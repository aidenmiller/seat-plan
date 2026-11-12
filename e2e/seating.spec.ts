/**
 * Acceptance check 6: dragging a name from the side list onto a table seats
 * the guest, and their circle turns dark blue; unseating them turns it
 * grey. Spec section 4, "Seating guests", and PLAN section 6.
 *
 * Laptop: a mouse drag from the Guests tab onto a table; while it moves,
 * the ghost shows the name, the table where the partner sits tints green,
 * the others red, and the seat the guest would land in grows. The seated
 * guest dragged back onto the right panel goes to Unassigned. A drop on a
 * full table changes nothing and says so. Right click on a seated guest
 * opens the guest menu, whose Unseat works.
 *
 * Phone: a name held 450 ms, then dragged up onto a table (the sheet drops
 * to its strip as the drag starts); the seated guest held and dragged onto
 * the sheet goes back to Unassigned; tap a name, then a seat; the More
 * button beside a tapped guest opens the guest menu; a second finger during
 * a guest drag cancels it.
 *
 * Both: a selected table lists its guests in Properties, where a guest is
 * dragged onto another seat (a laptop) or moved with Move down (a phone).
 */
import { expect, test, type Page } from '@playwright/test'
import { isPhoneLayout, itemLocator, mouseDrag, openProperties, setMode, sheetAtRest, Touch, type Point } from './canvas'
import { expectSaved } from './helpers'
import { guestRow, openEditor, openGuestsTab, rowCenter, seatCircle, seatOnScreen, serverSeats, setupSeating, tableOnScreen, type SeatingSetup } from './seating'

const FILLERS = Array.from({ length: 8 }, (_, i) => ({ firstName: `Full${i + 1}`, lastName: 'Guest' }))

async function seatingLayout(page: Page, testInfo: Parameters<typeof setupSeating>[1]): Promise<SeatingSetup> {
  return setupSeating(page, testInfo, {
    guests: [{ firstName: 'Jane', lastName: 'Doe' }, { firstName: 'Bo', lastName: 'Ray' }, { firstName: 'Ann', lastName: 'Lee' }, ...FILLERS],
    partners: [['Jane', 'Bo']],
    tables: [
      { at: { x: 0, y: 0 } },
      { at: { x: 420, y: 0 }, guests: ['Bo'] },
      { at: { x: 0, y: 420 }, guests: FILLERS.map((f) => f.firstName) },
    ],
  })
}

/** Fingers: hold `holdMs` at `from`, move sideways a little, then on to `to` in steps, and lift unless asked not to. */
async function holdAndDrag(page: Page, from: Point, to: Point, holdMs = 650, release = true): Promise<Touch> {
  const touch = await Touch.on(page)
  await touch.down([{ ...from, id: 1 }])
  await page.waitForTimeout(holdMs)
  await touch.move([{ x: from.x + 6, y: from.y, id: 1 }])
  for (let i = 1; i <= 12; i++) {
    const f = i / 12
    await touch.move([{ x: from.x + 6 + (to.x - from.x - 6) * f, y: from.y + (to.y - from.y) * f, id: 1 }])
  }
  if (release) await touch.up()
  return touch
}

test('a name dragged from the side list onto a table takes a seat (dark blue), and dragged back to the list is unseated (grey)', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const s = await seatingLayout(page, testInfo)
  const [t1, t2, t3] = s.tables
  const jane = s.byName('Jane')
  const ann = s.byName('Ann')
  await openEditor(page, s)
  await setMode(page, 'edit')
  const phone = await isPhoneLayout(page)
  const panel = await openGuestsTab(page)
  await expect(guestRow(panel, jane.id)).toHaveAttribute('data-seated', 'false')

  // Jane's partner sits at Table 2: it is where she is dropped.
  const from = await rowCenter(guestRow(panel, jane.id))
  if (!phone) {
    const to = await tableOnScreen(page, t2)
    await mouseDrag(page, from, to, { steps: 16, release: false })
    // While dragging: the ghost, the tints and the seat that grows.
    await expect(page.getByTestId('guest-ghost')).toHaveText('Jane Doe')
    await expect(itemLocator(page, t2)).toHaveAttribute('data-drag-tint', 'good')
    await expect(itemLocator(page, t1)).toHaveAttribute('data-drag-tint', 'bad')
    await expect(itemLocator(page, t2).locator('[data-drop-target]')).toHaveAttribute('data-seat-index', '1')
    const grown = await seatOnScreen(page, t2, 1)
    const plain = await seatOnScreen(page, t2, 2)
    expect(grown.size).toBeGreaterThan(plain.size * 1.2)
    await page.mouse.up()
  } else {
    // A finger held on the name for 450 ms picks it up; the sheet drops to its strip.
    const touch = await holdAndDrag(page, from, await tableOnScreen(page, t2), 650, false)
    await expect(page.getByTestId('bottom-sheet')).toHaveAttribute('data-snap', 'strip')
    await expect(page.getByTestId('guest-ghost')).toHaveText('Jane Doe')
    await expect(itemLocator(page, t2)).toHaveAttribute('data-drag-tint', 'good')
    await touch.up()
  }
  await expect(page.getByTestId('guest-ghost')).toHaveCount(0)
  await expect(seatCircle(page, t2, 1)).toHaveAttribute('data-seat-state', 'taken')
  await expect(seatCircle(page, t2, 1)).toHaveAttribute('fill', '#1e3a8a')
  await expect(itemLocator(page, t2)).not.toHaveAttribute('data-drag-tint', /.+/)
  await expectSaved(page)
  expect((await serverSeats(page, s.layout.id))[t2][1]).toBe(jane.id)

  // Back onto the side list: unseated, the circle grey again.
  const seat = await seatOnScreen(page, t2, 1)
  if (!phone) {
    const box = (await page.getByTestId('right-panel').boundingBox())!
    await mouseDrag(page, seat, { x: box.x + box.width / 2, y: box.y + 300 }, { steps: 16 })
  } else {
    const strip = (await page.getByTestId('bottom-sheet').boundingBox())!
    await holdAndDrag(page, seat, { x: 195, y: Math.min(830, strip.y + 40) })
  }
  await expect(seatCircle(page, t2, 1)).toHaveAttribute('data-seat-state', 'empty')
  await expect(seatCircle(page, t2, 1)).toHaveAttribute('fill', '#7b879a')
  await expectSaved(page)
  expect((await serverSeats(page, s.layout.id))[t2][1]).toBeNull()
  const again = await openGuestsTab(page)
  await expect(guestRow(again, jane.id)).toHaveAttribute('data-seated', 'false')

  // A full table changes nothing and says so.
  const annFrom = await rowCenter(guestRow(again, ann.id))
  if (!phone) await mouseDrag(page, annFrom, await tableOnScreen(page, t3), { steps: 16 })
  else await holdAndDrag(page, annFrom, await tableOnScreen(page, t3))
  await expect(page.getByTestId('editor-notice')).toHaveText('Table 3 is full')
  expect((await serverSeats(page, s.layout.id))[t3]).not.toContain(ann.id)
})

test('the guest menu unseats a seated guest: right click on a laptop, the More button beside a tapped guest on a phone', async ({ page }, testInfo) => {
  const s = await seatingLayout(page, testInfo)
  const [, t2] = s.tables
  await openEditor(page, s)
  await setMode(page, 'edit')
  const phone = await isPhoneLayout(page)
  const bo = await seatOnScreen(page, t2, 0)
  if (!phone) {
    await page.mouse.click(bo.x, bo.y, { button: 'right' })
  } else {
    await (await Touch.on(page)).tap(bo)
    await expect(page.getByTestId('guest-selection')).toHaveCount(1)
    await page.getByTestId('guest-more').tap()
  }
  const menu = page.getByTestId('canvas-menu')
  await expect(menu.getByRole('menuitem', { name: 'Unseat' })).toBeVisible()
  if (phone) await menu.getByRole('menuitem', { name: 'Unseat' }).tap()
  else await menu.getByRole('menuitem', { name: 'Unseat' }).click()
  await expect(seatCircle(page, t2, 0)).toHaveAttribute('data-seat-state', 'empty')
  await expectSaved(page)
  expect((await serverSeats(page, s.layout.id))[t2][0]).toBeNull()
})

test('on a phone, a tapped name waits for a seat tap, with Cancel', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Tap a name, then a seat, is the phone way.')
  const s = await seatingLayout(page, testInfo)
  const [t1] = s.tables
  const ann = s.byName('Ann')
  await openEditor(page, s)
  await setMode(page, 'edit')
  const panel = await openGuestsTab(page)
  await guestRow(panel, ann.id).tap()
  await expect(page.getByTestId('pick-strip')).toContainText('Tap a seat for Ann L.')
  await expect(page.getByTestId('bottom-sheet')).toHaveAttribute('data-snap', 'strip')
  await sheetAtRest(page)
  await page.getByTestId('pick-cancel').tap()
  await expect(page.getByTestId('pick-strip')).toHaveCount(0)

  await (await openGuestsTab(page)).locator(`[data-guest-id="${ann.id}"]`).tap()
  await expect(page.getByTestId('pick-strip')).toBeVisible()
  await sheetAtRest(page)
  await (await Touch.on(page)).tap(await seatOnScreen(page, t1, 3))
  await expect(seatCircle(page, t1, 3)).toHaveAttribute('data-seat-state', 'taken')
  await expect(page.getByTestId('pick-strip')).toHaveCount(0)
  await expectSaved(page)
  expect((await serverSeats(page, s.layout.id))[t1][3]).toBe(ann.id)
})

test('a selected table lists its guests in Properties, and dragging one onto another seat there swaps them (one undo step)', async ({ page }, testInfo) => {
  const s = await seatingLayout(page, testInfo)
  const [t1] = s.tables
  const jane = s.byName('Jane')
  const ann = s.byName('Ann')
  await openEditor(page, s)
  await setMode(page, 'edit')
  const phone = await isPhoneLayout(page)
  // Jane in seat 1 and Ann in seat 3 of Table 1, through the + picker's action.
  for (const [guest, seat] of [
    [jane, 0],
    [ann, 2],
  ] as const) {
    const at = await seatOnScreen(page, t1, seat)
    if (phone) await (await Touch.on(page)).tap(at)
    else await page.mouse.click(at.x, at.y)
    const choice = page.getByTestId('seat-picker').locator(`[data-guest-id="${guest.id}"]`)
    if (phone) await choice.tap()
    else await choice.click()
    await expect(seatCircle(page, t1, seat)).toHaveAttribute('data-seat-state', 'taken')
  }
  await expectSaved(page)

  // Select the table by its body, then read its seats in Properties.
  const body = await tableOnScreen(page, t1)
  if (phone) await (await Touch.on(page)).tap(body)
  else await page.mouse.click(body.x, body.y)
  const panel = await openProperties(page)
  const rows = panel.getByTestId('table-guest')
  await expect(rows).toHaveCount(8)
  await expect(rows.nth(0)).toContainText('Jane Doe')
  await expect(rows.nth(1)).toContainText('Empty')
  await expect(rows.nth(2)).toContainText('Ann Lee')

  if (!phone) {
    // Drag Jane's row onto Ann's: they swap.
    await rows.nth(3).scrollIntoViewIfNeeded()
    const from = await rowCenter(rows.nth(0))
    const toBox = (await rows.nth(2).boundingBox())!
    await mouseDrag(page, from, { x: from.x, y: toBox.y + toBox.height / 2 }, { steps: 10 })
  } else {
    // A phone has the buttons: Jane down twice (first into the empty seat, then swapping with Ann).
    await rows.nth(0).getByTestId('seat-move-down').tap()
    await expect(rows.nth(1)).toContainText('Jane Doe')
    await rows.nth(1).getByTestId('seat-move-down').tap()
  }
  await expect(rows.nth(2)).toContainText('Jane Doe')
  await expect(rows.nth(phone ? 1 : 0)).toContainText('Ann Lee')
  await expectSaved(page)
  const seats = (await serverSeats(page, s.layout.id))[t1]
  expect(seats[2]).toBe(jane.id)
  expect(seats[phone ? 1 : 0]).toBe(ann.id)
  // One drop or one button press is one undo step.
  await page.keyboard.press('ControlOrMeta+z')
  if (!phone) await expect(rows.nth(0)).toContainText('Jane Doe')
})

test('on a phone, a second finger during a guest drag cancels it: nobody moves and nothing saves', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Two fingers are a phone gesture.')
  const s = await seatingLayout(page, testInfo)
  const [t1, t2] = s.tables
  const bo = s.byName('Bo')
  await openEditor(page, s)
  await setMode(page, 'edit')
  const before = await serverSeats(page, s.layout.id)
  const from = await seatOnScreen(page, t2, 0)
  const over = await seatOnScreen(page, t1, 0)
  const touch = await Touch.on(page)
  await touch.down([{ ...from, id: 1 }])
  await page.waitForTimeout(650)
  for (let i = 1; i <= 10; i++) await touch.move([{ x: from.x + ((over.x - from.x) * i) / 10, y: from.y + ((over.y - from.y) * i) / 10, id: 1 }])
  await expect(page.getByTestId('guest-ghost')).toHaveText('Bo Ray')
  // A second finger lands to pinch: the drag ends with no change.
  await touch.down([
    { ...over, id: 1 },
    { x: over.x + 80, y: over.y + 40, id: 2 },
  ])
  await expect(page.getByTestId('guest-ghost')).toHaveCount(0)
  await touch.move([
    { ...over, id: 1 },
    { x: over.x + 120, y: over.y + 60, id: 2 },
  ])
  await touch.up([{ x: over.x + 120, y: over.y + 60, id: 2 }])
  await touch.up()
  await expect(seatCircle(page, t1, 0)).toHaveAttribute('data-seat-state', 'empty')
  await expect(seatCircle(page, t2, 0)).toHaveAttribute('data-seat-state', 'taken')
  await page.waitForTimeout(500)
  expect(await serverSeats(page, s.layout.id)).toEqual(before)
  expect((await serverSeats(page, s.layout.id))[t2][0]).toBe(bo.id)
})
