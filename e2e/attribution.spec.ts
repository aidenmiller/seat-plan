/**
 * Who made a change comes from the signed-in account, never from a choice on
 * the device: a save shows as "Edited just now by <name>" on the layouts
 * list; another planner's save loads in an open tab as "Loaded <name>'s
 * changes"; the same account in two tabs meets its own save as "You changed
 * this layout in another tab or on another device"; and a new note carries
 * its maker's initial and "Added by <name>".
 *
 * Avery (A) plans every wedding here; Blake (B) is made a member of one
 * through the database (e2e/db.ts) and saves from a browser of their own.
 */
import { expect, test, type Page } from '@playwright/test'
import { isPhoneLayout, openProperties, Touch, viewport, type Point } from './canvas'
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
  holdLayoutSaves,
  signIn,
  signInRequest,
  uniqueName,
  waitForEditor,
} from './helpers'

const A = E2E_USERS.a.displayName
const B = E2E_USERS.b.displayName

/** A tap on phones, a click elsewhere, at a page point. */
async function tapAt(page: Page, at: Point): Promise<void> {
  if (await isPhoneLayout(page)) await (await Touch.on(page)).tap(at)
  else await page.mouse.click(at.x, at.y)
}

/** Arms the Sticky note tool: the shape panel on a laptop, the Shapes drawer on a phone. */
async function armSticky(page: Page): Promise<void> {
  if (await isPhoneLayout(page)) {
    await page.getByTestId('open-shapes').tap()
    const drawer = page.getByTestId('shape-drawer')
    await drawer.getByRole('button', { name: 'Sticky note', exact: true }).tap()
    await expect(drawer).toBeHidden()
  } else {
    await page.getByTestId('shape-panel').getByRole('button', { name: 'Sticky note', exact: true }).click()
  }
  await expect(page.getByTestId('note-tool-hint')).toBeVisible()
}

test('a save shows the signed-in planner on the layouts list, with no device choice to make', async ({ page }, testInfo) => {
  await signIn(page)
  // No Noa / Aiden switch and no "Who is using this device?" question anywhere.
  await expect(page.getByRole('group', { name: 'Who is using this device' })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Who is using this device?' })).toHaveCount(0)

  const wedding = await apiCreateWedding(page.request, uniqueName('Attribution', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  await page.goto(`/w/${wedding.id}/layouts`)
  const card = page.locator(`[data-layout-id="${layout.id}"]`)
  await expect(card.getByTestId('layout-edited')).toHaveText(`Edited just now by ${A}`)

  await card.getByRole('link', { name: 'Open Plan' }).click()
  await waitForEditor(page)
  await addRoundTable(page)
  await expectSaved(page)
  await page.getByRole('link', { name: 'Back to layouts' }).click()
  await expect(card.getByTestId('layout-edited')).toHaveText(`Edited just now by ${A}`)

  const stored = await apiGetLayout(page.request, layout.id)
  expect(stored).toMatchObject({ editedBy: A, version: 2 })
  expect(stored.editedById).toMatch(/^[0-9a-f-]{36}$/)
})

test("another planner's save loads in an open tab with their name", async ({ browser, page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Loaded', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  await expectSaved(page)

  // Blake plans this wedding too, and saves a table from their own browser.
  await dbAddMember(wedding.id, E2E_USERS.b.email)
  const blakes = await browser.newContext()
  try {
    await signInRequest(blakes.request, 'b')
    await apiAddTables(blakes.request, layout, 1)
  } finally {
    await blakes.close()
  }

  // Avery's tab regains focus with nothing unsaved: Blake's version loads, named.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByTestId('editor-notice')).toHaveText(`Loaded ${B}'s changes`)
  await expect(canvasTables(page)).toHaveCount(1)
  const stored = await apiGetLayout(page.request, layout.id)
  expect(stored).toMatchObject({ version: 2, editedBy: B })
})

test('the same planner in two tabs meets their own save as "You changed this layout…"', async ({ context, page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('You', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  const second = await context.newPage()
  for (const tab of [page, second]) {
    await tab.goto(editorPath(wedding.id, layout.id))
    await waitForEditor(tab)
    await expectSaved(tab)
  }
  const held = await holdLayoutSaves(second)
  await addRoundTable(second)
  await held.waitForHeld()
  await addRoundTable(page)
  await expectSaved(page)
  await held.release()

  const dialog = second.getByRole('dialog', { name: 'This layout changed' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('conflict-message')).toHaveText(
    /^You changed this layout in another tab or on another device at \d{1,2}:\d{2} (am|pm)\.$/,
  )
})

test("a new note shows its maker's initial and \"Added by\" their name", async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Note author', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)

  await armSticky(page)
  const box = (await viewport(page).boundingBox())!
  const spot = { x: box.x + box.width / 2, y: box.y + box.height / 3 }
  await tapAt(page, spot)
  const sticky = page.getByTestId('canvas').locator('[data-kind="note"][data-note-type="sticky"]')
  await expect(sticky).toHaveCount(1)
  const editor = page.getByTestId('note-editor')
  await expect(editor).toBeFocused()
  await page.keyboard.type('Flowers by the door')
  if (await isPhoneLayout(page)) await tapAt(page, { x: spot.x, y: spot.y + 200 })
  else await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(sticky.locator('[data-note-author]')).toHaveText(A[0]!)
  await expectSaved(page)

  // Its details name who added it.
  await tapAt(page, (await sticky.boundingBox().then((b) => ({ x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 }))))
  const properties = await openProperties(page)
  await expect(properties.getByTestId('note-added')).toContainText(`Added by ${A}`)

  const id = (await sticky.getAttribute('data-item-id'))!
  const stored = (await apiGetLayout(page.request, layout.id)).canvas.items.find((item) => item.id === id)
  expect(stored).toMatchObject({ kind: 'note', author: A })
  expect((stored as { authorId?: string }).authorId).toMatch(/^[0-9a-f-]{36}$/)
})
