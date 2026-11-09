/**
 * Every route handler must check a cookie itself (PLAN section 5), whatever
 * the proxy does. This test imports every route file, calls every exported
 * HTTP method with no cookie, and expects 401. A handler that skips the check
 * fails here, however it is written.
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const APP_DIR = path.resolve(__dirname, '../../app')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

/** Routes that must work without the site cookie (spec section 2: the login route). */
const NO_COOKIE_NEEDED = new Set(['api/auth/login/route.ts', 'share/[token]/login/route.ts'])

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...routeFiles(full))
    else if (name === 'route.ts' || name === 'route.tsx') out.push(full)
  }
  return out
}

const files = routeFiles(APP_DIR).map((f) => path.relative(APP_DIR, f).split(path.sep).join('/'))

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'route-auth-test-secret-at-least-32-chars')
  vi.stubEnv('SITE_PASSWORD', 'route-auth-test-password')
  // No database: a handler that skips the check and touches the database throws instead of passing.
  vi.stubEnv('DATABASE_URL', '')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

describe('route handlers answer 401 without a cookie', () => {
  it('finds the route files', () => {
    expect(files).toContain('api/auth/login/route.ts')
    expect(files).toContain('api/auth/logout/route.ts')
  })

  for (const file of files) {
    if (NO_COOKIE_NEEDED.has(file)) continue
    it(file, async () => {
      const mod = (await import(path.join(APP_DIR, file))) as Record<string, unknown>
      const handlers = METHODS.filter((m) => typeof mod[m] === 'function')
      expect(handlers.length, 'route file exports no handler').toBeGreaterThan(0)
      for (const method of handlers) {
        const handler = mod[method] as (req: NextRequest, ctx: unknown) => Promise<Response> | Response
        const req = new NextRequest(`https://seat.example/${file.replace(/\/route\.tsx?$/, '')}`, { method })
        let status: number
        try {
          status = (await handler(req, { params: Promise.resolve({ token: 'x'.repeat(43), id: 'x' }) })).status
        } catch (err) {
          throw new Error(`${method} ${file} threw instead of answering 401: ${String(err)}`)
        }
        expect(status, `${method} ${file}`).toBe(401)
      }
    })
  }
})
