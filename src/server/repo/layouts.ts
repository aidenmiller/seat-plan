import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { emptyCanvas, type Canvas } from '@/domain/canvas-schema'
import { renderThumbnailSvg } from '@/domain/thumbnail'
import { fixedItemsSchema } from '@/domain/venue-schema'
import type {
  CreateLayoutBody,
  DuplicateLayoutBody,
  LayoutDeleteSummary,
  LayoutDetail,
  LayoutSummary,
  LayoutVersionInfo,
  SaveLayoutBody,
  UpdateLayoutBody,
} from '@/shared/api'
import { recentSavesOf, writeCanvas, type WriteCanvasResult } from '../canvas-write'
import { layouts, venueTemplates, weddings } from '../db/schema'
import { editorName } from '../editor-name'
import type { Db, Tx } from '../locks'

/**
 * Layouts. Every read and write here skips deleted layouts and layouts whose
 * wedding is deleted. Canvas writes go through writeCanvas().
 */

const MAX_NAME = 200

const liveLayout = (layoutId: string) =>
  and(eq(layouts.id, layoutId), isNull(layouts.deletedAt), isNull(weddings.deletedAt))

const summaryColumns = {
  id: layouts.id,
  weddingId: layouts.weddingId,
  name: layouts.name,
  kind: layouts.kind,
  venueTemplateId: layouts.venueTemplateId,
  venueName: venueTemplates.name,
  venueDeletedAt: venueTemplates.deletedAt,
  version: layouts.version,
  editedBy: editorName(layouts),
  editedById: layouts.editedByUserId,
  updatedAt: layouts.updatedAt,
  thumbSvg: layouts.thumbSvg,
}

type SummaryRow = {
  id: string
  weddingId: string
  name: string
  kind: 'reception' | 'ceremony'
  venueTemplateId: string | null
  venueName: string | null
  venueDeletedAt: Date | null
  version: number
  editedBy: string | null
  editedById: string | null
  updatedAt: Date
  thumbSvg: string
}

function toSummary(row: SummaryRow): LayoutSummary {
  return {
    id: row.id,
    weddingId: row.weddingId,
    name: row.name,
    kind: row.kind,
    venueTemplateId: row.venueTemplateId,
    venueName: row.venueTemplateId ? row.venueName : null,
    // The name stays the template's old name (DECISIONS 29).
    venueDeleted: row.venueTemplateId !== null && row.venueDeletedAt !== null,
    version: row.version,
    editedBy: row.editedBy,
    editedById: row.editedById,
    updatedAt: row.updatedAt.toISOString(),
    thumbSvg: row.thumbSvg,
  }
}

/** The wedding's live layouts, last edited first. Null when the wedding is missing or deleted. */
export async function listLayouts(db: Db, weddingId: string): Promise<LayoutSummary[] | null> {
  const [wedding] = await db
    .select({ id: weddings.id })
    .from(weddings)
    .where(and(eq(weddings.id, weddingId), isNull(weddings.deletedAt)))
  if (!wedding) return null
  const rows = await db
    .select(summaryColumns)
    .from(layouts)
    .leftJoin(venueTemplates, eq(venueTemplates.id, layouts.venueTemplateId))
    .where(and(eq(layouts.weddingId, weddingId), isNull(layouts.deletedAt)))
    .orderBy(desc(layouts.updatedAt), desc(layouts.id))
  return rows.map(toSummary)
}

/**
 * One layout with its canvas and template. The template is loaded whether or
 * not it was deleted, with a flag, so the editor can show the notice (DECISIONS 29).
 */
export async function getLayoutDetail(db: Db, layoutId: string): Promise<LayoutDetail | null> {
  const [row] = await db
    .select({
      ...summaryColumns,
      canvas: layouts.canvas,
      lastSaveId: layouts.lastSaveId,
      recentSaves: layouts.recentSaves,
      templateVersion: venueTemplates.version,
      templateFixedItems: venueTemplates.fixedItems,
    })
    .from(layouts)
    .innerJoin(weddings, eq(weddings.id, layouts.weddingId))
    .leftJoin(venueTemplates, eq(venueTemplates.id, layouts.venueTemplateId))
    .where(liveLayout(layoutId))
  if (!row) return null
  const template =
    row.venueTemplateId && row.venueName !== null && row.templateVersion !== null
      ? {
          id: row.venueTemplateId,
          name: row.venueName,
          version: row.templateVersion,
          fixedItems: row.templateFixedItems ?? [],
          deleted: row.venueDeletedAt !== null,
        }
      : null
  return {
    ...toSummary(row),
    canvas: row.canvas,
    lastSaveId: row.lastSaveId,
    recentSaveIds: recentSaveIdsOf(row.recentSaves),
    template,
  }
}

/** The ids in layouts.recent_saves, newest first. */
function recentSaveIdsOf(value: unknown): string[] {
  return recentSavesOf(value).map((r) => r.saveId)
}

export type CreateLayoutResult =
  | { status: 'created'; layout: LayoutDetail }
  | { status: 'not-found' }
  | { status: 'bad-template' }
  | { status: 'id-taken' }
  | { status: 'invalid'; issues: string[] }

/**
 * True when the template is live, holding a share lock on its row until the
 * transaction ends. A template delete locks the row for update and then counts
 * the layouts using it, so it waits for this layout write and sees it; a
 * write that waits behind a delete finds the template deleted.
 */
async function templateIsLive(tx: Tx, id: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: venueTemplates.id })
    .from(venueTemplates)
    .where(and(eq(venueTemplates.id, id), isNull(venueTemplates.deletedAt)))
    .for('share')
  return Boolean(row)
}

/** A new layout with an empty canvas. A chosen template must exist and not be deleted. */
export async function createLayout(db: Db, weddingId: string, body: CreateLayoutBody): Promise<CreateLayoutResult> {
  const layoutId = body.id ?? randomUUID()
  const result = await db.transaction(async (tx): Promise<WriteCanvasResult | { status: 'bad-template' }> => {
    const [wedding] = await tx
      .select({ id: weddings.id })
      .from(weddings)
      .where(and(eq(weddings.id, weddingId), isNull(weddings.deletedAt)))
    if (!wedding) return { status: 'gone' }
    if (body.venueTemplateId && !(await templateIsLive(tx, body.venueTemplateId))) return { status: 'bad-template' }
    return writeCanvas(tx, {
      mode: 'insert',
      weddingId,
      layoutId,
      canvas: emptyCanvas(),
      name: body.name,
      kind: body.kind,
      venueTemplateId: body.venueTemplateId,
      editedBy: body.editedBy,
    })
  })
  return afterInsert(db, layoutId, result)
}

async function afterInsert(
  db: Db,
  layoutId: string,
  result: WriteCanvasResult | { status: 'bad-template' | 'not-found' },
): Promise<CreateLayoutResult> {
  switch (result.status) {
    case 'created': {
      const layout = await getLayoutDetail(db, layoutId)
      return layout ? { status: 'created', layout } : { status: 'not-found' }
    }
    case 'bad-template':
    case 'id-taken':
      return { status: result.status }
    case 'invalid':
      return { status: 'invalid', issues: result.issues }
    default:
      return { status: 'not-found' }
  }
}

export type SaveLayoutResult = Extract<
  WriteCanvasResult,
  { status: 'saved' | 'already-saved' | 'conflict' | 'gone' | 'invalid' }
>

/** The editor's save (PUT /api/layouts/:id). See writeCanvas() for the answers. */
export async function saveLayout(db: Db, layoutId: string, body: SaveLayoutBody): Promise<SaveLayoutResult> {
  // A layout never moves between weddings, so its wedding id is safe to read first.
  const [row] = await db.select({ weddingId: layouts.weddingId }).from(layouts).where(eq(layouts.id, layoutId))
  if (!row) return { status: 'gone' }
  const result = await db.transaction((tx) =>
    writeCanvas(tx, {
      mode: 'save',
      weddingId: row.weddingId,
      layoutId,
      canvas: body.canvas,
      baseVersion: body.baseVersion,
      saveId: body.saveId,
      editedBy: body.editedBy,
    }),
  )
  switch (result.status) {
    case 'saved':
    case 'already-saved':
    case 'conflict':
    case 'gone':
    case 'invalid':
      return result
    default:
      return { status: 'gone' }
  }
}

export type UpdateLayoutResult = { status: 'updated'; layout: LayoutDetail } | { status: 'not-found' } | { status: 'bad-template' }

/**
 * Rename, or change the template (a live one, or null for a blank canvas).
 * Leaves the version, editor and last edited time alone: those follow canvas
 * saves only. A template change redraws the thumbnail.
 */
export async function updateLayout(db: Db, layoutId: string, body: UpdateLayoutBody): Promise<UpdateLayoutResult> {
  const outcome = await db.transaction(async (tx): Promise<UpdateLayoutResult['status']> => {
    const [row] = await tx
      .select({ canvas: layouts.canvas, venueTemplateId: layouts.venueTemplateId })
      .from(layouts)
      .innerJoin(weddings, eq(weddings.id, layouts.weddingId))
      .where(liveLayout(layoutId))
      .for('update', { of: layouts })
    if (!row) return 'not-found'

    const set: Partial<typeof layouts.$inferInsert> = {}
    if (body.name !== undefined) set.name = body.name
    if (body.venueTemplateId !== undefined && body.venueTemplateId !== row.venueTemplateId) {
      let fixedItems: Parameters<typeof renderThumbnailSvg>[1] = []
      if (body.venueTemplateId !== null) {
        // Share lock: a template delete waits for this change and then sees the layout (see templateIsLive).
        const [template] = await tx
          .select({ fixedItems: venueTemplates.fixedItems })
          .from(venueTemplates)
          .where(and(eq(venueTemplates.id, body.venueTemplateId), isNull(venueTemplates.deletedAt)))
          .for('share')
        if (!template) return 'bad-template'
        const parsed = fixedItemsSchema.safeParse(template.fixedItems)
        fixedItems = parsed.success ? parsed.data : []
      }
      set.venueTemplateId = body.venueTemplateId
      set.thumbSvg = renderThumbnailSvg(row.canvas, fixedItems)
    }
    if (Object.keys(set).length > 0) {
      await tx
        .update(layouts)
        .set({ ...set, updatedAt: sql`${layouts.updatedAt}` })
        .where(eq(layouts.id, layoutId))
    }
    return 'updated'
  })
  if (outcome !== 'updated') return { status: outcome }
  const layout = await getLayoutDetail(db, layoutId)
  return layout ? { status: 'updated', layout } : { status: 'not-found' }
}

/**
 * A copy of a layout with its tables, seats and notes (spec section 10), or,
 * for "keep mine as a new copy", with the canvas the editor sends. Same kind
 * and template. The default name is "<name> copy". Seats are kept; writeCanvas
 * drops any a removed guest still held.
 *
 * With a canvas, the source layout may be deleted (its wedding must be live):
 * that is "Save as a copy" after a save answered 410. Without one, a deleted
 * source is not found.
 */
export async function duplicateLayout(db: Db, layoutId: string, body: DuplicateLayoutBody): Promise<CreateLayoutResult> {
  const newId = body.id ?? randomUUID()
  const result = await db.transaction(async (tx): Promise<WriteCanvasResult | { status: 'not-found' }> => {
    const [source] = await tx
      .select({
        weddingId: layouts.weddingId,
        name: layouts.name,
        kind: layouts.kind,
        venueTemplateId: layouts.venueTemplateId,
        canvas: layouts.canvas,
      })
      .from(layouts)
      .innerJoin(weddings, eq(weddings.id, layouts.weddingId))
      .where(
        body.canvas
          ? and(eq(layouts.id, layoutId), isNull(weddings.deletedAt))
          : liveLayout(layoutId),
      )
    if (!source) return { status: 'not-found' }
    const canvas: Canvas = body.canvas ?? source.canvas
    return writeCanvas(tx, {
      mode: 'insert',
      weddingId: source.weddingId,
      layoutId: newId,
      canvas,
      name: body.name ?? copyName(source.name),
      kind: source.kind,
      venueTemplateId: source.venueTemplateId,
      editedBy: body.editedBy,
    })
  })
  return afterInsert(db, newId, result)
}

export function copyName(name: string): string {
  const suffix = ' copy'
  return `${name.slice(0, MAX_NAME - suffix.length).trimEnd()}${suffix}`
}

/** Marks the layout deleted. Other layouts, its seats and its share links stay as they are. */
export async function softDeleteLayout(db: Db, layoutId: string): Promise<boolean> {
  const updated = await db
    .update(layouts)
    .set({ deletedAt: sql`now()`, updatedAt: sql`${layouts.updatedAt}` })
    .where(
      and(
        eq(layouts.id, layoutId),
        isNull(layouts.deletedAt),
        sql`exists (select 1 from "weddings" w where w."id" = "layouts"."wedding_id" and w."deleted_at" is null)`,
      ),
    )
    .returning({ id: layouts.id })
  return updated.length > 0
}

/** What the delete dialog lists for a layout. */
export async function layoutDeleteSummary(db: Db, layoutId: string): Promise<LayoutDeleteSummary | null> {
  const [row] = await db
    .select({
      name: layouts.name,
      canvas: layouts.canvas,
      // Explicit table names: drizzle prints columns inside sql`` without
      // their table in some queries, which would change what they mean.
      seatedGuests: sql<number>`(select count(*)::int from "layout_seats" s where s."layout_id" = "layouts"."id")`,
      shareLinks: sql<number>`(select count(*)::int from "share_links" k where k."layout_id" = "layouts"."id" and k."revoked_at" is null)`,
    })
    .from(layouts)
    .innerJoin(weddings, eq(weddings.id, layouts.weddingId))
    .where(liveLayout(layoutId))
  if (!row) return null
  const items = Array.isArray(row.canvas?.items) ? row.canvas.items : []
  return {
    kind: 'layout',
    name: row.name,
    tables: items.filter((i) => i.kind === 'table').length,
    seatedGuests: Number(row.seatedGuests),
    notes: items.filter((i) => i.kind === 'note').length,
    shareLinks: Number(row.shareLinks),
  }
}

/** The cheap check a tab makes when it regains focus. */
export async function layoutVersion(db: Db, layoutId: string): Promise<LayoutVersionInfo | null> {
  const [row] = await db
    .select({
      version: layouts.version,
      updatedAt: layouts.updatedAt,
      editedBy: editorName(layouts),
      editedById: layouts.editedByUserId,
      lastSaveId: layouts.lastSaveId,
      recentSaves: layouts.recentSaves,
    })
    .from(layouts)
    .innerJoin(weddings, eq(weddings.id, layouts.weddingId))
    .where(liveLayout(layoutId))
  if (!row) return null
  return {
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    editedBy: row.editedBy,
    editedById: row.editedById,
    lastSaveId: row.lastSaveId,
    recentSaveIds: recentSaveIdsOf(row.recentSaves),
  }
}
