import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { nextGroupColor } from '@/domain/group-colors'
import type { Group, createGroupBody, updateGroupBody } from '@/shared/api'
import { groupMembers, groups, guests, weddings } from '../db/schema'
import { weddingLock, type Db, type Tx } from '../locks'

/**
 * Named groups (spec section 7, "Groups"). Deleted outright, members with
 * them (DECISIONS 31). Names are unique in a wedding ignoring case (a unique
 * index on lower(name)). Adding members takes the wedding lock shared, so it
 * never runs while a removal or an import holds it exclusive and has the
 * guests locked.
 */

type Conn = Db | Tx

export type CreateGroupInput = z.output<typeof createGroupBody>
export type UpdateGroupInput = z.output<typeof updateGroupBody>

export const NAME_TAKEN_MESSAGE = 'A group with that name already exists.'
export const NOT_THIS_WEDDING_ISSUE = 'guestIds: Some of these guests are not on this wedding’s guest list'

type GroupRow = typeof groups.$inferSelect

function toGroup(row: GroupRow, memberIds: readonly string[]): Group {
  return {
    id: row.id,
    weddingId: row.weddingId,
    name: row.name,
    color: row.color,
    memberIds: [...memberIds],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Live members per group, in the order they joined. */
async function memberIdsByGroup(conn: Conn, weddingId: string, groupIds: readonly string[] | null) {
  const rows = await conn
    .select({ groupId: groupMembers.groupId, guestId: groupMembers.guestId })
    .from(groupMembers)
    .innerJoin(guests, eq(guests.id, groupMembers.guestId))
    .where(
      and(
        eq(groupMembers.weddingId, weddingId),
        isNull(guests.deletedAt),
        groupIds === null ? undefined : inArray(groupMembers.groupId, [...groupIds]),
      ),
    )
    .orderBy(asc(groupMembers.createdAt), asc(groupMembers.guestId))
  const out = new Map<string, string[]>()
  for (const r of rows) {
    const list = out.get(r.groupId)
    if (list) list.push(r.guestId)
    else out.set(r.groupId, [r.guestId])
  }
  return out
}

async function weddingIsLive(conn: Conn, weddingId: string): Promise<boolean> {
  const [row] = await conn
    .select({ id: weddings.id })
    .from(weddings)
    .where(and(eq(weddings.id, weddingId), isNull(weddings.deletedAt)))
  return Boolean(row)
}

/** A group in a live wedding. */
async function liveGroup(conn: Conn, groupId: string): Promise<GroupRow | null> {
  const [row] = await conn
    .select({ group: groups })
    .from(groups)
    .innerJoin(weddings, eq(weddings.id, groups.weddingId))
    .where(and(eq(groups.id, groupId), isNull(weddings.deletedAt)))
  return row?.group ?? null
}

async function getGroup(conn: Conn, groupId: string): Promise<Group | null> {
  const row = await liveGroup(conn, groupId)
  if (!row) return null
  const members = await memberIdsByGroup(conn, row.weddingId, [row.id])
  return toGroup(row, members.get(row.id) ?? [])
}

/** The wedding's groups by name, ignoring case, with live members. Null when the wedding is missing or deleted. */
export async function listGroups(db: Conn, weddingId: string): Promise<Group[] | null> {
  if (!(await weddingIsLive(db, weddingId))) return null
  const rows = await db
    .select()
    .from(groups)
    .where(eq(groups.weddingId, weddingId))
    .orderBy(sql`lower(${groups.name})`, asc(groups.id))
  const members = await memberIdsByGroup(db, weddingId, null)
  return rows.map((row) => toGroup(row, members.get(row.id) ?? []))
}

/** The Postgres error behind a drizzle error, if any. */
function pgError(err: unknown): { code?: string; constraint?: string } | null {
  let current: unknown = err
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return current as { code?: string; constraint?: string }
    current = (current as { cause?: unknown }).cause
  }
  return null
}

/** True when a write broke the unique group name (case ignored). */
export function isGroupNameTaken(err: unknown): boolean {
  const pg = pgError(err)
  return pg?.code === '23505' && pg.constraint === 'groups_wedding_name_uq'
}

async function nameTaken(conn: Conn, weddingId: string, name: string, exceptId?: string): Promise<boolean> {
  const [row] = await conn
    .select({ id: groups.id })
    .from(groups)
    .where(
      and(
        eq(groups.weddingId, weddingId),
        sql`lower(${groups.name}) = lower(${name})`,
        exceptId ? sql`${groups.id} <> ${exceptId}` : undefined,
      ),
    )
  return Boolean(row)
}

export type GroupMembersResult =
  | { status: 'done'; group: Group; added: string[] }
  | { status: 'not-found' }
  /** Some guests are not live guests of the group's wedding. */
  | { status: 'invalid'; issues: string[] }

/**
 * Adds members inside a transaction that holds the wedding lock (shared or
 * exclusive). Skips guests already in the group. Refuses the lot when any is
 * not a live guest of this wedding.
 */
async function addMembersLocked(
  tx: Tx,
  weddingId: string,
  groupId: string,
  guestIds: readonly string[],
): Promise<{ ok: true; added: string[] } | { ok: false }> {
  const wanted = [...new Set(guestIds.map((id) => id.toLowerCase()))]
  if (wanted.length === 0) return { ok: true, added: [] }
  const live = await tx
    .select({ id: guests.id })
    .from(guests)
    .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, wanted), isNull(guests.deletedAt)))
  if (live.length !== wanted.length) return { ok: false }
  const inserted = await tx
    .insert(groupMembers)
    .values(wanted.map((guestId) => ({ weddingId, groupId, guestId })))
    .onConflictDoNothing()
    .returning({ guestId: groupMembers.guestId })
  const addedSet = new Set(inserted.map((r) => r.guestId))
  return { ok: true, added: wanted.filter((id) => addedSet.has(id)) }
}

export type CreateGroupResult =
  | { status: 'created'; group: Group }
  | { status: 'not-found' }
  | { status: 'name-taken' }
  | { status: 'id-taken' }
  | { status: 'invalid'; issues: string[] }

class Refused extends Error {
  constructor(readonly result: { status: 'invalid'; issues: string[] } | { status: 'name-taken' }) {
    super(result.status)
  }
}

/**
 * Creates a group, with members when guestIds is given. Without a color it
 * takes the palette color fewest groups use. A retry with the same id gives
 * the same group back.
 */
export async function createGroup(db: Db, weddingId: string, body: CreateGroupInput): Promise<CreateGroupResult> {
  try {
    return await db.transaction(async (tx): Promise<CreateGroupResult> => {
      await weddingLock(tx, weddingId, 'shared')
      if (!(await weddingIsLive(tx, weddingId))) return { status: 'not-found' }
      const id = body.id?.toLowerCase() ?? randomUUID()
      if (body.id) {
        const [existing] = await tx.select({ weddingId: groups.weddingId }).from(groups).where(eq(groups.id, id))
        if (existing) {
          if (existing.weddingId !== weddingId) return { status: 'id-taken' }
          const group = await getGroup(tx, id)
          return group ? { status: 'created', group } : { status: 'id-taken' }
        }
      }
      if (await nameTaken(tx, weddingId, body.name)) return { status: 'name-taken' }
      const used = await tx.select({ color: groups.color }).from(groups).where(eq(groups.weddingId, weddingId))
      const color = body.color ?? nextGroupColor(used.map((u) => u.color))
      await tx.insert(groups).values({ id, weddingId, name: body.name, color })
      if (body.guestIds && body.guestIds.length > 0) {
        const added = await addMembersLocked(tx, weddingId, id, body.guestIds)
        if (!added.ok) throw new Refused({ status: 'invalid', issues: [NOT_THIS_WEDDING_ISSUE] })
      }
      return { status: 'created', group: (await getGroup(tx, id))! }
    })
  } catch (err) {
    if (err instanceof Refused) return err.result
    // Two creates with the same name at once: the unique index refuses the second.
    if (isGroupNameTaken(err)) return { status: 'name-taken' }
    throw err
  }
}

export type UpdateGroupResult = { status: 'updated'; group: Group } | { status: 'not-found' } | { status: 'name-taken' }

/** Rename or recolor. */
export async function updateGroup(db: Db, groupId: string, body: UpdateGroupInput): Promise<UpdateGroupResult> {
  try {
    return await db.transaction(async (tx): Promise<UpdateGroupResult> => {
      const row = await liveGroup(tx, groupId)
      if (!row) return { status: 'not-found' }
      if (body.name !== undefined && (await nameTaken(tx, row.weddingId, body.name, row.id))) {
        return { status: 'name-taken' }
      }
      const set: Partial<typeof groups.$inferInsert> = {}
      if (body.name !== undefined) set.name = body.name
      if (body.color !== undefined) set.color = body.color
      await tx.update(groups).set(set).where(eq(groups.id, row.id))
      return { status: 'updated', group: (await getGroup(tx, row.id))! }
    })
  } catch (err) {
    if (isGroupNameTaken(err)) return { status: 'name-taken' }
    throw err
  }
}

/** Deletes the group outright; its member links go with it. False when missing or in a deleted wedding. */
export async function deleteGroup(db: Db, groupId: string): Promise<boolean> {
  const row = await liveGroup(db, groupId)
  if (!row) return false
  const deleted = await db.delete(groups).where(eq(groups.id, row.id)).returning({ id: groups.id })
  return deleted.length > 0
}

/** Adds guests to a group (bulk). Guests already in it are skipped; a guest of another wedding refuses the lot. */
export async function addGroupMembers(db: Db, groupId: string, guestIds: readonly string[]): Promise<GroupMembersResult> {
  const first = await liveGroup(db, groupId)
  if (!first) return { status: 'not-found' }
  return db.transaction(async (tx): Promise<GroupMembersResult> => {
    await weddingLock(tx, first.weddingId, 'shared')
    // Checked again under the lock: the group may have gone meanwhile.
    const row = await liveGroup(tx, groupId)
    if (!row) return { status: 'not-found' }
    const added = await addMembersLocked(tx, row.weddingId, row.id, guestIds)
    if (!added.ok) return { status: 'invalid', issues: [NOT_THIS_WEDDING_ISSUE] }
    return { status: 'done', group: (await getGroup(tx, row.id))!, added: added.added }
  })
}

/** Takes one guest out of a group. Replies with the group; a guest who was not in it changes nothing. */
export async function removeGroupMember(db: Db, groupId: string, guestId: string): Promise<Group | null> {
  const row = await liveGroup(db, groupId)
  if (!row) return null
  await db.delete(groupMembers).where(and(eq(groupMembers.groupId, row.id), eq(groupMembers.guestId, guestId)))
  return getGroup(db, row.id)
}
