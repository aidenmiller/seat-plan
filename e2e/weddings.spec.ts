/**
 * Milestone 2: weddings and layouts end to end (spec section 10). Create a
 * wedding, rename it in place, open it, change its settings; create layouts on
 * a blank canvas and on the Toronto Beach Club template, rename, duplicate,
 * open the editor, add a table and see it saved.
 *
 * Every test makes its own wedding with a name no other test uses, since both
 * projects share one database.
 */
import { expect, test, type Route } from '@playwright/test'
import {
  E2E_USERS,
  addRoundTable,
  apiCreateWedding,
  canvasTables,
  expectSaved,
  saveStatus,
  signIn,
  uniqueName,
  waitForEditor,
} from './helpers'
import type { WeddingSummary } from '../src/shared/api'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

test('create a wedding, rename it in place, open it and change its settings', async ({ page }, testInfo) => {
  await signIn(page)
  await expect(page.getByRole('heading', { name: 'Weddings' })).toBeVisible()

  // Create: an empty name is refused, then the new wedding opens on its Layouts tab.
  const name = uniqueName('Wedding', testInfo)
  await page.getByRole('button', { name: 'New wedding' }).click()
  const create = page.getByRole('dialog', { name: 'New wedding' })
  await create.getByRole('button', { name: 'Create wedding' }).click()
  await expect(create.getByText('Names cannot be empty.')).toBeVisible()
  await create.getByLabel('Name').fill(name)
  await create.getByRole('button', { name: 'Create wedding' }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${UUID}/layouts$`))
  const weddingId = new URL(page.url()).pathname.split('/')[2]
  await expect(page.getByTestId('wedding-title')).toHaveText(name)
  await expect(page.getByText('No layouts yet.')).toBeVisible()

  // Back home: the new card.
  await page.getByRole('link', { name: 'All weddings' }).click()
  await expect(page).toHaveURL(/\/$/)
  const card = page.locator(`[data-testid="wedding-card"][data-wedding-id="${weddingId}"]`)
  const cardName = card.getByTestId('wedding-name')
  const cardInput = card.getByTestId('wedding-name-input')
  await expect(cardName).toHaveText(name)
  await expect(card).toContainText('No date yet')
  await expect(card).toContainText('0 guests · 0 layouts')

  // Esc cancels.
  await cardName.click()
  await expect(cardInput).toBeFocused()
  await expect(cardInput).toHaveValue(name)
  await cardInput.fill('Not this name')
  await cardInput.press('Escape')
  await expect(cardInput).toBeHidden()
  await expect(cardName).toHaveText(name)
  await page.reload()
  await expect(cardName).toHaveText(name)

  // An empty name is refused and the old name comes back.
  await cardName.click()
  await cardInput.fill('   ')
  await cardInput.press('Enter')
  await expect(card.getByRole('alert')).toHaveText('Names cannot be empty.')
  await expect(cardName).toHaveText(name)

  // Enter saves.
  const renamed = `${name} renamed`
  await cardName.click()
  await cardInput.fill(renamed)
  // The new name shows while it is being saved, so wait for the server's answer before reloading.
  const weddingRenamed = page.waitForResponse(
    (res) => res.request().method() === 'PATCH' && new URL(res.url()).pathname === `/api/weddings/${weddingId}`,
  )
  await cardInput.press('Enter')
  await expect(cardName).toHaveText(renamed)
  await expect(cardName).toBeFocused()
  expect((await weddingRenamed).status()).toBe(200)
  await page.reload()
  await expect(cardName).toHaveText(renamed)
  const stored = (await (await page.request.get(`/api/weddings/${weddingId}`)).json()) as WeddingSummary
  expect(stored.name).toBe(renamed)

  // Open it: the six tabs, Layouts first.
  await card.getByRole('link', { name: `Open ${renamed}` }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${weddingId}/layouts$`))
  await expect(page.getByTestId('wedding-title')).toHaveText(renamed)
  const tabs = page.getByRole('navigation', { name: 'Wedding' })
  for (const label of ['Layouts', 'Guests', 'Groups', 'Rules', 'Venues', 'Links']) {
    await expect(tabs.getByRole('link', { name: label, exact: true })).toBeVisible()
  }
  await expect(tabs.getByRole('link', { name: 'Layouts' })).toHaveAttribute('aria-current', 'page')
  await tabs.getByRole('link', { name: 'Guests' }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${weddingId}/guests$`))
  await expect(page.getByRole('heading', { name: 'Guests', level: 2 })).toBeVisible()
  await expect(tabs.getByRole('link', { name: 'Guests' })).toHaveAttribute('aria-current', 'page')
  await tabs.getByRole('link', { name: 'Venues' }).click()
  await expect(page.getByTestId('venue-list')).toContainText('Toronto Beach Club')
  await tabs.getByRole('link', { name: 'Layouts' }).click()
  await expect(page.getByText('No layouts yet.')).toBeVisible()

  // Settings: switch to meters; the gap shows in meters, and a typed gap is read in meters.
  await page.getByRole('button', { name: 'Settings' }).click()
  let settings = page.getByRole('dialog', { name: 'Wedding settings' })
  await expect(settings.getByRole('radio', { name: 'Feet' })).toBeChecked()
  const gap = settings.getByLabel('Minimum gap between tables')
  await expect(gap).toHaveValue('5′ 0″')
  await settings.getByRole('radio', { name: 'Meters' }).check()
  await expect(gap).toHaveValue('1.52 m')
  // Saving refreshes the page's data. Hold that refresh, so Settings opens again before it lands, as a quick tap can.
  const refreshes: Route[] = []
  let holdRefresh = true
  await page.route(
    (url) => url.pathname.startsWith(`/w/${weddingId}`),
    (route) => {
      const headers = route.request().headers()
      if (!holdRefresh || headers['rsc'] !== '1' || headers['next-router-prefetch']) return route.fallback()
      refreshes.push(route)
    },
  )
  await settings.getByRole('button', { name: 'Save' }).click()
  await expect(settings).toBeHidden()
  await expect.poll(() => refreshes.length).toBeGreaterThan(0)

  let wedding = (await (await page.request.get(`/api/weddings/${weddingId}`)).json()) as WeddingSummary
  expect(wedding.unit).toBe('m')
  expect(wedding.minGapCm).toBeCloseTo(152.4, 6)

  // Settings opens on what was just saved, refresh or not.
  await page.getByRole('button', { name: 'Settings' }).click()
  settings = page.getByRole('dialog', { name: 'Wedding settings' })
  await expect(settings.getByRole('radio', { name: 'Meters' })).toBeChecked()
  await expect(gap).toHaveValue('1.52 m')
  holdRefresh = false
  for (const route of refreshes.splice(0)) await route.fallback()
  await expect(settings.getByRole('radio', { name: 'Meters' })).toBeChecked()
  await gap.fill('2')
  await settings.getByRole('button', { name: 'Save' }).click()
  await expect(settings).toBeHidden()
  wedding = (await (await page.request.get(`/api/weddings/${weddingId}`)).json()) as WeddingSummary
  expect(wedding.unit).toBe('m')
  expect(wedding.minGapCm).toBeCloseTo(200, 6)

  // Esc closes the dialog without saving.
  await page.getByRole('button', { name: 'Settings' }).click()
  settings = page.getByRole('dialog', { name: 'Wedding settings' })
  await expect(gap).toHaveValue('2.00 m')
  await settings.getByRole('radio', { name: 'Feet' }).check()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  wedding = (await (await page.request.get(`/api/weddings/${weddingId}`)).json()) as WeddingSummary
  expect(wedding.unit).toBe('m')
})

test('layouts: blank and Toronto Beach Club, rename, duplicate, open, add a table', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Layouts', testInfo))
  await page.goto(`/w/${wedding.id}/layouts`)
  await expect(page.getByText('No layouts yet.')).toBeVisible()

  // A reception layout on a blank canvas.
  await page.getByRole('button', { name: 'New layout' }).click()
  let dialog = page.getByRole('dialog', { name: 'New layout' })
  await expect(dialog.getByRole('radio', { name: /^Reception/ })).toBeChecked()
  await expect(dialog.getByRole('radio', { name: /^Blank canvas/ })).toBeChecked()
  await expect(dialog.getByLabel('3. Name')).toHaveValue('Reception plan')
  await dialog.getByLabel('3. Name').fill('Blank plan')
  await dialog.getByRole('button', { name: 'Create layout' }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${wedding.id}/layouts/${UUID}$`))
  const blankId = new URL(page.url()).pathname.split('/')[4]
  await expect(page.getByTestId('layout-title')).toHaveText('Blank plan')
  await waitForEditor(page)
  await expectSaved(page)
  await expect(canvasTables(page)).toHaveCount(0)
  await page.getByRole('link', { name: 'Back to layouts' }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${wedding.id}/layouts$`))

  // A reception layout on the Toronto Beach Club template.
  await page.getByRole('button', { name: 'New layout' }).click()
  dialog = page.getByRole('dialog', { name: 'New layout' })
  await dialog.getByRole('radio', { name: 'Toronto Beach Club' }).check()
  await dialog.getByLabel('3. Name').fill('Beach plan')
  await dialog.getByRole('button', { name: 'Create layout' }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${wedding.id}/layouts/(?!${blankId})${UUID}$`))
  const beachId = new URL(page.url()).pathname.split('/')[4]
  await expect(page.getByTestId('layout-title')).toHaveText('Beach plan')
  await waitForEditor(page)
  await page.getByRole('link', { name: 'Back to layouts' }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${wedding.id}/layouts$`))

  const cards = page.getByTestId('layout-card')
  await expect(cards).toHaveCount(2)
  const blank = page.locator(`[data-layout-id="${blankId}"]`)
  const beach = page.locator(`[data-layout-id="${beachId}"]`)
  await expect(blank.getByTestId('layout-name')).toHaveText('Blank plan')
  await expect(blank).toContainText('Reception · Blank canvas')
  await expect(blank.getByTestId('layout-edited')).toHaveText(`Edited just now by ${E2E_USERS.a.displayName}`)
  await expect(blank.getByTestId('layout-thumbnail')).toBeVisible()
  await expect(beach.getByTestId('layout-name')).toHaveText('Beach plan')
  await expect(beach).toContainText('Reception · Toronto Beach Club')

  // Rename in place: Esc cancels, an empty name is refused, Enter saves.
  const blankName = blank.getByTestId('layout-name')
  const blankInput = blank.getByTestId('layout-name-input')
  await blankName.click()
  await blankInput.fill('Something else')
  await blankInput.press('Escape')
  await expect(blankName).toHaveText('Blank plan')
  await blankName.click()
  await blankInput.fill('')
  await blankInput.press('Enter')
  await expect(blank.getByRole('alert')).toHaveText('Names cannot be empty.')
  await expect(blankName).toHaveText('Blank plan')
  await blankName.click()
  await blankInput.fill('Plan A')
  // The new name shows while it is being saved, so wait for the server's answer before reloading.
  const layoutRenamed = page.waitForResponse(
    (res) => res.request().method() === 'PATCH' && new URL(res.url()).pathname === `/api/layouts/${blankId}`,
  )
  await blankInput.press('Enter')
  await expect(blankName).toHaveText('Plan A')
  expect((await layoutRenamed).status()).toBe(200)
  await page.reload()
  await expect(blankName).toHaveText('Plan A')

  // Duplicate keeps the kind and the venue.
  await beach.getByRole('button', { name: 'Duplicate Beach plan' }).click()
  await expect(cards).toHaveCount(3)
  const copy = cards.filter({ has: page.getByTestId('layout-name').getByText('Beach plan copy', { exact: true }) })
  await expect(copy).toHaveCount(1)
  await expect(copy).toContainText('Reception · Toronto Beach Club')
  await expect(copy.getByTestId('layout-edited')).toHaveText(`Edited just now by ${E2E_USERS.a.displayName}`)

  // Open the editor, add a table, see it saved, reload and see it again.
  await blank.getByRole('link', { name: 'Open Plan A' }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${wedding.id}/layouts/${blankId}$`))
  await expect(page.getByTestId('layout-title')).toHaveText('Plan A')
  await waitForEditor(page)
  await expectSaved(page)
  await addRoundTable(page)
  await expect(canvasTables(page)).toHaveCount(1)
  await expect(saveStatus(page)).toHaveText('Saving…')
  await expectSaved(page)
  await page.reload()
  await waitForEditor(page)
  await expect(canvasTables(page)).toHaveCount(1)
  await expectSaved(page)
  await expect(page.getByTestId('canvas')).toHaveAttribute('aria-label', 'Floor plan with 1 table')

  // The list shows the save, and the other layouts are as they were.
  await page.getByRole('link', { name: 'Back to layouts' }).click()
  await expect(cards).toHaveCount(3)
  await expect(blank.getByTestId('layout-edited')).toHaveText(`Edited just now by ${E2E_USERS.a.displayName}`)
  await expect(beach.getByTestId('layout-name')).toHaveText('Beach plan')
})
