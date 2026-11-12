import 'server-only'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { normalizeEmail } from '@/domain/accounts'
import { getDb } from '../db/client'
import { venueTemplates } from '../db/schema'
import type { Db } from '../locks'
import { recordEvent } from '../repo/activity'
import { assignOwnerlessWeddings } from '../repo/members'
import { countUsers, insertUser, type UserDto } from '../repo/users'
import { passwordsMatch } from './tokens'

/**
 * First-run setup: while no account exists, whoever knows the old shared site
 * password (SITE_PASSWORD) may make the first account, an admin, which takes
 * over every wedding nobody owns. That is the only use of SITE_PASSWORD left.
 * Once any account exists, /setup and /api/setup answer 404 for good.
 */

/** True while setup may run: SITE_PASSWORD is set and there is no account yet. */
export async function setupOpen(db: Db = getDb()): Promise<boolean> {
  if (!process.env.SITE_PASSWORD) return false
  return (await countUsers(db)) === 0
}

/** The typed site password against SITE_PASSWORD, in constant time. False when SITE_PASSWORD is not set. */
export function setupPasswordMatches(input: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const expected = env.SITE_PASSWORD
  if (!expected) return false
  return passwordsMatch(input, expected)
}

export type BootstrapEmailCheck = 'ok' | 'not-configured' | 'mismatch'

/**
 * On Vercel (production and preview deployments alike: VERCEL is set on
 * every one) the first admin must be the person named in
 * BOOTSTRAP_ADMIN_EMAIL, so someone who learned the old site password cannot
 * claim the site, nor a preview deployment pointed at an empty database.
 * Elsewhere (local runs, tests) any email will do.
 */
export function checkBootstrapEmail(
  email: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): BootstrapEmailCheck {
  if (!env.VERCEL) return 'ok'
  const expected = normalizeEmail(env.BOOTSTRAP_ADMIN_EMAIL ?? '')
  if (!expected) return 'not-configured'
  return normalizeEmail(email) === expected ? 'ok' : 'mismatch'
}

/** The key two setups at once queue on, so only one can make the first account. */
const SETUP_LOCK = sql`select pg_advisory_xact_lock(hashtextextended('seat-plan setup', 0))`

export type SetupResult = { status: 'created'; user: UserDto; weddingsClaimed: number; venuesClaimed: number } | { status: 'closed' }

/**
 * Makes the first admin, in one transaction under the setup lock: counts the
 * accounts again (another setup may have just finished), adds the user, makes
 * them the owner of every wedding with no owner (deleted ones too) and of every
 * live venue made before accounts (no owner, not in the library; library
 * venues stay shared and ownerless), and logs setup_completed. 'closed' when an account already exists.
 */
export async function completeSetup(
  db: Db,
  input: { email: string; displayName: string; passwordHash: string },
): Promise<SetupResult> {
  return db.transaction(async (tx): Promise<SetupResult> => {
    await tx.execute(SETUP_LOCK)
    if ((await countUsers(tx)) > 0) return { status: 'closed' }
    const created = await insertUser(tx, { ...input, isAdmin: true })
    if (created.status !== 'created') return { status: 'closed' }
    const weddingsClaimed = await assignOwnerlessWeddings(tx, created.user.id)
    const claimedVenues = await tx
      .update(venueTemplates)
      .set({ ownerUserId: created.user.id })
      .where(and(isNull(venueTemplates.ownerUserId), eq(venueTemplates.isLibrary, false), isNull(venueTemplates.deletedAt)))
      .returning({ id: venueTemplates.id })
    const venuesClaimed = claimedVenues.length
    await recordEvent(tx, { kind: 'setup_completed', userId: created.user.id, detail: { weddingsClaimed, venuesClaimed } })
    return { status: 'created', user: created.user, weddingsClaimed, venuesClaimed }
  })
}
