/**
 * The contract for the admin pages' numbers and the admin-only changes:
 * request bodies (Zod, checked on the server) and reply shapes (types), as in
 * src/shared/accounts-api.ts. Only admins reach any of this: the routes use
 * withAdmin and the pages requireAdminPage.
 *
 * Edit counts come from the hourly usage counters (src/domain/activity.ts),
 * so they count saves and other changes, not keystrokes.
 */
import { z } from 'zod'
import { uuid, type VenueImportedBy } from './api'

const role = z.enum(['owner', 'editor'])

// ---------- The overview ----------

export type AdminTotals = {
  people: { active: number; off: number; admins: number }
  weddings: { live: number; deleted: number }
  /** In live weddings. */
  guests: number
  layouts: number
  venues: { library: number; private: number; noOwner: number }
  /** On, with a live layout in a live wedding. */
  shareLinks: number
}

/** One day in the admin time zone (ADMIN_TIME_ZONE), newest first. */
export type AdminDay = { day: string; edits: number; signIns: number }

export type AdminOverview = { totals: AdminTotals; days: AdminDay[] }

// ---------- Weddings ----------

/** What the weddings list adds to each AdminWedding. */
export type AdminWeddingStats = {
  /**
   * The newest change anyone made: from the usage counters, or, for a wedding
   * with none counted yet, its newest layout save ('layout').
   */
  lastEdited: { at: string; by: string | null; source: 'activity' | 'layout' } | null
  edits30: number
  /** Links that are on, on live layouts (a deleted wedding's open nothing until it is undeleted), and the last time any was opened. */
  shareLinks: { active: number; lastOpenedAt: string | null }
}

/** One line of a wedding's activity on its admin page. */
export type AdminActivity = {
  id: string
  at: string
  kind: string
  userId: string | null
  userName: string | null
  /** For a usage counter: how many changes that hour. */
  count: number | null
  /** For admin_access: whether it changed something. */
  write: boolean
}

/** Someone the admin may add to a wedding or make its owner. */
export type AdminPick = { id: string; displayName: string; email: string; disabled: boolean }

/** POST /api/admin/weddings/:id/members: adds someone with an account, no invite needed. 201 with the WeddingMember. */
export const adminAddMemberBody = z.object({ userId: uuid, role })
export type AdminAddMemberBody = z.input<typeof adminAddMemberBody>

/**
 * POST /api/admin/weddings/:id/transfer: makes `toUserId` an owner (adding
 * them if they do not belong yet). With keepPreviousAsEditors the wedding's
 * other owners become editors; without it they stay owners. Replies with the
 * members (WeddingMember[]).
 */
export const transferOwnershipBody = z.object({ toUserId: uuid, keepPreviousAsEditors: z.boolean() })
export type TransferOwnershipBody = z.input<typeof transferOwnershipBody>

// POST /api/admin/weddings/:id/undelete clears deleted_at, and only that. Replies with the AdminWedding.

// ---------- People ----------

/** What the people list adds to each AdminUser. */
export type AdminPersonStats = {
  /** Live weddings they own, and live weddings they help with as an editor. */
  owned: number
  editing: number
  edits7: number
  edits30: number
  aiImports30: number
}

// ---------- Venues ----------

export type AdminVenueStatus = 'library' | 'private' | 'no-owner'

export type AdminVenue = {
  id: string
  name: string
  /** 'library' wins: a library venue may also have no owner. */
  status: AdminVenueStatus
  isLibrary: boolean
  owner: { id: string; displayName: string } | null
  importedBy: VenueImportedBy
  /** Live layouts in live weddings that use it, across every wedding, and how many weddings those are. */
  layouts: number
  weddings: number
  updatedAt: string
}

/**
 * PATCH /api/admin/venues/:id. Puts it in the library or takes it out, and
 * changes its owner (null: nobody). A venue outside the library needs an
 * owner: taking one out of the library, or clearing the owner of one outside
 * it, is refused with 409 needs_owner while it has none. Replies with the
 * AdminVenue.
 */
export const adminVenuePatchBody = z
  .object({ library: z.boolean().optional(), ownerUserId: uuid.nullable().optional() })
  .refine((b) => b.library !== undefined || b.ownerUserId !== undefined, 'Send library, ownerUserId or both')
export type AdminVenuePatchBody = z.input<typeof adminVenuePatchBody>
