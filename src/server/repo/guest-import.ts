import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { ImportRow } from '@/domain/csv/columns'
import { planImport, type ExistingGuest, type ImportOptions, type ImportPlan } from '@/domain/csv/import-diff'
import type { PartnerRef } from '@/domain/csv/partner-match'
import { nextGroupColors } from '@/domain/group-colors'
import { nameKey } from '@/domain/names'
import type { ImportCommitResult, ImportPreview, importCommitBody, importPreviewBody } from '@/shared/api'
import { groupMembers, groups, guests, weddings } from '../db/schema'
import { weddingLock, type Db, type Tx } from '../locks'
import { chunks, newGuestValues, removeGuestsLocked, seatPlaces, setPartnerPairs, sortSeatPlaces } from './guests'

/**
 * The guest CSV import (spec section 6, PLAN section 7 and change 10). The
 * browser parses the file and matches columns; the server builds the plan
 * itself with planImport, for the preview and again inside the commit, and
 * never applies a plan the browser sends.
 */

type Conn = Db | Tx

/** The checked body, with rows as the domain's ImportRow (what applyMapping makes). */
export type ImportPreviewInput = Omit<z.output<typeof importPreviewBody>, 'rows'> & { rows: readonly ImportRow[] }
export type ImportCommitInput = Omit<z.output<typeof importCommitBody>, 'rows'> & { rows: readonly ImportRow[] }

type GroupRow = { id: string; name: string; color: string }

/** The wedding's live guests as the plan needs them, and all its groups. */
async function loadForPlan(conn: Conn, weddingId: string, lockGuests: boolean) {
  const query = conn
    .select()
    .from(guests)
    .where(and(eq(guests.weddingId, weddingId), isNull(guests.deletedAt)))
    .orderBy(asc(guests.id))
  // The commit locks every live guest in id order, like a removal, so no
  // field edit lands between building the plan and applying it.
  const rows = lockGuests ? await query.for('update') : await query
  const groupRows: GroupRow[] = await conn
    .select({ id: groups.id, name: groups.name, color: groups.color })
    .from(groups)
    .where(eq(groups.weddingId, weddingId))
    .orderBy(asc(groups.createdAt), asc(groups.id))
  const memberships = await conn
    .select({ guestId: groupMembers.guestId, groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.weddingId, weddingId))
  const groupName = new Map(groupRows.map((g) => [g.id, g.name]))
  const namesOf = new Map<string, string[]>()
  for (const m of memberships) {
    const name = groupName.get(m.groupId)
    if (name === undefined) continue
    const list = namesOf.get(m.guestId)
    if (list) list.push(name)
    else namesOf.set(m.guestId, [name])
  }
  const existing: ExistingGuest[] = rows.map((g) => ({
    id: g.id,
    firstName: g.firstName,
    lastName: g.lastName,
    nickname: g.nickname,
    partnerId: g.partnerId,
    household: g.household,
    side: g.side,
    rsvp: g.rsvp,
    meal: g.meal,
    isChild: g.isChild,
    notes: g.notes,
    groups: namesOf.get(g.id) ?? [],
  }))
  return { existing, groupRows }
}

function planOf(body: ImportPreviewInput, existing: ExistingGuest[], groupRows: GroupRow[]): ImportPlan {
  const options: ImportOptions = {
    existingGroupNames: groupRows.map((g) => g.name),
    reviewPicks: body.reviewPicks ?? {},
    partnerPicks: body.partnerPicks ?? {},
  }
  return planImport(body.rows, existing, options)
}

async function weddingIsLive(conn: Conn, weddingId: string): Promise<boolean> {
  const [row] = await conn
    .select({ id: weddings.id })
    .from(weddings)
    .where(and(eq(weddings.id, weddingId), isNull(weddings.deletedAt)))
  return Boolean(row)
}

/**
 * The re-import summary: the plan against the live guests, and where each
 * guest missing from the file sits (live layouts only). Null when the
 * wedding is missing or deleted.
 */
export async function previewImport(db: Db, weddingId: string, body: ImportPreviewInput): Promise<ImportPreview | null> {
  // One snapshot, so the plan and the seats agree.
  return db.transaction(
    async (tx) => {
      if (!(await weddingIsLive(tx, weddingId))) return null
      const { existing, groupRows } = await loadForPlan(tx, weddingId, false)
      const plan = planOf(body, existing, groupRows)
      const missingSeats = await seatPlaces(
        tx,
        weddingId,
        plan.missing.map((m) => m.guestId),
      )
      return { plan, missingSeats }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

export type CommitImportResult =
  | { status: 'done'; result: ImportCommitResult }
  | { status: 'not-found' }
  /** Needs-review rows without a pick. Nothing was saved. */
  | { status: 'needs-review'; items: { rowNumber: number; message: string }[] }
  /** The missing guests differ from the ones the summary showed. Nothing was saved. */
  | { status: 'stale' }

const sameSet = (a: readonly string[], b: readonly string[]) => {
  const x = new Set(a)
  const y = new Set(b)
  return x.size === y.size && [...x].every((v) => y.has(v))
}

/**
 * Applies an import in one transaction under the exclusive wedding lock:
 * builds the plan again, refuses while any needs-review row has no pick,
 * then creates groups, updates and creates guests, adds memberships, sets
 * partner links both ways, and (when asked) removes the guests missing from
 * the file the way removeGuests does, clearing their seats in every layout.
 */
export async function commitImport(db: Db, weddingId: string, body: ImportCommitInput): Promise<CommitImportResult> {
  return db.transaction(async (tx): Promise<CommitImportResult> => {
    await weddingLock(tx, weddingId, 'exclusive')
    if (!(await weddingIsLive(tx, weddingId))) return { status: 'not-found' }
    const { existing, groupRows } = await loadForPlan(tx, weddingId, true)
    const plan = planOf(body, existing, groupRows)

    if (plan.needsReview.length > 0) {
      return {
        status: 'needs-review',
        items: plan.needsReview.map((r) => ({ rowNumber: r.rowNumber, message: r.message })),
      }
    }
    const missingIds = plan.missing.map((m) => m.guestId)
    // The body schema requires the list with removeMissing; a missing one counts as empty here too.
    if (body.removeMissing && !sameSet(missingIds, body.missingGuestIds ?? [])) {
      return { status: 'stale' }
    }

    // 1. Groups named in the file that do not exist yet.
    const groupIdByName = new Map(groupRows.map((g) => [g.name.toLowerCase(), g.id]))
    let groupsCreated = 0
    if (plan.groupsToCreate.length > 0) {
      const colors = nextGroupColors(
        groupRows.map((g) => g.color),
        plan.groupsToCreate.length,
      )
      const values = plan.groupsToCreate.map((name, i) => ({ id: randomUUID(), weddingId, name, color: colors[i]! }))
      const inserted = await tx.insert(groups).values(values).onConflictDoNothing().returning({ id: groups.id, name: groups.name })
      groupsCreated = inserted.length
      for (const g of inserted) groupIdByName.set(g.name.toLowerCase(), g.id)
    }
    const groupIdOf = async (name: string): Promise<string> => {
      const known = groupIdByName.get(name.toLowerCase())
      if (known) return known
      // Postgres's lower() and JavaScript's can differ on rare letters.
      const [row] = await tx
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.weddingId, weddingId), sql`lower(${groups.name}) = lower(${name})`))
      if (!row) throw new Error(`Import: group "${name}" was neither found nor created`)
      groupIdByName.set(name.toLowerCase(), row.id)
      return row.id
    }

    // 2. Changed guests: only the fields that change.
    const rowIds = new Map<number, string>()
    const existingById = new Map(existing.map((g) => [g.id, g]))
    for (const c of plan.changed) {
      rowIds.set(c.rowNumber, c.guestId)
      if (Object.keys(c.patch).length === 0) continue
      const before = existingById.get(c.guestId)!
      const set: Partial<typeof guests.$inferInsert> = { ...c.patch }
      if (c.patch.firstName !== undefined || c.patch.lastName !== undefined) {
        set.nameKey = nameKey(c.patch.firstName ?? before.firstName, c.patch.lastName ?? before.lastName)
      }
      await tx
        .update(guests)
        .set(set)
        .where(and(eq(guests.weddingId, weddingId), eq(guests.id, c.guestId)))
    }
    for (const u of plan.unchanged) rowIds.set(u.rowNumber, u.guestId)

    // 3. New guests.
    const newValues = plan.newGuests.map((n) => {
      const id = randomUUID()
      rowIds.set(n.rowNumber, id)
      return newGuestValues(weddingId, id, n.guest)
    })
    for (const part of chunks(newValues)) await tx.insert(guests).values(part)

    // 4. Memberships: groups are only added, never taken away.
    const memberValues: { weddingId: string; groupId: string; guestId: string }[] = []
    for (const n of plan.newGuests) {
      for (const name of n.groups) memberValues.push({ weddingId, groupId: await groupIdOf(name), guestId: rowIds.get(n.rowNumber)! })
    }
    for (const c of plan.changed) {
      for (const name of c.addGroups) memberValues.push({ weddingId, groupId: await groupIdOf(name), guestId: c.guestId })
    }
    let membershipsAdded = 0
    for (const part of chunks(memberValues)) {
      const inserted = await tx.insert(groupMembers).values(part).onConflictDoNothing().returning({ guestId: groupMembers.guestId })
      membershipsAdded += inserted.length
    }

    // 5. Partner links, both ways. Every existing guest is locked already.
    const idOf = (ref: PartnerRef): string => {
      const id = ref.guestId ?? (ref.rowNumber !== null ? rowIds.get(ref.rowNumber) : undefined)
      if (!id) throw new Error(`Import: a partner link names an unknown person: ${JSON.stringify(ref)}`)
      return id
    }
    await setPartnerPairs(
      tx,
      weddingId,
      plan.partnerLinks.map((link) => [idOf(link.a), idOf(link.b)] as const),
    )

    // 6. Guests missing from the file, when asked: the same steps as removeGuests.
    let removed = 0
    let clearedSeats: ImportCommitResult['clearedSeats'] = []
    if (body.removeMissing && missingIds.length > 0) {
      const result = await removeGuestsLocked(tx, weddingId, missingIds)
      removed = result.removed.length
      clearedSeats = sortSeatPlaces(result.clearedSeats)
    }

    return {
      status: 'done',
      result: {
        created: plan.newGuests.length,
        updated: plan.changed.length,
        unchanged: plan.unchanged.length,
        groupsCreated,
        membershipsAdded,
        partnersLinked: plan.partnerLinks.length,
        removed,
        clearedSeats,
      },
    }
  })
}
