/**
 * Acceptance checks 10 and 11.
 *
 * 10: stretching a rectangle by its end handle to 24 ft and pressing Fit
 * seats gives 12 seats on a side. The Rectangle preset seats both long
 * sides, so that is 12 on each side; after switching it to one side, Fit
 * seats gives 12 in all (PLAN open question Q3: the test checks both).
 * Shrinking a round table to 36 in by a corner handle and setting 2 seats
 * makes a sweetheart table: both seats side by side on the back arc.
 *
 * 11: Shift+drag on a round table's body grows and shrinks it about its
 * center; Shift+click without moving (or moving 4 px or less) still adds to
 * or takes from the selection. Phones have no Shift: there the Select switch
 * makes taps add and remove (PLAN change 12).
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  clickWith,
  commitField,
  handleCenter,
  isPhoneLayout,
  lowerSheet,
  mouseDrag,
  openProperties,
  pointerDrag,
  readTable,
  selectedIds,
  settledCamera,
  tableClientCenter,
  Touch,
  zoomButtonsTo,
} from './canvas'
import {
  addPreset,
  addRoundTable,
  apiAddTables,
  apiCreateLayout,
  apiCreateWedding,
  apiGetLayout,
  canvasTables,
  editorPath,
  expectSaved,
  signIn,
  tableIds,
  uniqueName,
  waitForEditor,
} from './helpers'

const FOOT = 30.48

async function openBlankLayout(page: Page, testInfo: TestInfo, label: string) {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName(label, testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  await expectSaved(page)
  return { wedding, layout }
}

async function storedTable(page: Page, layoutId: string, id: string) {
  const item = (await apiGetLayout(page.request, layoutId)).canvas.items.find((i) => i.id === id)
  if (item?.kind !== 'table') throw new Error(`No table ${id} on the server`)
  return item
}

test('a rectangle stretched by its end handle to 24 ft fits 12 seats on each long side, and 12 in all on one side', async ({ page }, testInfo) => {
  const { layout } = await openBlankLayout(page, testInfo, 'Stretch')
  await addPreset(page, 'Add rectangle table')
  await expect(canvasTables(page)).toHaveCount(1)
  const [id] = await tableIds(page)
  const before = await readTable(page, id)
  expect(before).toMatchObject({ shape: 'rect', width: 243.84, height: 76.2 })
  expect(before.seats).toHaveLength(8)

  // Room for the stretch on screen: 50% on a laptop, 25% on a phone.
  const phone = await isPhoneLayout(page)
  await zoomButtonsTo(page, phone ? '25%' : '50%')
  const camera = await settledCamera(page)

  // Drag the end handle 16 ft to the right: 8 ft becomes 24 ft (snapped to the 1 ft grid).
  const from = await handleCenter(page, 'e')
  await pointerDrag(page, from, { x: from.x + 16 * FOOT * camera.zoom, y: from.y }, { steps: 16 })
  const stretched = await readTable(page, id)
  expect(stretched.width).toBeCloseTo(24 * FOOT, 1)
  expect(stretched.height).toBeCloseTo(76.2, 6)
  // The other end stayed put; the seat count did not change.
  expect(stretched.x - stretched.width / 2).toBeCloseTo(before.x - before.width / 2, 1)
  expect(stretched.seats).toHaveLength(8)

  const panel = await openProperties(page)
  await expect(panel.getByTestId('table-width')).toHaveValue('24′ 0″')
  const fit = panel.getByTestId('fit-seats')
  await expect(fit).toHaveText('Fit seats (24)')
  await fit.click()
  await expect(fit).toHaveText('Seats fit this size')
  let seats = (await readTable(page, id)).seats
  expect(seats).toHaveLength(24)
  expect(seats.filter((s) => s.cy < 0)).toHaveLength(12)
  expect(seats.filter((s) => s.cy > 0)).toHaveLength(12)

  // One side only, then Fit seats: 12 in all, along the back edge.
  await panel.getByTestId('table-sides').getByRole('radio', { name: 'One side' }).click()
  await expect(panel.getByTestId('table-sides').getByRole('radio', { name: 'One side' })).toHaveAttribute('aria-checked', 'true')
  await expect(fit).toHaveText('Fit seats (12)')
  await fit.click()
  await expect(fit).toHaveText('Seats fit this size')
  seats = (await readTable(page, id)).seats
  expect(seats).toHaveLength(12)
  expect(seats.every((s) => s.cy < 0)).toBe(true)
  expect((await readTable(page, id)).tight).toBe(false)
  await lowerSheet(page)
  await expectSaved(page)

  const stored = await storedTable(page, layout.id, id)
  expect(stored.width).toBeCloseTo(24 * FOOT, 1)
  expect(stored).toMatchObject({ seatCount: 12, seatSides: 'oneSide' })
})

test('a round table shrunk to 36 in by a corner handle, with 2 seats, is a sweetheart table', async ({ page }, testInfo) => {
  const { layout } = await openBlankLayout(page, testInfo, 'Sweetheart')
  await addRoundTable(page)
  const [id] = await tableIds(page)
  const before = await readTable(page, id)
  expect(before.width).toBeCloseTo(152.4, 6)
  const phone = await isPhoneLayout(page)

  // Placed freely here (Alt on a laptop, the Snap switch on a phone); a snapped drag reaches 36 in too.
  if (phone) {
    const panel = await openProperties(page)
    await panel.getByTestId('snap-switch').click()
    await expect(panel.getByTestId('snap-switch')).toHaveAttribute('aria-checked', 'false')
    await lowerSheet(page)
  }
  const camera = await settledCamera(page)
  // The far corner stays put; the near one moves in by 60 in less 36 in, on both axes.
  const inward = (152.4 - 91.44) * camera.zoom
  const from = await handleCenter(page, 'se')
  const to = { x: from.x - inward, y: from.y - inward }
  if (phone) await (await Touch.on(page)).drag(from, to, { steps: 12 })
  else await mouseDrag(page, from, to, { steps: 12, modifiers: ['Alt'] })
  const shrunk = await readTable(page, id)
  expect(Math.abs(shrunk.width - 91.44), `width ${shrunk.width}`).toBeLessThan(1.27)
  expect(shrunk.height).toBeCloseTo(shrunk.width, 6)

  const panel = await openProperties(page)
  await expect(panel.getByTestId('table-across')).toHaveValue('3′ 0″')
  await commitField(panel.getByTestId('table-seat-count'), '2')
  const table = await readTable(page, id)
  expect(table.seats).toHaveLength(2)
  // Side by side on the back arc, facing the room.
  const [a, b] = table.seats
  expect(a.cy).toBeLessThan(0)
  expect(b.cy).toBeLessThan(0)
  expect(Math.abs(a.cy - b.cy)).toBeLessThan(0.01)
  expect(a.cx).toBeLessThan(0)
  expect(b.cx).toBeGreaterThan(0)
  expect(Math.abs(a.cx + b.cx)).toBeLessThan(0.01)
  // Neighbors: the circles do not overlap.
  expect(b.cx - a.cx).toBeGreaterThanOrEqual(2 * table.seatRadius)
  expect(table.tight).toBe(false)
  await lowerSheet(page)
  await expectSaved(page)

  const stored = await storedTable(page, layout.id, id)
  expect(Math.abs(stored.width - 91.44)).toBeLessThan(1.27)
  expect(stored).toMatchObject({ shape: 'round', seatCount: 2 })
})

test('Shift+drag on a round table resizes it about its center; Shift+click still changes the selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'Phones have no Shift key; the Select switch test covers taps.')
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Shift drag', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  await apiAddTables(page.request, layout, 2)
  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  await expectSaved(page)
  const [first, second] = await tableIds(page)
  const camera = await settledCamera(page)
  const start = await readTable(page, first)
  const center = await tableClientCenter(page, first, camera)
  const radiusPx = (start.width / 2) * camera.zoom

  // Grow: from halfway out on the body to three quarters out. The edge follows
  // the pointer, so the radius grows by a quarter: 1.25 times as wide.
  await mouseDrag(page, { x: center.x + radiusPx * 0.5, y: center.y }, { x: center.x + radiusPx * 0.75, y: center.y }, { modifiers: ['Shift'] })
  const grown = await readTable(page, first)
  expect(Math.abs(grown.x - start.x), 'the center stays put').toBeLessThan(1)
  expect(Math.abs(grown.y - start.y), 'the center stays put').toBeLessThan(1)
  expect(Math.abs(grown.width - start.width * 1.25), `width ${grown.width}`).toBeLessThan(2)
  expect(grown.seats).toHaveLength(8)
  expect(await selectedIds(page)).toEqual([first])

  // Shrink: from 0.6 to 0.3 of the new radius, the edge coming in by 0.3 of it: 0.7 times as wide.
  const grownPx = (grown.width / 2) * camera.zoom
  await mouseDrag(page, { x: center.x, y: center.y + grownPx * 0.6 }, { x: center.x, y: center.y + grownPx * 0.3 }, { modifiers: ['Shift'] })
  const shrunk = await readTable(page, first)
  expect(Math.abs(shrunk.x - start.x)).toBeLessThan(1)
  expect(Math.abs(shrunk.y - start.y)).toBeLessThan(1)
  expect(Math.abs(shrunk.width - grown.width * 0.7), `width ${shrunk.width}`).toBeLessThan(2)
  await expectSaved(page)

  // Shift+click without moving adds and takes away; neither table changes size.
  const other = await readTable(page, second)
  const otherCenter = await tableClientCenter(page, second, camera)
  await page.mouse.click(otherCenter.x, otherCenter.y)
  expect(await selectedIds(page)).toEqual([second])
  await clickWith(page, center, ['Shift'])
  expect((await selectedIds(page)).sort()).toEqual([first, second].sort())
  await clickWith(page, otherCenter, ['Shift'])
  expect(await selectedIds(page)).toEqual([first])
  // A Shift+click that wobbles 3 px is still a click.
  await mouseDrag(page, otherCenter, { x: otherCenter.x + 3, y: otherCenter.y }, { steps: 3, modifiers: ['Shift'] })
  expect((await selectedIds(page)).sort()).toEqual([first, second].sort())
  expect((await readTable(page, second)).width).toBe(other.width)
  expect((await readTable(page, second)).x).toBe(other.x)
  expect((await readTable(page, first)).width).toBe(shrunk.width)

  const stored = await storedTable(page, layout.id, first)
  expect(stored.x).toBeCloseTo(start.x, 6)
  expect(stored.y).toBeCloseTo(start.y, 6)
  expect(stored.width).toBeCloseTo(shrunk.width, 6)
})

test('on a phone, the Select switch makes taps add to and take from the selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Phone toolbar.')
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Select taps', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  await apiAddTables(page.request, layout, 2)
  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  const [first, second] = await tableIds(page)
  const camera = await settledCamera(page)
  const touch = await Touch.on(page)
  const a = await tableClientCenter(page, first, camera)
  const b = await tableClientCenter(page, second, camera)

  await touch.tap(a)
  expect(await selectedIds(page)).toEqual([first])
  await touch.tap(b)
  expect(await selectedIds(page)).toEqual([second])

  const select = page.getByTestId('phone-select')
  await select.tap()
  await expect(select).toHaveAttribute('aria-pressed', 'true')
  await touch.tap(a)
  expect((await selectedIds(page)).sort()).toEqual([first, second].sort())
  await touch.tap(b)
  expect(await selectedIds(page)).toEqual([first])
  // Taps never resize or move anything.
  expect((await readTable(page, first)).width).toBeCloseTo(152.4, 6)
  expect((await readTable(page, second)).width).toBeCloseTo(152.4, 6)
})
