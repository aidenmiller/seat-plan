/**
 * The canvas menu (spec section 4, "Phones and desktops"; PLAN section 6,
 * "Selection"; PLAN change 14). Right click on a desktop and a long press on
 * a phone open it, and the More button beside every selection opens the
 * same menu on both. For a table it offers Fit seats, Lock, Copy, Duplicate
 * and Delete (phones also get Details).
 *
 * Linux Chromium sends contextmenu while the right button is still down, as
 * macOS does, so the desktop test also covers that order: the menu opens,
 * and the release that follows is no click.
 */
import { randomUUID } from 'node:crypto'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { emptyCanvas, type Canvas } from '../src/domain/canvas-schema'
import { makeItem } from '../src/domain/presets'
import { isPhoneLayout, itemPlace, readTable, selectedIds, settledCamera, tableClientCenter, Touch, clientToWorld, type Point } from './canvas'
import {
  apiCreateLayout,
  apiCreateWedding,
  apiGetLayout,
  apiPutCanvas,
  canvasTables,
  editorPath,
  expectSaved,
  presetAuthor,
  signIn,
  tableIds,
  uniqueName,
  waitForEditor,
} from './helpers'

const FOOT = 30.48
const TABLE_ITEMS = ['Fit seats', 'Lock', 'Copy', 'Duplicate', 'Delete']

/** A wedding and a layout holding round tables at these centers (cm), open in Edit mode. */
async function openWithTables(page: Page, testInfo: TestInfo, label: string, centers: Point[]) {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName(label, testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  let canvas: Canvas = emptyCanvas()
  const ids: string[] = []
  for (const c of centers) {
    const id = randomUUID()
    ids.push(id)
    canvas = { ...canvas, items: [...canvas.items, makeItem('round', c, id, canvas)] }
  }
  await apiPutCanvas(page.request, layout, canvas)
  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  await expectSaved(page)
  return { wedding, layout, ids }
}

function menu(page: Page) {
  return page.getByTestId('canvas-menu')
}

async function menuLabels(page: Page): Promise<string[]> {
  await expect(menu(page)).toBeVisible()
  return menu(page).getByRole('menuitem').allTextContents()
}

/** Every menu item is a 44 px tap target at least. */
async function expectTallItems(page: Page): Promise<void> {
  for (const item of await menu(page).getByRole('menuitem').all()) {
    const box = (await item.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
}

test('right click on a table opens its menu: Fit seats, Lock, Copy, Duplicate, Delete, and each works', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'Right click; phones use a long press and the More button (below).')
  await presetAuthor(context, 'Noa')
  const { layout, ids } = await openWithTables(page, testInfo, 'Menu', [{ x: 0, y: 0 }])
  const [id] = ids
  const camera = await settledCamera(page)
  const at = await tableClientCenter(page, id, camera)

  // Nothing selected; a right click selects the table and opens its menu where the pointer is.
  expect(await selectedIds(page)).toEqual([])
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await expect(menu(page)).toHaveAttribute('aria-label', 'Table menu')
  expect(await menuLabels(page)).toEqual(TABLE_ITEMS)
  await expectTallItems(page)
  const box = (await menu(page).boundingBox())!
  expect(Math.abs(box.x - at.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(box.y - at.y)).toBeLessThanOrEqual(1)
  // The release of the right button was no click: the menu stays and the table stays selected.
  expect(await selectedIds(page)).toEqual([id])
  await expect(menu(page).getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu(page)).toBeHidden()
  expect(await selectedIds(page)).toEqual([id])

  // Duplicate: Table 2, selected.
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await menu(page).getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(menu(page)).toBeHidden()
  await expect(canvasTables(page)).toHaveCount(2)
  const copy = (await tableIds(page)).find((t) => t !== id)!
  expect(await selectedIds(page)).toEqual([copy])
  expect((await readTable(page, copy)).name).toBe('Table 2')
  // The copy lands one grid step off the original; three big nudges move it clear.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
  expect((await itemPlace(page, copy)).x).toBeCloseTo(16 * FOOT, 6)

  // Copy, then Paste from the empty-canvas menu: the copy lands where the menu opened.
  await page.mouse.click(at.x, at.y, { button: 'right' })
  expect(await selectedIds(page)).toEqual([id])
  await menu(page).getByRole('menuitem', { name: 'Copy' }).click()
  const view = (await page.getByTestId('editor-viewport').boundingBox())!
  const empty = { x: view.x + 80, y: view.y + view.height - 120 }
  await page.mouse.click(empty.x, empty.y, { button: 'right' })
  await expect(menu(page)).toHaveAttribute('aria-label', 'Canvas menu')
  expect(await menuLabels(page)).toEqual(['Paste', 'Select all', 'Fit to content'])
  await menu(page).getByRole('menuitem', { name: 'Paste' }).click()
  await expect(canvasTables(page)).toHaveCount(3)
  const pasted = (await tableIds(page)).find((t) => t !== id && t !== copy)!
  const want = await clientToWorld(page, empty, camera)
  const place = await itemPlace(page, pasted)
  expect(Math.abs(place.x - want.x)).toBeLessThanOrEqual(FOOT / 2 + 0.01)
  expect(Math.abs(place.y - want.y)).toBeLessThanOrEqual(FOOT / 2 + 0.01)

  // Lock, then the menu offers Unlock and its Delete is off; unlocked, Delete removes it.
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await menu(page).getByRole('menuitem', { name: 'Lock' }).click()
  expect((await readTable(page, id)).locked).toBe(true)
  await page.mouse.click(at.x, at.y, { button: 'right' })
  expect(await menuLabels(page)).toEqual(['Fit seats', 'Unlock', 'Copy', 'Duplicate', 'Delete'])
  await expect(menu(page).getByRole('menuitem', { name: 'Delete' })).toBeDisabled()
  await menu(page).getByRole('menuitem', { name: 'Unlock' }).click()
  expect((await readTable(page, id)).locked).toBe(false)
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await menu(page).getByRole('menuitem', { name: 'Delete' }).click()
  await expect(canvasTables(page)).toHaveCount(2)
  expect(await tableIds(page)).not.toContain(id)

  await expectSaved(page)
  const stored = (await apiGetLayout(page.request, layout.id)).canvas.items.map((i) => i.id).sort()
  expect(stored).toEqual([copy, pasted].sort())
})

test('the More button beside a selected table opens the same menu as right click or a long press', async ({ context, page }, testInfo) => {
  await presetAuthor(context, 'Noa')
  const { layout, ids } = await openWithTables(page, testInfo, 'More', [{ x: 0, y: 0 }])
  const [id] = ids
  const phone = await isPhoneLayout(page)
  const camera = await settledCamera(page)
  const at = await tableClientCenter(page, id, camera)
  const touch = phone ? await Touch.on(page) : null

  // Select the table, then open its menu the device's own way.
  if (touch) await touch.tap(at)
  else await page.mouse.click(at.x, at.y)
  expect(await selectedIds(page)).toEqual([id])
  const more = page.getByTestId('selection-more')
  await expect(more).toBeVisible()
  const moreBox = (await more.boundingBox())!
  expect(moreBox.width).toBeGreaterThanOrEqual(44)
  expect(moreBox.height).toBeGreaterThanOrEqual(44)
  await expect(more).toHaveAccessibleName('More')

  if (touch) await touch.longPress(at)
  else await page.mouse.click(at.x, at.y, { button: 'right' })
  await expect(menu(page)).toHaveAttribute('aria-label', 'Table menu')
  const fromPointer = await menuLabels(page)
  expect(fromPointer).toEqual(phone ? ['Details', ...TABLE_ITEMS] : TABLE_ITEMS)
  await page.keyboard.press('Escape')
  await expect(menu(page)).toBeHidden()
  expect(await selectedIds(page)).toEqual([id])

  // More: the same menu, opening below the button's left edge.
  if (touch) await more.tap()
  else await more.click()
  await expect(menu(page)).toHaveAttribute('aria-label', 'Table menu')
  expect(await menuLabels(page)).toEqual(fromPointer)
  await expectTallItems(page)
  // On screen, starting at the button's bottom left corner: flipped to end there when it would run off the right.
  const box = (await menu(page).boundingBox())!
  const screen = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(screen.width)
  expect(box.y + box.height).toBeLessThanOrEqual(screen.height)
  const startsThere = Math.abs(box.x - moreBox.x) <= 1
  const endsThere = Math.abs(box.x + box.width - moreBox.x) <= 1
  expect(startsThere || endsThere, `menu x ${box.x}..${box.x + box.width}, button left ${moreBox.x}`).toBe(true)
  expect(endsThere).toBe(moreBox.x + box.width > screen.width - 8)
  const below = moreBox.y + moreBox.height
  if (below + box.height <= screen.height - 8) expect(Math.abs(box.y - below)).toBeLessThanOrEqual(1)
  else expect(Math.abs(box.y + box.height - (screen.height - 8))).toBeLessThanOrEqual(1)

  // Its Duplicate works like the right click one.
  const duplicate = menu(page).getByRole('menuitem', { name: 'Duplicate' })
  if (touch) await duplicate.tap()
  else await duplicate.click()
  await expect(menu(page)).toBeHidden()
  await expect(canvasTables(page)).toHaveCount(2)
  const copy = (await tableIds(page)).find((t) => t !== id)!
  expect(await selectedIds(page)).toEqual([copy])
  await expectSaved(page)
  expect((await apiGetLayout(page.request, layout.id)).canvas.items).toHaveLength(2)
})
