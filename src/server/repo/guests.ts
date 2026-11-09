import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { nameKey } from '@/domain/names'
import type {
  Guest,
  GuestDeleteSummary,
  GuestSeatPlace,
  createGuestBody,
  updateGuestBody,
} from '@/shared/api'
import { writeCanvas } from '../canvas-write'
import { groupMembers, groups, guests, layoutSeats, layouts, weddings } from '../db/schema'
import { weddingLock, type Db, type Tx } from '../locks'

/**
 * Guests (spec section 6, PLAN sections 4 and 5). Every query skips deleted
 * guests and guests of deleted weddings. Field edits save one row at a time;
 * partner links, removal and the CSV import take the wedding lock exclusive
 * and lock the guests they touch in id order, so they never interleave with a
 * layout save or with each other.
 */

/** A connection or a transaction: both run the same queries. */
type Conn = Db | Tx

export type CreateGuestInput = z.output<typeof createGuestBody>
export type UpdateGuestInput = z.output<typeof updateGuestBody>

type GuestRow = typeof guests.$inferSelect

function toGuest(row: GuestRow, groupIds: readonly string[]): Guest {
  return {
    id: row.id,
    weddingId: row.weddingId,
    firstName: row.firstName,
    lastName: row.lastName,
    nickname: row.nickname,
    partnerId: row.partnerId,
    coupleRuleEnabled: row.coupleRuleEnabled,
    household: row.household,
    side: row.side,
    rsvp: row.rsvp,
    meal: row.meal,
    isChild: row.isChild,
    notes: row.notes,
    groupIds: [...groupIds],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const liveWedding = (weddingId: string) => and(eq(weddings.id, weddingId), isNull(weddings.deletedAt))

/**
 * Live guests whose partner is one of `ids`. Removal clears partner_id on
 * the guests it marks deleted, so only live guests hold one, and the
 * deleted_at test lets Postgres use the partial unique index
 * guests_partner_live_uq instead of reading the whole wedding.
 */
const partnerOfAny = (ids: readonly string[]) => and(inArray(guests.partnerId, [...ids]), isNull(guests.deletedAt))

/** A Postgres uuid[] literal for one query parameter. Ids are checked uuids, so no quoting is needed. */
const uuidArray = (ids: readonly string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`

async function weddingIsLive(conn: Conn, weddingId: string): Promise<boolean> {
  const [row] = await conn.select({ id: weddings.id }).from(weddings).where(liveWedding(weddingId))
  return Boolean(row)
}

/** Group ids per guest, in group name order. Only the guests asked for (all of the wedding's when null). */
async function groupIdsByGuest(conn: Conn, weddingId: string, guestIds: readonly string[] | null) {
  const rows = await conn
    .select({ guestId: groupMembers.guestId, groupId: groupMembers.groupId })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groupMembers.weddingId, weddingId),
        guestIds === null ? undefined : inArray(groupMembers.guestId, [...guestIds]),
      ),
    )
    .orderBy(sql`lower(${groups.name})`, asc(groups.id))
  const out = new Map<string, string[]>()
  for (const r of rows) {
    const list = out.get(r.guestId)
    if (list) list.push(r.groupId)
    else out.set(r.guestId, [r.groupId])
  }
  return out
}

/** The live guests of a wedding, by last name then first name. Null when the wedding is missing or deleted. */
export async function listGuests(db: Conn, weddingId: string): Promise<Guest[] | null> {
  if (!(await weddingIsLive(db, weddingId))) return null
  const rows = await db
    .select()
    .from(guests)
    .where(and(eq(guests.weddingId, weddingId), isNull(guests.deletedAt)))
    .orderBy(sql`lower(${guests.lastName})`, sql`lower(${guests.firstName})`, asc(guests.createdAt), asc(guests.id))
  const memberships = await groupIdsByGuest(db, weddingId, null)
  return rows.map((row) => toGuest(row, memberships.get(row.id) ?? []))
}

/** Live guests of one wedding by id, in the order asked. Missing and deleted ones are left out. */
export async function guestsByIds(conn: Conn, weddingId: string, ids: readonly string[]): Promise<Guest[]> {
  const wanted = [...new Set(ids)]
  if (wanted.length === 0) return []
  const rows = await conn
    .select()
    .from(guests)
    .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, wanted), isNull(guests.deletedAt)))
  const memberships = await groupIdsByGuest(conn, weddingId, wanted)
  const byId = new Map(rows.map((r) => [r.id, r]))
  return wanted.flatMap((id) => {
    const row = byId.get(id)
    return row ? [toGuest(row, memberships.get(id) ?? [])] : []
  })
}

/** The live wedding a live guest belongs to, or null. */
async function weddingOfGuest(conn: Conn, guestId: string): Promise<string | null> {
  const [row] = await conn
    .select({ weddingId: guests.weddingId })
    .from(guests)
    .innerJoin(weddings, eq(weddings.id, guests.weddingId))
    .where(and(eq(guests.id, guestId), isNull(guests.deletedAt), isNull(weddings.deletedAt)))
  return row?.weddingId ?? null
}

// ---------------------------------------------------------------------------
// Create

export type CreateGuestsResult =
  | { status: 'created'; guests: Guest[] }
  /** The wedding is missing or deleted. */
  | { status: 'not-found' }
  /** An id the browser chose belongs to another wedding or a removed guest. */
  | { status: 'id-taken' }

export type CreateGuestResult = { status: 'created'; guest: Guest } | { status: 'not-found' } | { status: 'id-taken' }

/** The guests row for a new guest. name_key always comes from nameKey(). */
export function newGuestValues(weddingId: string, id: string, body: Omit<CreateGuestInput, 'id'>): typeof guests.$inferInsert {
  return {
    id,
    weddingId,
    firstName: body.firstName,
    lastName: body.lastName,
    nameKey: nameKey(body.firstName, body.lastName),
    nickname: body.nickname ?? null,
    household: body.household ?? null,
    side: body.side ?? 'Both',
    rsvp: body.rsvp ?? 'pending',
    meal: body.meal ?? null,
    isChild: body.isChild ?? false,
    notes: body.notes ?? null,
  }
}

class IdTaken extends Error {}

/** Rows per insert statement, well under Postgres's 65,535 parameters. */
export const INSERT_CHUNK = 1000

export function chunks<T>(list: readonly T[], size = INSERT_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * Adds guests in one transaction (pasted names, or one guest by hand). The
 * browser may choose ids, so a retried request gives back the guests the
 * first try made; an id used by another wedding or a removed guest refuses
 * the whole request.
 */
export async function addGuestsBulk(
  db: Db,
  weddingId: string,
  bodies: readonly CreateGuestInput[],
): Promise<CreateGuestsResult> {
  try {
    return await db.transaction(async (tx) => {
      if (!(await weddingIsLive(tx, weddingId))) return { status: 'not-found' } as const
      const values = bodies.map((b) => newGuestValues(weddingId, b.id?.toLowerCase() ?? randomUUID(), b))
      const ids = values.map((v) => v.id!)
      const inserted = new Set<string>()
      for (const part of chunks(values)) {
        const rows = await tx.insert(guests).values(part).onConflictDoNothing({ target: guests.id }).returning({ id: guests.id })
        for (const r of rows) inserted.add(r.id)
      }
      const retried = ids.filter((id) => !inserted.has(id))
      if (retried.length > 0) {
        const mine = await tx
          .select({ id: guests.id })
          .from(guests)
          .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, retried), isNull(guests.deletedAt)))
        if (mine.length !== retried.length) throw new IdTaken()
      }
      return { status: 'created', guests: await guestsByIds(tx, weddingId, ids) } as const
    })
  } catch (err) {
    if (err instanceof IdTaken) return { status: 'id-taken' }
    throw err
  }
}

/** Adds one guest. */
export async function createGuest(db: Db, weddingId: string, body: CreateGuestInput): Promise<CreateGuestResult> {
  const result = await addGuestsBulk(db, weddingId, [body])
  return result.status === 'created' ? { status: 'created', guest: result.guests[0]! } : result
}

// ---------------------------------------------------------------------------
// Partner links (PLAN section 5, "Partner links", and change 8)

/**
 * Links a and b both ways. Clears any earlier partner of either, and turns
 * the couple rule on for a, b and the partners they leave. Nothing changes
 * when they are already linked. The caller holds the exclusive wedding lock
 * and the row locks. Returns every guest id whose row changed.
 */
export async function setPartners(tx: Tx, weddingId: string, a: string, b: string): Promise<string[]> {
  const pair = await tx
    .select({ id: guests.id, partnerId: guests.partnerId })
    .from(guests)
    .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, [a, b])))
  if (pair.length === 2 && pair.every((g) => g.partnerId === (g.id === a ? b : a))) return []
  // Clear first: partner_id is unique among live guests, checked row by row.
  const cleared = await tx
    .update(guests)
    .set({ partnerId: null, coupleRuleEnabled: true })
    .where(and(eq(guests.weddingId, weddingId), or(inArray(guests.id, [a, b]), partnerOfAny([a, b]))))
    .returning({ id: guests.id })
  await tx
    .update(guests)
    .set({ partnerId: b, coupleRuleEnabled: true })
    .where(and(eq(guests.weddingId, weddingId), eq(guests.id, a)))
  await tx
    .update(guests)
    .set({ partnerId: a, coupleRuleEnabled: true })
    .where(and(eq(guests.weddingId, weddingId), eq(guests.id, b)))
  return [...new Set([a, b, ...cleared.map((r) => r.id)])]
}

/**
 * Links many pairs at once, with what setPartners does for each: any
 * earlier partner of either side is unlinked, and the couple rule is on for
 * everyone involved. Two statements in all, so a 400-guest import does not
 * wait on hundreds of round trips. The pairs must not share a person; the
 * import plan never makes such pairs, and this throws if it gets one. The
 * caller holds the exclusive wedding lock and the row locks.
 */
export async function setPartnerPairs(tx: Tx, weddingId: string, pairs: readonly (readonly [string, string])[]): Promise<void> {
  if (pairs.length === 0) return
  const ids = pairs.flat()
  if (new Set(ids).size !== ids.length) throw new Error('setPartnerPairs: a guest is in two pairs')
  // Clear every link that touches them, so no new value meets an old one in the unique index.
  await tx
    .update(guests)
    .set({ partnerId: null, coupleRuleEnabled: true })
    .where(
      and(
        eq(guests.weddingId, weddingId),
        or(sql`${guests.id} = any(${uuidArray(ids)})`, and(sql`${guests.partnerId} = any(${uuidArray(ids)})`, isNull(guests.deletedAt))),
      ),
    )
  const from = [...pairs.map(([a]) => a), ...pairs.map(([, b]) => b)]
  const to = [...pairs.map(([, b]) => b), ...pairs.map(([a]) => a)]
  await tx.execute(sql`
    update ${guests} as g
    set "partner_id" = v.partner_id, "couple_rule_enabled" = true
    from unnest(${uuidArray(from)}, ${uuidArray(to)}) as v(id, partner_id)
    where g."wedding_id" = ${weddingId} and g."id" = v.id`)
}

/** Unlinks a from their partner on both sides, couple rule back on for both. Returns the ids that changed. */
export async function clearPartner(tx: Tx, weddingId: string, a: string): Promise<string[]> {
  const [me] = await tx
    .select({ partnerId: guests.partnerId })
    .from(guests)
    .where(and(eq(guests.weddingId, weddingId), eq(guests.id, a)))
  const linkedBack = await tx
    .select({ id: guests.id })
    .from(guests)
    .where(and(eq(guests.weddingId, weddingId), partnerOfAny([a])))
  if (!me?.partnerId && linkedBack.length === 0) return []
  const cleared = await tx
    .update(guests)
    .set({ partnerId: null, coupleRuleEnabled: true })
    .where(and(eq(guests.weddingId, weddingId), or(eq(guests.id, a), partnerOfAny([a]))))
    .returning({ id: guests.id })
  return cleared.map((r) => r.id)
}

/**
 * Locks live guests of the wedding in id order, so two writers never wait on
 * each other in a circle. "No key update" is the lock an update of these
 * columns takes anyway; it lets a seat or group member that points at the
 * guest be written meanwhile.
 */
async function lockGuests(tx: Tx, weddingId: string, ids: readonly string[]) {
  const wanted = [...new Set(ids)]
  if (wanted.length === 0) return [] as { id: string; partnerId: string | null }[]
  return tx
    .select({ id: guests.id, partnerId: guests.partnerId })
    .from(guests)
    .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, wanted), isNull(guests.deletedAt)))
    .orderBy(asc(guests.id))
    .for('no key update')
}

// ---------------------------------------------------------------------------
// Update

export const PARTNER_CONFLICT_MESSAGE = 'Someone else just changed this partner link. Check it and try again.'
export const PARTNER_GONE_MESSAGE = 'That guest is no longer on the guest list.'

export type UpdateGuestResult =
  | { status: 'updated'; guest: Guest; alsoChanged: Guest[] }
  | { status: 'not-found' }
  | { status: 'self-partner' }
  | { status: 'conflict'; message: string; guests: Guest[] }

class PartnerConflict extends Error {
  constructor(
    readonly weddingId: string,
    readonly involved: string[],
    readonly plainMessage: string,
  ) {
    super(plainMessage)
  }
}

/**
 * Saves the fields a PATCH sends (PLAN section 5: one row, only the changed
 * fields). A partner change or the couple rule switch takes the wedding lock
 * exclusive, locks the up to four guests involved in id order, and answers
 * 'conflict' (nothing saved) when a link changed since the browser last saw
 * it (expectedPartners) or the new partner is gone.
 */
export async function updateGuest(db: Db, guestId: string, body: UpdateGuestInput): Promise<UpdateGuestResult> {
  if (body.partnerId !== undefined && body.partnerId !== null && body.partnerId.toLowerCase() === guestId) {
    return { status: 'self-partner' }
  }
  try {
    return await db.transaction(async (tx): Promise<UpdateGuestResult> => {
      const weddingId = await weddingOfGuest(tx, guestId)
      if (!weddingId) return { status: 'not-found' }
      const newPartner = body.partnerId === undefined || body.partnerId === null ? body.partnerId : body.partnerId.toLowerCase()
      const linking = newPartner !== undefined || body.coupleRuleEnabled !== undefined

      let involved = [guestId]
      if (linking) {
        await weddingLock(tx, weddingId, 'exclusive')
        // Under the exclusive lock nobody else changes a link, so these reads hold.
        const pair = await tx
          .select({ id: guests.id, partnerId: guests.partnerId })
          .from(guests)
          .where(
            and(
              eq(guests.weddingId, weddingId),
              inArray(guests.id, newPartner ? [guestId, newPartner] : [guestId]),
              isNull(guests.deletedAt),
            ),
          )
        involved = [guestId, ...(newPartner ? [newPartner] : []), ...pair.flatMap((g) => (g.partnerId ? [g.partnerId] : []))]
      }
      const locked = await lockGuests(tx, weddingId, involved)
      const current = new Map(locked.map((g) => [g.id, g.partnerId]))
      if (!current.has(guestId)) return { status: 'not-found' }

      if (newPartner !== undefined) {
        if (newPartner !== null && !current.has(newPartner)) {
          throw new PartnerConflict(weddingId, involved, PARTNER_GONE_MESSAGE)
        }
        for (const [id, expected] of Object.entries(body.expectedPartners ?? {})) {
          const key = id.toLowerCase()
          const seen = expected === null ? null : expected.toLowerCase()
          const now = current.has(key) ? current.get(key) : await partnerOfLive(tx, weddingId, key)
          if (now === undefined || now !== seen) throw new PartnerConflict(weddingId, involved, PARTNER_CONFLICT_MESSAGE)
        }
      }

      const set: Partial<typeof guests.$inferInsert> = {}
      for (const field of ['firstName', 'lastName', 'nickname', 'household', 'side', 'rsvp', 'meal', 'isChild', 'notes'] as const) {
        if (body[field] !== undefined) (set as Record<string, unknown>)[field] = body[field]
      }
      if (body.firstName !== undefined || body.lastName !== undefined) {
        const [names] = await tx
          .select({ firstName: guests.firstName, lastName: guests.lastName })
          .from(guests)
          .where(eq(guests.id, guestId))
        set.nameKey = nameKey(body.firstName ?? names!.firstName, body.lastName ?? names!.lastName)
      }
      const touched = new Set<string>()
      if (Object.keys(set).length > 0) {
        await tx.update(guests).set(set).where(eq(guests.id, guestId))
      }
      if (newPartner !== undefined) {
        const changed = newPartner === null ? await clearPartner(tx, weddingId, guestId) : await setPartners(tx, weddingId, guestId, newPartner)
        for (const id of changed) touched.add(id)
      }
      if (body.coupleRuleEnabled !== undefined) {
        const [me] = await tx.select({ partnerId: guests.partnerId }).from(guests).where(eq(guests.id, guestId))
        const ids = me?.partnerId ? [guestId, me.partnerId] : [guestId]
        await tx
          .update(guests)
          .set({ coupleRuleEnabled: body.coupleRuleEnabled })
          .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, ids)))
        for (const id of ids) touched.add(id)
      }
      touched.delete(guestId)
      const [guest] = await guestsByIds(tx, weddingId, [guestId])
      return { status: 'updated', guest: guest!, alsoChanged: await guestsByIds(tx, weddingId, [...touched].sort()) }
    })
  } catch (err) {
    if (!(err instanceof PartnerConflict)) throw err
    return {
      status: 'conflict',
      message: err.plainMessage,
      guests: await guestsByIds(db, err.weddingId, err.involved),
    }
  }
}

/** A live guest's partner id (null for none), or undefined when the guest is not live in this wedding. */
async function partnerOfLive(tx: Tx, weddingId: string, guestId: string): Promise<string | null | undefined> {
  const [row] = await tx
    .select({ partnerId: guests.partnerId })
    .from(guests)
    .where(and(eq(guests.weddingId, weddingId), eq(guests.id, guestId), isNull(guests.deletedAt)))
  return row ? row.partnerId : undefined
}

// ---------------------------------------------------------------------------
// Seats, delete summary and delete

/** Where these guests sit in the wedding's live layouts, by layout name, then table, then guest. */
export async function seatPlaces(conn: Conn, weddingId: string, guestIds: readonly string[]): Promise<GuestSeatPlace[]> {
  const wanted = [...new Set(guestIds)]
  if (wanted.length === 0) return []
  const rows = await conn
    .select({
      guestId: layoutSeats.guestId,
      layoutId: layoutSeats.layoutId,
      layoutName: layouts.name,
      itemLabel: layoutSeats.itemLabel,
    })
    .from(layoutSeats)
    .innerJoin(layouts, eq(layouts.id, layoutSeats.layoutId))
    .where(and(eq(layoutSeats.weddingId, weddingId), inArray(layoutSeats.guestId, wanted), isNull(layouts.deletedAt)))
  return sortSeatPlaces(rows)
}

/** Where every live guest sits in the wedding's live layouts. Null when the wedding is missing or deleted. */
export async function weddingSeatPlaces(conn: Conn, weddingId: string): Promise<GuestSeatPlace[] | null> {
  if (!(await weddingIsLive(conn, weddingId))) return null
  const rows = await conn
    .select({
      guestId: layoutSeats.guestId,
      layoutId: layoutSeats.layoutId,
      layoutName: layouts.name,
      itemLabel: layoutSeats.itemLabel,
    })
    .from(layoutSeats)
    .innerJoin(layouts, eq(layouts.id, layoutSeats.layoutId))
    .innerJoin(guests, eq(guests.id, layoutSeats.guestId))
    .where(and(eq(layoutSeats.weddingId, weddingId), isNull(layouts.deletedAt), isNull(guests.deletedAt)))
  return sortSeatPlaces(rows)
}

export function sortSeatPlaces<T extends GuestSeatPlace>(places: readonly T[]): T[] {
  const opts = { numeric: true, sensitivity: 'base' } as const
  return [...places].sort(
    (a, b) =>
      a.layoutName.localeCompare(b.layoutName, 'en', opts) ||
      a.layoutId.localeCompare(b.layoutId) ||
      a.itemLabel.localeCompare(b.itemLabel, 'en', opts) ||
      a.guestId.localeCompare(b.guestId),
  )
}

/** What the guest delete dialog lists. Null when the guest or the wedding is missing or deleted. */
export async function guestDeleteSummary(db: Db, guestId: string): Promise<GuestDeleteSummary | null> {
  const weddingId = await weddingOfGuest(db, guestId)
  if (!weddingId) return null
  const [me] = await guestsByIds(db, weddingId, [guestId])
  if (!me) return null
  const [partner] = me.partnerId ? await guestsByIds(db, weddingId, [me.partnerId]) : []
  const [counts] = await db
    .select({
      // Explicit table names, as in weddings.ts: drizzle prints columns inside sql`` without their table.
      groups: sql<number>`(select count(*)::int from "group_members" m where m."guest_id" = ${guestId})`,
      rules: sql<number>`(select count(*)::int from "rule_guests" r where r."guest_id" = ${guestId})`,
    })
    .from(weddings)
    .where(eq(weddings.id, weddingId))
  return {
    kind: 'guest',
    name: `${me.firstName} ${me.lastName}`,
    seats: await seatPlaces(db, weddingId, [guestId]),
    partnerName: partner ? `${partner.firstName} ${partner.lastName}` : null,
    groups: Number(counts?.groups ?? 0),
    rules: Number(counts?.rules ?? 0),
  }
}

/**
 * Removes one guest through removeGuests: seats cleared in every layout,
 * partner unlinked. Null when the guest or the wedding is missing or deleted.
 */
export async function deleteGuest(db: Db, guestId: string): Promise<{ clearedSeats: GuestSeatPlace[] } | null> {
  const weddingId = await weddingOfGuest(db, guestId)
  if (!weddingId) return null
  const result = await removeGuests(db, weddingId, [guestId])
  if (!result || result.removed.length === 0) return null
  return { clearedSeats: sortSeatPlaces(result.clearedSeats) }
}

// ---------------------------------------------------------------------------
// Removal (PLAN change 7)

/** A seat emptied because its guest was removed. */
export type ClearedSeat = { layoutId: string; layoutName: string; itemLabel: string; guestId: string }

export type RemoveGuestsResult = {
  /** Guests marked deleted by this call. Unknown and already removed ids are skipped. */
  removed: string[]
  /** Seats emptied in live layouts. Deleted layouts are rewritten too, but not listed. */
  clearedSeats: ClearedSeat[]
}

/**
 * Removes guests from a wedding (PLAN change 7 and section 5, "Removing a
 * guest"), all in one transaction:
 *  - takes the wedding lock exclusive, so no save runs halfway through;
 *  - locks the guests and their partners in id order, so two removals never deadlock;
 *  - marks the guests deleted;
 *  - clears the partner link on both sides and turns the couple rule switch
 *    back on for each former partner (PLAN change 8);
 *  - empties their seats in every layout that seats them, deleted layouts
 *    too (so restoring one never brings a seat back), through writeCanvas's
 *    rewrite mode, which keeps each layout's version, so an editor with the
 *    layout open can still save. Only seats in live layouts are reported;
 *    nobody can see a deleted layout, so naming it would only confuse;
 *  - deletes their layout_seats rows.
 * Their group and rule links stay, hidden, so undoing the delete in the
 * database brings those back.
 *
 * Null when the wedding is missing or deleted.
 */
export async function removeGuests(
  db: Db,
  weddingId: string,
  guestIds: readonly string[],
): Promise<RemoveGuestsResult | null> {
  return db.transaction(async (tx) => {
    await weddingLock(tx, weddingId, 'exclusive')
    if (!(await weddingIsLive(tx, weddingId))) return null
    return removeGuestsLocked(tx, weddingId, guestIds)
  })
}

/**
 * The body of removeGuests, for a transaction that already holds the
 * exclusive wedding lock on a live wedding (the CSV import uses it to remove
 * the guests missing from the file).
 */
export async function removeGuestsLocked(
  tx: Tx,
  weddingId: string,
  guestIds: readonly string[],
): Promise<RemoveGuestsResult> {
  const wanted = [...new Set(guestIds)]
  if (wanted.length === 0) return { removed: [], clearedSeats: [] }

  // Who goes, and everyone linked to them as a partner either way.
  const targets = await tx
    .select({ id: guests.id, partnerId: guests.partnerId })
    .from(guests)
    .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, wanted), isNull(guests.deletedAt)))
  const removed = targets.map((t) => t.id).sort()
  if (removed.length === 0) return { removed: [], clearedSeats: [] }
  const removedSet = new Set(removed)
  const linkedBack = await tx
    .select({ id: guests.id })
    .from(guests)
    .where(and(eq(guests.weddingId, weddingId), partnerOfAny(removed)))
  const partners = new Set<string>()
  for (const t of targets) if (t.partnerId && !removedSet.has(t.partnerId)) partners.add(t.partnerId)
  for (const r of linkedBack) if (!removedSet.has(r.id)) partners.add(r.id)

  await tx
    .select({ id: guests.id })
    .from(guests)
    .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, [...removed, ...partners])))
    .orderBy(asc(guests.id))
    .for('update')

  await tx
    .update(guests)
    .set({ deletedAt: sql`now()`, partnerId: null })
    .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, removed)))
  await tx
    .update(guests)
    .set({ partnerId: null, coupleRuleEnabled: true })
    .where(and(eq(guests.weddingId, weddingId), partnerOfAny(removed), notInArray(guests.id, removed)))

  // Every layout that seats them, deleted layouts too, locked in id order.
  const seated = await tx
    .selectDistinct({ layoutId: layoutSeats.layoutId })
    .from(layoutSeats)
    .where(and(eq(layoutSeats.weddingId, weddingId), inArray(layoutSeats.guestId, removed)))
  const clearedSeats: ClearedSeat[] = []
  if (seated.length > 0) {
    const affected = await tx
      .select({ id: layouts.id, name: layouts.name, canvas: layouts.canvas, deletedAt: layouts.deletedAt })
      .from(layouts)
      .where(
        and(
          eq(layouts.weddingId, weddingId),
          inArray(
            layouts.id,
            seated.map((s) => s.layoutId),
          ),
        ),
      )
      .orderBy(asc(layouts.id))
      .for('update')
    for (const layout of affected) {
      const result = await writeCanvas(tx, { mode: 'rewrite', weddingId, layoutId: layout.id, canvas: layout.canvas })
      if (result.status !== 'rewritten') {
        throw new Error(`Could not clear seats in layout ${layout.id}: ${result.status}`)
      }
      if (layout.deletedAt !== null) continue
      for (const d of result.dropped) {
        if (removedSet.has(d.guestId)) {
          clearedSeats.push({ layoutId: layout.id, layoutName: layout.name, itemLabel: d.itemLabel, guestId: d.guestId })
        }
      }
    }
  }
  await tx
    .delete(layoutSeats)
    .where(and(eq(layoutSeats.weddingId, weddingId), inArray(layoutSeats.guestId, removed)))

  return { removed, clearedSeats }
}
