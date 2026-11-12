/**
 * The page checks with cookies, the database and Next's redirect and
 * notFound mocked: signed-out visitors go to /login with a safe `next`,
 * and anyone who may not see a page gets the 404 page.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../db/client'
import { recordEvent } from '../repo/activity'
import { findSession, touchSession } from '../repo/sessions'
import { weddingAccess } from './access'
import { getSessionUser, requireAdminPage, requireUser, requireVenuePage, requireWeddingPage } from './pages'
import { SESSION_COOKIE, newOpaqueToken, signSessionCookie } from './tokens'
import { templateAccess } from './venue-access'

const jar = vi.hoisted(() => ({ value: undefined as string | undefined }))

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'sp_session' && jar.value !== undefined ? { name, value: jar.value } : undefined) }),
}))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`)
  },
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
}))
vi.mock('../db/client', () => ({ getDb: vi.fn() }))
vi.mock('../repo/sessions', () => ({ findSession: vi.fn(), touchSession: vi.fn() }))
vi.mock('../repo/activity', () => ({ recordEvent: vi.fn() }))
vi.mock('./access', async (importOriginal) => ({ ...(await importOriginal<typeof import('./access')>()), weddingAccess: vi.fn() }))
vi.mock('./venue-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./venue-access')>()),
  templateAccess: vi.fn(),
}))

const USER_ID = '11111111-1111-4111-8111-111111111111'
const WEDDING_ID = '22222222-2222-4222-8222-222222222222'
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333'
const member = { id: USER_ID, sessionId: 's', email: 'pat@example.com', displayName: 'Pat', isAdmin: false }
const admin = { ...member, isAdmin: true }
const FAKE_DB = { fake: 'db' }

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'pages-test-secret-that-is-at-least-32-chars')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  jar.value = signSessionCookie(newOpaqueToken(), Date.now() + 86_400_000)
  vi.mocked(getDb).mockReset().mockImplementation(() => FAKE_DB as never)
  vi.mocked(findSession).mockReset().mockResolvedValue({ user: member, touchDue: false })
  vi.mocked(touchSession).mockReset().mockResolvedValue(true)
  vi.mocked(recordEvent).mockReset().mockResolvedValue(undefined)
  vi.mocked(weddingAccess).mockReset()
  vi.mocked(templateAccess).mockReset()
})

describe('getSessionUser', () => {
  it('is null without a cookie or with a forged one, without touching the database', async () => {
    jar.value = undefined
    expect(await getSessionUser()).toBeNull()
    jar.value = 'forged'
    expect(await getSessionUser()).toBeNull()
    expect(getDb).not.toHaveBeenCalled()
  })

  it('returns the user and touches the session when due', async () => {
    expect(await getSessionUser()).toEqual(member)
    expect(touchSession).not.toHaveBeenCalled()
    vi.mocked(findSession).mockResolvedValue({ user: member, touchDue: true })
    expect(await getSessionUser()).toEqual(member)
    expect(touchSession).toHaveBeenCalledWith(FAKE_DB, member)
    expect(findSession).toHaveBeenCalledWith(FAKE_DB, jar.value)
    expect(SESSION_COOKIE).toBe('sp_session')
  })
})

describe('requireUser', () => {
  it('sends a signed-out visitor to /login with a safe next', async () => {
    vi.mocked(findSession).mockResolvedValue(null)
    await expect(requireUser('/w/abc/guests?x=1')).rejects.toThrow(`REDIRECT /login?next=${encodeURIComponent('/w/abc/guests?x=1')}`)
    await expect(requireUser('/')).rejects.toThrow(/^REDIRECT \/login$/)
    await expect(requireUser('//evil.example')).rejects.toThrow(/^REDIRECT \/login$/)
  })

  it('returns the signed-in user', async () => {
    expect(await requireUser('/')).toEqual(member)
  })
})

describe('requireAdminPage', () => {
  it('shows the 404 page to anyone but an admin', async () => {
    await expect(requireAdminPage('/admin')).rejects.toThrow('NOT_FOUND')
    vi.mocked(findSession).mockResolvedValue({ user: admin, touchDue: false })
    expect(await requireAdminPage('/admin')).toEqual(admin)
  })
})

describe('requireWeddingPage', () => {
  it('shows the 404 page to a non-member, for a deleted wedding, or for too low a role', async () => {
    vi.mocked(weddingAccess).mockResolvedValue(null)
    await expect(requireWeddingPage(WEDDING_ID, '/w/x')).rejects.toThrow('NOT_FOUND')
    vi.mocked(weddingAccess).mockResolvedValue({ user: member, weddingId: WEDDING_ID, role: 'editor', viaAdmin: false })
    await expect(requireWeddingPage(WEDDING_ID, '/w/x', 'owner')).rejects.toThrow('NOT_FOUND')
    expect(await requireWeddingPage(WEDDING_ID, '/w/x')).toEqual({ user: member, weddingId: WEDDING_ID, role: 'editor', viaAdmin: false })
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('lets an admin in and logs it once a day', async () => {
    vi.mocked(findSession).mockResolvedValue({ user: admin, touchDue: false })
    vi.mocked(weddingAccess).mockResolvedValue({ user: admin, weddingId: WEDDING_ID, role: null, viaAdmin: true })
    expect(await requireWeddingPage(WEDDING_ID, '/w/x', 'owner')).toMatchObject({ viaAdmin: true })
    const day = new Date().toISOString().slice(0, 10)
    expect(recordEvent).toHaveBeenCalledWith(
      FAKE_DB,
      expect.objectContaining({ kind: 'admin_access', userId: USER_ID, weddingId: WEDDING_ID, dedupeKey: `admin_access:${USER_ID}:${WEDDING_ID}:${day}` }),
    )
  })

  it('sends a signed-out visitor to /login first', async () => {
    vi.mocked(findSession).mockResolvedValue(null)
    await expect(requireWeddingPage(WEDDING_ID, '/w/x')).rejects.toThrow(/^REDIRECT \/login\?next=/)
    expect(weddingAccess).not.toHaveBeenCalled()
  })
})

describe('requireVenuePage', () => {
  it('shows the 404 page when the template cannot be read', async () => {
    vi.mocked(templateAccess).mockResolvedValue(null)
    await expect(requireVenuePage(TEMPLATE_ID, '/venues/x')).rejects.toThrow('NOT_FOUND')
    vi.mocked(templateAccess).mockResolvedValue({ read: false, edit: false, library: false, ownerUserId: null, ownerName: null })
    await expect(requireVenuePage(TEMPLATE_ID, '/venues/x')).rejects.toThrow('NOT_FOUND')
    const readable = { read: true, edit: false, library: true, ownerUserId: null, ownerName: null }
    vi.mocked(templateAccess).mockResolvedValue(readable)
    expect(await requireVenuePage(TEMPLATE_ID.toUpperCase(), '/venues/x')).toEqual({ user: member, templateId: TEMPLATE_ID, template: readable })
    expect(templateAccess).toHaveBeenLastCalledWith(FAKE_DB, { userId: USER_ID, isAdmin: false }, TEMPLATE_ID.toUpperCase())
  })
})
