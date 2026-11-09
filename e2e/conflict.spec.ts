/**
 * Acceptance check 18: two tabs on one layout, both edit before either save
 * lands. The first save wins; the second meets the newer version and shows the
 * conflict dialog naming who changed it, with "Load their version" and "Keep
 * mine as a new copy".
 *
 * Both pages share one browser context, as two tabs of one browser do, so
 * they share the Noa / Aiden choice and the message reads "from another tab
 * or device".
 */
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import {
  addRoundTable,
  apiCreateLayout,
  apiCreateWedding,
  apiGetLayout,
  canvasTables,
  editorPath,
  expectSaved,
  holdLayoutSaves,
  presetAuthor,
  saveStatus,
  signIn,
  tableIds,
  uniqueName,
  waitForEditor,
} from './helpers'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

async function twoTabsInConflict(context: BrowserContext, page: Page, testInfo: TestInfo) {
  await presetAuthor(context, 'Aiden')
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Conflict', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan', editedBy: 'Noa' })

  const first = page
  const second = await context.newPage()
  for (const tab of [first, second]) {
    await tab.goto(editorPath(wedding.id, layout.id))
    await waitForEditor(tab)
    await expectSaved(tab)
  }

  // Both tabs edit while no save can land: the first adds two tables, the second one.
  const firstSaves = await holdLayoutSaves(first)
  const secondSaves = await holdLayoutSaves(second)
  await addRoundTable(first)
  await addRoundTable(first)
  await addRoundTable(second)
  await expect(canvasTables(first)).toHaveCount(2)
  await expect(canvasTables(second)).toHaveCount(1)
  await firstSaves.waitForHeld()
  await secondSaves.waitForHeld()
  const firstIds = await tableIds(first)
  const secondIds = await tableIds(second)
  expect(secondIds).toHaveLength(1)
  expect(firstIds).not.toContain(secondIds[0])

  // The first tab's save lands.
  await firstSaves.release()
  await expectSaved(first)

  // The second tab's save meets the newer version.
  await secondSaves.release()
  const dialog = second.getByRole('dialog', { name: 'This layout changed' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('conflict-message')).toHaveText(
    /^Aiden changed this layout from another tab or device at \d{1,2}:\d{2} (am|pm)\.$/,
  )
  // The text says plainly what each button does with the changes at stake.
  await expect(dialog.getByTestId('conflict-choice')).toHaveText(
    'Your latest changes are not saved yet. ' +
      'Load their version to drop your changes here, or keep yours as a new copy of this layout.',
  )
  await expect(saveStatus(second)).toHaveText('Not saved')
  // The dialog needs an answer: Esc does nothing.
  await second.keyboard.press('Escape')
  await expect(dialog).toBeVisible()

  // The server holds the first tab's version.
  const stored = await apiGetLayout(second.request, layout.id)
  expect(stored.version).toBe(2)
  expect(stored.editedBy).toBe('Aiden')
  expect(stored.canvas.items.map((item) => item.id)).toEqual(firstIds)

  return { wedding, layout, first, second, firstIds, secondIds, dialog }
}

test('the second save warns, and "Keep mine as a new copy" opens a copy with my table', async ({ context, page }, testInfo) => {
  const { wedding, layout, second, firstIds, secondIds, dialog } = await twoTabsInConflict(context, page, testInfo)

  await dialog.getByRole('button', { name: 'Keep mine as a new copy' }).click()
  await expect(second).toHaveURL(new RegExp(`/w/${wedding.id}/layouts/(?!${layout.id})${UUID}$`))
  await expect(dialog).toBeHidden()
  const copyId = new URL(second.url()).pathname.split('/')[4]
  await expect(second.getByTestId('layout-title')).toHaveText("Plan (Aiden's copy)")
  await waitForEditor(second)
  await expectSaved(second)
  await expect(canvasTables(second)).toHaveCount(1)
  expect(await tableIds(second)).toEqual(secondIds)

  // The copy is stored with my table; the original keeps theirs.
  const copy = await apiGetLayout(second.request, copyId)
  expect(copy.name).toBe("Plan (Aiden's copy)")
  expect(copy.canvas.items.map((item) => item.id)).toEqual(secondIds)
  const original = await apiGetLayout(second.request, layout.id)
  expect(original.version).toBe(2)
  expect(original.canvas.items.map((item) => item.id)).toEqual(firstIds)

  // Both show on the layouts list.
  await second.goto(`/w/${wedding.id}/layouts`)
  await expect(second.getByTestId('layout-card')).toHaveCount(2)
  await expect(second.locator(`[data-layout-id="${copyId}"]`).getByTestId('layout-name')).toHaveText(
    "Plan (Aiden's copy)",
  )
  await expect(second.locator(`[data-layout-id="${layout.id}"]`).getByTestId('layout-name')).toHaveText('Plan')
})

test('the second save warns, and "Load their version" shows the first tab\'s tables', async ({ context, page }, testInfo) => {
  const { layout, second, firstIds, secondIds, dialog } = await twoTabsInConflict(context, page, testInfo)

  // Before choosing, the dialog says that loading theirs drops my changes.
  await expect(dialog).toContainText('Load their version to drop your changes here')
  await dialog.getByRole('button', { name: 'Load their version' }).click()
  await expect(dialog).toBeHidden()
  await expect(canvasTables(second)).toHaveCount(2)
  expect(await tableIds(second)).toEqual(firstIds)
  // My table is dropped, as the dialog said.
  expect(await tableIds(second)).not.toContain(secondIds[0])
  await expectSaved(second)
  // Undo cannot bring my lost table back over their work.
  await expect(second.getByRole('button', { name: 'Undo' })).toBeDisabled()

  // Editing goes on from their version.
  await addRoundTable(second)
  await expect(canvasTables(second)).toHaveCount(3)
  await expectSaved(second)
  const stored = await apiGetLayout(second.request, layout.id)
  expect(stored.version).toBe(3)
  expect(stored.canvas.items.slice(0, 2).map((item) => item.id)).toEqual(firstIds)

  // Only one layout: nothing was copied.
  await second.goto(`/w/${stored.weddingId}/layouts`)
  await expect(second.getByTestId('layout-card')).toHaveCount(1)
})
