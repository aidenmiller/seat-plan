import 'server-only'
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import type { AdminVenue, AdminVenueStatus } from '@/shared/admin-api'
import type { VenueImportedBy } from '@/shared/api'
import { users, venueTemplates } from '../db/schema'
import type { Db } from '../locks'

/**
 * Every venue template for the admin's Venues page: the all-venues list the
 * planners' lists deliberately leave out (venue-access.ts, "no admin
 * extras"). Only admins reach these (the admin page and route check). Usage
 * counts cover every live wedding, since the admin may see them all.
 */

/** A venue outside the library needs an owner, or nobody but an admin could change it. */
export function venueStatus(isLibrary: boolean, ownerUserId: string | null): AdminVenueStatus {
  if (isLibrary) return 'library'
  return ownerUserId ? 'private' : 'no-owner'
}

// Explicit table names, as in venues.ts: inside sql`` drizzle prints a column without its table.
const liveLayouts = sql`from "layouts" l join "weddings" w on w."id" = l."wedding_id"
  where l."venue_template_id" = "venue_templates"."id" and l."deleted_at" is null and w."deleted_at" is null`
const layoutCount = sql<number>`(select count(*)::int ${liveLayouts})`
const weddingCount = sql<number>`(select count(distinct l."wedding_id")::int ${liveLayouts})`

const columns = {
  id: venueTemplates.id,
  name: venueTemplates.name,
  isLibrary: venueTemplates.isLibrary,
  ownerUserId: venueTemplates.ownerUserId,
  ownerName: users.displayName,
  importedBy: venueTemplates.importedBy,
  updatedAt: venueTemplates.updatedAt,
  layouts: layoutCount,
  weddings: weddingCount,
}

type Row = {
  id: string
  name: string
  isLibrary: boolean
  ownerUserId: string | null
  ownerName: string | null
  importedBy: VenueImportedBy
  updatedAt: Date
  layouts: number
  weddings: number
}

function toAdminVenue(r: Row): AdminVenue {
  return {
    id: r.id,
    name: r.name,
    status: venueStatus(r.isLibrary, r.ownerUserId),
    isLibrary: r.isLibrary,
    owner: r.ownerUserId ? { id: r.ownerUserId, displayName: r.ownerName ?? '' } : null,
    importedBy: r.importedBy,
    layouts: Number(r.layouts),
    weddings: Number(r.weddings),
    updatedAt: r.updatedAt.toISOString(),
  }
}

function select(db: Db, where: SQL | undefined) {
  return db
    .select(columns)
    .from(venueTemplates)
    .leftJoin(users, eq(users.id, venueTemplates.ownerUserId))
    .where(and(isNull(venueTemplates.deletedAt), where))
}

/** Every live template: the library first, then by name. */
export async function listVenuesForAdmin(db: Db): Promise<AdminVenue[]> {
  const rows = await select(db, undefined).orderBy(
    sql`case when ${venueTemplates.isLibrary} then 0 else 1 end`,
    sql`lower(${venueTemplates.name})`,
    venueTemplates.id,
  )
  return rows.map(toAdminVenue)
}

export async function getVenueForAdmin(db: Db, id: string): Promise<AdminVenue | null> {
  const [row] = await select(db, eq(venueTemplates.id, id))
  return row ? toAdminVenue(row) : null
}

export type AdminVenueChange = { library?: boolean; ownerUserId?: string | null }

export type AdminVenueResult =
  | { status: 'ok'; changed: { library?: { from: boolean; to: boolean }; owner?: { from: string | null; to: string | null } } }
  | { status: 'not-found' | 'no-user' | 'user-disabled' | 'needs-owner' }

/**
 * Puts a live template in the library or takes it out, and changes its
 * owner, in one transaction with the template row locked. Refused with
 * 'needs-owner' when the change would leave it outside the library with no
 * owner: taking an ownerless venue out of the library, or clearing the owner
 * of one outside it (the admin assigns an owner first). The new owner must
 * have an account that is on. Its contents and version are not touched.
 */
export async function changeVenueForAdmin(db: Db, id: string, change: AdminVenueChange): Promise<AdminVenueResult> {
  return db.transaction(async (tx): Promise<AdminVenueResult> => {
    const [current] = await tx
      .select({ isLibrary: venueTemplates.isLibrary, ownerUserId: venueTemplates.ownerUserId })
      .from(venueTemplates)
      .where(and(eq(venueTemplates.id, id), isNull(venueTemplates.deletedAt)))
      .for('update')
    if (!current) return { status: 'not-found' }
    if (change.ownerUserId) {
      const [owner] = await tx.select({ disabledAt: users.disabledAt }).from(users).where(eq(users.id, change.ownerUserId))
      if (!owner) return { status: 'no-user' }
      if (owner.disabledAt) return { status: 'user-disabled' }
    }
    const library = change.library ?? current.isLibrary
    const ownerUserId = change.ownerUserId !== undefined ? change.ownerUserId : current.ownerUserId
    if (!library && ownerUserId === null && (change.library === false || change.ownerUserId === null)) return { status: 'needs-owner' }
    const changed: Extract<AdminVenueResult, { status: 'ok' }>['changed'] = {}
    if (library !== current.isLibrary) changed.library = { from: current.isLibrary, to: library }
    if (ownerUserId !== current.ownerUserId) changed.owner = { from: current.ownerUserId, to: ownerUserId }
    if (changed.library || changed.owner) {
      // Not an edit of the venue itself: "Edited … by …" keeps its time.
      await tx
        .update(venueTemplates)
        .set({ isLibrary: library, ownerUserId, updatedAt: sql`${venueTemplates.updatedAt}` })
        .where(eq(venueTemplates.id, id))
    }
    return { status: 'ok', changed }
  })
}
