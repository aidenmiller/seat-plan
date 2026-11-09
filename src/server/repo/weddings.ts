import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { CreateWeddingBody, UpdateWeddingBody, WeddingDeleteSummary, WeddingSummary } from '@/shared/api'
import { weddings } from '../db/schema'
import type { Db } from '../locks'

/**
 * Weddings. Deleting one marks only the wedding row (DECISIONS 32); every
 * other query skips rows whose wedding is marked.
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

/**
 * Creates a wedding. The browser may choose the id, so a retried create gives
 * back the wedding the first try made. 'id-taken' when that id belongs to a
 * deleted wedding.
 */
export async function createWedding(
  db: Db,
  body: CreateWeddingBody,
): Promise<{ status: 'created'; wedding: WeddingSummary } | { status: 'id-taken' }> {
  const id = body.id ?? randomUUID()
  await db
    .insert(weddings)
    .values({ id, name: body.name, date: body.date ?? null, unit: body.unit ?? 'ft' })
    .onConflictDoNothing({ target: weddings.id })
  const wedding = await getWedding(db, id)
  return wedding ? { status: 'created', wedding } : { status: 'id-taken' }
}

/** Name, date, unit and minimum gap. Null when the wedding is missing or deleted. */
export async function updateWedding(db: Db, id: string, body: UpdateWeddingBody): Promise<WeddingSummary | null> {
  const set: Partial<typeof weddings.$inferInsert> = {}
  if (body.name !== undefined) set.name = body.name
  if (body.date !== undefined) set.date = body.date
  if (body.unit !== undefined) set.unit = body.unit
  if (body.minGapCm !== undefined) set.minGapCm = body.minGapCm
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
