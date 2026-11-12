/**
 * One browser, two people (Avery, A, and Blake, B, from e2e/users.ts).
 * Unsaved edits live in each person's own IndexedDB databases, so:
 *
 * 1. Avery signs out with an edit that could not be saved: the sign-out
 *    asks first, then deletes Avery's databases.
 * 2. Blake then signs in on the same browser: Avery's edit was never sent
 *    (the layout's version has not moved) and Blake sees none of Avery's
 *    weddings.
 * 3. Avery's session ends (deleted in the database) while an edit waits:
 *    nothing is lost, and the edit goes out once Avery signs in again.
 * 4. Blake signs in from another tab while Avery's editor holds an edit:
 *    Avery's tab says someone else signed in, and the edit never lands under
 *    Blake's session, even once saves can get through again.
 */
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { dbEndSessions } from './db'
import {
  E2E_USERS,
  addRoundTable,
  apiCreateLayout,
  apiCreateWedding,
  apiGetLayout,
  canvasTables,
  editorPath,
  expectSaved,
  logOut,
  saveStatus,
  signIn,
  signInRequest,
  tableIds,
  uniqueName,
  waitForEditor,
} from './helpers'

/** Layout saves from this page fail as if the network dropped them, until the returned function lets them through. */
async function blockLayoutSaves(page: Page): Promise<() => Promise<void>> {
  const pattern = '**/api/layouts/*'
  await page.route(pattern, (route) => (route.request().method() === 'PUT' ? route.abort('failed') : route.fallback()))
  return async () => {
    await page.unroute(pattern)
    // The browser is back: the save engine tries again at once.
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
  }
}

/** The IndexedDB databases this page's origin holds. */
async function databaseNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? ''))
}

/** Avery's wedding and layout, open in the editor, with one table added that cannot be saved yet. */
async function averyWithAnUnsavedEdit(page: Page, testInfo: TestInfo, label: string) {
  await signIn(page)
  const weddingName = uniqueName(label, testInfo)
  const wedding = await apiCreateWedding(page.request, weddingName)
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  const averyId = layout.editedById!
  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  await expectSaved(page)
  const unblock = await blockLayoutSaves(page)
  await addRoundTable(page)
  await expect(canvasTables(page)).toHaveCount(1)
  await expect(saveStatus(page)).toHaveAttribute('data-status', /retrying|offline/)
  // The edit waits in Avery's own database.
  expect(await databaseNames(page)).toContain(`seat-plan-u-${averyId}`)
  return { weddingName, wedding, layout, averyId, unblock }
}

/** The layout as the server holds it, read by Avery from a browser of their own. */
async function serverCopy(context: BrowserContext, layoutId: string) {
  const browser = context.browser()!
  const averys = await browser.newContext()
  try {
    await signInRequest(averys.request, 'a')
    return await apiGetLayout(averys.request, layoutId)
  } finally {
    await averys.close()
  }
}

test('signing out with an unsaved edit asks first, then deletes the edit; the next person finds nothing of it', async ({ context, page }, testInfo) => {
  const { weddingName, layout, averyId } = await averyWithAnUnsavedEdit(page, testInfo, 'Shared device')

  // 1. Log out: the edit is not saved, so the sign-out asks; Avery says yes.
  let question = ''
  page.once('dialog', (dialog) => {
    question = dialog.message()
    void dialog.accept()
  })
  await page.getByTestId('user-menu').click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login/)
  expect(question).toBe('Some changes are not saved yet. Sign out anyway?')
  const names = await databaseNames(page)
  expect(names).not.toContain(`seat-plan-u-${averyId}`)
  expect(names).not.toContain(`seat-plan-rows-u-${averyId}`)
  expect(await page.evaluate(() => window.localStorage.getItem('seat-plan:clipboard'))).toBeNull()

  // 2. Blake signs in on the same browser.
  await signIn(page, 'b')
  await expect(page.getByRole('heading', { name: 'Weddings' })).toBeVisible()
  await expect(page.getByText(weddingName)).toHaveCount(0)
  expect((await page.request.get(`/api/layouts/${layout.id}`)).status()).toBe(404)
  // Avery's edit was never sent, under anyone's session.
  const stored = await serverCopy(context, layout.id)
  expect(stored.version).toBe(1)
  expect(stored.canvas.items).toEqual([])
  expect(await databaseNames(page)).not.toContain(`seat-plan-u-${averyId}`)
})

test('saying no to the sign-out question keeps Avery signed in, with the edit', async ({ page }, testInfo) => {
  const { averyId, unblock } = await averyWithAnUnsavedEdit(page, testInfo, 'Stay signed in')
  await logOut(page, 'dismiss')
  await expect(page).not.toHaveURL(/\/login/)
  expect(await databaseNames(page)).toContain(`seat-plan-u-${averyId}`)
  await unblock()
  await expectSaved(page)
})

test('a session that ends while an edit waits keeps it, and it goes out once the same person signs in again', async ({ context, page }, testInfo) => {
  const { layout, unblock } = await averyWithAnUnsavedEdit(page, testInfo, 'Session ends')

  // 3. Avery's session ends (as when it runs out); the save then meets a plain 401.
  await dbEndSessions(E2E_USERS.a.email)
  await unblock()
  await expect(page.getByTestId('save-failed-banner')).toContainText('You were signed out')
  await expect(page.getByTestId('save-failed-banner').getByRole('link', { name: 'Sign in again' })).toBeVisible()
  expect((await serverCopy(context, layout.id)).version).toBe(1)

  // Avery signs in again in another tab: the waiting edit goes out from the first tab.
  const again = await context.newPage()
  await signIn(again)
  await expectSaved(page)
  const stored = await serverCopy(context, layout.id)
  expect(stored.version).toBe(2)
  expect(stored.editedBy).toBe(E2E_USERS.a.displayName)
  expect(stored.canvas.items.map((item) => item.id)).toEqual(await tableIds(page))
})

test("when someone else signs in from another tab, Avery's tab stops and never saves under their session", async ({ context, page }, testInfo) => {
  const { layout, averyId, unblock } = await averyWithAnUnsavedEdit(page, testInfo, 'Other person')

  // 4. Avery's session has ended, and Blake signs in from a second tab of this browser.
  await dbEndSessions(E2E_USERS.a.email)
  const blakes = await context.newPage()
  await signIn(blakes, 'b')

  // Avery's tab hears it and says so.
  const notice = page.getByTestId('other-user-dialog')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Someone else signed in')
  await expect(notice).toContainText(`This page was opened for ${E2E_USERS.a.displayName}`)

  // Saves can get through again: Avery's edit goes out under Blake's cookie with Avery's id, and the server refuses it.
  await unblock()
  await expect(saveStatus(page)).toHaveAttribute('data-status', 'failed')
  await expect(saveStatus(page)).toHaveText("Couldn't save: someone else signed in")
  await expect(page.getByTestId('save-failed-banner')).toContainText(`Sign in again as ${E2E_USERS.a.displayName}`)
  // Nothing more goes out from that tab, however long it waits.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(1500)
  const stored = await serverCopy(context, layout.id)
  expect(stored.version).toBe(1)
  expect(stored.canvas.items).toEqual([])
  // The edit stays in Avery's own database, for when Avery signs in again; Blake's tab never opened it.
  expect(await databaseNames(page)).toContain(`seat-plan-u-${averyId}`)
})
