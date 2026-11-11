import 'server-only'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { uuid } from '@/shared/api'
import { restoredWeddingId } from '../backup'
import { groups, guests, invites, layouts, rules, shareLinks } from '../db/schema'
import type { Db } from '../locks'

/**
 * How a guarded route finds the wedding a request is about, from its params
 * (or, for the couple rule, its body). A resolver only says which wedding the
 * row belongs to: whether that wedding is live and whether the caller may
 * open it is weddingAccess's job, so rows that are themselves deleted
 * (a deleted layout or guest) still resolve, and the handler answers for
 * them (410 for a deleted layout, 404 for the rest).
 *
 * An id that is not a uuid, or a row that does not exist, resolves to null,
 * which the guard answers with 404.
 */

export type WeddingResolver<Ctx> = {
  readonly name: string
  resolve(req: NextRequest, ctx: Ctx, db: Db): Promise<string | null>
}

/** Finds the template a venue route is about. Only its params are read. */
export type TemplateResolver<Ctx> = {
  readonly name: string
  resolve(req: NextRequest, ctx: Ctx): Promise<string | null>
}

/** The context Next.js passes to a handler under an [id] folder. */
type IdParams = { params: Promise<{ id: string }> }
/** The context of a handler under restore/[jobId]. */
type JobParams = { params: Promise<{ jobId: string }> }

/** A route param when it is a uuid, lower-cased; null otherwise. */
function uuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && uuid.safeParse(value).success ? value.toLowerCase() : null
}

/** A resolver that reads the [id] param and looks up the wedding_id of that row. */
function byRow(name: string, lookup: (db: Db, id: string) => Promise<{ weddingId: string | null }[]>): WeddingResolver<IdParams> {
  return {
    name,
    async resolve(_req, ctx, db) {
      const id = uuidOrNull((await ctx.params).id)
      if (!id) return null
      const [row] = await lookup(db, id)
      return row?.weddingId ?? null
    },
  }
}

/** /api/weddings/[id]/...: the id is the wedding. */
export const byWeddingId: WeddingResolver<IdParams> = {
  name: 'byWeddingId',
  async resolve(_req, ctx) {
    return uuidOrNull((await ctx.params).id)
  },
}

/** /api/layouts/[id]/...: deleted layouts resolve too, so a save to one can answer 410. */
export const byLayoutId = byRow('byLayoutId', (db, id) =>
  db.select({ weddingId: layouts.weddingId }).from(layouts).where(eq(layouts.id, id)),
)

export const byGuestId = byRow('byGuestId', (db, id) =>
  db.select({ weddingId: guests.weddingId }).from(guests).where(eq(guests.id, id)),
)

export const byGroupId = byRow('byGroupId', (db, id) =>
  db.select({ weddingId: groups.weddingId }).from(groups).where(eq(groups.id, id)),
)

export const byRuleId = byRow('byRuleId', (db, id) => db.select({ weddingId: rules.weddingId }).from(rules).where(eq(rules.id, id)))

export const byShareLinkId = byRow('byShareLinkId', (db, id) =>
  db.select({ weddingId: shareLinks.weddingId }).from(shareLinks).where(eq(shareLinks.id, id)),
)

/** A planner invite has no wedding, so it resolves to null: those are managed through the admin routes. */
export const byInviteId = byRow('byInviteId', (db, id) =>
  db.select({ weddingId: invites.weddingId }).from(invites).where(eq(invites.id, id)),
)

/**
 * /api/weddings/restore/[jobId]/...: the wedding a restore job makes has an
 * id worked out from the job id (backup.ts, restoredWeddingId), so no lookup
 * is needed. Only a member of that wedding (its creator, added when the
 * restore started) gets past weddingAccess.
 */
export const byRestoreJob: WeddingResolver<JobParams> = {
  name: 'byRestoreJob',
  async resolve(_req, ctx) {
    const jobId = uuidOrNull((await ctx.params).jobId)
    return jobId ? restoredWeddingId(jobId) : null
  },
}

/**
 * PATCH /api/rules/couple: the wedding of the first guest in the body's
 * guestIds. Reads a clone, so the handler can still read the body. The
 * handler must keep the second guest to that same wedding (setCoupleRule
 * does: it reads both guests within the first one's wedding).
 */
export const byCouplePair: WeddingResolver<unknown> = {
  name: 'byCouplePair',
  async resolve(req, _ctx, db) {
    let body: unknown
    try {
      body = await req.clone().json()
    } catch {
      return null
    }
    const first = (body as { guestIds?: unknown } | null)?.guestIds
    const guestId = uuidOrNull(Array.isArray(first) ? first[0] : undefined)
    if (!guestId) return null
    const [row] = await db.select({ weddingId: guests.weddingId }).from(guests).where(eq(guests.id, guestId))
    return row?.weddingId ?? null
  },
}

/** /api/venues/[id]/...: the id is the template. */
export const byTemplateId: TemplateResolver<IdParams> = {
  name: 'byTemplateId',
  async resolve(_req, ctx) {
    return uuidOrNull((await ctx.params).id)
  },
}
