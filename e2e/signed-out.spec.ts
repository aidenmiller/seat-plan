/**
 * Acceptance check 2: no page or API route returns data without the cookie,
 * and the password never reaches the browser. New pages and routes join these
 * lists as each milestone adds them.
 */
import { expect, test } from '@playwright/test'
import { signIn, sitePassword } from './helpers'

const PAGES = ['/', '/w/00000000-0000-4000-8000-000000000000/layouts', '/venues/00000000-0000-4000-8000-000000000000']
const API_ROUTES: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string }[] = [
  { method: 'GET', path: '/api/weddings' },
  { method: 'POST', path: '/api/weddings' },
  { method: 'GET', path: '/api/layouts/00000000-0000-4000-8000-000000000000' },
  { method: 'POST', path: '/api/auth/logout' },
]

test.describe('without the cookie', () => {
  for (const path of PAGES) {
    test(`page ${path} goes to the password page`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 })
      expect(res.status()).toBe(307)
      expect(res.headers()['location']).toMatch(/\/login/)
      expect(res.headers()['x-robots-tag']).toContain('noindex')
    })
  }

  for (const { method, path } of API_ROUTES) {
    test(`${method} ${path} answers 401`, async ({ request }) => {
      const res = await request.fetch(path, { method, maxRedirects: 0 })
      expect(res.status()).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
    })
  }

  test('robots.txt is readable without the cookie', async ({ request }) => {
    const res = await request.get('/robots.txt')
    expect(res.status()).toBe(200)
    expect(await res.text()).toContain('User-Agent: *')
  })

  test('the login page itself carries noindex', async ({ request }) => {
    const res = await request.get('/login')
    expect(res.headers()['x-robots-tag']).toContain('noindex')
  })
})

test('no response the app loads contains the password', async ({ page }) => {
  const password = sitePassword()
  const leaks: string[] = []
  page.on('response', async (res) => {
    try {
      const body = await res.body()
      if (body.includes(Buffer.from(password))) leaks.push(res.url())
    } catch {
      // Redirects and aborted requests have no body.
    }
  })
  await signIn(page)
  await page.reload()
  await page.waitForLoadState('networkidle')
  expect(leaks).toEqual([])
})
