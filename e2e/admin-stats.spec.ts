/**
 * The admin overview, the per-wedding and venue admin pages, and the usage
 * counters behind them, end to end. Avery (A) is the run's admin; Blake (B)
 * makes the weddings and venues through the API; Casey (C) gets added to one.
 * Planners get the Not found page; no admin page scrolls sideways on a phone.
 */
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { emptyCanvas } from '../src/domain/canvas-schema'
import { E2E_USERS, apiCreateLayout, apiCreateWedding, apiPutCanvas, signIn, signInRequest, uniqueName } from './helpers'
import { apiCreateVenue } from './venues'

/** The number in an overview total. */
async function total(page: Page, testId: string): Promise<number> {
  return Number(await page.getByTestId(`${testId}-value`).textContent())
}

function weddingRow(page: Page, weddingId: string) {
  return page.locator(`[data-testid="admin-wedding"][data-wedding-id="${weddingId}"]`)
}

test('planners get the Not found page on every admin page', async ({ page }) => {
  await signIn(page, 'b', '/admin')
  await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible()
  for (const path of ['/admin/venues', `/admin/weddings/${randomUUID()}`]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0)
  }
})

test('the overview counts a new wedding, and a save shows in its edits', async ({ page, request }, testInfo) => {
  await signInRequest(request, 'b')
  await signIn(page, 'a', '/admin')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
  const weddingsBefore = await total(page, 'total-weddings')
  const layoutsBefore = await total(page, 'total-layouts')

  const wedding = await apiCreateWedding(request, uniqueName('Counted', testInfo))
  const layout = await apiCreateLayout(request, wedding.id, { name: 'Reception' })
  await page.reload()
  await expect(page.getByTestId('total-weddings-value')).toHaveText(String(weddingsBefore + 1))
  await expect(page.getByTestId('total-layouts-value')).toHaveText(String(layoutsBefore + 1))
  // Blake signed in just now: today has a sign-in.
  await expect(page.getByTestId('activity-day').first().locator('td').nth(1)).not.toHaveText('0')

  // Making the layout was one edit; a save is another. Counting happens after the reply, so each is waited for.
  await page.goto('/admin/weddings')
  const edits = weddingRow(page, wedding.id).getByTestId('admin-wedding-edits')
  const editsReach = async (count: number) =>
    expect(async () => {
      await page.reload()
      await expect(edits).toHaveText(String(count), { timeout: 1000 })
    }).toPass({ timeout: 15_000 })
  await editsReach(1)
  await expect(weddingRow(page, wedding.id)).toContainText(`by ${E2E_USERS.b.displayName}`)
  await apiPutCanvas(request, layout, emptyCanvas())
  await editsReach(2)
})

test('the admin undeletes a deleted wedding', async ({ page, request }, testInfo) => {
  await signInRequest(request, 'b')
  const wedding = await apiCreateWedding(request, uniqueName('Deleted by mistake', testInfo))
  expect((await request.delete(`/api/weddings/${wedding.id}`, { data: { confirm: 'delete' } })).status()).toBe(200)
  expect((await request.get(`/api/weddings/${wedding.id}`)).status()).toBe(404)

  await signIn(page, 'a', '/admin/weddings')
  const deleted = page.getByTestId('admin-deleted-weddings')
  const row = deleted.locator(`[data-wedding-id="${wedding.id}"]`)
  await expect(row).toContainText(wedding.name)
  await row.getByRole('button', { name: 'Undelete' }).click()
  await expect(row).toHaveCount(0)
  await expect(page.getByTestId('admin-weddings').locator(`[data-wedding-id="${wedding.id}"]`).getByRole('link', { name: `Open ${wedding.name}` })).toBeVisible()
  // Blake has it back, as it was.
  const back = await request.get(`/api/weddings/${wedding.id}`)
  expect(back.status()).toBe(200)
  expect(await back.json()).toMatchObject({ id: wedding.id, name: wedding.name })
})

test('the admin adds someone to a wedding from its admin page', async ({ page, request, playwright }, testInfo) => {
  await signInRequest(request, 'b')
  const wedding = await apiCreateWedding(request, uniqueName('Adding Casey', testInfo))

  await signIn(page, 'a', '/admin/weddings')
  await weddingRow(page, wedding.id).getByRole('link', { name: wedding.name, exact: true }).click()
  await expect(page.getByRole('heading', { name: wedding.name, level: 2 })).toBeVisible()
  await expect(page.getByTestId('admin-member')).toHaveCount(1)
  const casey = E2E_USERS.c
  await page.getByLabel('Add someone with an account').selectOption({ label: `${casey.displayName} (${casey.email})` })
  await page.getByLabel('As', { exact: true }).selectOption('editor')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const row = page.getByTestId('admin-member').filter({ hasText: casey.email })
  await expect(row).toBeVisible()
  await expect(row.getByLabel(`Role for ${casey.displayName}`)).toHaveValue('editor')
  // The activity lists it.
  await expect(page.getByTestId('admin-wedding-event').filter({ hasText: 'Added someone' })).toBeVisible()

  // Casey can open the wedding now.
  const caseys = await playwright.request.newContext({ baseURL: process.env.E2E_BASE_URL })
  try {
    await signInRequest(caseys, 'c')
    expect((await caseys.get(`/api/weddings/${wedding.id}`)).status()).toBe(200)
  } finally {
    await caseys.dispose()
  }
})

test('the admin puts a planner’s venue in the library, and takes it out', async ({ page, request }, testInfo) => {
  await signInRequest(request, 'b')
  const venue = await apiCreateVenue(request, uniqueName('Blake hall', testInfo))

  await signIn(page, 'a', '/admin/venues')
  const row = page.locator(`[data-testid="admin-venue"][data-venue-id="${venue.id}"]`)
  await expect(row.getByTestId('admin-venue-status')).toHaveText('Private')
  await expect(row).toContainText(E2E_USERS.b.displayName)
  await row.getByRole('button', { name: 'Add to library' }).click()
  const dialog = page.getByRole('dialog', { name: `Add ${venue.name} to the library?` })
  await expect(dialog).toContainText('Every planner will see it')
  await dialog.getByRole('button', { name: 'Add to library' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(row.getByTestId('admin-venue-status')).toHaveText('Library')
  await page.reload()
  await expect(row.getByTestId('admin-venue-status')).toHaveText('Library')

  // Back out, so the other tests' venue lists stay as they were.
  await row.getByRole('button', { name: 'Remove from library' }).click()
  await expect(row.getByTestId('admin-venue-status')).toHaveText('Private')
})

test('no admin page scrolls sideways at 390 px: tables scroll in their own box', async ({ page, request }, testInfo) => {
  await signInRequest(request, 'b')
  const wedding = await apiCreateWedding(request, uniqueName('Narrow', testInfo))
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, 'a', '/admin')
  for (const path of ['/admin', '/admin/weddings', `/admin/weddings/${wedding.id}`, '/admin/users', '/admin/venues']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible()
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }))
    expect(widths.page, path).toBeLessThanOrEqual(widths.view)
  }
})
