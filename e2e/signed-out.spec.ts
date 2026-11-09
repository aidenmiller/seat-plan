/**
 * Acceptance check 2: no page or API route returns data without the cookie,
 * and the password never reaches the browser. New pages and routes join these
 * lists as each milestone adds them.
 */
import { expect, request as playwrightRequest, test } from '@playwright/test'
import { apiCreateLayout, apiCreateWedding, signIn, signInRequest, sitePassword } from './helpers'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const NO_ID = '00000000-0000-4000-8000-000000000000'

/** Every page, with `:wedding` and `:layout` standing for ids. */
const PAGE_PATHS = [
  '/',
  '/w/:wedding',
  '/w/:wedding/layouts',
  '/w/:wedding/guests',
  '/w/:wedding/groups',
  '/w/:wedding/rules',
  '/w/:wedding/venues',
  '/w/:wedding/links',
  '/w/:wedding/layouts/:layout',
  '/venues/:layout',
]

/** Every API route but the login route, with a body where the route takes one. */
const API_ROUTES: { method: Method; path: string; body?: unknown }[] = [
  { method: 'GET', path: '/api/weddings' },
  { method: 'POST', path: '/api/weddings', body: { name: 'Sneaky' } },
  { method: 'GET', path: '/api/weddings/:wedding' },
  { method: 'PATCH', path: '/api/weddings/:wedding', body: { name: 'Sneaky' } },
  { method: 'DELETE', path: '/api/weddings/:wedding', body: { confirm: 'delete' } },
  { method: 'GET', path: '/api/weddings/:wedding/delete-summary' },
  { method: 'GET', path: '/api/weddings/:wedding/layouts' },
  {
    method: 'POST',
    path: '/api/weddings/:wedding/layouts',
    body: { name: 'Sneaky', kind: 'reception', venueTemplateId: null, editedBy: 'Noa' },
  },
  { method: 'GET', path: '/api/layouts/:layout' },
  { method: 'PUT', path: '/api/layouts/:layout', body: { baseVersion: 1 } },
  { method: 'PATCH', path: '/api/layouts/:layout', body: { name: 'Sneaky' } },
  { method: 'DELETE', path: '/api/layouts/:layout', body: { confirm: 'delete' } },
  { method: 'GET', path: '/api/layouts/:layout/delete-summary' },
  { method: 'GET', path: '/api/layouts/:layout/version' },
  { method: 'POST', path: '/api/layouts/:layout/duplicate', body: { editedBy: 'Noa' } },
  { method: 'GET', path: '/api/venues' },
  { method: 'POST', path: '/api/auth/logout' },
]

function fill(path: string, ids: { wedding: string; layout: string }): string {
  return path.replace(':wedding', ids.wedding).replace(':layout', ids.layout)
}

test.describe('without the cookie', () => {
  for (const path of PAGE_PATHS) {
    test(`page ${fill(path, { wedding: NO_ID, layout: NO_ID })} goes to the password page`, async ({ request }) => {
      const res = await request.get(fill(path, { wedding: NO_ID, layout: NO_ID }), { maxRedirects: 0 })
      expect(res.status()).toBe(307)
      expect(res.headers()['location']).toMatch(/\/login/)
      expect(res.headers()['x-robots-tag']).toContain('noindex')
    })
  }

  for (const { method, path, body } of API_ROUTES) {
    test(`${method} ${fill(path, { wedding: NO_ID, layout: NO_ID })} answers 401`, async ({ request }) => {
      const res = await request.fetch(fill(path, { wedding: NO_ID, layout: NO_ID }), {
        method,
        data: body,
        maxRedirects: 0,
      })
      expect(res.status()).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
    })
  }

  test('real weddings and layouts stay hidden, and nothing changes', async ({ request, baseURL }) => {
    // Make a real wedding and layout as a signed-in visitor.
    const owner = await playwrightRequest.newContext({ baseURL })
    try {
      await signInRequest(owner)
      const secret = `Hidden wedding ${Date.now()}`
      const wedding = await apiCreateWedding(owner, secret)
      const layout = await apiCreateLayout(owner, wedding.id, { name: `Hidden layout ${Date.now()}` })
      const ids = { wedding: wedding.id, layout: layout.id }

      for (const path of PAGE_PATHS) {
        const res = await request.get(fill(path, ids), { maxRedirects: 0 })
        expect(res.status(), path).toBe(307)
        const text = await res.text()
        expect(text, path).not.toContain(secret)
        expect(text, path).not.toContain(layout.name)
      }
      for (const { method, path, body } of API_ROUTES) {
        const res = await request.fetch(fill(path, ids), { method, data: body, maxRedirects: 0 })
        expect(res.status(), `${method} ${path}`).toBe(401)
        const text = await res.text()
        expect(text, `${method} ${path}`).not.toContain(secret)
        expect(text, `${method} ${path}`).not.toContain(layout.name)
      }

      // The signed-out PATCH, DELETE and PUT changed nothing.
      const weddingNow = await owner.get(`/api/weddings/${wedding.id}`)
      expect(weddingNow.status()).toBe(200)
      expect((await weddingNow.json()).name).toBe(secret)
      const layoutNow = await owner.get(`/api/layouts/${layout.id}`)
      expect(layoutNow.status()).toBe(200)
      expect(await layoutNow.json()).toMatchObject({ name: layout.name, version: 1 })
    } finally {
      await owner.dispose()
    }
  })

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
  // The wedding pages and the editor too.
  const wedding = await apiCreateWedding(page.request, `Password check ${Date.now()}`)
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  for (const path of [`/w/${wedding.id}/layouts`, `/w/${wedding.id}/guests`, `/w/${wedding.id}/layouts/${layout.id}`]) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  }
  expect(leaks).toEqual([])
})
