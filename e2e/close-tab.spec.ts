/**
 * Acceptance check 19: closing the tab right after an edit, before its save
 * can land, and opening the layout again shows the edit, which then saves.
 * The edit survives in this device's IndexedDB draft (PLAN section 5,
 * "Closing the tab" and "Opening a layout"). If someone else saved in
 * between, opening the layout asks instead (acceptance check 18's dialog,
 * with the wording for edits left on this device).
 *
 * When the page hides, the tab sends one last save with fetch keepalive.
 * Chromium sends that request after the page is gone, and page.route() never
 * sees it, so a route cannot hold it back. The draft tests therefore take the
 * device offline (no save can leave at all), and a separate test shows the
 * keepalive save landing on its own.
 */
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { dbAddMember } from './db'
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
  signInRequest,
  tableIds,
  uniqueName,
  waitForEditor,
} from './helpers'

async function openNewLayout(context: BrowserContext, page: Page, testInfo: TestInfo, label: string) {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName(label, testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  await expectSaved(page)
  return { wedding, layout }
}

/**
 * Takes the device offline, adds a table and closes the tab within 200 ms of
 * the edit. Nothing reaches the server; the edit is only in the draft.
 * Returns the new table's id, with the device back online.
 */
async function editOfflineAndClose(context: BrowserContext, page: Page): Promise<string[]> {
  await context.setOffline(true)
  await addRoundTable(page)
  const editedAt = Date.now()
  await expect(canvasTables(page)).toHaveCount(1)
  const ids = await tableIds(page)
  await page.close()
  expect(Date.now() - editedAt, 'the tab closed within 200 ms of the edit').toBeLessThan(200)
  await context.setOffline(false)
  return ids
}

test('an edit made just before the tab closes comes back when the layout opens again', async ({ context, page }, testInfo) => {
  const { wedding, layout } = await openNewLayout(context, page, testInfo, 'Close tab')
  const ids = await editOfflineAndClose(context, page)

  // The server never got it, not even a moment later (the keepalive save lands within about 50 ms when online).
  const request = context.request
  await new Promise((resolve) => setTimeout(resolve, 500))
  const before = await apiGetLayout(request, layout.id)
  expect(before.version).toBe(1)
  expect(before.canvas.items).toEqual([])

  // Open the layout again in a new tab: the edit appears, then saves.
  const again = await context.newPage()
  await again.goto(editorPath(wedding.id, layout.id))
  await expect(canvasTables(again)).toHaveCount(1)
  expect(await tableIds(again)).toEqual(ids)
  await expectSaved(again)
  await expect(saveStatus(again)).toHaveText('Saved')

  const after = await apiGetLayout(request, layout.id)
  expect(after.version).toBe(2)
  expect(after.editedBy).toBe(E2E_USERS.a.displayName)
  expect(after.canvas.items.map((item) => item.id)).toEqual(ids)

  // Nothing is left to replay: a reload shows the saved table and stays saved.
  await again.reload()
  await waitForEditor(again)
  await expect(canvasTables(again)).toHaveCount(1)
  await expectSaved(again)
  expect((await apiGetLayout(request, layout.id)).version).toBe(2)
})

test('closing the tab right after an edit still sends the last-chance save', async ({ context, page }, testInfo) => {
  const { layout } = await openNewLayout(context, page, testInfo, 'Close tab keepalive')

  // No route here: with one, Chromium sometimes holds the keepalive request and drops it when the page goes.
  await addRoundTable(page)
  const editedAt = Date.now()
  await expect(canvasTables(page)).toHaveCount(1)
  const ids = await tableIds(page)
  await page.close()
  // Closed long before the 1 second wait after an edit was up, so no ordinary save
  // had left: the only save that can land is the keepalive one sent as the page hid.
  expect(Date.now() - editedAt).toBeLessThan(200)

  const request = context.request
  await expect.poll(async () => (await apiGetLayout(request, layout.id)).version, { timeout: 5000 }).toBe(2)
  const stored = await apiGetLayout(request, layout.id)
  expect(stored.editedBy).toBe(E2E_USERS.a.displayName)
  expect(stored.canvas.items.map((item) => item.id)).toEqual(ids)

  // Opening it again finds that the draft's save landed: nothing to replay, no question.
  const again = await context.newPage()
  await again.goto(editorPath(stored.weddingId, layout.id))
  await waitForEditor(again)
  await expectSaved(again)
  await expect(again.getByRole('dialog', { name: 'This layout changed' })).toHaveCount(0)
  expect(await tableIds(again)).toEqual(ids)
  expect((await apiGetLayout(request, layout.id)).version).toBe(2)
})

test('an edit left by a closed tab meets a newer save: the dialog says loading theirs drops it', async ({ browser, context, page }, testInfo) => {
  const { wedding, layout } = await openNewLayout(context, page, testInfo, 'Close tab conflict')
  const mine = await editOfflineAndClose(context, page)

  // Meanwhile Blake, who plans this wedding too, saves a table from their own device.
  const request = context.request
  const before = await apiGetLayout(request, layout.id)
  expect(before.version).toBe(1)
  await dbAddMember(wedding.id, E2E_USERS.b.email)
  const otherDevice = await browser.newContext()
  await signInRequest(otherDevice.request, 'b')
  await apiAddTables(otherDevice.request, before, 1)
  await otherDevice.close()
  const theirs = await apiGetLayout(request, layout.id)
  expect(theirs.version).toBe(2)
  const theirIds = theirs.canvas.items.map((item) => item.id)
  expect(theirIds).toHaveLength(1)
  expect(theirIds).not.toContain(mine[0])

  // Opening the layout again finds the closed tab's edit, made on the older version.
  const again = await context.newPage()
  await again.goto(editorPath(wedding.id, layout.id))
  const dialog = again.getByRole('dialog', { name: 'This layout changed' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('conflict-message')).toHaveText(
    new RegExp(`^${E2E_USERS.b.displayName} changed this layout at \\d{1,2}:\\d{2} (am|pm)\\.$`),
  )
  await expect(dialog.getByTestId('conflict-choice')).toHaveText(
    'Changes made on this device earlier were not saved before that. ' +
      'Load their version to drop the changes made on this device earlier, or keep them as a new copy.',
  )

  // Load their version: my table is dropped, theirs shows, and the server keeps theirs.
  await dialog.getByRole('button', { name: 'Load their version' }).click()
  await expect(dialog).toBeHidden()
  await expect(canvasTables(again)).toHaveCount(1)
  expect(await tableIds(again)).toEqual(theirIds)
  await expectSaved(again)
  expect((await apiGetLayout(request, layout.id)).version).toBe(2)

  // The dropped edit is gone for good: a reload asks nothing.
  await again.reload()
  await waitForEditor(again)
  await expectSaved(again)
  await expect(dialog).toHaveCount(0)
  expect(await tableIds(again)).toEqual(theirIds)
  const after = await apiGetLayout(request, layout.id)
  expect(after.version).toBe(2)
  expect(after.canvas.items.map((item) => item.id)).toEqual(theirIds)
})
