import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { Guest, StoredRule, createRuleBody, updateRuleBody } from '@/shared/api'
import { guests, ruleGuests, rules, weddings } from '../db/schema'
import { weddingLock, type Db, type Tx } from '../locks'
import { guestsByIds } from './guests'

/**
 * Seating rules (spec section 7, "Rules"; PLAN section 4). Stored rules are
 * deleted outright, their guest links with them (DECISIONS 31). A removed
 * guest's link stays, hidden: a rule left with fewer than two live guests
 * reads as "needs guests" (PLAN change 7). Couple rules have no rows (PLAN
 * change 8): setCoupleRule flips the switch on both partners.
 *
 * Writes take the wedding lock shared, so they never run while a removal or
 * an import holds it exclusive; the couple switch takes it exclusive, like a
 * partner change.
 */

type Conn = Db | Tx

export type CreateRuleInput = z.output<typeof createRuleBody>
export type UpdateRuleInput = z.output<typeof updateRuleBody>

type RuleRow = typeof rules.$inferSelect

export const RULE_GUESTS_ISSUE = 'guestIds: Some of these guests are not on this wedding’s guest list'
export const NEXT_TO_APART_ISSUE = 'nextToEachOther: Next to each other is only for together rules'
export const COUPLE_UNLINKED_MESSAGE = 'These two are no longer partners. Reload the page to see the change.'

function toRule(row: RuleRow, guestIds: readonly string[]): StoredRule {
  return {
    id: row.id,
    weddingId: row.weddingId,
    kind: row.kind,
    guestIds: [...guestIds],
    nextToEachOther: row.nextToEachOther,
    appliesTo: row.appliesTo,
    enabled: row.enabled,
    note: row.note,
    needsGuests: guestIds.length < 2,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function weddingIsLive(conn: Conn, weddingId: string): Promise<boolean> {
  const [row] = await conn
    .select({ id: weddings.id })
    .from(weddings)
    .where(and(eq(weddings.id, weddingId), isNull(weddings.deletedAt)))
  return Boolean(row)
}

/** Live guests per rule, by last name then first name. */
async function guestIdsByRule(conn: Conn, weddingId: string, ruleIds: readonly string[] | null): Promise<Map<string, string[]>> {
  const rows = await conn
    .select({ ruleId: ruleGuests.ruleId, guestId: ruleGuests.guestId })
    .from(ruleGuests)
    .innerJoin(guests, eq(guests.id, ruleGuests.guestId))
    .where(
      and(
        eq(ruleGuests.weddingId, weddingId),
        isNull(guests.deletedAt),
        ruleIds === null ? undefined : inArray(ruleGuests.ruleId, [...ruleIds]),
      ),
    )
    .orderBy(sql`lower(${guests.lastName})`, sql`lower(${guests.firstName})`, asc(guests.id))
  const out = new Map<string, string[]>()
  for (const r of rows) {
    const list = out.get(r.ruleId)
    if (list) list.push(r.guestId)
    else out.set(r.ruleId, [r.guestId])
  }
  return out
}

/**
 * A rule of this live wedding. The routes pass the wedding their guard
 * resolved, so a rule of any other wedding reads as missing.
 */
async function liveRule(conn: Conn, weddingId: string, ruleId: string): Promise<RuleRow | null> {
  const [row] = await conn
    .select({ rule: rules })
    .from(rules)
    .innerJoin(weddings, eq(weddings.id, rules.weddingId))
    .where(and(eq(rules.id, ruleId), eq(rules.weddingId, weddingId), isNull(weddings.deletedAt)))
  return row?.rule ?? null
}

async function getRule(conn: Conn, weddingId: string, ruleId: string): Promise<StoredRule | null> {
  const row = await liveRule(conn, weddingId, ruleId)
  if (!row) return null
  const ids = await guestIdsByRule(conn, row.weddingId, [row.id])
  return toRule(row, ids.get(row.id) ?? [])
}

/** The wedding's stored rules, oldest first. Null when the wedding is missing or deleted. */
export async function listRules(db: Conn, weddingId: string): Promise<StoredRule[] | null> {
  if (!(await weddingIsLive(db, weddingId))) return null
  const rows = await db.select().from(rules).where(eq(rules.weddingId, weddingId)).orderBy(asc(rules.createdAt), asc(rules.id))
  const ids = await guestIdsByRule(db, weddingId, null)
  return rows.map((row) => toRule(row, ids.get(row.id) ?? []))
}

/** True when every id is a live guest of the wedding. */
async function allLiveGuests(tx: Tx, weddingId: string, ids: readonly string[]): Promise<boolean> {
  const wanted = [...new Set(ids)]
  const rows = await tx
    .select({ id: guests.id })
    .from(guests)
    .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, wanted), isNull(guests.deletedAt)))
  return rows.length === wanted.length
}

/**
 * Replaces the rule's guests with live ones. Links to removed guests stay,
 * hidden (PLAN section 5), so undoing a removal in the database brings them back.
 */
async function setRuleGuests(tx: Tx, weddingId: string, ruleId: string, guestIds: readonly string[]): Promise<void> {
  const liveLinks = await tx
    .select({ guestId: ruleGuests.guestId })
    .from(ruleGuests)
    .innerJoin(guests, eq(guests.id, ruleGuests.guestId))
    .where(and(eq(ruleGuests.ruleId, ruleId), isNull(guests.deletedAt)))
  const wanted = new Set(guestIds)
  const drop = liveLinks.map((l) => l.guestId).filter((id) => !wanted.has(id))
  if (drop.length > 0) await tx.delete(ruleGuests).where(and(eq(ruleGuests.ruleId, ruleId), inArray(ruleGuests.guestId, drop)))
  await tx
    .insert(ruleGuests)
    .values([...wanted].map((guestId) => ({ weddingId, ruleId, guestId })))
    .onConflictDoNothing()
}

export type CreateRuleResult =
  | { status: 'created'; rule: StoredRule }
  | { status: 'not-found' }
  | { status: 'id-taken' }
  | { status: 'invalid'; issues: string[] }

/** Creates a rule. A retry with the same id gives the same rule back. */
export async function createRule(db: Db, weddingId: string, body: CreateRuleInput): Promise<CreateRuleResult> {
  return db.transaction(async (tx): Promise<CreateRuleResult> => {
    await weddingLock(tx, weddingId, 'shared')
    if (!(await weddingIsLive(tx, weddingId))) return { status: 'not-found' }
    const id = body.id?.toLowerCase() ?? randomUUID()
    if (body.id) {
      const [existing] = await tx.select({ weddingId: rules.weddingId }).from(rules).where(eq(rules.id, id))
      if (existing) {
        if (existing.weddingId !== weddingId) return { status: 'id-taken' }
        return { status: 'created', rule: (await getRule(tx, weddingId, id))! }
      }
    }
    if (!(await allLiveGuests(tx, weddingId, body.guestIds))) return { status: 'invalid', issues: [RULE_GUESTS_ISSUE] }
    await tx.insert(rules).values({
      id,
      weddingId,
      kind: body.kind,
      nextToEachOther: body.kind === 'together' && body.nextToEachOther === true,
      appliesTo: body.appliesTo ?? 'both',
      enabled: body.enabled ?? true,
      note: body.note ?? null,
    })
    await setRuleGuests(tx, weddingId, id, body.guestIds)
    return { status: 'created', rule: (await getRule(tx, weddingId, id))! }
  })
}

export type UpdateRuleResult = { status: 'updated'; rule: StoredRule } | { status: 'not-found' } | { status: 'invalid'; issues: string[] }

/**
 * Saves the fields sent. Turning a rule into an apart rule turns next to each
 * other off. 'not-found' for a rule of another wedding.
 */
export async function updateRule(db: Db, weddingId: string, ruleId: string, body: UpdateRuleInput): Promise<UpdateRuleResult> {
  if (!(await liveRule(db, weddingId, ruleId))) return { status: 'not-found' }
  return db.transaction(async (tx): Promise<UpdateRuleResult> => {
    await weddingLock(tx, weddingId, 'shared')
    const row = await liveRule(tx, weddingId, ruleId)
    if (!row) return { status: 'not-found' }
    const kind = body.kind ?? row.kind
    if (kind === 'apart' && body.nextToEachOther === true) return { status: 'invalid', issues: [NEXT_TO_APART_ISSUE] }
    if (body.guestIds && !(await allLiveGuests(tx, row.weddingId, body.guestIds))) {
      return { status: 'invalid', issues: [RULE_GUESTS_ISSUE] }
    }
    const set: Partial<typeof rules.$inferInsert> = { updatedAt: new Date() }
    if (body.kind !== undefined) set.kind = body.kind
    if (body.nextToEachOther !== undefined) set.nextToEachOther = body.nextToEachOther
    if (kind === 'apart') set.nextToEachOther = false
    if (body.appliesTo !== undefined) set.appliesTo = body.appliesTo
    if (body.enabled !== undefined) set.enabled = body.enabled
    if (body.note !== undefined) set.note = body.note
    await tx.update(rules).set(set).where(and(eq(rules.id, row.id), eq(rules.weddingId, weddingId)))
    if (body.guestIds) await setRuleGuests(tx, weddingId, row.id, body.guestIds)
    return { status: 'updated', rule: (await getRule(tx, weddingId, row.id))! }
  })
}

/** Deletes the rule outright. False when missing, of another wedding, or in a deleted wedding. */
export async function deleteRule(db: Db, weddingId: string, ruleId: string): Promise<boolean> {
  const row = await liveRule(db, weddingId, ruleId)
  if (!row) return false
  const deleted = await db
    .delete(rules)
    .where(and(eq(rules.id, row.id), eq(rules.weddingId, weddingId)))
    .returning({ id: rules.id })
  return deleted.length > 0
}

export type CoupleRuleResult =
  | { status: 'updated'; guests: Guest[] }
  | { status: 'not-found' }
  /** The two are no longer linked to each other: nothing changed. */
  | { status: 'conflict'; message: string; guests: Guest[] }

/**
 * Switches a couple rule on or off (PLAN change 8): the switch is set on both
 * partners in one transaction, under the wedding lock held exclusive, as for
 * a partner change. The two must still be live partners of each other.
 *
 * `weddingId` is the wedding the route's guard resolved from the first
 * guest. Both guests must belong to it, or the answer is 'not-found' and
 * nothing is read or changed: the guard only looked at the first. (A second
 * guest of this wedding who was removed still gets 'conflict' below.)
 */
export async function setCoupleRule(db: Db, weddingId: string, pair: readonly [string, string], enabled: boolean): Promise<CoupleRuleResult> {
  const [a, b] = pair
  const found = await db
    .select({ id: guests.id, deletedAt: guests.deletedAt })
    .from(guests)
    .innerJoin(weddings, eq(weddings.id, guests.weddingId))
    .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, [a, b]), isNull(weddings.deletedAt)))
  const first = found.find((g) => g.id === a)
  if (!first || first.deletedAt !== null || !found.some((g) => g.id === b)) return { status: 'not-found' }
  return db.transaction(async (tx): Promise<CoupleRuleResult> => {
    await weddingLock(tx, weddingId, 'exclusive')
    const locked = await tx
      .select({ id: guests.id, partnerId: guests.partnerId })
      .from(guests)
      .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, [a, b]), isNull(guests.deletedAt)))
      .orderBy(asc(guests.id))
      .for('no key update')
    const partner = new Map(locked.map((g) => [g.id, g.partnerId]))
    if (partner.get(a) !== b || partner.get(b) !== a) {
      return { status: 'conflict', message: COUPLE_UNLINKED_MESSAGE, guests: await guestsByIds(tx, weddingId, [a, b]) }
    }
    await tx
      .update(guests)
      .set({ coupleRuleEnabled: enabled })
      .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, [a, b])))
    return { status: 'updated', guests: await guestsByIds(tx, weddingId, [a, b]) }
  })
}
