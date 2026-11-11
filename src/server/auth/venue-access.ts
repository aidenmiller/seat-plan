import 'server-only'
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { NextResponse } from 'next/server'
import { uuid } from '@/shared/api'
import { json, notFound } from '../api-route'
import { users, venueTemplates } from '../db/schema'
import type { Db, Tx } from '../locks'

/**
 * Who may see, change and use venue templates. Templates belong to a planner
 * (owner_user_id); a few sit in the shared library (is_library), and ones
 * from before accounts belong to no one.
 *
 * A template is "used" by someone when a live layout, in a live wedding they
 * belong to, points at it. Using it lets them read it (to draw the venue
 * under their layout), never change it.
 *
 * |                     | Library    | Mine | Someone else's, used by me | Someone else's, not used | No owner (old)  |
 * |---------------------|------------|------|----------------------------|--------------------------|-----------------|
 * | Listed for wedding W| yes        | yes  | only if used in W          | no                       | only if used in W |
 * | Read (and copy)     | yes        | yes  | yes                        | no (404)                 | admin, or used  |
 * | Change              | admin only | yes  | no (403)                   | no (404)                 | admin only      |
 * | Attach in W         | yes        | yes  | only if used in W already  | no                       | only if used in W |
 *
 * An admin may read and change any template. Lists and attaching never use
 * that power: an admin's list for a wedding is the same as anyone's, so an
 * admin cannot hand a private template to a wedding by attaching it.
 */

export type Viewer = { userId: string; isAdmin: boolean }

export type TemplateAccess = {
  read: boolean
  edit: boolean
  library: boolean
  ownerUserId: string | null
  ownerName: string | null
}

/** The facts the rules need about one template, for this viewer. */
export type TemplateFacts = { isLibrary: boolean; ownerUserId: string | null; usedByViewer: boolean }

/** The table above, as a plain function. */
export function templateRights(viewer: Viewer, facts: TemplateFacts): { read: boolean; edit: boolean } {
  if (viewer.isAdmin) return { read: true, edit: true }
  if (facts.isLibrary) return { read: true, edit: false }
  if (facts.ownerUserId === viewer.userId) return { read: true, edit: true }
  return { read: facts.usedByViewer, edit: false }
}

/*
 * Written with explicit table names: in a select from one table, drizzle
 * prints columns inside sql`` without their table (see weddings.ts).
 */

/** A live layout in a live wedding the viewer belongs to points at the template. */
function usedByViewerSql(userId: string): SQL {
  return sql`exists (
    select 1 from "layouts" l
    join "weddings" w on w."id" = l."wedding_id"
    join "wedding_members" m on m."wedding_id" = w."id"
    where l."venue_template_id" = "venue_templates"."id"
      and l."deleted_at" is null
      and w."deleted_at" is null
      and m."user_id" = ${userId}
  )`
}

/** A live layout in wedding W (live, and one the viewer belongs to unless they are an admin) points at the template. */
function usedInWeddingSql(viewer: Viewer, weddingId: string): SQL {
  const member = viewer.isAdmin
    ? sql`true`
    : sql`exists (select 1 from "wedding_members" m where m."wedding_id" = w."id" and m."user_id" = ${viewer.userId})`
  return sql`exists (
    select 1 from "layouts" l
    join "weddings" w on w."id" = l."wedding_id"
    where l."venue_template_id" = "venue_templates"."id"
      and l."wedding_id" = ${weddingId}
      and l."deleted_at" is null
      and w."deleted_at" is null
      and ${member}
  )`
}

/**
 * A WHERE fragment over venue_templates for the template lists. With a
 * wedding: the library, the viewer's own, and any other template a live
 * layout in that wedding uses. Without one: the library, the viewer's own,
 * and those used in any wedding the viewer belongs to. Deleted templates are
 * left out. No admin extras (a separate admin list will show everything).
 */
export function readableTemplateSql(viewer: Viewer, weddingId?: string): SQL {
  const used = weddingId !== undefined ? usedInWeddingSql(viewer, weddingId) : usedByViewerSql(viewer.userId)
  return sql`("venue_templates"."deleted_at" is null and (
    "venue_templates"."is_library"
    or "venue_templates"."owner_user_id" = ${viewer.userId}
    or ${used}
  ))`
}

const owner = alias(users, 'template_owner')

/** What the viewer may do with a template. Null when it is missing or deleted. */
export async function templateAccess(db: Db | Tx, viewer: Viewer, templateId: string): Promise<TemplateAccess | null> {
  if (!uuid.safeParse(templateId).success) return null
  const [row] = await db
    .select({
      isLibrary: venueTemplates.isLibrary,
      ownerUserId: venueTemplates.ownerUserId,
      ownerName: owner.displayName,
      usedByViewer: sql<boolean>`${usedByViewerSql(viewer.userId)}`,
    })
    .from(venueTemplates)
    .leftJoin(owner, eq(owner.id, venueTemplates.ownerUserId))
    .where(and(eq(venueTemplates.id, templateId), isNull(venueTemplates.deletedAt)))
  if (!row) return null
  const rights = templateRights(viewer, row)
  return { ...rights, library: row.isLibrary, ownerUserId: row.ownerUserId, ownerName: row.ownerName ?? null }
}

/**
 * True when a layout in this wedding may point at the template: it is listed
 * for the wedding (library, the viewer's own, or already used there). Call it
 * inside the transaction that sets the layout's template.
 */
export async function canUseTemplateInWedding(tx: Db | Tx, viewer: Viewer, templateId: string, weddingId: string): Promise<boolean> {
  if (!uuid.safeParse(templateId).success || !uuid.safeParse(weddingId).success) return false
  const [row] = await tx
    .select({ id: venueTemplates.id })
    .from(venueTemplates)
    .where(and(eq(venueTemplates.id, templateId), readableTemplateSql(viewer, weddingId)))
  return Boolean(row)
}

/** For venue routes: the access, or the reply to send. 404 when the viewer cannot read it, 403 when they can read but not change it. */
export async function requireTemplate(
  db: Db | Tx,
  viewer: Viewer,
  id: string,
  need: 'read' | 'edit',
): Promise<{ ok: true; access: TemplateAccess } | { ok: false; response: NextResponse }> {
  const access = await templateAccess(db, viewer, id)
  if (!access || !access.read) return { ok: false, response: notFound() }
  if (need === 'edit' && !access.edit) return { ok: false, response: json({ error: 'forbidden' }, 403) }
  return { ok: true, access }
}
