import 'server-only'
import { randomBytes, randomUUID } from 'node:crypto'
import { hash, verify, type Algorithm } from '@node-rs/argon2'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'
import { buildShareView, type ShareView } from '@/domain/share-view'
import { fixedItemsSchema } from '@/domain/venue-schema'
import type { CreateShareLinkBody, ShareLink, UpdateShareLinkBody } from '@/shared/api'
import { guests, layouts, shareLinks, venueTemplates, weddings } from '../db/schema'
import type { Db } from '../locks'

/**
 * Venue share links (spec section 2, PLAN sections 4 and 5). A link opens one
 * layout. It works only while it is on and its layout and wedding are live;
 * a deleted layout keeps its links in the database, but they stop working
 * (DECISIONS 30).
 *
 * Passwords are stored as argon2id hashes. Changing the password or turning
 * the link off raises credential_version; every link cookie carries the
 * version it was signed with, so either change signs viewers out.
 */

/** Algorithm.Argon2id. The package declares it as a const enum, which isolatedModules cannot read. */
const ARGON2ID = 2 as Algorithm

export function hashSharePassword(password: string): Promise<string> {
  return hash(password, { algorithm: ARGON2ID })
}

let dummyHash: Promise<string> | null = null

/**
 * Checks a password against a link's hash. With no link (an unknown token) it
 * checks against a hash of a random password made once per server, so the
 * reply takes as long and does not reveal which tokens exist.
 */
export async function verifySharePassword(passwordHash: string | null, password: string): Promise<boolean> {
  if (passwordHash === null) {
    dummyHash ??= hashSharePassword(randomBytes(24).toString('base64url'))
    await verify(await dummyHash, password).catch(() => false)
    return false
  }
  return verify(passwordHash, password).catch(() => false)
}

/** 32 random bytes in base64url: 43 characters, matching SHARE_TOKEN_PATTERN. */
export function newShareToken(): string {
  return randomBytes(32).toString('base64url')
}

export function sharePath(token: string): string {
  return `/share/${token}`
}

const linkColumns = {
  id: shareLinks.id,
  weddingId: shareLinks.weddingId,
  layoutId: shareLinks.layoutId,
  layoutName: layouts.name,
  label: shareLinks.label,
  token: shareLinks.token,
  showNames: shareLinks.showNames,
  showNotes: shareLinks.showNotes,
  revokedAt: shareLinks.revokedAt,
  lastOpenedAt: shareLinks.lastOpenedAt,
  createdAt: shareLinks.createdAt,
}

type LinkRow = {
  id: string
  weddingId: string
  layoutId: string
  layoutName: string
  label: string
  token: string
  showNames: boolean
  showNotes: boolean
  revokedAt: Date | null
  lastOpenedAt: Date | null
  createdAt: Date
}

function toShareLink(row: LinkRow): ShareLink {
  return {
    id: row.id,
    weddingId: row.weddingId,
    layoutId: row.layoutId,
    layoutName: row.layoutName,
    label: row.label,
    path: sharePath(row.token),
    showNames: row.showNames,
    showNotes: row.showNotes,
    enabled: row.revokedAt === null,
    lastOpenedAt: row.lastOpenedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Links whose layout and wedding are live. */
const liveParents = and(isNull(layouts.deletedAt), isNull(weddings.deletedAt))

function selectLinks(db: Db) {
  return db
    .select(linkColumns)
    .from(shareLinks)
    .innerJoin(layouts, and(eq(layouts.id, shareLinks.layoutId), eq(layouts.weddingId, shareLinks.weddingId)))
    .innerJoin(weddings, eq(weddings.id, shareLinks.weddingId))
}

/** The wedding's links that are on, on live layouts, oldest first. Null when the wedding is missing or deleted. */
export async function listWeddingShareLinks(db: Db, weddingId: string): Promise<ShareLink[] | null> {
  const [wedding] = await db
    .select({ id: weddings.id })
    .from(weddings)
    .where(and(eq(weddings.id, weddingId), isNull(weddings.deletedAt)))
  if (!wedding) return null
  const rows = await selectLinks(db)
    .where(and(eq(shareLinks.weddingId, weddingId), isNull(shareLinks.revokedAt), liveParents))
    .orderBy(asc(shareLinks.createdAt), asc(shareLinks.id))
  return rows.map(toShareLink)
}

/** One layout's links that are on, oldest first. Null when the layout or its wedding is missing or deleted. */
export async function listLayoutShareLinks(db: Db, layoutId: string): Promise<ShareLink[] | null> {
  if (!(await liveLayoutWedding(db, layoutId))) return null
  const rows = await selectLinks(db)
    .where(and(eq(shareLinks.layoutId, layoutId), isNull(shareLinks.revokedAt), liveParents))
    .orderBy(asc(shareLinks.createdAt), asc(shareLinks.id))
  return rows.map(toShareLink)
}

async function liveLayoutWedding(db: Db, layoutId: string): Promise<string | null> {
  const [row] = await db
    .select({ weddingId: layouts.weddingId })
    .from(layouts)
    .innerJoin(weddings, eq(weddings.id, layouts.weddingId))
    .where(and(eq(layouts.id, layoutId), liveParents))
  return row?.weddingId ?? null
}

/** One link (on or off) whose layout and wedding are live. */
export async function getShareLink(db: Db, linkId: string): Promise<ShareLink | null> {
  const [row] = await selectLinks(db).where(and(eq(shareLinks.id, linkId), liveParents))
  return row ? toShareLink(row) : null
}

export type CreateShareLinkResult = { status: 'created'; link: ShareLink; existed: boolean } | { status: 'not-found' } | { status: 'id-taken' }

/** A new link that is on, names shown and notes hidden unless the body says otherwise. */
export async function createShareLink(db: Db, layoutId: string, body: CreateShareLinkBody): Promise<CreateShareLinkResult> {
  const weddingId = await liveLayoutWedding(db, layoutId)
  if (!weddingId) return { status: 'not-found' }
  const id = body.id ?? randomUUID()
  const passwordHash = await hashSharePassword(body.password)
  const inserted = await db
    .insert(shareLinks)
    .values({
      id,
      weddingId,
      layoutId,
      label: body.label ?? '',
      token: newShareToken(),
      passwordHash,
      showNames: body.showNames ?? true,
      showNotes: body.showNotes ?? false,
    })
    .onConflictDoNothing({ target: shareLinks.id })
    .returning({ id: shareLinks.id })
  const link = await getShareLink(db, id)
  // A retried create finds the link the first try made, on this same layout.
  if (!link || link.layoutId !== layoutId) return { status: 'id-taken' }
  return { status: 'created', link, existed: inserted.length === 0 }
}

/**
 * Changes a link. A new password, or turning the link off, raises the
 * credential version, so everyone using it is signed out. Turning it back on
 * keeps the raised version: viewers sign in again. Null when the link, its
 * layout or its wedding is gone.
 */
export async function updateShareLink(db: Db, linkId: string, body: UpdateShareLinkBody): Promise<ShareLink | null> {
  const current = await getShareLink(db, linkId)
  if (!current) return null
  const set: PgUpdateSetSource<typeof shareLinks> = {}
  let signOut = false
  if (body.label !== undefined) set.label = body.label
  if (body.showNames !== undefined) set.showNames = body.showNames
  if (body.showNotes !== undefined) set.showNotes = body.showNotes
  if (body.password !== undefined) {
    set.passwordHash = await hashSharePassword(body.password)
    signOut = true
  }
  if (body.enabled === false && current.enabled) {
    set.revokedAt = sql`now()`
    signOut = true
  }
  if (body.enabled === true && !current.enabled) set.revokedAt = null
  if (signOut) set.credentialVersion = sql`${shareLinks.credentialVersion} + 1`
  if (Object.keys(set).length > 0) await db.update(shareLinks).set(set).where(eq(shareLinks.id, linkId))
  return getShareLink(db, linkId)
}

/** Removes the link for good. False when there was no such link. */
export async function deleteShareLink(db: Db, linkId: string): Promise<boolean> {
  const deleted = await db.delete(shareLinks).where(eq(shareLinks.id, linkId)).returning({ id: shareLinks.id })
  return deleted.length > 0
}

/** A link that works: on, with a live layout and wedding. What the share check needs. */
export type LiveShareLink = {
  id: string
  weddingId: string
  layoutId: string
  layoutName: string
  passwordHash: string
  credentialVersion: number
  showNames: boolean
  showNotes: boolean
}

export async function findLiveShareLink(db: Db, token: string): Promise<LiveShareLink | null> {
  const [row] = await db
    .select({
      id: shareLinks.id,
      weddingId: shareLinks.weddingId,
      layoutId: shareLinks.layoutId,
      layoutName: layouts.name,
      passwordHash: shareLinks.passwordHash,
      credentialVersion: shareLinks.credentialVersion,
      showNames: shareLinks.showNames,
      showNotes: shareLinks.showNotes,
    })
    .from(shareLinks)
    .innerJoin(layouts, and(eq(layouts.id, shareLinks.layoutId), eq(layouts.weddingId, shareLinks.weddingId)))
    .innerJoin(weddings, eq(weddings.id, shareLinks.weddingId))
    .where(and(eq(shareLinks.token, token), isNull(shareLinks.revokedAt), liveParents))
  return row ?? null
}

/** "Last opened": set when a viewer signs in or opens the link with its cookie. */
export async function touchShareLink(db: Db, linkId: string): Promise<void> {
  await db
    .update(shareLinks)
    .set({ lastOpenedAt: sql`now()`, updatedAt: sql`${shareLinks.updatedAt}` })
    .where(eq(shareLinks.id, linkId))
}

/** The one layout as the link may show it (PLAN change 24). Null when the layout is gone. */
export async function shareViewData(db: Db, link: LiveShareLink): Promise<ShareView | null> {
  const [row] = await db
    .select({
      name: layouts.name,
      kind: layouts.kind,
      canvas: layouts.canvas,
      updatedAt: layouts.updatedAt,
      unit: weddings.unit,
      weddingName: weddings.name,
      fixedItems: venueTemplates.fixedItems,
      templateDeletedAt: venueTemplates.deletedAt,
    })
    .from(layouts)
    .innerJoin(weddings, eq(weddings.id, layouts.weddingId))
    .leftJoin(venueTemplates, eq(venueTemplates.id, layouts.venueTemplateId))
    .where(and(eq(layouts.id, link.layoutId), liveParents))
  if (!row) return null

  const seated = new Set<string>()
  for (const item of row.canvas.items) {
    if (item.kind !== 'table' && item.kind !== 'chairRow') continue
    for (const seat of item.seats) if (seat.guestId) seated.add(seat.guestId)
  }
  const guestRows =
    seated.size === 0
      ? []
      : await db
          .select({ id: guests.id, firstName: guests.firstName, lastName: guests.lastName, meal: guests.meal, isChild: guests.isChild })
          .from(guests)
          .where(and(eq(guests.weddingId, link.weddingId), isNull(guests.deletedAt), inArray(guests.id, [...seated])))

  // A deleted template draws no venue layer (DECISIONS 29).
  const venue = row.fixedItems && row.templateDeletedAt === null ? fixedItemsSchema.safeParse(row.fixedItems) : null
  return buildShareView({
    weddingName: row.weddingName,
    layoutName: row.name,
    kind: row.kind,
    unit: row.unit,
    updatedAt: row.updatedAt.toISOString(),
    canvas: row.canvas,
    venue: venue?.success ? venue.data : [],
    guests: guestRows,
    showNames: link.showNames,
    showNotes: link.showNotes,
  })
}
