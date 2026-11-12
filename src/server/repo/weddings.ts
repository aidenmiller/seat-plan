import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { CreateWeddingBody, UpdateWeddingBody, WeddingDeleteSummary, WeddingSummary } from '@/shared/api'
import { weddingMembers, weddings } from '../db/schema'
import type { Db } from '../locks'
import { recordEvent } from './activity'

/**
 * Weddings. Deleting one marks only the wedding row (DECISIONS 32); every
 * other query skips rows whose wedding is marked. Who may open a wedding is
 * the guards' business (src/server/auth/guards.ts); the functions here that
 * take a wedding id trust that the caller checked.
 */

/*
 * Counts as correlated subqueries. Written with explicit table names: in a
 * select from one table, drizzle prints columns inside sql`` without their
 * table, which would make "id" mean the inner table's id.
 */
const liveGuestCount = sql<number>`(select count(*)::int from "guests" g where g."wedding_id" = "weddings"."id" and g."deleted_at" is null)`
const liveLayoutCount = sql<number>`(select count(*)::int from "layouts" l where l."wedding_id" = "weddings"."id" and l."deleted_at" is null)`
const groupCount = sql<number>`(select count(*)::int from "groups" g where g."wedding_id" = "weddings"."id")`
const ruleCount = sql<number>`(select count(*)::int from "rules" r where r."wedding_id" = "weddings"."id")`

const summaryColumns = {
  id: weddings.id,
  name: weddings.name,
  date: weddings.date,
  unit: weddings.unit,
  minGapCm: weddings.minGapCm,
  partner1Name: weddings.partner1Name,
  partner2Name: weddings.partner2Name,
  updatedAt: weddings.updatedAt,
  guestCount: liveGuestCount,
  layoutCount: liveLayoutCount,
}

type SummaryRow = {
  id: string
  name: string
  date: string | null
  unit: 'ft' | 'm'
  minGapCm: number
  partner1Name: string | null
  partner2Name: string | null
  updatedAt: Date
  guestCount: number
  layoutCount: number
}

function toSummary(row: SummaryRow): WeddingSummary {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    unit: row.unit,
    minGapCm: row.minGapCm,
    partner1Name: row.partner1Name,
    partner2Name: row.partner2Name,
    guestCount: Number(row.guestCount),
    layoutCount: Number(row.layoutCount),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Live weddings, oldest first, with live guest and layout counts. */
export async function listWeddings(db: Db): Promise<WeddingSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(weddings)
    .where(isNull(weddings.deletedAt))
    .orderBy(asc(weddings.createdAt), asc(weddings.id))
  return rows.map(toSummary)
}

/**
 * The live weddings the user belongs to (any role), in listWeddings' order.
 * An admin gets only their own memberships here too.
 */
export async function listWeddingsForUser(db: Db, userId: string): Promise<WeddingSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(weddings)
    .innerJoin(weddingMembers, and(eq(weddingMembers.weddingId, weddings.id), eq(weddingMembers.userId, userId)))
    .where(isNull(weddings.deletedAt))
    .orderBy(asc(weddings.createdAt), asc(weddings.id))
  return rows.map(toSummary)
}

export async function getWedding(db: Db, id: string): Promise<WeddingSummary | null> {
  const [row] = await db
    .select(summaryColumns)
    .from(weddings)
    .where(and(eq(weddings.id, id), isNull(weddings.deletedAt)))
  return row ? toSummary(row) : null
}

/** True when the wedding exists and is not deleted. */
export async function weddingIsLive(db: Db, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: weddings.id })
    .from(weddings)
    .where(and(eq(weddings.id, id), isNull(weddings.deletedAt)))
  return Boolean(row)
}

export type CreateWeddingResult = { status: 'created'; wedding: WeddingSummary; existed: boolean } | { status: 'id-taken' }

/**
 * Creates a wedding with its creator as its owner, in one transaction, and
 * logs wedding_created. The browser may choose the id, so a retried create
 * gives back the wedding the first try made, but only to someone who already
 * belongs to it. Anyone else gets 'id-taken' and learns nothing about the
 * wedding (whether it is live, deleted, or whose); so does a retry for a
 * wedding deleted since.
 */
export async function createWedding(db: Db, body: CreateWeddingBody, userId: string): Promise<CreateWeddingResult> {
  const id = (body.id ?? randomUUID()).toLowerCase()
  const outcome = await db.transaction(async (tx): Promise<'created' | 'existed' | 'id-taken'> => {
    const inserted = await tx
      .insert(weddings)
      .values({ id, name: body.name, date: body.date ?? null, unit: body.unit ?? 'ft', partner1Name: body.partner1Name ?? null, partner2Name: body.partner2Name ?? null })
      .onConflictDoNothing({ target: weddings.id })
      .returning({ id: weddings.id })
    if (inserted.length === 0) {
      const [mine] = await tx
        .select({ id: weddings.id })
        .from(weddings)
        .innerJoin(weddingMembers, and(eq(weddingMembers.weddingId, weddings.id), eq(weddingMembers.userId, userId)))
        .where(and(eq(weddings.id, id), isNull(weddings.deletedAt)))
      return mine ? 'existed' : 'id-taken'
    }
    await tx.insert(weddingMembers).values({ weddingId: id, userId, role: 'owner', addedByUserId: null })
    await recordEvent(tx, { kind: 'wedding_created', userId, weddingId: id })
    return 'created'
  })
  if (outcome === 'id-taken') return { status: 'id-taken' }
  const wedding = await getWedding(db, id)
  return wedding ? { status: 'created', wedding, existed: outcome === 'existed' } : { status: 'id-taken' }
}

/** Name, date, unit, minimum gap and the partners' names. Null when the wedding is missing or deleted. */
export async function updateWedding(db: Db, id: string, body: UpdateWeddingBody): Promise<WeddingSummary | null> {
  const set: Partial<typeof weddings.$inferInsert> = {}
  if (body.name !== undefined) set.name = body.name
  if (body.date !== undefined) set.date = body.date
  if (body.unit !== undefined) set.unit = body.unit
  if (body.minGapCm !== undefined) set.minGapCm = body.minGapCm
  if (body.partner1Name !== undefined) set.partner1Name = body.partner1Name
  if (body.partner2Name !== undefined) set.partner2Name = body.partner2Name
  const updated = await db
    .update(weddings)
    .set(set)
    .where(and(eq(weddings.id, id), isNull(weddings.deletedAt)))
    .returning({ id: weddings.id })
  if (updated.length === 0) return null
  return getWedding(db, id)
}

/** Marks the wedding row only. False when it was missing or already deleted. */
export async function softDeleteWedding(db: Db, id: string): Promise<boolean> {
  const updated = await db
    .update(weddings)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(weddings.id, id), isNull(weddings.deletedAt)))
    .returning({ id: weddings.id })
  return updated.length > 0
}

/** What the delete dialog lists: "This also deletes 6 layouts, 142 guests, 9 groups and 14 rules." */
export async function weddingDeleteSummary(db: Db, id: string): Promise<WeddingDeleteSummary | null> {
  const [row] = await db
    .select({
      name: weddings.name,
      layouts: liveLayoutCount,
      guests: liveGuestCount,
      groups: groupCount,
      rules: ruleCount,
    })
    .from(weddings)
    .where(and(eq(weddings.id, id), isNull(weddings.deletedAt)))
  if (!row) return null
  return {
    kind: 'wedding',
    name: row.name,
    layouts: Number(row.layouts),
    guests: Number(row.guests),
    groups: Number(row.groups),
    rules: Number(row.rules),
  }
}
