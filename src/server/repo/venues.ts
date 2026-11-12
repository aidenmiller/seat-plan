import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Canvas, Table } from '@/domain/canvas-schema'
import { readImageHeader } from '@/domain/image-header'
import { itemLabel } from '@/domain/item-labels'
import { renderThumbnailSvg } from '@/domain/thumbnail'
import { fixedItemsSchema, type FixedItem, type ReferenceMeta } from '@/domain/venue-schema'
import { wallCrossings } from '@/domain/walls'
import {
  MAX_LISTED_REVISIONS,
  MAX_VENUE_IMAGE_BYTES,
  MAX_VENUE_IMAGE_SIDE,
  type AcceptImportBody,
  type CreateVenueBody,
  type DuplicateVenueBody,
  type RestoreRevisionBody,
  type SaveVenueBody,
  type VenueAccess,
  type VenueDeleteSummary,
  type VenueDetail,
  type VenueImageInfo,
  type VenueImportedBy,
  type VenueRevisionList,
  type VenueSummary,
  type VenueUse,
  type VenueWallCheck,
} from '@/shared/api'
import { readableTemplateSql, templateAccess, templateRights, type Viewer } from '../auth/venue-access'
import { MAX_RECENT_SAVES, recentSavesOf } from '../canvas-write'
import { layouts, users, venueImages, venueTemplateRevisions, venueTemplates, weddings, type RecentSave } from '../db/schema'
import { editorName } from '../editor-name'
import type { Db, Tx } from '../locks'

/**
 * Venue templates (spec section 5, PLAN sections 4 and 7). A template belongs
 * to the planner who made it, sits in the shared library, or (from before
 * accounts) belongs to no one; src/server/auth/venue-access.ts says who may
 * see, change and use each, and the routes check it before calling in here.
 * Every read skips deleted templates.
 *
 * Replies about who uses a template (usedBy, the delete summary, the wall
 * check, a refused delete) name only layouts in weddings the viewer belongs
 * to (every wedding for an admin). Layouts in other weddings are only
 * counted (hiddenLayouts), never named.
 *
 * Fixed items, the reference meta and the reference image change only through
 * saveTemplate, acceptImport and restoreRevision. Each one, in one transaction:
 * locks the template row, checks baseVersion (a retry whose saveId is the
 * template's last_save_id answers 'already-saved'; templates keep only the
 * last save id, not the 20 recent ones layouts keep), writes the new state with
 * version + 1, adds a venue_template_revisions row holding the state after the
 * write, and redraws the thumbnails of live layouts that use the template.
 * A template that has no revision yet (the seeded Toronto Beach Club) first
 * gets one holding its state before the write, so "Undo import" always has a
 * revision to go back to.
 *
 * Lock order: template row, then layout rows in id order. Layout saves lock
 * their own row and read the template without a lock, so the two never wait
 * on each other in a circle.
 */

const MAX_NAME = 200

const liveTemplate = (id: string) => and(eq(venueTemplates.id, id), isNull(venueTemplates.deletedAt))

/**
 * SQL: the viewer belongs to the wedding whose id `weddingIdSql` names (any
 * role), or is an admin. Written with explicit table names: in a select from
 * one table, drizzle prints columns inside sql`` without their table.
 */
function viewerBelongsTo(viewer: Viewer, weddingIdSql: SQL): SQL {
  if (viewer.isAdmin) return sql`true`
  return sql`exists (select 1 from "wedding_members" m where m."wedding_id" = ${weddingIdSql} and m."user_id" = ${viewer.userId})`
}

/** Live layouts that use the template, in live weddings the viewer belongs to (all for an admin), as a SQL count. */
function usedByCount(viewer: Viewer): SQL<number> {
  return sql<number>`(
    select count(*)::int from "layouts" l
    join "weddings" w on w."id" = l."wedding_id"
    where l."venue_template_id" = "venue_templates"."id"
      and l."deleted_at" is null
      and w."deleted_at" is null
      and ${viewerBelongsTo(viewer, sql`w."id"`)}
  )`
}

/** Whose template it is, as the viewer sees it (VenueAccess in src/shared/api.ts). */
export function venueAccessOf(viewer: Viewer, isLibrary: boolean, ownerUserId: string | null): VenueAccess {
  if (isLibrary) return 'library'
  if (ownerUserId === viewer.userId) return 'mine'
  if (ownerUserId === null) return 'unowned'
  return 'shared'
}

/** The fields every template reply carries about its owner and the viewer's rights. */
function ownership(viewer: Viewer, row: { isLibrary: boolean; ownerUserId: string | null; ownerName: string | null }) {
  return {
    access: venueAccessOf(viewer, row.isLibrary, row.ownerUserId),
    ownerName: row.ownerName,
    // Changing a template never depends on who uses it (venue-access.ts), so usedByViewer does not matter here.
    canEdit: templateRights(viewer, { isLibrary: row.isLibrary, ownerUserId: row.ownerUserId, usedByViewer: false }).edit,
  }
}

const owner = alias(users, 'venue_owner')

export function imageUrl(templateId: string, imageId: string): string {
  return `/api/venues/${templateId}/images/${imageId}`
}

// ---------------------------------------------------------------- reads

/**
 * The live templates the viewer may pick from, by name (readableTemplateSql).
 * For a wedding: the library, the viewer's own, and any template a live
 * layout of that wedding uses. Without one: the library, the viewer's own,
 * and those used in any wedding the viewer belongs to. An admin gets nothing
 * extra here. The caller checks the viewer may open the wedding first.
 */
export async function listVenues(db: Db, viewer: Viewer, opts: { weddingId?: string } = {}): Promise<VenueSummary[]> {
  const rows = await db
    .select({
      id: venueTemplates.id,
      name: venueTemplates.name,
      updatedAt: venueTemplates.updatedAt,
      version: venueTemplates.version,
      editedBy: editorName(venueTemplates),
      editedById: venueTemplates.editedByUserId,
      importedBy: venueTemplates.importedBy,
      referenceImageId: venueTemplates.referenceImageId,
      fixedItemCount: sql<number>`jsonb_array_length("venue_templates"."fixed_items")`,
      // Explicit table names: in a select from one table, drizzle prints
      // columns inside sql`` without their table.
      usedBy: usedByCount(viewer),
      isLibrary: venueTemplates.isLibrary,
      ownerUserId: venueTemplates.ownerUserId,
      ownerName: owner.displayName,
    })
    .from(venueTemplates)
    .leftJoin(owner, eq(owner.id, venueTemplates.ownerUserId))
    .where(readableTemplateSql(viewer, opts.weddingId))
    .orderBy(asc(sql`lower(${venueTemplates.name})`), asc(venueTemplates.id))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    updatedAt: r.updatedAt.toISOString(),
    usedBy: Number(r.usedBy),
    version: r.version,
    editedBy: r.editedBy,
    editedById: r.editedById,
    importedBy: r.importedBy,
    fixedItemCount: Number(r.fixedItemCount),
    hasReferenceImage: r.referenceImageId !== null,
    ...ownership(viewer, { isLibrary: r.isLibrary, ownerUserId: r.ownerUserId, ownerName: r.ownerName ?? null }),
  }))
}

type ImageRow = {
  id: string
  templateId: string
  contentType: 'image/png' | 'image/jpeg'
  width: number
  height: number
  byteSize: number
  sha256: string
  createdAt: Date
}

const imageInfoColumns = {
  id: venueImages.id,
  templateId: venueImages.templateId,
  contentType: venueImages.contentType,
  width: venueImages.width,
  height: venueImages.height,
  byteSize: sql<number>`octet_length(${venueImages.bytes})`,
  sha256: venueImages.sha256,
  createdAt: venueImages.createdAt,
}

function toImageInfo(row: ImageRow): VenueImageInfo {
  return {
    id: row.id,
    templateId: row.templateId,
    contentType: row.contentType,
    width: row.width,
    height: row.height,
    byteSize: Number(row.byteSize),
    sha256: row.sha256,
    url: imageUrl(row.templateId, row.id),
    createdAt: row.createdAt.toISOString(),
  }
}

/** Stored fixed items, checked; a row that somehow fails the check reads as empty rather than breaking the page. */
function storedItems(value: unknown): FixedItem[] {
  const parsed = fixedItemsSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

/**
 * One live template with its fixed items, reference meta and reference image,
 * as the viewer sees it. Null when it is missing or deleted, or the viewer may
 * not read it (venue-access.ts).
 */
export async function getTemplate(db: Db | Tx, id: string, viewer: Viewer): Promise<VenueDetail | null> {
  const access = await templateAccess(db, viewer, id)
  if (!access?.read) return null
  const [row] = await db
    .select({
      id: venueTemplates.id,
      name: venueTemplates.name,
      version: venueTemplates.version,
      lastSaveId: venueTemplates.lastSaveId,
      editedBy: editorName(venueTemplates),
      editedById: venueTemplates.editedByUserId,
      updatedAt: venueTemplates.updatedAt,
      importedBy: venueTemplates.importedBy,
      fixedItems: venueTemplates.fixedItems,
      reference: venueTemplates.reference,
      referenceImageId: venueTemplates.referenceImageId,
      usedBy: usedByCount(viewer),
    })
    .from(venueTemplates)
    .where(liveTemplate(id))
  if (!row) return null
  let referenceImage: VenueImageInfo | null = null
  if (row.referenceImageId) {
    const [image] = await db.select(imageInfoColumns).from(venueImages).where(eq(venueImages.id, row.referenceImageId))
    referenceImage = image ? toImageInfo(image) : null
  }
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    lastSaveId: row.lastSaveId,
    editedBy: row.editedBy,
    editedById: row.editedById,
    updatedAt: row.updatedAt.toISOString(),
    importedBy: row.importedBy,
    fixedItems: storedItems(row.fixedItems),
    reference: row.reference ?? null,
    referenceImage,
    usedBy: Number(row.usedBy),
    ...ownership(viewer, { isLibrary: access.library, ownerUserId: access.ownerUserId, ownerName: access.ownerName }),
  }
}

/** The name of a live template, or null. */
export async function liveTemplateName(db: Db, id: string): Promise<string | null> {
  const [row] = await db.select({ name: venueTemplates.name }).from(venueTemplates).where(liveTemplate(id))
  return row?.name ?? null
}

/** Live layouts in live weddings that use a template: those the viewer may see, and how many others. */
type TemplateUses = { layouts: VenueUse[]; hiddenLayouts: number }

/**
 * Live layouts in live weddings that use the template. Those in weddings the
 * viewer belongs to (every wedding for an admin) come back by wedding name
 * then layout name; the rest only as a count.
 */
async function templateUses(db: Db | Tx, templateId: string, viewer: Viewer): Promise<TemplateUses> {
  const rows = await db
    .select({
      weddingId: weddings.id,
      weddingName: weddings.name,
      layoutId: layouts.id,
      layoutName: layouts.name,
      visible: sql<boolean>`${viewerBelongsTo(viewer, sql`"weddings"."id"`)}`,
    })
    .from(layouts)
    .innerJoin(weddings, eq(weddings.id, layouts.weddingId))
    .where(and(eq(layouts.venueTemplateId, templateId), isNull(layouts.deletedAt), isNull(weddings.deletedAt)))
    .orderBy(asc(sql`lower(${weddings.name})`), asc(weddings.id), asc(sql`lower(${layouts.name})`), asc(layouts.id))
  const shown = rows.filter((r) => r.visible === true)
  return {
    layouts: shown.map((r) => ({ weddingId: r.weddingId, weddingName: r.weddingName, layoutId: r.layoutId, layoutName: r.layoutName })),
    hiddenLayouts: rows.length - shown.length,
  }
}

/**
 * What the delete dialog lists: the layouts that block the delete (those the
 * viewer may see, and a count of the rest), and what goes with the template.
 */
export async function templateDeleteSummary(db: Db, id: string, viewer: Viewer): Promise<VenueDeleteSummary | null> {
  const [row] = await db.select({ name: venueTemplates.name }).from(venueTemplates).where(liveTemplate(id))
  if (!row) return null
  const [[images], [revisions], uses] = await Promise.all([
    db.select({ n: count() }).from(venueImages).where(eq(venueImages.templateId, id)),
    db.select({ n: count() }).from(venueTemplateRevisions).where(eq(venueTemplateRevisions.templateId, id)),
    templateUses(db, id, viewer),
  ])
  return {
    kind: 'venue',
    name: row.name,
    layouts: uses.layouts,
    hiddenLayouts: uses.hiddenLayouts,
    images: Number(images?.n ?? 0),
    revisions: Number(revisions?.n ?? 0),
  }
}

/** The template's revisions, newest first, and which one "Undo import" restores. Null when the template is not live. */
export async function listRevisions(db: Db, id: string): Promise<VenueRevisionList | null> {
  const [template] = await db.select({ id: venueTemplates.id }).from(venueTemplates).where(liveTemplate(id))
  if (!template) return null
  const rows = await db
    .select({
      id: venueTemplateRevisions.id,
      reason: venueTemplateRevisions.reason,
      createdAt: venueTemplateRevisions.createdAt,
      fixedItemCount: sql<number>`jsonb_array_length(${venueTemplateRevisions.fixedItems})`,
      referenceImageId: venueTemplateRevisions.referenceImageId,
      hasReference: sql<boolean>`${venueTemplateRevisions.reference} is not null`,
    })
    .from(venueTemplateRevisions)
    .where(eq(venueTemplateRevisions.templateId, id))
    .orderBy(desc(venueTemplateRevisions.createdAt), desc(venueTemplateRevisions.id))
    .limit(MAX_LISTED_REVISIONS)
  return {
    revisions: rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      fixedItemCount: Number(r.fixedItemCount),
      referenceImageId: r.referenceImageId,
      hasReference: Boolean(r.hasReference),
    })),
    undoImportRevisionId: await undoImportRevisionId(db, id),
  }
}

/**
 * The revision just before the newest import revision, or null when there is
 * none. Worked out in SQL: revision times have microseconds, which a JS Date
 * would cut to milliseconds.
 */
async function undoImportRevisionId(db: Db, templateId: string): Promise<string | null> {
  const result = await db.execute<{ before_id: string | null }>(sql`
    select "before_id" from (
      select "id", "reason", "created_at",
        lead("id") over (order by "created_at" desc, "id" desc) as "before_id"
      from "venue_template_revisions"
      where "template_id" = ${templateId}::uuid
    ) r
    where r."reason" = 'import'
    order by r."created_at" desc, r."id" desc
    limit 1
  `)
  return result.rows[0]?.before_id ?? null
}

/**
 * Every live layout in a live wedding that uses the template, with the tables
 * a wall of the saved template runs through (src/domain/walls.ts). Layouts
 * with no such table are listed with an empty list. Only layouts in weddings
 * the viewer belongs to (every wedding for an admin) are listed; the rest are
 * counted in hiddenLayouts and their canvases are never read.
 */
export async function templateWallCheck(db: Db, id: string, viewer: Viewer): Promise<VenueWallCheck | null> {
  const [template] = await db
    .select({ version: venueTemplates.version, fixedItems: venueTemplates.fixedItems })
    .from(venueTemplates)
    .where(liveTemplate(id))
  if (!template) return null
  const items = storedItems(template.fixedItems)
  const live = and(eq(layouts.venueTemplateId, id), isNull(layouts.deletedAt), isNull(weddings.deletedAt))
  const visible = viewerBelongsTo(viewer, sql`"weddings"."id"`)
  const [rows, [hidden]] = await Promise.all([
    db
      .select({
        weddingId: weddings.id,
        weddingName: weddings.name,
        layoutId: layouts.id,
        layoutName: layouts.name,
        canvas: layouts.canvas,
      })
      .from(layouts)
      .innerJoin(weddings, eq(weddings.id, layouts.weddingId))
      .where(and(live, visible))
      .orderBy(asc(sql`lower(${weddings.name})`), asc(weddings.id), asc(sql`lower(${layouts.name})`), asc(layouts.id)),
    db
      .select({ n: count() })
      .from(layouts)
      .innerJoin(weddings, eq(weddings.id, layouts.weddingId))
      .where(and(live, sql`not ${visible}`)),
  ])
  return {
    templateVersion: template.version,
    hiddenLayouts: Number(hidden?.n ?? 0),
    layouts: rows.map(({ canvas, ...use }) => {
      const tables = new Map(canvas.items.filter((i): i is Table => i.kind === 'table').map((t) => [t.id, t]))
      return {
        ...use,
        tables: wallCrossings(canvas, items).map((c) => {
          const table = tables.get(c.tableId)
          return { tableId: c.tableId, label: table ? itemLabel(table) : c.tableId, wallIds: c.wallIds }
        }),
      }
    }),
  }
}

// ---------------------------------------------------------------- create, rename, duplicate, delete

export type CreateTemplateResult = { status: 'created'; venue: VenueDetail; existed: boolean } | { status: 'id-taken' }

/**
 * The outcome of an insert that met an existing row with the chosen id: a
 * retry of the viewer's own create ('existed'), or an id they may not have
 * ('id-taken', telling nothing about the template that holds it).
 */
async function retriedCreate(tx: Tx, id: string, viewer: Viewer): Promise<'existed' | 'id-taken'> {
  const [existing] = await tx
    .select({ deletedAt: venueTemplates.deletedAt, ownerUserId: venueTemplates.ownerUserId })
    .from(venueTemplates)
    .where(eq(venueTemplates.id, id))
  return existing && existing.deletedAt === null && existing.ownerUserId === viewer.userId ? 'existed' : 'id-taken'
}

/**
 * A new, empty template with its first revision, owned by the viewer and
 * private (not in the library). A retry with the same id gives the viewer's
 * own template back; an id that belongs to anyone else's is 'id-taken'.
 */
export async function createTemplate(db: Db, body: CreateVenueBody, viewer: Viewer): Promise<CreateTemplateResult> {
  const id = (body.id ?? randomUUID()).toLowerCase()
  const outcome = await db.transaction(async (tx): Promise<'created' | 'existed' | 'id-taken'> => {
    const inserted = await tx
      .insert(venueTemplates)
      .values({
        id,
        name: body.name,
        fixedItems: [],
        importedBy: 'hand',
        editedBy: body.editedBy ?? null,
        editedByName: body.editedBy ?? null,
        ownerUserId: viewer.userId,
        isLibrary: false,
      })
      .onConflictDoNothing({ target: venueTemplates.id })
      .returning({ id: venueTemplates.id })
    if (inserted.length === 0) return retriedCreate(tx, id, viewer)
    await addRevision(tx, id, { fixedItems: [], referenceImageId: null, reference: null }, 'save')
    return 'created'
  })
  if (outcome === 'id-taken') return { status: 'id-taken' }
  const venue = await getTemplate(db, id, viewer)
  return venue ? { status: 'created', venue, existed: outcome === 'existed' } : { status: 'id-taken' }
}

/** Renames a live template. The version, editor and last edited time stay as they are. Null when not live. */
export async function renameTemplate(db: Db, id: string, name: string, viewer: Viewer): Promise<VenueDetail | null> {
  const updated = await db
    .update(venueTemplates)
    .set({ name, updatedAt: sql`${venueTemplates.updatedAt}` })
    .where(liveTemplate(id))
    .returning({ id: venueTemplates.id })
  return updated.length > 0 ? getTemplate(db, id, viewer) : null
}

export function copyName(name: string): string {
  const suffix = ' copy'
  return `${name.slice(0, MAX_NAME - suffix.length).trimEnd()}${suffix}`
}

export type DuplicateTemplateResult = CreateTemplateResult | { status: 'not-found' }

/**
 * A new template with the same fixed items, reference meta, import source and
 * a copy of the current reference image row, owned by the viewer and private
 * whatever the source was. Version 1, its own first revision. Older images
 * and revisions stay with the original. The caller checks the viewer may read
 * the source.
 */
export async function duplicateTemplate(db: Db, sourceId: string, body: DuplicateVenueBody, viewer: Viewer): Promise<DuplicateTemplateResult> {
  const id = (body.id ?? randomUUID()).toLowerCase()
  const outcome = await db.transaction(async (tx): Promise<'created' | 'existed' | 'id-taken' | 'not-found'> => {
    const [source] = await tx
      .select({
        name: venueTemplates.name,
        fixedItems: venueTemplates.fixedItems,
        reference: venueTemplates.reference,
        referenceImageId: venueTemplates.referenceImageId,
        importedBy: venueTemplates.importedBy,
      })
      .from(venueTemplates)
      .where(liveTemplate(sourceId))
    if (!source) return 'not-found'
    const inserted = await tx
      .insert(venueTemplates)
      .values({
        id,
        name: body.name ?? copyName(source.name),
        fixedItems: source.fixedItems,
        reference: source.reference,
        importedBy: source.importedBy,
        editedBy: body.editedBy ?? null,
        editedByName: body.editedBy ?? null,
        ownerUserId: viewer.userId,
        isLibrary: false,
      })
      .onConflictDoNothing({ target: venueTemplates.id })
      .returning({ id: venueTemplates.id })
    if (inserted.length === 0) return retriedCreate(tx, id, viewer)
    // The image row points at its template and the template at its image, so
    // the copy is made after the template, then the template points at it.
    let referenceImageId: string | null = null
    if (source.referenceImageId) {
      referenceImageId = randomUUID()
      await tx.execute(sql`
        insert into "venue_images" ("id", "template_id", "content_type", "bytes", "width", "height", "sha256")
        select ${referenceImageId}::uuid, ${id}::uuid, "content_type", "bytes", "width", "height", "sha256"
        from "venue_images" where "id" = ${source.referenceImageId}::uuid
      `)
      await tx
        .update(venueTemplates)
        .set({ referenceImageId, updatedAt: sql`${venueTemplates.updatedAt}` })
        .where(eq(venueTemplates.id, id))
    }
    await addRevision(tx, id, { fixedItems: source.fixedItems, referenceImageId, reference: source.reference ?? null }, 'save')
    return 'created'
  })
  if (outcome === 'not-found' || outcome === 'id-taken') return { status: outcome }
  const venue = await getTemplate(db, id, viewer)
  return venue ? { status: 'created', venue, existed: outcome === 'existed' } : { status: 'not-found' }
}

export type SoftDeleteTemplateResult =
  | { status: 'deleted' }
  | { status: 'in-use'; layouts: VenueUse[]; hiddenLayouts: number }
  | { status: 'not-found' }

/**
 * Marks the template deleted, unless live layouts in live weddings still use
 * it, in any wedding: then nothing changes and those layouts come back (spec
 * section 5), named only when the viewer may see them. Layouts in deleted
 * weddings, and deleted layouts, keep pointing at it and open with a notice
 * if they come back (DECISIONS 29).
 */
export async function softDeleteTemplate(db: Db, id: string, viewer: Viewer): Promise<SoftDeleteTemplateResult> {
  return db.transaction(async (tx): Promise<SoftDeleteTemplateResult> => {
    const [row] = await tx.select({ id: venueTemplates.id }).from(venueTemplates).where(liveTemplate(id)).for('update')
    if (!row) return { status: 'not-found' }
    const uses = await templateUses(tx, id, viewer)
    if (uses.layouts.length > 0 || uses.hiddenLayouts > 0) return { status: 'in-use', ...uses }
    await tx
      .update(venueTemplates)
      .set({ deletedAt: sql`now()`, updatedAt: sql`${venueTemplates.updatedAt}` })
      .where(eq(venueTemplates.id, id))
    return { status: 'deleted' }
  })
}

// ---------------------------------------------------------------- images

export type AddImageResult =
  | { status: 'created' | 'existed'; image: VenueImageInfo }
  | { status: 'not-found' }
  | { status: 'too-large' }
  | { status: 'bad-type' }
  | { status: 'bad-size' }

/**
 * Stores an uploaded floor plan image for the template, without pointing the
 * template at it (that happens on Accept). The type and size come from the
 * bytes themselves. The same bytes uploaded again to the same template give
 * the stored row back, so a retried upload makes no second copy.
 */
export async function addTemplateImage(db: Db, templateId: string, bytes: Uint8Array): Promise<AddImageResult> {
  if (bytes.length > MAX_VENUE_IMAGE_BYTES) return { status: 'too-large' }
  const header = readImageHeader(bytes)
  if (!header) return { status: 'bad-type' }
  if (header.width > MAX_VENUE_IMAGE_SIDE || header.height > MAX_VENUE_IMAGE_SIDE) return { status: 'bad-size' }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return db.transaction(async (tx): Promise<AddImageResult> => {
    // A share lock: the template cannot be deleted while its image goes in.
    const [template] = await tx.select({ id: venueTemplates.id }).from(venueTemplates).where(liveTemplate(templateId)).for('share')
    if (!template) return { status: 'not-found' }
    const [existing] = await tx
      .select(imageInfoColumns)
      .from(venueImages)
      .where(
        and(
          eq(venueImages.templateId, templateId),
          eq(venueImages.sha256, sha256),
          eq(venueImages.contentType, header.contentType),
        ),
      )
      .orderBy(asc(venueImages.createdAt))
      .limit(1)
    if (existing) return { status: 'existed', image: toImageInfo(existing) }
    const [row] = await tx
      .insert(venueImages)
      .values({
        templateId,
        contentType: header.contentType,
        bytes: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        width: header.width,
        height: header.height,
        sha256,
      })
      .returning(imageInfoColumns)
    return { status: 'created', image: toImageInfo(row!) }
  })
}

export type StoredImage = { contentType: 'image/png' | 'image/jpeg'; bytes: Buffer; width: number; height: number; templateName: string; sha256: string }

const imageOfLiveTemplate = (templateId: string, imageId: string) =>
  and(eq(venueImages.id, imageId), eq(venueImages.templateId, templateId), isNull(venueTemplates.deletedAt))

/** An image of a live template, with its bytes. Null when either is missing or the image belongs to another template. */
export async function getTemplateImage(db: Db, templateId: string, imageId: string): Promise<StoredImage | null> {
  const [row] = await db
    .select({
      contentType: venueImages.contentType,
      bytes: venueImages.bytes,
      width: venueImages.width,
      height: venueImages.height,
      templateName: venueTemplates.name,
      sha256: venueImages.sha256,
    })
    .from(venueImages)
    .innerJoin(venueTemplates, eq(venueTemplates.id, venueImages.templateId))
    .where(imageOfLiveTemplate(templateId, imageId))
  return row ?? null
}

/** The stored image's sha256 (its ETag), without reading its bytes. Null as for getTemplateImage. */
export async function templateImageHash(db: Db, templateId: string, imageId: string): Promise<string | null> {
  const [row] = await db
    .select({ sha256: venueImages.sha256 })
    .from(venueImages)
    .innerJoin(venueTemplates, eq(venueTemplates.id, venueImages.templateId))
    .where(imageOfLiveTemplate(templateId, imageId))
  return row?.sha256 ?? null
}

// ---------------------------------------------------------------- saves

export type TemplateSaveResult =
  | { status: 'saved' | 'already-saved'; version: number; updatedAt: Date; editedBy: string | null; editedById: string | null }
  | { status: 'conflict'; version: number; updatedAt: Date; editedBy: string | null; editedById: string | null; lastSaveId: string | null }
  /** The template is missing or deleted. */
  | { status: 'gone' }

type TemplateState = { fixedItems: FixedItem[]; referenceImageId: string | null; reference: ReferenceMeta | null }

type LockedTemplate = TemplateState & {
  version: number
  lastSaveId: string | null
  recentSaves: RecentSave[]
  editedBy: string | null
  editedById: string | null
  updatedAt: Date
  importedBy: VenueImportedBy
}

async function lockTemplate(tx: Tx, id: string): Promise<LockedTemplate | null> {
  const [row] = await tx
    .select({
      version: venueTemplates.version,
      lastSaveId: venueTemplates.lastSaveId,
      recentSaves: venueTemplates.recentSaves,
      editedBy: editorName(venueTemplates),
      editedById: venueTemplates.editedByUserId,
      updatedAt: venueTemplates.updatedAt,
      importedBy: venueTemplates.importedBy,
      fixedItems: venueTemplates.fixedItems,
      referenceImageId: venueTemplates.referenceImageId,
      reference: venueTemplates.reference,
    })
    .from(venueTemplates)
    .where(liveTemplate(id))
    .for('update')
  return row ? { ...row, reference: row.reference ?? null, recentSaves: recentSavesOf(row.recentSaves) } : null
}

/** Inserts a revision. clock_timestamp(), so two revisions in one transaction keep their order. */
async function addRevision(tx: Tx, templateId: string, state: TemplateState, reason: 'save' | 'import'): Promise<void> {
  await tx.insert(venueTemplateRevisions).values({
    templateId,
    fixedItems: state.fixedItems,
    referenceImageId: state.referenceImageId,
    reference: state.reference,
    reason,
    createdAt: sql`clock_timestamp()`,
  })
}

/** Gives a template without revisions (one seeded by a migration) a revision holding its current state. */
async function ensureBaselineRevision(tx: Tx, templateId: string, current: TemplateState): Promise<void> {
  const [any] = await tx
    .select({ id: venueTemplateRevisions.id })
    .from(venueTemplateRevisions)
    .where(eq(venueTemplateRevisions.templateId, templateId))
    .limit(1)
  if (!any) await addRevision(tx, templateId, current, 'save')
}

/** Redraws the thumbnails of live layouts that use the template, locking them in id order. */
async function redrawLayoutThumbs(tx: Tx, templateId: string, items: readonly FixedItem[]): Promise<void> {
  const rows = await tx
    .select({ id: layouts.id, canvas: layouts.canvas })
    .from(layouts)
    .where(and(eq(layouts.venueTemplateId, templateId), isNull(layouts.deletedAt)))
    .orderBy(asc(layouts.id))
    .for('update')
  for (const row of rows) {
    await tx
      .update(layouts)
      // updated_at is set to itself, or drizzle's $onUpdate would move it to now.
      .set({ thumbSvg: renderThumbnailSvg(row.canvas as Canvas, items), updatedAt: sql`${layouts.updatedAt}` })
      .where(eq(layouts.id, row.id))
  }
}

type WriteArgs = { baseVersion: number; saveId: string; editedBy: 'Noa' | 'Aiden' }

/**
 * The shared body of a save, an accepted import and a restore: lock, check
 * the version, write the next state with version + 1, add its revision and
 * redraw layout thumbnails. `next` returns null to refuse (its reason is
 * returned as is).
 *
 * Saved twice (DECISIONS 28, as layouts do it): the template remembers its
 * newest save ids (recent_saves). A retry of a save that landed, its reply
 * lost, answers 'already-saved' with the version that save made, even when
 * other saves landed since; the tab's next save then meets those as a
 * conflict.
 */
async function writeTemplate<Refusal extends { status: string }>(
  db: Db,
  id: string,
  args: WriteArgs,
  reason: 'save' | 'import',
  next: (tx: Tx, current: LockedTemplate) => Promise<(TemplateState & { importedBy: VenueImportedBy }) | Refusal>,
): Promise<TemplateSaveResult | Refusal> {
  return db.transaction(async (tx): Promise<TemplateSaveResult | Refusal> => {
    const current = await lockTemplate(tx, id)
    if (!current) return { status: 'gone' }
    if (current.version !== args.baseVersion) {
      const state = {
        version: current.version,
        updatedAt: current.updatedAt,
        editedBy: current.editedBy,
        editedById: current.editedById,
      }
      const earlier = current.recentSaves.find((r) => r.saveId === args.saveId)
      // Only ids and versions are kept, so the time is the template's last save.
      if (earlier && earlier.version !== current.version) return { status: 'already-saved', version: earlier.version, updatedAt: current.updatedAt, editedBy: args.editedBy, editedById: null }
      if (earlier || current.lastSaveId === args.saveId) return { status: 'already-saved', ...state }
      return { status: 'conflict', ...state, lastSaveId: current.lastSaveId }
    }
    const state = await next(tx, current)
    if ('status' in state) return state
    await ensureBaselineRevision(tx, id, current)
    const recentSaves: RecentSave[] = [
      { saveId: args.saveId, version: args.baseVersion + 1 },
      ...current.recentSaves.filter((r) => r.saveId !== args.saveId),
    ].slice(0, MAX_RECENT_SAVES)
    const [row] = await tx
      .update(venueTemplates)
      .set({
        fixedItems: state.fixedItems,
        reference: state.reference,
        referenceImageId: state.referenceImageId,
        importedBy: state.importedBy,
        version: sql`${venueTemplates.version} + 1`,
        lastSaveId: args.saveId,
        recentSaves,
        editedBy: args.editedBy,
        editedByName: args.editedBy,
        // This phase's writers only know the name, so clear an id a later writer left.
        editedByUserId: null,
        updatedAt: sql`now()`,
      })
      .where(eq(venueTemplates.id, id))
      .returning({
        version: venueTemplates.version,
        updatedAt: venueTemplates.updatedAt,
        editedBy: editorName(venueTemplates),
        editedById: venueTemplates.editedByUserId,
      })
    await addRevision(tx, id, state, reason)
    await redrawLayoutThumbs(tx, id, state.fixedItems)
    return { status: 'saved', ...row! }
  })
}

/** The template editor's save: fixed items and reference meta. The reference image stays as it is. */
export function saveTemplate(db: Db, id: string, body: SaveVenueBody): Promise<TemplateSaveResult> {
  return writeTemplate<never>(db, id, body, 'save', async (_tx, current) => ({
    fixedItems: body.fixedItems,
    reference: body.reference,
    referenceImageId: current.referenceImageId,
    importedBy: current.importedBy,
  }))
}

/**
 * Accept on an import draft: the fixed items, the image (which must belong to
 * this template), its placement and where the items came from, saved as one
 * revision with reason 'import'. The revision before it is the "Undo import" point.
 */
export function acceptImport(db: Db, id: string, body: AcceptImportBody): Promise<TemplateSaveResult | { status: 'bad-image' }> {
  return writeTemplate<{ status: 'bad-image' }>(db, id, body, 'import', async (tx) => {
    const [image] = await tx
      .select({ id: venueImages.id })
      .from(venueImages)
      .where(and(eq(venueImages.id, body.imageId), eq(venueImages.templateId, id)))
    if (!image) return { status: 'bad-image' }
    return { fixedItems: body.fixedItems, reference: body.reference, referenceImageId: image.id, importedBy: body.importedBy }
  })
}

type RestoreRefusal = { status: 'revision-not-found' } | { status: 'invalid'; issues: string[] }

/**
 * Puts back the fixed items, reference meta and reference image a revision
 * holds ("Undo import" restores the revision before an import), as a new save
 * with its own revision. A restored state without an image was drawn by hand,
 * so imported_by goes back to 'hand'; with one, it stays as it is.
 */
export function restoreRevision(
  db: Db,
  id: string,
  revisionId: string,
  body: RestoreRevisionBody,
): Promise<TemplateSaveResult | RestoreRefusal> {
  return writeTemplate<RestoreRefusal>(db, id, body, 'save', async (tx, current) => {
    const [revision] = await tx
      .select({
        fixedItems: venueTemplateRevisions.fixedItems,
        referenceImageId: venueTemplateRevisions.referenceImageId,
        reference: venueTemplateRevisions.reference,
      })
      .from(venueTemplateRevisions)
      .where(and(eq(venueTemplateRevisions.id, revisionId), eq(venueTemplateRevisions.templateId, id)))
    if (!revision) return { status: 'revision-not-found' }
    const parsed = fixedItemsSchema.safeParse(revision.fixedItems)
    if (!parsed.success) return { status: 'invalid', issues: ['That revision holds items that no longer pass the check'] }
    return {
      fixedItems: parsed.data,
      reference: revision.reference ?? null,
      referenceImageId: revision.referenceImageId,
      importedBy: revision.referenceImageId === null ? 'hand' : current.importedBy,
    }
  })
}
