/**
 * Acceptance check 1: the public URL in a private window shows the password
 * page. A wrong password shows an error. The right one opens the app, and it
 * stays open after the browser restarts.
 */
import { expect, test } from '@playwright/test'
import { SITE_COOKIE } from '../src/server/auth/tokens'
import { signIn, sitePassword } from './helpers'

test('a new visitor sees the password page', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Seat Plan' })).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
})

test('a wrong password shows an error and allows another try', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Password').fill('not the password')
  await page.getByRole('button', { name: 'Enter' }).click()
  await expect(page.locator('#login-error')).toHaveText('That password is wrong. Try again.')
  await expect(page).toHaveURL(/\/login/)

  await page.getByLabel('Password').fill(sitePassword())
  await page.getByRole('button', { name: 'Enter' }).click()
  await expect(page.getByRole('heading', { name: 'Weddings' })).toBeVisible()
})

test('the right password opens the app', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('heading', { name: 'Weddings' })).toBeVisible()
})

test('after signing in you land on the page you asked for', async ({ page }) => {
  await page.goto('/w/abc/layouts?tab=1')
  await expect(page).toHaveURL(/\/login\?next=%2Fw%2Fabc%2Flayouts%3Ftab%3D1$/)
  await page.getByLabel('Password').fill(sitePassword())
  await page.getByRole('button', { name: 'Enter' }).click()
  await expect(page).toHaveURL(/\/w\/abc\/layouts\?tab=1$/)
})

test('too many tries shows how long to wait', async ({ page }) => {
  // The real block is covered by the login route's tests; tripping it here
  // would lock out every other test, which all come from one address.
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 429, json: { error: 'too_many_attempts', retryAfterSeconds: 840 } }),
  )
  await page.goto('/login')
  await page.getByLabel('Password').fill('anything')
  await page.getByRole('button', { name: 'Enter' }).click()
  await expect(page.locator('#login-error')).toHaveText('Too many tries. Try again in 14 minutes.')
})

test('the cookie is HttpOnly, SameSite=Lax and lasts 30 days', async ({ page, context }) => {
  await signIn(page)
  const cookie = (await context.cookies()).find((c) => c.name === SITE_COOKIE)
  expect(cookie).toBeDefined()
  expect(cookie!.httpOnly).toBe(true)
  expect(cookie!.sameSite).toBe('Lax')
  const days = (cookie!.expires * 1000 - Date.now()) / 86_400_000
  expect(days).toBeGreaterThan(29.9)
  expect(days).toBeLessThan(30.1)
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

test('log out signs this device out', async ({ page }) => {
  await signIn(page)
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})

test('a forged cookie does not open the app', async ({ page, context, baseURL }) => {
  const body = Buffer.from(JSON.stringify({ typ: 'site', exp: Date.now() + 1e9 })).toString('base64url')
  await context.addCookies([{ name: SITE_COOKIE, value: `${body}.AAAA`, url: baseURL! }])
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})
