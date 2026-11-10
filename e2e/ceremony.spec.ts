/**
 * Milestone 8, ceremony layouts (spec section 8; PLAN "Ceremony" and change
 * 18; DECISIONS 34), on a laptop and a phone:
 *
 *  - a ceremony layout made from the Layouts tab offers the seating block
 *    tool instead of tables; its defaults place two labelled sides of rows,
 *    numbered from the front, 20 in per chair, 36 in from row to row and a
 *    6 ft aisle;
 *  - a row reserved with a label shows it on the canvas; Add row behind adds
 *    the next row 36 in back; a row's chair count changes with the aisle end
 *    kept where it was; the Room panel counts chairs against yes;
 *  - a guest takes a chair by drag (laptop) or by tap, then tap (phone), and
 *    a together rule split by the aisle shows a problem on both rows.
 */
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import type { Canvas, ChairRow } from '../src/domain/canvas-schema'
import { emptyCanvas } from '../src/domain/canvas-schema'
import { generateSeatingBlock } from '../src/domain/ceremony'
import { chairRowLength } from '../src/domain/geometry'
import { isPhoneLayout, itemLocator, mouseDrag, openProperties, selectedIds, setMode, settledCamera, sheetAtRest, Touch, commitField, press, type Point } from './canvas'
import { apiAddGuests } from './guest-list'
import { apiCreateLayout, apiCreateWedding, apiGetLayout, apiPutCanvas, editorPath, expectSaved, presetAuthor, signIn, uniqueName } from './helpers'
import { guestRow, openGuestsTab, rowCenter, seatCircle, seatOnScreen } from './seating'

test.beforeEach(async ({ context }) => {
  await presetAuthor(context, 'Noa')
})

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

async function serverRows(page: Page, layoutId: string): Promise<ChairRow[]> {
  const layout = await apiGetLayout(page.request, layoutId)
  return layout.canvas.items.filter((i): i is ChairRow => i.kind === 'chairRow')
}

function side(rows: readonly ChairRow[], label: string): ChairRow[] {
  return rows.filter((r) => r.blockLabel === label).sort((a, b) => a.rowNumber - b.rowNumber)
}

/** A tap on a phone, a click on a laptop, at a point on the page. */
async function tapAt(page: Page, at: Point): Promise<void> {
  if (await isPhoneLayout(page)) await (await Touch.on(page)).tap(at)
  else await page.mouse.click(at.x, at.y)
}

test('a ceremony layout: the seating block tool, a reserved row, a row behind, a new chair count, and chairs against yes', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Ceremony', testInfo))
  await apiAddGuests(page.request, wedding.id, [
    { firstName: 'Ann', lastName: 'Lee', rsvp: 'yes' },
    { firstName: 'Bo', lastName: 'Ray', rsvp: 'yes' },
    { firstName: 'Cy', lastName: 'Fox', rsvp: 'pending' },
    { firstName: 'Di', lastName: 'Orr', rsvp: 'no' },
  ])

  // A ceremony layout on a blank canvas, from the Layouts tab.
  await page.goto(`/w/${wedding.id}/layouts`)
  await page.getByRole('button', { name: 'New layout' }).click()
  const dialog = page.getByRole('dialog', { name: 'New layout' })
  await dialog.getByRole('radio', { name: /^Ceremony/ }).check()
  await expect(dialog.getByLabel('3. Name')).toHaveValue('Ceremony plan')
  await dialog.getByRole('button', { name: 'Create layout' }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${wedding.id}/layouts/${UUID}$`))
  const layoutId = new URL(page.url()).pathname.split('/')[4]
  await setMode(page, 'edit')
  await expect(page.getByTestId('open-shapes').or(page.getByTestId('seating-block-tool'))).toBeEnabled({ timeout: 10_000 })
  await expectSaved(page)
  expect((await apiGetLayout(page.request, layoutId)).kind).toBe('ceremony')
  const phone = await isPhoneLayout(page)

  // The shape panel has the seating block tool and ceremony fixtures, no tables.
  if (phone) await page.getByTestId('open-shapes').click()
  const shapes = phone ? page.getByTestId('shape-drawer') : page.getByTestId('shape-panel')
  await expect(shapes.getByRole('button', { name: 'Add ceremony structure' })).toBeVisible()
  await expect(shapes.getByRole('button', { name: 'Add round table' })).toHaveCount(0)
  await press(page, shapes.getByTestId('seating-block-tool'))

  // The defaults: 8 rows of 6, a 6 ft aisle, Noa's side and Aiden's side.
  const block = page.getByTestId('seating-block-dialog')
  await expect(block.getByTestId('block-rows')).toHaveValue('8')
  await expect(block.getByTestId('block-chairs')).toHaveValue('6')
  await expect(block.getByTestId('block-aisle')).toHaveValue('6′ 0″')
  await expect(block.getByTestId('block-left')).toHaveValue("Noa's side")
  await expect(block.getByTestId('block-right')).toHaveValue("Aiden's side")
  await press(page, block.getByTestId('block-add'))
  await expect(block).toHaveCount(0)
  await expect(page.getByTestId('canvas').locator('[data-kind="chairRow"]')).toHaveCount(16)
  await expectSaved(page)

  const rows = await serverRows(page, layoutId)
  const noa = side(rows, "Noa's side")
  const aiden = side(rows, "Aiden's side")
  expect(noa.map((r) => r.rowNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  expect(aiden.map((r) => r.rowNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  for (const r of rows) {
    expect(r.chairCount).toBe(6)
    expect(r.spacing).toBeCloseTo(50.8, 3)
  }
  // Row 1 at the front, where the guests face (up the plan); 36 in from one row to the next.
  noa.forEach((r, i) => {
    expect(r.y - noa[0].y).toBeCloseTo(i * 91.44, 1)
    expect(aiden[i].y).toBeCloseTo(r.y, 3)
  })
  // Noa's side on the left, 6 ft between the inner chairs.
  const len = chairRowLength(noa[0])
  expect(aiden[0].x - len / 2 - (noa[0].x + len / 2)).toBeCloseTo(182.88, 1)
  // The front row carries the side's label; every row its number.
  await expect(itemLocator(page, noa[0].id).locator('[data-block-label]')).toHaveText("Noa's side")
  await expect(itemLocator(page, aiden[0].id).locator('[data-block-label]')).toHaveText("Aiden's side")
  await expect(itemLocator(page, noa[1].id).locator('[data-block-label]')).toHaveCount(0)
  await expect(itemLocator(page, noa[0].id).locator('[data-row-label]')).toHaveText('Row 1')
  await expect(itemLocator(page, aiden[7].id).locator('[data-row-label]')).toHaveText('Row 8')

  // Pick Noa's row 1 alone.
  await press(page, page.getByRole('button', { name: 'Fit to content' }))
  await settledCamera(page)
  await page.keyboard.press('Escape')
  await expect.poll(() => selectedIds(page)).toEqual([])
  // A row is all chairs: the first tap on one picks the row (a chair's + offers guests only once its row is selected).
  await tapAt(page, await seatOnScreen(page, noa[0].id, 5))
  await expect.poll(() => selectedIds(page)).toEqual([noa[0].id])
  await expect(page.getByTestId('seat-picker')).toHaveCount(0)

  // Reserve it with a label.
  let props = await openProperties(page)
  await expect(props.getByTestId('row-properties')).toContainText('Row 1')
  await commitField(props.getByTestId('row-reserved'), 'Family, row 1')
  await expect(itemLocator(page, noa[0].id).locator('[data-reserved-label]')).toHaveText('Family, row 1')
  await expectSaved(page)
  await expect.poll(async () => (await serverRows(page, layoutId)).find((r) => r.id === noa[0].id)?.reservedFor).toBe('Family, row 1')

  // Add row behind: row 9 on Noa's side, 36 in behind row 8, selected.
  await press(page, props.getByTestId('add-row-behind'))
  await expect(page.getByTestId('canvas').locator('[data-kind="chairRow"]')).toHaveCount(17)
  await expectSaved(page)
  const nine = side(await serverRows(page, layoutId), "Noa's side").find((r) => r.rowNumber === 9)
  expect(nine).toBeDefined()
  const row9 = nine!
  expect(row9.chairCount).toBe(6)
  expect(row9.reservedFor).toBeNull()
  expect(row9.x).toBeCloseTo(noa[7].x, 3)
  expect(row9.y - noa[7].y).toBeCloseTo(91.44, 1)
  await expect.poll(() => selectedIds(page)).toEqual([row9.id])
  await expect(itemLocator(page, row9.id).locator('[data-row-label]')).toHaveText('Row 9')

  // Its chair count goes to 8; the aisle end (the right end on Noa's side) stays put.
  props = await openProperties(page)
  await commitField(props.getByTestId('row-chair-count'), '8')
  await expect(itemLocator(page, row9.id).locator('circle[data-seat-index]')).toHaveCount(8)
  await expectSaved(page)
  await expect.poll(async () => (await serverRows(page, layoutId)).find((r) => r.id === row9.id)?.chairCount).toBe(8)
  const grown = (await serverRows(page, layoutId)).find((r) => r.id === row9.id)!
  expect(grown.seats).toHaveLength(8)
  expect(grown.x + chairRowLength(grown) / 2).toBeCloseTo(row9.x + chairRowLength(row9) / 2, 3)

  // Nothing selected: the Room panel counts chairs against yes, and the reserved ones.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Escape')
  await expect.poll(() => selectedIds(page)).toEqual([])
  props = await openProperties(page)
  const room = props.getByTestId('room-panel')
  await expect(room).toContainText('Chairs')
  await expect(room.getByTestId('room-lines').locator('li')).toHaveText(['104 chairs', '2 said yes: enough', '3 said yes or not yet: enough', '6 chairs reserved in 1 row'])
})

test('a guest takes a chair by drag or by tap, then tap, and a together rule split by the aisle shows a problem', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Ceremony seats', testInfo))
  const guests = await apiAddGuests(page.request, wedding.id, [
    { firstName: 'Jane', lastName: 'Doe', rsvp: 'yes' },
    { firstName: 'Bo', lastName: 'Ray', rsvp: 'yes' },
    { firstName: 'Ann', lastName: 'Lee', rsvp: 'yes' },
  ])
  const [jane, bo] = guests
  const created = await apiCreateLayout(page.request, wedding.id, { name: 'Ceremony', kind: 'ceremony' })
  // Two rows of 4 a side; Bo in the aisle chair of Aiden's row 1 (seat 1 there; seat 4 on Noa's side).
  const rows = generateSeatingBlock({ rows: 2, chairsPerRow: 4, origin: { x: 0, y: 0 } }, randomUUID)
  const noa1 = rows.find((r) => r.blockLabel === "Noa's side" && r.rowNumber === 1)!
  const aiden1 = rows.find((r) => r.blockLabel === "Aiden's side" && r.rowNumber === 1)!
  const items = rows.map((r) => (r.id === aiden1.id ? { ...r, seats: r.seats.map((s) => (s.index === 0 ? { ...s, guestId: bo.id } : s)) } : r))
  const canvas: Canvas = { ...emptyCanvas(), items }
  await apiPutCanvas(page.request, created, canvas)
  const rule = await page.request.post(`/api/weddings/${wedding.id}/rules`, { data: { kind: 'together', guestIds: [jane.id, bo.id] } })
  expect(rule.status(), await rule.text()).toBe(201)

  await page.goto(editorPath(wedding.id, created.id))
  await expectSaved(page)
  await setMode(page, 'edit')
  const phone = await isPhoneLayout(page)
  await press(page, page.getByRole('button', { name: 'Fit to content' }))
  await settledCamera(page)

  // Only Bo is seated by name: the together rule waits quietly.
  await expect(itemLocator(page, aiden1.id)).not.toHaveAttribute('data-problem', /.+/)
  await expect(page.getByTestId('problem-count')).toHaveCount(0)

  // Jane goes to the aisle chair of Noa's row 1, across the aisle from Bo.
  const panel = await openGuestsTab(page)
  const target = await seatOnScreen(page, noa1.id, 3)
  if (!phone) {
    await mouseDrag(page, await rowCenter(guestRow(panel, jane.id)), target, { steps: 16 })
  } else {
    await guestRow(panel, jane.id).tap()
    await expect(page.getByTestId('pick-strip')).toContainText('Tap a seat for Jane D.')
    await sheetAtRest(page)
    await (await Touch.on(page)).tap(await seatOnScreen(page, noa1.id, 3))
    await expect(page.getByTestId('pick-strip')).toHaveCount(0)
  }
  await expect(seatCircle(page, noa1.id, 3)).toHaveAttribute('data-seat-state', 'taken')
  await expectSaved(page)
  const saved = await apiGetLayout(page.request, created.id)
  const savedNoa1 = saved.canvas.items.find((i) => i.id === noa1.id) as ChairRow
  expect(savedNoa1.seats[3].guestId).toBe(jane.id)

  // The aisle splits them: two rows, so the rule shows a problem on both rows.
  await expect(itemLocator(page, noa1.id)).toHaveAttribute('data-problem', 'problem')
  await expect(itemLocator(page, aiden1.id)).toHaveAttribute('data-problem', 'problem')
  await expect(page.getByTestId('problem-count')).toHaveAttribute('data-count', '1')
})
