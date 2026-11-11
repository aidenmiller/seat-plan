/**
 * Accounts for integration tests: users, a signed-in cookie for one, and
 * wedding members. Nothing in the app imports this file.
 *
 * Session cookies are signed with AUTH_SECRET, so importing this file sets a
 * test secret when none (or too short a one) is set.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { users, weddingMembers } from '../src/server/db/schema'
import type { Db } from '../src/server/locks'
import { createSession } from '../src/server/repo/sessions'
import { createUser, type UserDto } from '../src/server/repo/users'

export const TEST_AUTH_SECRET = 'integration-test-secret-at-least-32-characters'
if ((process.env.AUTH_SECRET ?? '').length < 32) process.env.AUTH_SECRET = TEST_AUTH_SECRET

export const TEST_PASSWORD = 'correct horse battery'

export type TestUser = UserDto & { password: string }

/** A user with a unique email. Pass `disabled` for an account that is turned off. */
export async function makeUser(
  db: Db,
  opts: { email?: string; displayName?: string; password?: string; isAdmin?: boolean; disabled?: boolean } = {},
): Promise<TestUser> {
  const password = opts.password ?? TEST_PASSWORD
  const result = await createUser(db, {
    email: opts.email ?? `user-${randomUUID()}@example.com`,
    displayName: opts.displayName ?? 'Pat',
    password,
    isAdmin: opts.isAdmin ?? false,
  })
  if (result.status !== 'created') throw new Error(`makeUser: ${result.status}`)
  if (opts.disabled) {
    await db.update(users).set({ disabledAt: new Date() }).where(eq(users.id, result.user.id))
    return { ...result.user, disabled: true, password }
  }
  return { ...result.user, password }
}

/** A Cookie header value that signs this user in: `sp_session=<value>`. */
export async function sessionCookie(db: Db, userId: string): Promise<string> {
  const session = await createSession(db, userId, { userAgent: 'vitest' })
  return `sp_session=${session.cookieValue}`
}

export async function makeMember(db: Db, weddingId: string, userId: string, role: 'owner' | 'editor'): Promise<void> {
  await db.insert(weddingMembers).values({ weddingId, userId, role })
}
