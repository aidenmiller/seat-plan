import 'server-only'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { canvasSchema, type Author, type Canvas } from '@/domain/canvas-schema'
import { itemLabel } from '@/domain/item-labels'
import { cleanSeats, seatedGuestIds } from '@/domain/seat-cleanup'
import { renderThumbnailSvg } from '@/domain/thumbnail'
import { fixedItemsSchema, type FixedItem } from '@/domain/venue-schema'
import type { DroppedSeat, LayoutKind } from '@/shared/api'
import { guests, layoutSeats, layouts, venueTemplates, weddings, type RecentSave } from './db/schema'
import { weddingLock, type Tx } from './locks'

/**
 * writeCanvas(): the one way a layout's canvas reaches the database (PLAN
 * section 5, "Saving layouts"). Saves, creates, duplicates, "keep mine" copies,
 * guest removal, and later restore and seed all come through here, so every
 * stored canvas is checked, holds no seat for a removed, unknown or doubly
 * seated guest, and matches its layout_seats rows and thumbnail.
 *
 * Call it inside a transaction. In order it:
 *  1. checks the canvas with canvasSchema (before the lock, so a bad body never waits);
 *  2. takes the wedding lock in shared mode, then (save and rewrite) locks the
 *     layout row, so a template change cannot slip in before the thumbnail;
 *  3. loads which seated guest ids are live in this wedding and which were removed;
 *  4. empties the seats that must go (cleanSeats);
 *  5. writes the row (see the modes below), with a fresh thumbnail;
 *  6. rebuilds layout_seats for the layout, with item labels.
 *
 * Modes:
 *  - 'save': the editor's PUT. Lands only if the stored version is baseVersion,
 *    then raises it by one and puts { saveId, version } at the front of
 *    recent_saves (the newest MAX_RECENT_SAVES). A retry of a save that already
 *    landed (its saveId is in recent_saves, or is last_save_id) answers
 *    'already-saved' with the version that save made; any other mismatch is a
 *    'conflict'.
 *  - 'insert': a new layout (create, duplicate, keep mine as a copy). Version 1,
 *    no recent saves.
 *  - 'rewrite': guest removal and the like. Keeps version, last_save_id,
 *    recent_saves, edited_by and updated_at, so nobody with the layout open gets a conflict
 *    (PLAN change 7). Works on deleted layouts too, so restoring one never brings
 *    back a removed guest's seat.
 */

export type WriteCanvasArgs =
  | {
      mode: 'save'
      weddingId: string
      layoutId: string
      canvas: unknown
      baseVersion: number
      saveId: string
      editedBy: Author
    }
  | {
      mode: 'insert'
      weddingId: string
      layoutId: string
      canvas: unknown
      name: string
      kind: LayoutKind
      venueTemplateId: string | null
      editedBy: Author | null
    }
  | { mode: 'rewrite'; weddingId: string; layoutId: string; canvas: unknown }

/** A dropped seat plus the name of its table or row, for summaries. */
export type DroppedSeatDetail = DroppedSeat & { itemLabel: string }

export type SavedState = { version: number; updatedAt: Date; editedBy: Author | null }

/** How many recent saves a layout remembers (layouts.recent_saves). */
export const MAX_RECENT_SAVES = 20

export type WriteCanvasResult =
  | ({ status: 'saved' | 'already-saved'; dropped: DroppedSeatDetail[] } & SavedState)
  | ({ status: 'conflict'; lastSaveId: string | null; recentSaveIds: string[] } & SavedState)
  /** existed: a retried insert whose row was already there (same id, same wedding). */
  | { status: 'created'; dropped: DroppedSeatDetail[]; existed: boolean }
  | { status: 'rewritten'; dropped: DroppedSeatDetail[] }
  /** insert: the id belongs to a deleted layout or another wedding's layout. */
  | { status: 'id-taken' }
  /** The layout or its wedding is missing or deleted. */
  | { status: 'gone' }
  | { status: 'invalid'; issues: string[] }

/** Zod issues as short lines: "items.3.seats: seats.length must equal seatCount". */
export function zodIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 50).map((issue) => {
    const where = issue.path.map(String).join('.')
    return where ? `${where}: ${issue.message}` : issue.message
  })
}

export async function writeCanvas(tx: Tx, args: WriteCanvasArgs): Promise<WriteCanvasResult> {
  const parsed = canvasSchema.safeParse(args.canvas)
  if (!parsed.success) return { status: 'invalid', issues: zodIssues(parsed.error) }

  await weddingLock(tx, args.weddingId, 'shared')

  switch (args.mode) {
    case 'save':
      return save(tx, args, parsed.data)
    case 'insert':
      return insert(tx, args, parsed.data)
    case 'rewrite':
      return rewrite(tx, args, parsed.data)
  }
}

async function save(
  tx: Tx,
  args: Extract<WriteCanvasArgs, { mode: 'save' }>,
  canvas: Canvas,
): Promise<WriteCanvasResult> {
  // Locks the row (after the wedding lock), so the template id read here is
  // still the layout's template when the thumbnail is drawn and written.
  const current = await lockCurrentState(tx, args.layoutId, args.weddingId)
  if (!current) return { status: 'gone' }

  const { canvas: clean, dropped } = await cleanForWedding(tx, args.weddingId, canvas)
  if (current.version !== args.baseVersion) return mismatch(current, args, dropped)

  const thumbSvg = renderThumbnailSvg(clean, await templateItems(tx, current.venueTemplateId))
  const recentSaves: RecentSave[] = [
    { saveId: args.saveId, version: args.baseVersion + 1 },
    ...current.recentSaves.filter((r) => r.saveId !== args.saveId),
  ].slice(0, MAX_RECENT_SAVES)
  const [row] = await tx
    .update(layouts)
    .set({
      canvas: clean,
      version: sql`${layouts.version} + 1`,
      lastSaveId: args.saveId,
      recentSaves,
      editedBy: args.editedBy,
      updatedAt: sql`now()`,
      thumbSvg,
    })
    .where(
      and(
        eq(layouts.id, args.layoutId),
        eq(layouts.weddingId, args.weddingId),
        isNull(layouts.deletedAt),
        eq(layouts.version, args.baseVersion),
        sql`exists (select 1 from "weddings" w where w."id" = "layouts"."wedding_id" and w."deleted_at" is null)`,
      ),
    )
    .returning({ version: layouts.version, updatedAt: layouts.updatedAt, editedBy: layouts.editedBy })

  if (!row) {
    // Cannot happen while the row is locked; kept so a mistake answers safely.
    const after = await lockCurrentState(tx, args.layoutId, args.weddingId)
    return after ? mismatch(after, args, dropped) : { status: 'gone' }
  }

  await rebuildSeats(tx, args.weddingId, args.layoutId, clean)
  return { status: 'saved', ...row, dropped }
}

async function insert(
  tx: Tx,
  args: Extract<WriteCanvasArgs, { mode: 'insert' }>,
  canvas: Canvas,
): Promise<WriteCanvasResult> {
  const [wedding] = await tx
    .select({ id: weddings.id })
    .from(weddings)
    .where(and(eq(weddings.id, args.weddingId), isNull(weddings.deletedAt)))
  if (!wedding) return { status: 'gone' }

  const { canvas: clean, dropped } = await cleanForWedding(tx, args.weddingId, canvas)
  const thumbSvg = renderThumbnailSvg(clean, await templateItems(tx, args.venueTemplateId))
  const inserted = await tx
    .insert(layouts)
    .values({
      id: args.layoutId,
      weddingId: args.weddingId,
      name: args.name,
      kind: args.kind,
      venueTemplateId: args.venueTemplateId,
      version: 1,
      lastSaveId: null,
      editedBy: args.editedBy,
      canvas: clean,
      thumbSvg,
    })
    .onConflictDoNothing({ target: layouts.id })
    .returning({ id: layouts.id })

  if (inserted.length === 0) {
    // A retried create: harmless when the first try made this very layout.
    const [existing] = await tx
      .select({ weddingId: layouts.weddingId, deletedAt: layouts.deletedAt })
      .from(layouts)
      .where(eq(layouts.id, args.layoutId))
    if (existing && existing.weddingId === args.weddingId && existing.deletedAt === null) {
      return { status: 'created', dropped: [], existed: true }
    }
    return { status: 'id-taken' }
  }

  await rebuildSeats(tx, args.weddingId, args.layoutId, clean)
  return { status: 'created', dropped, existed: false }
}

async function rewrite(
  tx: Tx,
  args: Extract<WriteCanvasArgs, { mode: 'rewrite' }>,
  canvas: Canvas,
): Promise<WriteCanvasResult> {
  // Wedding lock, then the layout row, as in save mode.
  const [row] = await tx
    .select({ venueTemplateId: layouts.venueTemplateId })
    .from(layouts)
    .where(and(eq(layouts.id, args.layoutId), eq(layouts.weddingId, args.weddingId)))
    .for('update')
  if (!row) return { status: 'gone' }

  const { canvas: clean, dropped } = await cleanForWedding(tx, args.weddingId, canvas)
  const thumbSvg = renderThumbnailSvg(clean, await templateItems(tx, row.venueTemplateId))
  await tx
    .update(layouts)
    // updated_at is set to itself, or drizzle's $onUpdate would move it to now.
    .set({ canvas: clean, thumbSvg, updatedAt: sql`${layouts.updatedAt}` })
    .where(and(eq(layouts.id, args.layoutId), eq(layouts.weddingId, args.weddingId)))
  await rebuildSeats(tx, args.weddingId, args.layoutId, clean)
  return { status: 'rewritten', dropped }
}

type CurrentState = SavedState & {
  lastSaveId: string | null
  recentSaves: RecentSave[]
  venueTemplateId: string | null
}

/**
 * Locks the layout row (FOR UPDATE, until the transaction ends) and reads its
 * save state. Null when it or its wedding is missing or deleted. Callers hold
 * the wedding lock first: wedding lock, then layout row, everywhere.
 */
async function lockCurrentState(tx: Tx, layoutId: string, weddingId: string): Promise<CurrentState | null> {
  const [row] = await tx
    .select({
      version: layouts.version,
      updatedAt: layouts.updatedAt,
      editedBy: layouts.editedBy,
      lastSaveId: layouts.lastSaveId,
      recentSaves: layouts.recentSaves,
      venueTemplateId: layouts.venueTemplateId,
    })
    .from(layouts)
    .innerJoin(weddings, eq(weddings.id, layouts.weddingId))
    .where(
      and(
        eq(layouts.id, layoutId),
        eq(layouts.weddingId, weddingId),
        isNull(layouts.deletedAt),
        isNull(weddings.deletedAt),
      ),
    )
    .for('update', { of: layouts })
  return row ? { ...row, recentSaves: recentSavesOf(row.recentSaves) } : null
}

/** The stored recent_saves, keeping only well-formed entries (newest first). */
export function recentSavesOf(value: unknown): RecentSave[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (r): r is RecentSave =>
      typeof r === 'object' && r !== null && typeof r.saveId === 'string' && Number.isInteger(r.version),
  )
}

function mismatch(
  current: CurrentState,
  args: Extract<WriteCanvasArgs, { mode: 'save' }>,
  dropped: DroppedSeatDetail[],
): WriteCanvasResult {
  const state = { version: current.version, updatedAt: current.updatedAt, editedBy: current.editedBy }
  // The same save landed before and its reply was lost, maybe with other saves
  // since. Answer with the version that save made, so the tab's next save
  // starts from there and meets any later save as a conflict. The seats it
  // dropped then are the ones dropped now, so the editor still hears about them.
  const earlier = current.recentSaves.find((r) => r.saveId === args.saveId)
  if (earlier && earlier.version !== current.version) {
    // Only ids and versions are kept, so the time is the layout's last save.
    return { status: 'already-saved', version: earlier.version, updatedAt: current.updatedAt, editedBy: args.editedBy, dropped }
  }
  if (earlier || current.lastSaveId === args.saveId) return { status: 'already-saved', ...state, dropped }
  return {
    status: 'conflict',
    ...state,
    lastSaveId: current.lastSaveId,
    recentSaveIds: current.recentSaves.map((r) => r.saveId),
  }
}

async function cleanForWedding(
  tx: Tx,
  weddingId: string,
  canvas: Canvas,
): Promise<{ canvas: Canvas; dropped: DroppedSeatDetail[] }> {
  const ids = seatedGuestIds(canvas)
  const live = new Set<string>()
  const deleted = new Set<string>()
  if (ids.length > 0) {
    const rows = await tx
      .select({ id: guests.id, deletedAt: guests.deletedAt })
      .from(guests)
      .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, ids)))
    for (const row of rows) (row.deletedAt === null ? live : deleted).add(row.id)
  }
  const result = cleanSeats(canvas, live, deleted)
  const labels = labelsById(canvas)
  return {
    canvas: result.canvas,
    dropped: result.dropped.map((d) => ({ ...d, itemLabel: labels.get(d.itemId) ?? '' })),
  }
}

function labelsById(canvas: Canvas): Map<string, string> {
  const labels = new Map<string, string>()
  for (const item of canvas.items) {
    if (item.kind === 'table' || item.kind === 'chairRow') labels.set(item.id, itemLabel(item))
  }
  return labels
}

/** The live template's fixed items, for the thumbnail. A deleted template draws nothing (DECISIONS 29). */
async function templateItems(tx: Tx, templateId: string | null): Promise<FixedItem[]> {
  if (!templateId) return []
  const [row] = await tx
    .select({ fixedItems: venueTemplates.fixedItems })
    .from(venueTemplates)
    .where(and(eq(venueTemplates.id, templateId), isNull(venueTemplates.deletedAt)))
  if (!row) return []
  const parsed = fixedItemsSchema.safeParse(row.fixedItems)
  return parsed.success ? parsed.data : []
}

const SEAT_ROWS_PER_INSERT = 1000

async function rebuildSeats(tx: Tx, weddingId: string, layoutId: string, canvas: Canvas): Promise<void> {
  await tx.delete(layoutSeats).where(eq(layoutSeats.layoutId, layoutId))
  const rows: (typeof layoutSeats.$inferInsert)[] = []
  for (const item of canvas.items) {
    if (item.kind !== 'table' && item.kind !== 'chairRow') continue
    const label = itemLabel(item)
    for (const seat of item.seats) {
      if (seat.guestId === null) continue
      rows.push({ weddingId, layoutId, guestId: seat.guestId, itemId: item.id, itemLabel: label, seatIndex: seat.index })
    }
  }
  for (let i = 0; i < rows.length; i += SEAT_ROWS_PER_INSERT) {
    await tx.insert(layoutSeats).values(rows.slice(i, i + SEAT_ROWS_PER_INSERT))
  }
}

/** Drops the itemLabel the server keeps for itself; the editor gets the contract's DroppedSeat. */
export function toDroppedSeats(dropped: readonly DroppedSeatDetail[]): DroppedSeat[] {
  return dropped.map(({ itemId, seatIndex, guestId, reason }) => ({ itemId, seatIndex, guestId, reason }))
}
