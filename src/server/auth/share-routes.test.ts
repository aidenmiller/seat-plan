/**
 * Every route under src/app/share/[token]/ apart from the login route must
 * open only with the site cookie or that one link's valid cookie (PLAN
 * section 5, "Password gate"). This test imports each route file and calls
 * every handler with each kind of cookie. The link lookup is faked, so no
 * database is needed; a route that skips the check fails here however it is
 * written.
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SITE_COOKIE, createShareToken, createSiteToken, shareCookieName } from './tokens'

const TOKEN = 'A'.repeat(43)
const LINK = '11111111-1111-4111-8111-111111111111'
const OTHER_LINK = '22222222-2222-4222-8222-222222222222'
const VERSION = 3

const lookups = vi.hoisted(() => ({ live: true }))

vi.mock('@/server/db/client', () => ({ getDb: () => ({}) }))
vi.mock('@/server/repo/share-links', () => ({
  findLiveShareLink: vi.fn(async (_db: unknown, token: string) =>
    lookups.live && token === 'A'.repeat(43)
      ? {
          id: '11111111-1111-4111-8111-111111111111',
          weddingId: 'w',
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

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'share-routes-test-secret-at-least-32-chars')
  vi.stubEnv('SITE_PASSWORD', 'share-routes-test-password')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

type Handler = (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => Promise<Response> | Response

async function statusWith(file: string, method: string, cookies: Record<string, string>): Promise<Response> {
  const mod = (await import(path.join(SHARE_DIR, file))) as Record<string, unknown>
  const req = new NextRequest(`https://seat.example/share/${TOKEN}/${file.replace(/\/?route\.tsx?$/, '')}`, { method })
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value)
  return (mod[method] as Handler)(req, { params: Promise.resolve({ token: TOKEN }) })
}

describe('share routes need the site cookie or that link’s cookie', () => {
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
        lookups.live = true
        const refused: [string, Record<string, string>][] = [
          ['no cookie', {}],
          ['a forged link cookie', { [thisLink]: `${createShareToken(LINK, VERSION).split('.')[0]}.AAAA` }],
          ['a link cookie from before a password change', { [thisLink]: createShareToken(LINK, VERSION - 1) }],
          ['another link’s cookie', { [shareCookieName(OTHER_LINK)]: createShareToken(OTHER_LINK, VERSION) }],
          ['another link’s token under this link’s name', { [thisLink]: createShareToken(OTHER_LINK, VERSION) }],
          ['a site token in the link cookie', { [thisLink]: createSiteToken() }],
          ['a link token in the site cookie', { [SITE_COOKIE]: createShareToken(LINK, VERSION) }],
        ]
        for (const [what, cookies] of refused) {
          const res = await statusWith(file, method, cookies)
          expect(res.status, `${method} ${file} with ${what}`).toBe(401)
          expect(res.headers.get('referrer-policy'), `${method} ${file} with ${what}`).toBe('no-referrer')
        }

        const opened: [string, Record<string, string>][] = [
          ['the site cookie', { [SITE_COOKIE]: createSiteToken() }],
          ['this link’s cookie', { [thisLink]: createShareToken(LINK, VERSION) }],
        ]
        for (const [what, cookies] of opened) {
          const res = await statusWith(file, method, cookies)
          expect(res.status, `${method} ${file} with ${what}`).toBe(200)
          expect(res.headers.get('referrer-policy')).toBe('no-referrer')
        }

        // A link that is off, or whose layout is gone, opens for nobody.
        lookups.live = false
        for (const [what, cookies] of opened) {
          expect((await statusWith(file, method, cookies)).status, `${method} ${file} turned off, with ${what}`).toBe(401)
        }
      }
    })
  }

  it('clears a link cookie from before a password change', async () => {
    lookups.live = true
    const res = await statusWith('data/route.ts', 'GET', { [shareCookieName(LINK)]: createShareToken(LINK, VERSION - 1) })
    expect(res.status).toBe(401)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${shareCookieName(LINK)}=;`)
    expect(cookie).toContain(`Path=/share/${TOKEN}`)
    expect(cookie).toMatch(/Max-Age=0/)
  })
})
