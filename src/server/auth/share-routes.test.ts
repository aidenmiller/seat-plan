/**
 * Every route under src/app/share/[token]/ apart from the login route must
 * open only with this one link's valid cookie, or with the session of
 * someone who may open the link's wedding (a member, any role, or an admin)
 * (PLAN section 5, "Password gate"). This test imports each route file and
 * calls every handler with each kind of cookie. The link, session and
 * membership lookups are faked, so no database is needed; a route that skips
 * the check fails here however it is written.
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { touchShareLink } from '@/server/repo/share-links'
import { policyOf } from './guards'
import { SESSION_COOKIE, SITE_COOKIE, createShareToken, createSiteToken, newOpaqueToken, shareCookieName, signSessionCookie } from './tokens'

const TOKEN = 'A'.repeat(43)
const LINK = '11111111-1111-4111-8111-111111111111'
const OTHER_LINK = '22222222-2222-4222-8222-222222222222'
const VERSION = 3

/** Session cookie values the fake session lookup knows, by who they sign in. */
const fake = vi.hoisted(() => ({
  live: true,
  sessions: new Map<string, { id: string; sessionId: string; email: string; displayName: string; isAdmin: boolean }>(),
  members: new Set<string>(),
}))

vi.mock('@/server/db/client', () => ({ getDb: () => ({}) }))
vi.mock('@/server/repo/share-links', () => ({
  findLiveShareLink: vi.fn(async (_db: unknown, token: string) =>
    fake.live && token === 'A'.repeat(43)
      ? {
          id: '11111111-1111-4111-8111-111111111111',
          weddingId: '33333333-3333-4333-8333-333333333333',
          layoutId: 'l',
          layoutName: 'Dinner',
          passwordHash: 'x',
          credentialVersion: 3,
          showNames: true,
          showNotes: false,
        }
      : null,
  ),
  touchShareLink: vi.fn(async () => {}),
  shareViewData: vi.fn(async () => ({ layoutName: 'Dinner' })),
}))
vi.mock('@/server/repo/sessions', () => ({
  lookupSession: vi.fn(async (_db: unknown, value: string | undefined) => (value ? (fake.sessions.get(value) ?? null) : null)),
  findSession: vi.fn(async () => null),
  touchSession: vi.fn(async () => false),
}))
vi.mock('@/server/auth/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./access')>()),
  weddingAccess: vi.fn(async (_db: unknown, user: { id: string; isAdmin: boolean }, weddingId: string) =>
    weddingId === '33333333-3333-4333-8333-333333333333' && (user.isAdmin || fake.members.has(user.id))
      ? { user, weddingId, role: fake.members.has(user.id) ? 'editor' : null, viaAdmin: !fake.members.has(user.id) }
      : null,
  ),
}))

const SHARE_DIR = path.resolve(__dirname, '../../app/share/[token]')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
const LOGIN = 'login/route.ts'

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...routeFiles(full))
    else if (name === 'route.ts' || name === 'route.tsx') out.push(full)
  }
  return out
}

const files = routeFiles(SHARE_DIR).map((f) => path.relative(SHARE_DIR, f).split(path.sep).join('/'))

/** A signed session cookie for a made-up user the fake lookup knows. */
function sessionFor(user: { id: string; isAdmin?: boolean; member?: boolean }): string {
  const value = signSessionCookie(newOpaqueToken(), Date.now() + 86_400_000)
  fake.sessions.set(value, { id: user.id, sessionId: `s-${user.id}`, email: `${user.id}@example.com`, displayName: 'Pat', isAdmin: user.isAdmin ?? false })
  if (user.member) fake.members.add(user.id)
  return value
}

let member = ''
let nonMember = ''
let admin = ''
let ended = ''

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'share-routes-test-secret-at-least-32-chars')
  vi.stubEnv('SITE_PASSWORD', 'share-routes-test-password')
  member = sessionFor({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', member: true })
  nonMember = sessionFor({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })
  admin = sessionFor({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', isAdmin: true })
  // Validly signed, but the database holds no such session (signed out, expired, or the user is disabled).
  ended = signSessionCookie(newOpaqueToken(), Date.now() + 86_400_000)
})
afterAll(() => {
  vi.unstubAllEnvs()
})
beforeEach(() => {
  vi.mocked(touchShareLink).mockClear()
})

type Handler = (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => Promise<Response> | Response

async function statusWith(file: string, method: string, cookies: Record<string, string>): Promise<Response> {
  const mod = (await import(path.join(SHARE_DIR, file))) as Record<string, unknown>
  const req = new NextRequest(`https://seat.example/share/${TOKEN}/${file.replace(/\/?route\.tsx?$/, '')}`, { method })
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value)
  return (mod[method] as Handler)(req, { params: Promise.resolve({ token: TOKEN }) })
}

describe('share routes need this link’s cookie or a member’s session', () => {
  it('finds the share routes', () => {
    expect(files).toContain(LOGIN)
    expect(files).toContain('data/route.ts')
  })

  for (const file of files) {
    if (file === LOGIN) continue
    it(file, async () => {
      const mod = (await import(path.join(SHARE_DIR, file))) as Record<string, unknown>
      const methods = METHODS.filter((m) => typeof mod[m] === 'function')
      expect(methods.length, 'route file exports no handler').toBeGreaterThan(0)
      const thisLink = shareCookieName(LINK)

      for (const method of methods) {
        expect(policyOf(mod[method]), `${method} ${file}`).toEqual({ kind: 'share' })
        fake.live = true
        const refused: [string, Record<string, string>][] = [
          ['no cookie', {}],
          ['a forged link cookie', { [thisLink]: `${createShareToken(LINK, VERSION).split('.')[0]}.AAAA` }],
          ['a link cookie from before a password change', { [thisLink]: createShareToken(LINK, VERSION - 1) }],
          ['another link’s cookie', { [shareCookieName(OTHER_LINK)]: createShareToken(OTHER_LINK, VERSION) }],
          ['another link’s token under this link’s name', { [thisLink]: createShareToken(OTHER_LINK, VERSION) }],
          ['a site token in the link cookie', { [thisLink]: createSiteToken() }],
          ['a link token in the session cookie', { [SESSION_COOKIE]: createShareToken(LINK, VERSION) }],
          ['the old site cookie', { [SITE_COOKIE]: createSiteToken() }],
          ['a forged session cookie', { [SESSION_COOKIE]: `${member.split('.')[0]}.AAAA` }],
          ['a session the database no longer holds', { [SESSION_COOKIE]: ended }],
          ['a signed-in user who is not a member of the wedding', { [SESSION_COOKIE]: nonMember }],
        ]
        for (const [what, cookies] of refused) {
          const res = await statusWith(file, method, cookies)
          expect(res.status, `${method} ${file} with ${what}`).toBe(401)
          expect(res.headers.get('referrer-policy'), `${method} ${file} with ${what}`).toBe('no-referrer')
        }

        const opened: [string, Record<string, string>, 'link' | 'member'][] = [
          ['this link’s cookie', { [thisLink]: createShareToken(LINK, VERSION) }, 'link'],
          ['a member’s session', { [SESSION_COOKIE]: member }, 'member'],
          ['an admin’s session', { [SESSION_COOKIE]: admin }, 'member'],
          ['a non-member’s session with this link’s cookie', { [SESSION_COOKIE]: nonMember, [thisLink]: createShareToken(LINK, VERSION) }, 'link'],
        ]
        for (const [what, cookies, via] of opened) {
          vi.mocked(touchShareLink).mockClear()
          const res = await statusWith(file, method, cookies)
          expect(res.status, `${method} ${file} with ${what}`).toBe(200)
          expect(res.headers.get('referrer-policy')).toBe('no-referrer')
          // Only the venue opening it with the link's own cookie counts as the link being opened (DECISIONS 105).
          if (file === 'data/route.ts') expect(vi.mocked(touchShareLink).mock.calls.length, `${what}`).toBe(via === 'link' ? 1 : 0)
        }

        // A link that is off, or whose layout is gone, opens for nobody.
        fake.live = false
        for (const [what, cookies] of opened) {
          expect((await statusWith(file, method, cookies)).status, `${method} ${file} turned off, with ${what}`).toBe(401)
        }
      }
    })
  }

  it('clears a link cookie from before a password change', async () => {
    fake.live = true
    const res = await statusWith('data/route.ts', 'GET', { [shareCookieName(LINK)]: createShareToken(LINK, VERSION - 1) })
    expect(res.status).toBe(401)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${shareCookieName(LINK)}=;`)
    expect(cookie).toContain(`Path=/share/${TOKEN}`)
    expect(cookie).toMatch(/Max-Age=0/)
  })

  it('tags the share password route public', async () => {
    const mod = (await import(path.join(SHARE_DIR, LOGIN))) as Record<string, unknown>
    expect(policyOf(mod.POST)).toMatchObject({ kind: 'public' })
  })
})
