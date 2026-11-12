/**
 * Acceptance check 7: pressing + on an 8-seat round table gives 9 evenly
 * spaced circles. And check 12: setting a table to 12 seats spaces 12 seats
 * evenly, and dropping a table with 10 guests seated to 8 seats asks before
 * unseating 2, naming them with their seats.
 *
 * Spacing is measured from where the browser draws each seat circle: the
 * angle between neighbors around the table's center is 360/n within 0.5
 * degrees, every circle the same size and distance from the center.
 *
 * Also: − on a round table with one empty seat takes that seat out and
 * keeps every guest near their place, in the same order (DECISIONS 9 and
 * 63), and on a phone the + and − beside a table near the bottom of the
 * canvas stay above the bottom sheet, where a finger can reach them.
 */
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { emptyCanvas, type Canvas, type Table } from '../src/domain/canvas-schema'
import { makeItem } from '../src/domain/presets'
import {
  commitField,
  expectEvenlySpaced,
  isPhoneLayout,
  lowerSheet,
  openProperties,
  press,
  readTable,
  selectedIds,
  settledCamera,
  tableClientCenter,
  Touch,
  viewport,
  type Point,
} from './canvas'
import { dbAddGuests } from './db'
import { openEditor, serverSeats, setupSeating } from './seating'
import {
  addRoundTable,
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

const EMPTY_SEAT = '#7b879a'

test('+ on an 8-seat round table gives 9 evenly spaced seats, and a count of 12 spaces 12 evenly', async ({ context, page }, testInfo) => {
  await presetAuthor(context, 'Noa')
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Seat count', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  await expectSaved(page)

  await addRoundTable(page)
  await expect(canvasTables(page)).toHaveCount(1)
  const [id] = await tableIds(page)
  const table = page.getByTestId('canvas').locator(`[data-item-id="${id}"]`)
  const seats = table.locator('circle[data-seat-index]')
  await expect(seats).toHaveCount(8)
  await expectEvenlySpaced(page, id, 8)
  expect((await readTable(page, id)).selected).toBe(true)

  // The + beside the selected table: 9 seats, evenly spaced, all empty and grey.
  const plus = page.getByTestId('seat-plus')
  await expect(plus).toBeVisible()
  const plusBox = await plus.boundingBox()
  expect(plusBox!.width).toBeGreaterThanOrEqual(44)
  expect(plusBox!.height).toBeGreaterThanOrEqual(44)
  await press(page, plus)
  await expect(seats).toHaveCount(9)
  await expectEvenlySpaced(page, id, 9)
  await expect(table.locator('[data-seat-count]')).toHaveText('0/9')
  for (const fill of await seats.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('fill')))) expect(fill).toBe(EMPTY_SEAT)
  // 9 seats on a 60 in round get less than 22 in of edge each: outlined in yellow, never blocked.
  expect((await readTable(page, id)).tight).toBe(true)
  await expectSaved(page)

  // The seat count field: 12 seats, evenly spaced.
  const panel = await openProperties(page)
  const count = panel.getByTestId('table-seat-count')
  await expect(count).toHaveValue('9')
  await expect(panel.getByTestId('tight-reason')).toBeVisible()
  await commitField(count, '12')
  await expect(seats).toHaveCount(12)
  await expect(count).toHaveValue('12')
  await expectEvenlySpaced(page, id, 12)
  await expect(table.locator('[data-seat-count]')).toHaveText('0/12')
  await lowerSheet(page)
  await expectSaved(page)

  const stored = (await apiGetLayout(page.request, layout.id)).canvas.items.find((item) => item.id === id)
  expect(stored).toMatchObject({ kind: 'table', shape: 'round', seatCount: 12 })
  if (stored?.kind !== 'table') throw new Error('not a table')
  expect(stored.seats).toHaveLength(12)
  expect(stored.seats.every((seat) => seat.guestId === null)).toBe(true)
})

/** A seat's place around its table, in degrees clockwise from straight up, from where the browser draws it. */
function seatAngle(seat: Point): number {
  return ((Math.atan2(seat.x, -seat.y) * 180) / Math.PI + 360) % 360
}

function turnBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Selects a table the device's way: a tap on a phone, a click on a laptop. */
async function selectTable(page: Page, id: string): Promise<void> {
  const at = await tableClientCenter(page, id)
  if (await isPhoneLayout(page)) await (await Touch.on(page)).tap(at)
  else await page.mouse.click(at.x, at.y)
  expect(await selectedIds(page)).toEqual([id])
}

test('− on an 8-seat round table with one empty seat takes that seat and keeps every guest on their side, in order', async ({ context, page }, testInfo) => {
  await presetAuthor(context, 'Noa')
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Minus', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  // Seven guests at each table, seated through the layout API. The empty seat is
  // the top one (seat 1) at the first table and seat 2 at the second.
  const emptySeat = [0, 1]
  const guests = await dbAddGuests(
    wedding.id,
    Array.from({ length: 14 }, (_, i) => [`Guest${i + 1}`, `Minus${i + 1}`] as const),
  )
  let canvas: Canvas = emptyCanvas()
  const ids = emptySeat.map(() => randomUUID())
  ids.forEach((id, t) => {
    const table = makeItem('round', { x: t * 15 * 30.48, y: 0 }, id, canvas) as Table
    const mine = guests.slice(t * 7, t * 7 + 7)
    let next = 0
    const seats = table.seats.map((s, i) => (i === emptySeat[t] ? s : { ...s, guestId: mine[next++] }))
    canvas = { ...canvas, items: [...canvas.items, { ...table, seats }] }
  })
  const saved = await apiPutCanvas(page.request, layout, canvas)

  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  await expectSaved(page)

  let version = saved.version
  for (const [t, id] of ids.entries()) {
    const table = page.getByTestId('canvas').locator(`[data-item-id="${id}"]`)
    await expect(table.locator('[data-seat-state="taken"]')).toHaveCount(7)
    await expect(table.locator('[data-seat-count]')).toHaveText('7/8')
    const before = await readTable(page, id)
    const guestAt = (canvas.items.find((i) => i.id === id) as Table).seats.map((s) => s.guestId)
    expect(before.seats.map((s) => s.state)).toEqual(guestAt.map((g) => (g === null ? 'empty' : 'taken')))
    const angleBefore = new Map<string, number>()
    before.seats.forEach((s) => {
      const g = guestAt[s.index]
      if (g) angleBefore.set(g, seatAngle({ x: s.cx, y: s.cy }))
    })

    await selectTable(page, id)
    // Every seat but one is taken, so − asks nothing: the empty seat goes.
    await press(page, page.getByTestId('seat-minus'))
    await expect(page.getByTestId('unseat-list')).toHaveCount(0)
    await expect(table.locator('circle[data-seat-index]')).toHaveCount(7)
    await expect(table.locator('[data-seat-state="taken"]')).toHaveCount(7)
    await expect(table.locator('[data-seat-count]')).toHaveText('7/7')
    await expectEvenlySpaced(page, id, 7)
    await expectSaved(page)

    const stored = await apiGetLayout(page.request, layout.id)
    expect(stored.version).toBe(version + 1)
    version = stored.version
    const after = stored.canvas.items.find((i) => i.id === id) as Table
    expect(after.seatCount).toBe(7)
    const order = after.seats.map((s) => s.guestId)
    expect(order.every((g) => g !== null)).toBe(true)
    // Nobody was unseated, and the order round the table is the same: everyone keeps both neighbors.
    const was = guestAt.filter((g): g is string => g !== null)
    expect([...order].sort()).toEqual([...was].sort())
    const shift = order.indexOf(was[0])
    expect(order.map((_, k) => order[(shift + k) % order.length])).toEqual(was)
    // Each guest moves at most one seat step (45°) round the table, never across it.
    const drawn = await readTable(page, id)
    for (const s of drawn.seats) {
      const g = order[s.index]!
      const turn = turnBetween(seatAngle({ x: s.cx, y: s.cy }), angleBefore.get(g)!)
      expect(turn, `table ${t + 1}: the guest from the old seat ${guestAt.indexOf(g) + 1} turned ${turn.toFixed(1)}°`).toBeLessThanOrEqual(45 + 0.5)
    }
    await lowerSheet(page)
  }
})

test('on a phone, + and − beside a table near the bottom of the canvas sit above the bottom sheet and work', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'The bottom sheet is the phone layout.')
  await presetAuthor(context, 'Noa')
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Seat buttons', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  const id = randomUUID()
  const canvas = emptyCanvas()
  await apiPutCanvas(page.request, layout, { ...canvas, items: [makeItem('round', { x: 0, y: 0 }, id, canvas)] })
  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  await expectSaved(page)
  await press(page, page.getByRole('button', { name: 'Zoom to 100%', exact: true }))
  await expect(page.getByTestId('zoom-level')).toHaveText('100%')

  const sheet = page.getByTestId('bottom-sheet')
  await expect(sheet).toHaveAttribute('data-snap', 'strip')
  const view = (await viewport(page).boundingBox())!
  const touch = await Touch.on(page)
  const seats = page.getByTestId('canvas').locator(`[data-item-id="${id}"] circle[data-seat-index]`)
  let count = 8

  // The table's center just above the sheet's strip, then half under it.
  for (const aboveSheet of [40, -20]) {
    const sheetTop = (await sheet.boundingBox())!.y
    const camera = await settledCamera(page)
    const center = await tableClientCenter(page, id, camera)
    // One finger on empty canvas, left of the table, pans the view.
    const from = { x: view.x + 24, y: view.y + 140 }
    const dy = sheetTop - aboveSheet - center.y
    await touch.drag(from, { x: from.x, y: from.y + dy }, { steps: 12 })
    const panned = await settledCamera(page)
    expect(Math.abs(panned.y - (camera.y + dy))).toBeLessThan(1.5)
    const at = await tableClientCenter(page, id, panned)
    expect(Math.abs(at.y - (sheetTop - aboveSheet))).toBeLessThan(2)
    // Tap a part of the table clear of the sheet and the zoom controls (bottom right).
    const zoom = (await page.getByTestId('zoom-controls').boundingBox())!
    await touch.tap({ x: Math.min(at.x, zoom.x - 16), y: Math.min(at.y, sheetTop - 30) })
    expect(await selectedIds(page)).toEqual([id])

    for (const testId of ['seat-plus', 'seat-minus', 'selection-more']) {
      const button = page.getByTestId(testId)
      await expect(button).toBeVisible()
      const box = (await button.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
      // Wholly on screen, inside the canvas and clear of the sheet's strip.
      expect(box.x).toBeGreaterThanOrEqual(view.x)
      expect(box.x + box.width).toBeLessThanOrEqual(view.x + view.width)
      expect(box.y).toBeGreaterThanOrEqual(view.y)
      expect(box.y + box.height, `${testId} ends above the sheet`).toBeLessThanOrEqual(sheetTop)
      // Nothing covers it: the topmost element at its center is the button itself.
      const hit = await page.evaluate(
        ({ x, y, testId }) => {
          const el = document.elementFromPoint(x, y)
          return el?.closest(`[data-testid="${testId}"]`) !== null && el !== null
        },
        { x: box.x + box.width / 2, y: box.y + box.height / 2, testId },
      )
      expect(hit, `${testId} is the topmost element at its center`).toBe(true)
    }

    // A real tap on each works.
    await page.getByTestId('seat-plus').tap()
    await expect(seats).toHaveCount(++count)
    await page.getByTestId('seat-minus').tap()
    await page.getByTestId('seat-minus').tap()
    count -= 2
    await expect(seats).toHaveCount(count)
    await expect(sheet).toHaveAttribute('data-snap', 'strip')
  }
  await expectSaved(page)
  const stored = (await apiGetLayout(page.request, layout.id)).canvas.items.find((i) => i.id === id) as Table
  expect(stored.seatCount).toBe(count)
})

test('a table of 12 with 10 guests seated, set to 8 seats, asks first and names the 2 guests who would lose their seats (check 12)', async ({ context, page }, testInfo) => {
  await presetAuthor(context, 'Noa')
  const people: [string, string][] = [
    ['Ava', 'Cohen'],
    ['Ben', 'Levi'],
    ['Cara', 'Diaz'],
    ['Dov', 'Katz'],
    ['Eli', 'Brooks'],
    ['Fay', 'Adler'],
    ['Gil', 'Moss'],
    ['Hana', 'Roth'],
    ['Ido', 'Sela'],
    ['June', 'Park'],
  ]
  const s = await setupSeating(page, testInfo, {
    guests: people.map(([firstName, lastName]) => ({ firstName, lastName })),
    tables: [{ at: { x: 0, y: 0 }, seats: 12, guests: people.map(([first]) => first) }],
  })
  const [id] = s.tables
  await openEditor(page, s)
  await waitForEditor(page)
  await selectTable(page, id)
  const panel = await openProperties(page)
  const count = panel.getByTestId('table-seat-count')
  await expect(count).toHaveValue('12')

  // Cancel first: nothing changes.
  await commitField(count, '8')
  const dialog = page.getByTestId('unseat-dialog')
  await expect(dialog).toContainText('Remove 2 guests from their seats?')
  await expect(dialog.getByTestId('unseat-list').locator('li')).toHaveText(['Seat 9: Ido Sela', 'Seat 10: June Park'])
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  const table = page.getByTestId('canvas').locator(`[data-item-id="${id}"]`)
  await expect(table.locator('circle[data-seat-index]')).toHaveCount(12)
  await expect(table.locator('[data-seat-state="taken"]')).toHaveCount(10)

  // Then yes: 8 seats, all taken; Ido and June go to Unassigned.
  await commitField(count, '8')
  await expect(dialog.getByTestId('unseat-list').locator('li')).toHaveText(['Seat 9: Ido Sela', 'Seat 10: June Park'])
  await dialog.getByRole('button', { name: 'Remove from seats' }).click()
  await expect(table.locator('circle[data-seat-index]')).toHaveCount(8)
  await expect(table.locator('[data-seat-state="taken"]')).toHaveCount(8)
  await expectSaved(page)
  // The eight who stay keep their seats in the same order round the table (DECISIONS 63); Ido and June have none.
  const seats = (await serverSeats(page, s.layout.id))[id]
  const kept = people.slice(0, 8).map(([first]) => s.byName(first).id)
  expect([...seats].sort()).toEqual([...kept].sort())
  const start = seats.indexOf(kept[0])
  expect([...seats.slice(start), ...seats.slice(0, start)]).toEqual(kept)
  expect(seats).not.toContain(s.byName('Ido').id)
  expect(seats).not.toContain(s.byName('June').id)
})
