/**
 * Invite links through the routes, against the test database: making them
 * (owners only), listing and cancelling them, looking one up, signing up
 * through one, accepting one while signed in, and every way one can stop
 * working: used, cancelled, expired, locked to another email, an email that
 * has an account, the sender losing the role. Planner invites from the admin
 * routes too. No reply but the one that makes an invite, and no activity
 * row, ever holds a token. The wrong-guess delay is switched off here.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../test/db'
import { makeMember, makeUser, sessionCookie, type TestUser } from '../../../../test/auth'
import { callRoute, freshAddress, sessionCookieFrom, type CallOptions, type CallResult } from '../../../../test/routes'
import { inviteProblemMessage } from '@/domain/account-wording'
import { hashUserPassword } from '@/server/auth/passwords'
import { PER_ADDRESS_LIMIT } from '@/server/auth/throttle'
import { activityEvents, invites, users, weddingMembers } from '@/server/db/schema'
import { INVITE_NOTE_MAX as REPO_NOTE_MAX } from '@/server/repo/invites'
import { lookupSession } from '@/server/repo/sessions'
import { INVITE_NOTE_MAX, type CreatedInvite, type InviteLookup, type InviteSummary } from '@/shared/accounts-api'

vi.mock('@/server/auth/throttle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/auth/throttle')>()),
  wrongGuessDelay: async () => {},
}))
vi.mock('@/server/auth/passwords', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/auth/passwords')>()
  return { ...real, hashUserPassword: vi.fn(real.hashUserPassword) }
})

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'invites-route-test-secret-32-chars-plus')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

async function db() {
  return (await import('@/server/db/client')).getDb()
}

beforeEach(async () => {
  await (await db()).execute(sql`delete from login_attempts`)
})

const routes = async () => ({
  weddingInvites: (await import('../weddings/[id]/invites/route')) as Record<string, unknown>,
  one: (await import('./[id]/route')) as Record<string, unknown>,
  lookup: (await import('./lookup/route')) as Record<string, unknown>,
  register: (await import('./register/route')) as Record<string, unknown>,
  accept: (await import('./accept/route')) as Record<string, unknown>,
  plannerInvites: (await import('../admin/invites/route')) as Record<string, unknown>,
  members: (await import('../weddings/[id]/members/route')) as Record<string, unknown>,
})

/** Every token a reply handed out in this file: none may show up anywhere else. */
const issued: string[] = []

/** Calls a route and checks the reply holds no token, unless it is the reply that made one. */
async function call(mod: Record<string, unknown>, method: string, opts: CallOptions & { makesToken?: boolean } = {}): Promise<CallResult> {
  const res = await callRoute(mod, method, opts)
  if (opts.makesToken && res.status === 201) {
    const token = (res.body as CreatedInvite).token
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify((res.body as CreatedInvite).invite)).not.toContain(token)
    issued.push(token)
  } else {
    for (const token of issued) expect(res.text, `${method} reply`).not.toContain(token)
  }
  return res
}

type Person = TestUser & { cookie: string }

async function person(opts: { isAdmin?: boolean; displayName?: string; email?: string } = {}): Promise<Person> {
  const user = await makeUser(await db(), opts)
  return { ...user, cookie: await sessionCookie(await db(), user.id) }
}

async function weddingWithOwner(name = 'Rosa & Ben') {
  const { makeWedding } = await import('@/server/repo/test-fixtures')
  const weddingId = await makeWedding(await db(), name)
  const owner = await person({ displayName: 'Olive' })
  await makeMember(await db(), weddingId, owner.id, 'owner')
  return { weddingId, owner }
}

async function makeInvite(weddingId: string, owner: Person, body: Record<string, unknown> = { role: 'editor' }) {
  const { weddingInvites } = await routes()
  const res = await call(weddingInvites, 'POST', { cookie: owner.cookie, params: { id: weddingId }, body, makesToken: true })
  expect(res.status, res.text).toBe(201)
  return res.body as CreatedInvite
}

async function roleOf(weddingId: string, userId: string): Promise<string | null> {
  const [row] = await (await db())
    .select({ role: weddingMembers.role })
    .from(weddingMembers)
    .where(and(eq(weddingMembers.weddingId, weddingId), eq(weddingMembers.userId, userId)))
  return row?.role ?? null
}

const signUp = (token: string, extra: Record<string, unknown> = {}) => ({
  token,
  email: `new-${randomUUID()}@example.com`,
  displayName: 'Nova',
  password: 'a brand new password',
  ...extra,
})

describe('making, listing and cancelling invites', () => {
  it('lets owners and admins make invites, and refuses editors (403) and strangers (404)', async () => {
    const { weddingInvites } = await routes()
    const { weddingId, owner } = await weddingWithOwner()
    const editor = await person()
    await makeMember(await db(), weddingId, editor.id, 'editor')
    const stranger = await person()
    const admin = await person({ isAdmin: true })

    const made = await makeInvite(weddingId, owner, { role: 'owner', email: ' Pat@Example.com ', note: '  For the planner  ' })
    expect(made.invite).toMatchObject({
      weddingId,
      role: 'owner',
      email: 'pat@example.com',
      note: 'For the planner',
      invitedBy: { id: owner.id, name: 'Olive' },
      acceptedBy: null,
      state: 'pending',
    })
    expect(Date.parse(made.invite.expiresAt) - Date.now()).toBeGreaterThan(6.9 * 86_400_000)

    const post = (who: Person, body: unknown) => call(weddingInvites, 'POST', { cookie: who.cookie, params: { id: weddingId }, body, makesToken: true })
    expect((await post(editor, { role: 'editor' })).status).toBe(403)
    expect((await post(stranger, { role: 'editor' })).status).toBe(404)
    expect((await post(admin, { role: 'editor' })).status).toBe(201)
    expect((await call(weddingInvites, 'POST', { params: { id: weddingId }, body: { role: 'editor' } })).status).toBe(401)
    // Bodies that do not fit.
    expect((await post(owner, { role: 'admin' })).status).toBe(422)
    expect((await post(owner, { role: 'editor', email: 'not an email' })).status).toBe(422)
    expect((await post(owner, { role: 'editor', note: 'x'.repeat(INVITE_NOTE_MAX + 1) })).status).toBe(422)
    // An empty email means anyone with the link.
    expect(((await post(owner, { role: 'editor', email: '' })).body as CreatedInvite).invite.email).toBeNull()

    const list = await call(weddingInvites, 'GET', { cookie: owner.cookie, params: { id: weddingId } })
    expect(list.status).toBe(200)
    expect((list.body as InviteSummary[]).map((i) => i.id)).toContain(made.invite.id)
    expect(JSON.stringify(list.body)).not.toMatch(/token/i)
    expect((await call(weddingInvites, 'GET', { cookie: editor.cookie, params: { id: weddingId } })).status).toBe(403)
    expect((await call(weddingInvites, 'GET', { cookie: stranger.cookie, params: { id: weddingId } })).status).toBe(404)

    const [created] = await (await db())
      .select({ detail: activityEvents.detail, userId: activityEvents.userId })
      .from(activityEvents)
      .where(and(eq(activityEvents.kind, 'invite_created'), eq(activityEvents.subjectId, made.invite.id)))
    expect(created).toEqual({ userId: owner.id, detail: { role: 'owner', emailLocked: true } })
  })

  it('keeps the note limit the same as the invites table', () => {
    expect(INVITE_NOTE_MAX).toBe(REPO_NOTE_MAX)
  })

  it('lets an owner cancel a pending invite, after which the link is refused', async () => {
    const { one, lookup, register } = await routes()
    const { weddingId, owner } = await weddingWithOwner()
    const editor = await person()
    await makeMember(await db(), weddingId, editor.id, 'editor')
    const stranger = await person()
    const { invite, token } = await makeInvite(weddingId, owner)

    expect((await call(one, 'DELETE', { cookie: editor.cookie, params: { id: invite.id } })).status).toBe(403)
    expect((await call(one, 'DELETE', { cookie: stranger.cookie, params: { id: invite.id } })).status).toBe(404)
    expect((await call(one, 'DELETE', { cookie: owner.cookie, params: { id: randomUUID() } })).status).toBe(404)
    expect(await call(one, 'DELETE', { cookie: owner.cookie, params: { id: invite.id } })).toMatchObject({ status: 200, body: { ok: true } })
    expect(await call(one, 'DELETE', { cookie: owner.cookie, params: { id: invite.id } })).toMatchObject({ status: 409, body: { error: 'not_pending' } })

    const seen = await call(lookup, 'POST', { body: { token }, ip: freshAddress() })
    expect(seen).toMatchObject({ status: 200, body: { status: 'revoked' } })
    expect(Object.keys(seen.body as object)).toEqual(['status'])
    const tried = await call(register, 'POST', { body: signUp(token), ip: freshAddress() })
    expect(tried).toMatchObject({ status: 409, body: { error: 'invite_unusable', reason: 'revoked', message: inviteProblemMessage('revoked') } })

    const [revoked] = await (await db())
      .select({ userId: activityEvents.userId, weddingId: activityEvents.weddingId })
      .from(activityEvents)
      .where(and(eq(activityEvents.kind, 'invite_revoked'), eq(activityEvents.subjectId, invite.id)))
    expect(revoked).toEqual({ userId: owner.id, weddingId })
  })

  it('does not cancel a planner invite through the wedding route', async () => {
    const { one, plannerInvites } = await routes()
    const admin = await person({ isAdmin: true })
    const made = await call(plannerInvites, 'POST', { cookie: admin.cookie, body: {}, makesToken: true })
    expect(made.status).toBe(201)
    expect((await call(one, 'DELETE', { cookie: admin.cookie, params: { id: (made.body as CreatedInvite).invite.id } })).status).toBe(404)
  })
})

describe('looking up an invite', () => {
  it('shows who sent it, for what, while it works, and 404 for an unknown or malformed link', async () => {
    const { lookup } = await routes()
    const { weddingId, owner } = await weddingWithOwner('Mia & Leo')
    const { token, invite } = await makeInvite(weddingId, owner, { role: 'editor', email: 'only@example.com' })
    const res = await call(lookup, 'POST', { body: { token }, ip: freshAddress() })
    const expected: InviteLookup = {
      status: 'ok',
      kind: 'wedding',
      weddingName: 'Mia & Leo',
      role: 'editor',
      inviterName: 'Olive',
      email: 'only@example.com',
      expiresAt: invite.expiresAt,
    }
    expect(res).toMatchObject({ status: 200, body: expected })
    // Nothing that identifies the rows.
    expect(res.text).not.toContain(weddingId)
    expect(res.text).not.toContain(invite.id)

    expect(await call(lookup, 'POST', { body: { token: 'A'.repeat(43) }, ip: freshAddress() })).toMatchObject({ status: 404, body: { error: 'not_found' } })
    expect((await call(lookup, 'POST', { body: { token: 'short' }, ip: freshAddress() })).status).toBe(404)
    expect((await call(lookup, 'POST', { body: {}, ip: freshAddress() })).status).toBe(422)
    expect((await call(lookup, 'POST', { body: 'not json', ip: freshAddress() })).status).toBe(400)
  })

  it('says the invite has expired, and that it stopped working when the sender lost the role', async () => {
    const { lookup, accept, members } = await routes()
    const { weddingId, owner } = await weddingWithOwner()
    const expiring = await makeInvite(weddingId, owner)
    await (await db()).update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.id, expiring.invite.id))
    expect((await call(lookup, 'POST', { body: { token: expiring.token }, ip: freshAddress() })).body).toEqual({ status: 'expired' })
    const someone = await person()
    expect(await call(accept, 'POST', { cookie: someone.cookie, body: { token: expiring.token } })).toMatchObject({
      status: 409,
      body: { reason: 'expired' },
    })
    expect(await roleOf(weddingId, someone.id)).toBeNull()

    // The owner who sent an owner invite becomes an editor: it can no longer give that role.
    const ownerInvite = await makeInvite(weddingId, owner, { role: 'owner' })
    const coOwner = await person()
    await makeMember(await db(), weddingId, coOwner.id, 'owner')
    await (await db())
      .update(weddingMembers)
      .set({ role: 'editor' })
      .where(and(eq(weddingMembers.weddingId, weddingId), eq(weddingMembers.userId, owner.id)))
    expect((await call(lookup, 'POST', { body: { token: ownerInvite.token }, ip: freshAddress() })).body).toEqual({ status: 'inviter-lost-access' })
    expect((await call(accept, 'POST', { cookie: someone.cookie, body: { token: ownerInvite.token } })).body).toMatchObject({
      reason: 'inviter-lost-access',
    })
    expect((await call(members, 'GET', { cookie: someone.cookie, params: { id: weddingId } })).status).toBe(404)
  })

  it('counts every lookup for the address and blocks after the limit, leaving other addresses alone', async () => {
    const { lookup } = await routes()
    const { weddingId, owner } = await weddingWithOwner()
    const { token } = await makeInvite(weddingId, owner)
    const address = freshAddress()
    for (let i = 0; i < PER_ADDRESS_LIMIT; i++) {
      expect((await call(lookup, 'POST', { body: { token: `${'B'.repeat(40)}${String(i).padStart(3, '0')}` }, ip: address })).status).toBe(404)
    }
    const blocked = await call(lookup, 'POST', { body: { token }, ip: address })
    expect(blocked).toMatchObject({ status: 429, body: { error: 'too_many_attempts' } })
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await call(lookup, 'POST', { body: { token }, ip: freshAddress() })).status).toBe(200)
  })
})

describe('signing up through an invite', () => {
  it('makes the account, joins the wedding with the invite’s role, signs in, and uses up the link', async () => {
    const { register, lookup, accept, members } = await routes()
    const { weddingId, owner } = await weddingWithOwner()
    const { token, invite } = await makeInvite(weddingId, owner)
    const tag = randomUUID()
    const body = signUp(token, { email: ` Nova.${tag}@Example.com `, displayName: '  Nova  ' })
    const res = await call(register, 'POST', { body, ip: freshAddress() })
    expect(res).toMatchObject({ status: 200, body: { ok: true, redirect: `/w/${weddingId}/layouts` } })
    const cookie = sessionCookieFrom(res)!
    expect(cookie).toBeTruthy()
    const user = await lookupSession(await db(), cookie.slice(cookie.indexOf('=') + 1))
    expect(user).toMatchObject({ email: `nova.${tag}@example.com`, displayName: 'Nova', isAdmin: false })
    expect(await roleOf(weddingId, user!.id)).toBe('editor')
    // Signed in: the member list opens for them.
    expect((await call(members, 'GET', { cookie, params: { id: weddingId } })).status).toBe(200)

    // Used up: the same link is refused everywhere.
    expect((await call(lookup, 'POST', { body: { token }, ip: freshAddress() })).body).toEqual({ status: 'used' })
    expect((await call(register, 'POST', { body: signUp(token), ip: freshAddress() })).body).toMatchObject({ error: 'invite_unusable', reason: 'used' })
    const other = await person()
    expect((await call(accept, 'POST', { cookie: other.cookie, body: { token } })).body).toMatchObject({ reason: 'used' })
    expect(await roleOf(weddingId, other.id)).toBeNull()

    const [accepted] = await (await db())
      .select({ userId: activityEvents.userId, weddingId: activityEvents.weddingId, detail: activityEvents.detail })
      .from(activityEvents)
      .where(and(eq(activityEvents.kind, 'invite_accepted'), eq(activityEvents.subjectId, invite.id)))
    expect(accepted).toEqual({ userId: user!.id, weddingId, detail: { role: 'editor', newAccount: true } })
  })

  it('ends the session the browser held before, as signing in does', async () => {
    const { register } = await routes()
    const { weddingId, owner } = await weddingWithOwner()
    const { token } = await makeInvite(weddingId, owner)
    const before = await person()
    const res = await call(register, 'POST', { body: signUp(token), ip: freshAddress(), cookie: before.cookie })
    expect(res.status).toBe(200)
    expect(await lookupSession(await db(), before.cookie.slice(before.cookie.indexOf('=') + 1))).toBeNull()
  })

  it('keeps an invite locked to its email, and says when an email has an account already', async () => {
    const { register, lookup } = await routes()
    const { weddingId, owner } = await weddingWithOwner()
    const kimEmail = `kim-${randomUUID()}@example.com`
    const locked = await makeInvite(weddingId, owner, { role: 'editor', email: kimEmail })
    const wrong = await call(register, 'POST', { body: signUp(locked.token, { email: 'someone-else@example.com' }), ip: freshAddress() })
    expect(wrong).toMatchObject({ status: 409, body: { reason: 'email-mismatch', message: inviteProblemMessage('email-mismatch') } })
    expect((await call(lookup, 'POST', { body: { token: locked.token }, ip: freshAddress() })).body).toMatchObject({ status: 'ok' })

    // An unlocked invite, with an email that has an account: nothing is kept, and the link still works.
    const open = await makeInvite(weddingId, owner)
    const existing = await person()
    const taken = await call(register, 'POST', { body: signUp(open.token, { email: existing.email.toUpperCase() }), ip: freshAddress() })
    expect(taken).toMatchObject({ status: 409, body: { error: 'email_taken' } })
    expect(await roleOf(weddingId, existing.id)).toBeNull()
    expect((await call(lookup, 'POST', { body: { token: open.token }, ip: freshAddress() })).body).toMatchObject({ status: 'ok' })

    const right = await call(register, 'POST', { body: signUp(locked.token, { email: kimEmail.toUpperCase() }), ip: freshAddress() })
    expect(right.status).toBe(200)
    const [kim] = await (await db()).select({ id: users.id }).from(users).where(eq(users.email, kimEmail))
    expect(await roleOf(weddingId, kim!.id)).toBe('editor')
  })

  it('refuses bodies that do not fit without counting them, and an unknown link with 404', async () => {
    const { register } = await routes()
    const address = freshAddress()
    const token = 'C'.repeat(43)
    expect((await call(register, 'POST', { body: signUp(token, { password: 'short' }), ip: address })).status).toBe(422)
    expect((await call(register, 'POST', { body: signUp(token, { email: 'nope' }), ip: address })).status).toBe(422)
    expect((await call(register, 'POST', { body: signUp(token, { displayName: '   ' }), ip: address })).status).toBe(422)
    const rows = await (await db()).execute(sql`select 1 from login_attempts`)
    expect(rows.rows).toHaveLength(0)
    expect((await call(register, 'POST', { body: signUp(token), ip: address })).status).toBe(404)
  })

  it('counts sign-ups before any password hashing, and clears the count when one works', async () => {
    const { register, lookup } = await routes()
    const { weddingId, owner } = await weddingWithOwner()
    const { token } = await makeInvite(weddingId, owner)
    const address = freshAddress()
    for (let i = 0; i < PER_ADDRESS_LIMIT - 1; i++) {
      expect((await call(register, 'POST', { body: signUp(`${'D'.repeat(40)}${String(i).padStart(3, '0')}`), ip: address })).status).toBe(404)
    }
    expect((await call(register, 'POST', { body: signUp(token), ip: address })).status).toBe(200)
    // The count was cleared: this address may look links up again.
    const next = await makeInvite(weddingId, owner)
    expect((await call(lookup, 'POST', { body: { token: next.token }, ip: address })).status).toBe(200)

    for (let i = 0; i < PER_ADDRESS_LIMIT; i++) {
      await call(lookup, 'POST', { body: { token: `${'E'.repeat(40)}${String(i).padStart(3, '0')}` }, ip: address })
    }
    vi.mocked(hashUserPassword).mockClear()
    const blocked = await call(register, 'POST', { body: signUp(next.token), ip: address })
    expect(blocked.status).toBe(429)
    expect(vi.mocked(hashUserPassword)).not.toHaveBeenCalled()
  })
})

describe('accepting an invite while signed in', () => {
  it('adds the user with the invite’s role, raising an editor to owner but never lowering an owner', async () => {
    const { accept } = await routes()
    const { weddingId, owner } = await weddingWithOwner()
    const pat = await person()
    const first = await makeInvite(weddingId, owner, { role: 'editor' })
    expect(await call(accept, 'POST', { cookie: pat.cookie, body: { token: first.token } })).toMatchObject({
      status: 200,
      body: { ok: true, redirect: `/w/${weddingId}/layouts` },
    })
    expect(await roleOf(weddingId, pat.id)).toBe('editor')

    const raise = await makeInvite(weddingId, owner, { role: 'owner' })
    expect((await call(accept, 'POST', { cookie: pat.cookie, body: { token: raise.token } })).status).toBe(200)
    expect(await roleOf(weddingId, pat.id)).toBe('owner')

    const lower = await makeInvite(weddingId, owner, { role: 'editor' })
    expect((await call(accept, 'POST', { cookie: pat.cookie, body: { token: lower.token } })).status).toBe(200)
    expect(await roleOf(weddingId, pat.id)).toBe('owner')
  })

  it('refuses an invite locked to another email, an unknown link, and a request with no session', async () => {
    const { accept } = await routes()
    const { weddingId, owner } = await weddingWithOwner()
    const pat = await person({ email: `pat-${randomUUID()}@example.com` })
    const locked = await makeInvite(weddingId, owner, { role: 'editor', email: 'not-pat@example.com' })
    expect(await call(accept, 'POST', { cookie: pat.cookie, body: { token: locked.token } })).toMatchObject({
      status: 409,
      body: { reason: 'email-mismatch' },
    })
    expect(await roleOf(weddingId, pat.id)).toBeNull()
    expect((await call(accept, 'POST', { cookie: pat.cookie, body: { token: 'F'.repeat(43) } })).status).toBe(404)
    expect((await call(accept, 'POST', { body: { token: locked.token } })).status).toBe(401)

    const forPat = await makeInvite(weddingId, owner, { role: 'editor', email: pat.email.toUpperCase() })
    expect((await call(accept, 'POST', { cookie: pat.cookie, body: { token: forPat.token } })).status).toBe(200)
  })
})

describe('planner invites', () => {
  it('lets an admin invite a new planner, who signs up with no wedding and lands at home', async () => {
    const { plannerInvites, lookup, register } = await routes()
    const admin = await person({ isAdmin: true, displayName: 'Ada' })
    const notAdmin = await person()
    expect((await call(plannerInvites, 'POST', { cookie: notAdmin.cookie, body: {}, makesToken: true })).status).toBe(404)
    const made = await call(plannerInvites, 'POST', { cookie: admin.cookie, body: { note: 'Welcome' }, makesToken: true })
    expect(made.status).toBe(201)
    const { token, invite } = made.body as CreatedInvite
    expect(invite).toMatchObject({ weddingId: null, role: null, email: null, note: 'Welcome', state: 'pending' })

    expect((await call(lookup, 'POST', { body: { token }, ip: freshAddress() })).body).toMatchObject({
      status: 'ok',
      kind: 'planner',
      weddingName: null,
      role: null,
      inviterName: 'Ada',
    })
    const res = await call(register, 'POST', { body: signUp(token), ip: freshAddress() })
    expect(res).toMatchObject({ status: 200, body: { ok: true, redirect: '/' } })
    const cookie = sessionCookieFrom(res)!
    const user = await lookupSession(await db(), cookie.slice(cookie.indexOf('=') + 1))
    const memberships = await (await db()).select().from(weddingMembers).where(eq(weddingMembers.userId, user!.id))
    expect(memberships).toEqual([])

    const listed = await call(plannerInvites, 'GET', { cookie: admin.cookie })
    expect((listed.body as InviteSummary[]).find((i) => i.id === invite.id)).toMatchObject({ state: 'accepted', acceptedBy: { id: user!.id } })
  })
})

describe('no token is ever kept or logged', () => {
  it('leaves no token in the activity log', async () => {
    expect(issued.length).toBeGreaterThan(5)
    const rows = await (await db()).execute<{ detail: string }>(sql`select detail::text as detail from activity_events`)
    const all = rows.rows.map((r) => r.detail).join('\n')
    for (const token of issued) expect(all).not.toContain(token)
  })
})
