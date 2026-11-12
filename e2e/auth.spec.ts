/**
 * Acceptance check 1, with accounts: the public URL in a private window shows
 * the sign-in page. A wrong email or password shows one error. The right
 * ones open the app, and it stays open after the browser restarts. Log out
 * ends the session. First-run setup is closed once accounts exist.
 */
import { expect, test } from '@playwright/test'
import { SESSION_COOKIE, SITE_COOKIE } from '../src/server/auth/tokens'
import { E2E_USERS, logOut, signIn, signInRequest, sitePassword, userPassword } from './helpers'

const WRONG = 'That email or password is wrong. Try again.'

test('a new visitor sees the sign-in page', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page).toHaveTitle('Sign in · Something Blueprint.')
  // The logo loads without a session (its file is under /_next/static, which the sign-in gate lets through).
  const logo = page.getByRole('img', { name: 'Something Blueprint.' })
  await expect(logo).toBeVisible()
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  // Accounts exist, so there is no setup link.
  await expect(page.getByRole('link', { name: 'Set up the first account' })).toHaveCount(0)
})

test('a wrong password or an unknown email shows the same error and allows another try', async ({ page }) => {
  const a = E2E_USERS.a
  await page.goto('/login')
  await page.getByLabel('Email').fill(a.email)
  await page.getByLabel('Password').fill('not the password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('#login-error')).toHaveText(WRONG)
  await expect(page).toHaveURL(/\/login/)

  await page.getByLabel('Email').fill('nobody@e2e.seat-plan.test')
  await page.getByLabel('Password').fill(userPassword('a'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('#login-error')).toHaveText(WRONG)

  // Another account's password does not open this one.
  await page.getByLabel('Email').fill(a.email)
  await page.getByLabel('Password').fill(userPassword('b'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('#login-error')).toHaveText(WRONG)

  await page.getByLabel('Email').fill(` ${a.email.toUpperCase()} `)
  await page.getByLabel('Password').fill(userPassword('a'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Weddings' })).toBeVisible()
})

test('every account can sign in', async ({ browser }) => {
  for (const who of ['a', 'b', 'c'] as const) {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      await signIn(page, who)
      await expect(page.getByRole('heading', { name: 'Weddings' })).toBeVisible()
    } finally {
      await context.close()
    }
  }
})

test('after signing in you land on the page you asked for', async ({ page }) => {
  await page.goto('/w/abc/layouts?tab=1')
  await expect(page).toHaveURL(/\/login\?next=%2Fw%2Fabc%2Flayouts%3Ftab%3D1$/)
  await page.getByLabel('Email').fill(E2E_USERS.a.email)
  await page.getByLabel('Password').fill(userPassword('a'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/w\/abc\/layouts\?tab=1$/)
})

test('too many tries shows how long to wait', async ({ page }) => {
  // The real block is covered by the login route's tests; tripping it here
  // would lock out every other test, which all come from one address.
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 429, json: { error: 'too_many_attempts', retryAfterSeconds: 840 } }),
  )
  await page.goto('/login')
  await page.getByLabel('Email').fill(E2E_USERS.a.email)
  await page.getByLabel('Password').fill('anything')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('#login-error')).toHaveText('Too many tries. Try again in 14 minutes.')
})

test('the session cookie is HttpOnly, SameSite=Lax and lasts 30 days', async ({ page, context }) => {
  await signIn(page)
  const cookie = (await context.cookies()).find((c) => c.name === SESSION_COOKIE)
  expect(cookie).toBeDefined()
  expect(cookie!.httpOnly).toBe(true)
  expect(cookie!.sameSite).toBe('Lax')
  expect(cookie!.path).toBe('/')
  const days = (cookie!.expires * 1000 - Date.now()) / 86_400_000
  expect(days).toBeGreaterThan(29.9)
  expect(days).toBeLessThan(30.1)
  expect((await context.cookies()).some((c) => c.name === SITE_COOKIE)).toBe(false)
})

test('opening a page renews the cookie’s 30 days', async ({ page, context, baseURL }) => {
  await signIn(page)
  const first = (await context.cookies()).find((c) => c.name === SESSION_COOKIE)!
  // Shorten the browser's copy, as if it had been set long ago; the next page sets it again.
  await context.addCookies([{ ...first, expires: Math.floor(Date.now() / 1000) + 3600 }])
  await page.goto('/')
  const renewed = (await context.cookies(baseURL!)).find((c) => c.name === SESSION_COOKIE)!
  expect(renewed.value).toBe(first.value)
  expect((renewed.expires * 1000 - Date.now()) / 86_400_000).toBeGreaterThan(29.9)
})

test('signing in clears a cookie left from the site password', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: SITE_COOKIE, value: 'left-over', url: baseURL! }])
  await signIn(page)
  expect((await context.cookies()).some((c) => c.name === SITE_COOKIE)).toBe(false)
})

test('the session survives a browser restart', async ({ page, context, browser }) => {
  await signIn(page)
  // A restart keeps persistent cookies; a new context loaded from saved state stands in for it.
  const state = await context.storageState()
  await context.close()
  const restarted = await browser.newContext({ storageState: state })
  const again = await restarted.newPage()
  await again.goto('/')
  await expect(again.getByRole('heading', { name: 'Weddings' })).toBeVisible()
  await restarted.close()
})

test('log out ends the session, even for a copy of its cookie', async ({ page, context, browser }) => {
  await signIn(page)
  const state = await context.storageState()
  await logOut(page)
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  expect((await context.cookies()).some((c) => c.name === SESSION_COOKIE && c.value !== '')).toBe(false)

  // The cookie copied before logging out no longer opens anything: the session is gone from the database.
  const copy = await browser.newContext({ storageState: state })
  try {
    const stale = await copy.newPage()
    await stale.goto('/')
    await expect(stale).toHaveURL(/\/login$/)
    await expect(stale.getByLabel('Email')).toBeVisible()
    expect((await copy.request.get('/api/weddings')).status()).toBe(401)
  } finally {
    await copy.close()
  }
})

test('a forged cookie does not open the app', async ({ page, context, baseURL }) => {
  const body = Buffer.from(JSON.stringify({ typ: 'user', s: 'A'.repeat(43), exp: Date.now() + 1e9 })).toString('base64url')
  await context.addCookies([{ name: SESSION_COOKIE, value: `${body}.AAAA`, url: baseURL! }])
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})

test('first-run setup is closed once accounts exist', async ({ page, request }) => {
  const res = await page.goto('/setup')
  expect(res?.status()).toBe(404)
  const api = await request.post('/api/setup', {
    data: { sitePassword: sitePassword(), email: 'late@e2e.seat-plan.test', displayName: 'Late', password: 'a-long-enough-password' },
  })
  expect(api.status()).toBe(404)
  // And that try made no account.
  const login = await request.post('/api/auth/login', { data: { email: 'late@e2e.seat-plan.test', password: 'a-long-enough-password' } })
  expect(login.status()).toBe(401)
})

test('a tab left open from before someone else signed in on this browser cannot save under their account', async ({ page, context }, testInfo) => {
  await signIn(page, 'b')
  await expect(page.getByRole('heading', { name: 'Weddings' })).toBeVisible()
  // Someone else signs in on this browser (this ends B's session); the tab still shows B's page.
  await signInRequest(context.request, 'c')

  const stale = `Stale tab ${testInfo.project.name} ${Date.now()}`
  const refused = page.waitForResponse((r) => r.url().endsWith('/api/weddings') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'New wedding' }).click()
  const create = page.getByRole('dialog', { name: 'New wedding' })
  await create.getByLabel('Name').fill(stale)
  await create.getByRole('button', { name: 'Create wedding' }).click()
  const res = await refused
  // The page named the user it was rendered for; the cookie now signs in someone else.
  expect(res.request().headers()['x-seat-plan-user']).toMatch(/^[0-9a-f-]{36}$/)
  expect(res.status()).toBe(401)
  expect(await res.json()).toEqual({ error: 'stale_page' })
  const list = (await (await context.request.get('/api/weddings')).json()) as { name: string }[]
  expect(list.some((w) => w.name === stale)).toBe(false)

  // Once the tab reloads it is C's page, and the same change goes through.
  await page.reload()
  const accepted = page.waitForResponse((r) => r.url().endsWith('/api/weddings') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'New wedding' }).click()
  await create.getByLabel('Name').fill(stale)
  await create.getByRole('button', { name: 'Create wedding' }).click()
  const ok = await accepted
  expect(ok.status()).toBe(201)
  expect(ok.request().headers()['x-seat-plan-user']).not.toBe(res.request().headers()['x-seat-plan-user'])
})

test('a change from another site is refused before it reaches the app', async ({ request, baseURL }) => {
  for (const path of ['/api/auth/login', '/api/weddings', '/api/setup']) {
    const res = await request.post(path, { data: {}, headers: { origin: 'https://evil.example' } })
    expect(res.status(), path).toBe(403)
    expect(await res.json()).toEqual({ error: 'bad_origin' })
  }
  // The same request from this site gets past that check.
  const same = await request.post('/api/auth/login', { data: {}, headers: { origin: new URL(baseURL!).origin } })
  expect(same.status()).not.toBe(403)
})
