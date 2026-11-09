/**
 * Acceptance check 4: on a phone the editor opens in View mode, and dragging
 * on the canvas pans without moving anything. Switching to Edit allows
 * changes. On a laptop it opens in Edit mode. Each device remembers its last
 * choice (spec section 4, "Edit mode and View mode"; DECISIONS 19).
 *
 * The phone's drags are real touches (Chrome's own touch events).
 */
import { expect, test } from '@playwright/test'
import {
  editorMode,
  itemTransforms,
  lowerSheet,
  mouseDrag,
  readTable,
  setMode,
  settledCamera,
  tableClientCenter,
  Touch,
} from './canvas'
import {
  addRoundTable,
  apiAddTables,
  apiCreateLayout,
  apiCreateWedding,
  apiGetLayout,
  canvasTables,
  editorPath,
  expectSaved,
  presetAuthor,
  signIn,
  tableIds,
  uniqueName,
  waitForEditor,
} from './helpers'

test('a phone opens in View, a drag pans and moves nothing, and Edit allows adding and moving', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Phone behavior; the laptop test is below.')
  await presetAuthor(context, 'Aiden')
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Modes', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  const saved = await apiAddTables(page.request, layout, 2)

  await page.goto(editorPath(wedding.id, layout.id))
  expect(await editorMode(page)).toBe('view')
  const modeSwitch = page.getByTestId('mode-switch')
  await expect(modeSwitch).toHaveAttribute('aria-checked', 'false')
  await expect(canvasTables(page)).toHaveCount(2)
  // View mode: no shape panel button, no edit tools.
  await expect(page.getByTestId('open-shapes')).toHaveCount(0)
  await expect(page.getByTestId('canvas-toolbar')).toHaveCount(0)
  await expectSaved(page)

  const [first, second] = await tableIds(page)
  const before = await itemTransforms(page)
  const camera = await settledCamera(page)

  // One finger dragged across a table pans the view; nothing moves on the plan.
  const touch = await Touch.on(page)
  const start = await tableClientCenter(page, first, camera)
  await touch.drag(start, { x: start.x + 90, y: start.y + 70 }, { steps: 12 })
  const panned = await settledCamera(page)
  expect(panned.zoom).toBeCloseTo(camera.zoom, 6)
  expect(panned.x).toBeCloseTo(camera.x + 90, 1)
  expect(panned.y).toBeCloseTo(camera.y + 70, 1)
  expect(await itemTransforms(page)).toEqual(before)

  // A tap on a table lists its seats, read only, and shows no handles or seat buttons.
  await touch.tap(await tableClientCenter(page, second, panned))
  await expect(page.getByTestId('table-seats')).toBeVisible()
  await expect(page.getByTestId('table-seats')).toContainText('0 of 8 seats taken')
  await expect(page.getByTestId('handle-e')).toHaveCount(0)
  await expect(page.getByTestId('seat-plus')).toHaveCount(0)
  await lowerSheet(page)
  expect(await itemTransforms(page)).toEqual(before)
  expect((await apiGetLayout(page.request, layout.id)).version).toBe(saved.version)

  // Edit: the Shapes button adds a table, and one finger moves the selected table.
  await setMode(page, 'edit')
  await expect(modeSwitch).toHaveAttribute('aria-checked', 'true')
  await waitForEditor(page)
  await addRoundTable(page)
  await expect(canvasTables(page)).toHaveCount(3)
  const added = (await tableIds(page)).find((id) => id !== first && id !== second)!
  expect((await readTable(page, added)).selected).toBe(true)
  await expectSaved(page)

  const cameraBeforeMove = await settledCamera(page)
  const from = await readTable(page, added)
  const at = await tableClientCenter(page, added, cameraBeforeMove)
  const dx = 4 * 30.48 * cameraBeforeMove.zoom
  await touch.drag(at, { x: at.x + dx, y: at.y }, { steps: 12 })
  const to = await readTable(page, added)
  expect(to.x - from.x, 'the table moved about 4 ft right').toBeGreaterThan(4 * 30.48 - 31)
  expect(to.x - from.x).toBeLessThan(4 * 30.48 + 31)
  expect(Math.abs(to.y - from.y)).toBeLessThan(31)
  expect(await settledCamera(page)).toEqual(cameraBeforeMove)
  const others = await itemTransforms(page)
  expect(others[first]).toBe(before[first])
  expect(others[second]).toBe(before[second])
  await expectSaved(page)
  const stored = (await apiGetLayout(page.request, layout.id)).canvas.items.find((item) => item.id === added)!
  expect(stored.x).toBeCloseTo(to.x, 6)

  // The phone remembers Edit, then View.
  await page.reload()
  expect(await editorMode(page)).toBe('edit')
  await setMode(page, 'view')
  await page.reload()
  expect(await editorMode(page)).toBe('view')
  await expect(modeSwitch).toHaveAttribute('aria-checked', 'false')
})

test('a laptop opens in Edit; View hides the tools, pans on drag and refuses changes; the choice is remembered', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Laptop behavior; the phone test is above.')
  await presetAuthor(context, 'Noa')
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Modes', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  const saved = await apiAddTables(page.request, layout, 2)

  await page.goto(editorPath(wedding.id, layout.id))
  expect(await editorMode(page)).toBe('edit')
  const modes = page.getByRole('group', { name: 'Mode' })
  await expect(modes.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('shape-panel')).toBeVisible()
  await waitForEditor(page)
  await expectSaved(page)
  const [first] = await tableIds(page)

  // View: no shape panel or edit tools; a drag on a table pans.
  await setMode(page, 'view')
  await expect(modes.getByRole('button', { name: 'View' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('shape-panel')).toHaveCount(0)
  await expect(page.getByTestId('canvas-toolbar')).toHaveCount(0)
  const before = await itemTransforms(page)
  const camera = await settledCamera(page)
  const start = await tableClientCenter(page, first, camera)
  await mouseDrag(page, start, { x: start.x + 120, y: start.y + 80 })
  const panned = await settledCamera(page)
  expect(panned.x).toBeCloseTo(camera.x + 120, 1)
  expect(panned.y).toBeCloseTo(camera.y + 80, 1)
  expect(await itemTransforms(page)).toEqual(before)

  // A click still selects (to list the table), but Delete changes nothing.
  await page.mouse.click(start.x + 120, start.y + 80)
  await expect(page.getByTestId('table-seats')).toBeVisible()
  await expect(page.getByTestId('handle-e')).toHaveCount(0)
  await page.keyboard.press('Delete')
  await expect(page.getByTestId('editor-notice')).toHaveText('Switch to Edit to change the plan.')
  await expect(canvasTables(page)).toHaveCount(2)
  expect(await itemTransforms(page)).toEqual(before)
  expect((await apiGetLayout(page.request, layout.id)).version).toBe(saved.version)

  // Remembered on this device.
  await page.reload()
  expect(await editorMode(page)).toBe('view')

  // Edit again: the same drag moves the table.
  await setMode(page, 'edit')
  await waitForEditor(page)
  const from = await readTable(page, first)
  const at = await tableClientCenter(page, first)
  await mouseDrag(page, at, { x: at.x + 3 * 30.48 * panned.zoom, y: at.y })
  const to = await readTable(page, first)
  expect(to.x - from.x).toBeGreaterThan(3 * 30.48 - 31)
  expect(to.x - from.x).toBeLessThan(3 * 30.48 + 31)
  await expectSaved(page)
  expect((await apiGetLayout(page.request, layout.id)).version).toBe(saved.version + 1)
  await page.reload()
  expect(await editorMode(page)).toBe('edit')
})
