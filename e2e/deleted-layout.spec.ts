/**
 * A layout deleted on another device while it is open in the editor (PLAN
 * section 5, "Answers": a 410 stops the retries and shows "Couldn't save"
 * with Save as a copy and Download). Save as a copy stores this tab's canvas
 * as a new layout in the same wedding and opens it.
 *
 * The delete happens in a second browser context, as the same planner on
 * their phone or laptop would do it: through the layouts list and the typed
 * `delete`.
 */
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import {
  E2E_USERS,
  addRoundTable,
  apiAddTables,
  apiCreateLayout,
  apiCreateWedding,
  apiGetLayout,
  canvasTables,
  editorPath,
  expectSaved,
  saveStatus,
  signIn,
  tableIds,
  uniqueName,
  waitForEditor,
} from './helpers'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const GONE_MESSAGE = 'This layout was deleted, so changes cannot be saved.'
/** The copy carries the signed-in planner's name (e2e/users.ts). */
const COPY_NAME = `Plan (${E2E_USERS.a.displayName}'s copy)`

/** Deletes the layout from another browser context, through the layouts list. */
async function deleteElsewhere(browser: Browser, weddingId: string, layoutId: string, name: string): Promise<void> {
  const other = await browser.newContext({ baseURL: process.env.E2E_BASE_URL })
  try {
    const page = await other.newPage()
    await signIn(page)
    await page.goto(`/w/${weddingId}/layouts`)
    const card = page.locator(`[data-layout-id="${layoutId}"]`)
    await card.getByRole('button', { name: `Delete ${name}` }).click()
    const dialog = page.getByTestId('delete-dialog')
    await dialog.getByLabel('Type delete to confirm').fill('delete')
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(card).toHaveCount(0)
    expect((await page.request.get(`/api/layouts/${layoutId}`)).status()).toBe(404)
  } finally {
    await other.close()
  }
}

async function openEditor(page: Page, testInfo: TestInfo, label: string) {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName(label, testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  return { wedding, layout }
}

/** Clicks Save as a copy and checks the copy opens, holding `ids`, and is stored. */
async function saveAsCopyOpens(page: Page, weddingId: string, layoutId: string, ids: string[]): Promise<void> {
  const banner = page.getByTestId('save-failed-banner')
  await banner.getByRole('button', { name: 'Save as a copy' }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${weddingId}/layouts/(?!${layoutId})${UUID}$`))
  const copyId = new URL(page.url()).pathname.split('/')[4]
  await expect(page.getByTestId('layout-title')).toHaveText(COPY_NAME)
  await waitForEditor(page)
  await expectSaved(page)
  await expect(banner).toBeHidden()
  await expect(canvasTables(page)).toHaveCount(ids.length)
  expect(await tableIds(page)).toEqual(ids)

  const copy = await apiGetLayout(page.request, copyId)
  expect(copy.weddingId).toBe(weddingId)
  expect(copy.name).toBe(COPY_NAME)
  expect(copy.editedBy).toBe(E2E_USERS.a.displayName)
  expect(copy.canvas.items.map((item) => item.id)).toEqual(ids)
  expect((await page.request.get(`/api/layouts/${layoutId}`)).status()).toBe(404)

  // Editing goes on in the copy.
  await addRoundTable(page)
  await expect(canvasTables(page)).toHaveCount(ids.length + 1)
  await expectSaved(page)
  const after = await apiGetLayout(page.request, copyId)
  expect(after.version).toBe(copy.version + 1)

  // The wedding now has just the copy.
  await page.goto(`/w/${weddingId}/layouts`)
  await expect(page.getByTestId('layout-card')).toHaveCount(1)
  await expect(page.locator(`[data-layout-id="${copyId}"]`).getByTestId('layout-name')).toHaveText(COPY_NAME)
}

test('an edit after the layout was deleted elsewhere fails, and Save as a copy opens a new layout with the table', async ({ browser, page }, testInfo) => {
  const { wedding, layout } = await openEditor(page, testInfo, 'Deleted while open')
  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  await expectSaved(page)
  const headerHeight = (await page.locator('header').boundingBox())?.height

  await deleteElsewhere(browser, wedding.id, layout.id, 'Plan')

  // A table added after the delete: its save answers 410.
  await addRoundTable(page)
  await expect(canvasTables(page)).toHaveCount(1)
  const ids = await tableIds(page)
  await expect(saveStatus(page)).toHaveAttribute('data-status', 'failed', { timeout: 10_000 })
  await expect(saveStatus(page)).toHaveText("Couldn't save: this layout was deleted")
  await expect(saveStatus(page)).toHaveAttribute('title', `Couldn't save: this layout was deleted. ${GONE_MESSAGE}`)
  // The longest status still fits the top bar's one row.
  expect((await page.locator('header').boundingBox())?.height).toBe(headerHeight)

  const banner = page.getByTestId('save-failed-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText(GONE_MESSAGE)
  await expect(banner.getByRole('button', { name: 'Save as a copy' })).toBeEnabled()
  await expect(banner.getByRole('button', { name: 'Download a copy' })).toBeEnabled()

  await saveAsCopyOpens(page, wedding.id, layout.id, ids)
})

test('coming back to a tab whose layout was deleted shows the banner, and Save as a copy keeps the tables', async ({ browser, page }, testInfo) => {
  const { wedding, layout } = await openEditor(page, testInfo, 'Deleted while away')
  const saved = await apiAddTables(page.request, layout, 2)
  expect(saved.version).toBe(2)
  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  await expectSaved(page)
  await expect(canvasTables(page)).toHaveCount(2)
  const ids = await tableIds(page)

  await deleteElsewhere(browser, wedding.id, layout.id, 'Plan')

  // The tab regains focus and asks for the version: the layout is gone. No edit needed.
  const banner = page.getByTestId('save-failed-banner')
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(banner).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
  await expect(banner).toContainText(GONE_MESSAGE)

  await saveAsCopyOpens(page, wedding.id, layout.id, ids)
})
