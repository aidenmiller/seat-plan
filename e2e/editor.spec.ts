/**
 * The canvas editor's everyday tools (spec section 4; PLAN section 6):
 * keyboard shortcuts, lock, align, the shape panel, the zoom controls and
 * panning. Keyboard tests run on the laptop only; phones get the same edits
 * through taps, the Shapes drawer and two fingers.
 */
import { randomUUID } from 'node:crypto'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { emptyCanvas, type Canvas, type Item, type Table } from '../src/domain/canvas-schema'
import { footprintBox } from '../src/domain/geometry'
import { makeItem, type PresetId } from '../src/domain/presets'
import { SEAT_TAKEN_COLOR } from '../src/domain/seats'
import {
  clickWith,
  clientToWorld,
  isPhoneLayout,
  itemLocator,
  itemPlace,
  itemTransforms,
  lowerSheet,
  mouseDrag,
  openProperties,
  pointerDrag,
  press,
  readTable,
  selectedIds,
  settledCamera,
  tableClientCenter,
  Touch,
  viewport,
  zoomLevel,
} from './canvas'
import { dbAddGuests } from './db'
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

type Placed = { preset: PresetId; x: number; y: number }

/** A wedding and a layout holding these items, opened in the editor in Edit mode. */
async function openWith(page: Page, testInfo: TestInfo, label: string, placed: Placed[], seat?: (weddingId: string, canvas: Canvas) => Promise<Canvas>) {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName(label, testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  let canvas: Canvas = emptyCanvas()
  const ids: string[] = []
  for (const p of placed) {
    const id = randomUUID()
    ids.push(id)
    canvas = { ...canvas, items: [...canvas.items, makeItem(p.preset, { x: p.x, y: p.y }, id, canvas)] }
  }
  if (seat) canvas = await seat(wedding.id, canvas)
  const saved = placed.length > 0 ? await apiPutCanvas(page.request, layout, canvas) : null
  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  await expectSaved(page)
  return { wedding, layout, ids, version: saved?.version ?? layout.version }
}

async function storedItems(page: Page, layoutId: string): Promise<Item[]> {
  return (await apiGetLayout(page.request, layoutId)).canvas.items
}

function laptopOnly(testInfo: TestInfo) {
  test.skip(testInfo.project.name === 'phone', 'Keyboard and mouse; phones have their own tests here.')
}

test('keyboard: select all, delete, undo and redo; duplicate and paste give new numbers and empty seats; a burst of nudges is one undo step', async ({ context, page }, testInfo) => {
  laptopOnly(testInfo)
  await presetAuthor(context, 'Noa')
  const { layout, ids } = await openWith(page, testInfo, 'Keys', [{ preset: 'round', x: 0, y: 0 }, { preset: 'round', x: 450, y: 0 }], async (weddingId, canvas) => {
    // Two guests at Table 1, so copies can show their seats come empty.
    const guests = await dbAddGuests(weddingId, [
      ['Ann', 'Lee'],
      ['Ben', 'Ray'],
    ])
    const [first, ...rest] = canvas.items as Table[]
    const seats = first.seats.map((s, i) => (i < 2 ? { ...s, guestId: guests[i] } : s))
    return { ...canvas, items: [{ ...first, seats }, ...rest] }
  })
  const [a, b] = ids
  const table = itemLocator(page, a)
  await expect(table.locator('[data-seat-state="taken"]')).toHaveCount(2)
  await expect(table.locator('[data-seat-state="taken"]').first()).toHaveAttribute('fill', SEAT_TAKEN_COLOR)
  const before = await itemTransforms(page)

  // Select all, delete, undo, redo, undo.
  await page.keyboard.press('ControlOrMeta+a')
  expect((await selectedIds(page)).sort()).toEqual([a, b].sort())
  await page.keyboard.press('Delete')
  await expect(canvasTables(page)).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(canvasTables(page)).toHaveCount(2)
  expect(await itemTransforms(page)).toEqual(before)
  await expect(table.locator('[data-seat-state="taken"]')).toHaveCount(2)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(canvasTables(page)).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  await expect(canvasTables(page)).toHaveCount(2)
  await page.keyboard.press('Escape')
  expect(await selectedIds(page)).toEqual([])

  // Nudges: three right and one big step down, then one undo puts all four back.
  const camera = await settledCamera(page)
  await page.mouse.click(...xy(await tableClientCenter(page, a, camera)))
  expect(await selectedIds(page)).toEqual([a])
  const start = await itemPlace(page, a)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  let moved = await itemPlace(page, a)
  expect(moved.x - start.x).toBeCloseTo(3 * FOOT, 6)
  expect(moved.y - start.y).toBeCloseTo(5 * FOOT, 6)
  await page.keyboard.press('ControlOrMeta+z')
  moved = await itemPlace(page, a)
  expect(moved.x).toBeCloseTo(start.x, 6)
  expect(moved.y).toBeCloseTo(start.y, 6)
  await expect(canvasTables(page)).toHaveCount(2)
  await page.keyboard.press('ControlOrMeta+y')
  moved = await itemPlace(page, a)
  expect(moved.x - start.x).toBeCloseTo(3 * FOOT, 6)

  // Duplicate Table 1 (two seated): the copy is Table 3 with every seat empty.
  expect(await selectedIds(page)).toEqual([a])
  await page.keyboard.press('ControlOrMeta+d')
  await expect(canvasTables(page)).toHaveCount(3)
  const copy = (await tableIds(page)).find((id) => id !== a && id !== b)!
  expect(await selectedIds(page)).toEqual([copy])
  const dup = await readTable(page, copy)
  expect(dup.number).toBe(3)
  expect(dup.name).toBe('Table 3')
  expect(dup.seats).toHaveLength(8)
  expect(dup.seats.every((s) => s.state === 'empty')).toBe(true)
  await expect(table.locator('[data-seat-state="taken"]')).toHaveCount(2)

  // Copy and paste Table 2: Table 4.
  await page.mouse.click(...xy(await tableClientCenter(page, b, camera)))
  await page.keyboard.press('ControlOrMeta+c')
  await page.keyboard.press('ControlOrMeta+v')
  await expect(canvasTables(page)).toHaveCount(4)
  const pasted = (await tableIds(page)).find((id) => ![a, b, copy].includes(id))!
  expect((await readTable(page, pasted)).number).toBe(4)
  expect((await readTable(page, pasted)).name).toBe('Table 4')

  await expectSaved(page)
  const items = await storedItems(page, layout.id)
  const tables = items.filter((i): i is Table => i.kind === 'table')
  expect(tables.map((t) => t.number).sort()).toEqual([1, 2, 3, 4])
  expect(tables.find((t) => t.id === a)!.seats.filter((s) => s.guestId !== null)).toHaveLength(2)
  for (const t of tables.filter((t) => t.id === copy || t.id === pasted)) expect(t.seats.every((s) => s.guestId === null)).toBe(true)
})

test('a locked table cannot be moved, nudged or resized until unlocked', async ({ context, page }, testInfo) => {
  await presetAuthor(context, 'Noa')
  const { layout, ids } = await openWith(page, testInfo, 'Lock', [{ preset: 'round', x: 0, y: 0 }])
  const [id] = ids
  const phone = await isPhoneLayout(page)
  const camera = await settledCamera(page)
  const center = await tableClientCenter(page, id, camera)
  if (phone) await (await Touch.on(page)).tap(center)
  else await page.mouse.click(center.x, center.y)
  expect(await selectedIds(page)).toEqual([id])
  await expect(page.getByTestId('handle-se')).toHaveCount(1)

  const panel = await openProperties(page)
  await panel.getByTestId('lock-switch').click()
  await expect(panel.getByTestId('lock-switch')).toHaveAttribute('aria-checked', 'true')
  await expect(panel.getByTestId('table-across')).toBeDisabled()
  await lowerSheet(page)
  expect((await readTable(page, id)).locked).toBe(true)
  await expect(page.getByTestId('handle-se')).toHaveCount(0)
  const start = await itemPlace(page, id)

  // A drag on it does not move it (a laptop draws a selection box, a phone pans).
  await pointerDrag(page, center, { x: center.x + 3 * FOOT * camera.zoom, y: center.y + FOOT * camera.zoom })
  expect(await itemPlace(page, id)).toEqual(start)
  if (!phone) {
    await page.mouse.click(...xy(await tableClientCenter(page, id)))
    await page.keyboard.press('ArrowRight')
    expect(await itemPlace(page, id)).toEqual(start)
  }

  // Unlocked, the same drag moves it.
  expect(await selectedIds(page)).toEqual([id])
  const again = await openProperties(page)
  await again.getByTestId('lock-switch').click()
  await expect(again.getByTestId('lock-switch')).toHaveAttribute('aria-checked', 'false')
  await lowerSheet(page)
  const now = await settledCamera(page)
  const at = await tableClientCenter(page, id, now)
  await pointerDrag(page, at, { x: at.x + 3 * FOOT * now.zoom, y: at.y })
  const moved = await itemPlace(page, id)
  expect(moved.x - start.x).toBeGreaterThan(3 * FOOT - 31)
  await expectSaved(page)
  const stored = (await storedItems(page, layout.id)).find((i) => i.id === id)!
  expect(stored.locked).toBe(false)
  expect(stored.x).toBeCloseTo(moved.x, 6)
})

test('Align left lines up two tables by their left edges', async ({ context, page }, testInfo) => {
  await presetAuthor(context, 'Noa')
  const { layout, ids } = await openWith(page, testInfo, 'Align', [
    { preset: 'round', x: 0, y: 0 },
    { preset: 'rect', x: 520, y: 400 },
  ])
  const [round, rect] = ids
  const phone = await isPhoneLayout(page)
  const camera = await settledCamera(page)
  const a = await tableClientCenter(page, round, camera)
  const b = await tableClientCenter(page, rect, camera)
  if (phone) {
    const touch = await Touch.on(page)
    await press(page, page.getByTestId('phone-select'))
    await touch.tap(a)
    await touch.tap(b)
  } else {
    await page.mouse.click(a.x, a.y)
    await clickWith(page, b, ['Shift'])
  }
  expect((await selectedIds(page)).sort()).toEqual([round, rect].sort())
  const before = await storedItems(page, layout.id)
  const leftBefore = Math.min(...before.map((i) => footprintBox(i).minX))

  const panel = await openProperties(page)
  await expect(panel.getByTestId('multi-properties')).toContainText('2 items selected')
  await panel.getByTestId('multi-properties').getByRole('button', { name: 'Left', exact: true }).click()
  await lowerSheet(page)
  await expectSaved(page)
  const after = await storedItems(page, layout.id)
  const boxes = after.map((i) => footprintBox(i))
  expect(boxes[0].minX).toBeCloseTo(leftBefore, 6)
  expect(boxes[1].minX).toBeCloseTo(leftBefore, 6)
  // Only across: the tops stay where they were.
  expect(after.map((i) => i.y)).toEqual(before.map((i) => i.y))
  expect(await itemPlace(page, rect)).toMatchObject({ x: after[1].x, y: after[1].y })
})

test('the shape panel: drag a fixture and a table onto the plan (laptop), or tap to add in the middle (phone)', async ({ context, page }, testInfo) => {
  await presetAuthor(context, 'Noa')
  const { layout } = await openWith(page, testInfo, 'Shapes', [])
  const camera = await settledCamera(page)
  const view = (await viewport(page).boundingBox())!

  if (await isPhoneLayout(page)) {
    await page.getByTestId('open-shapes').tap()
    const drawer = page.getByTestId('shape-drawer')
    await expect(drawer.getByRole('dialog', { name: 'Shapes' })).toBeVisible()
    const tile = drawer.getByRole('button', { name: 'Add dance floor', exact: true })
    const box = (await tile.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    await tile.tap()
    await expect(drawer).toBeHidden()
    const fixture = page.getByTestId('canvas').locator('[data-kind="fixture"][data-fixture-type="danceFloor"]')
    await expect(fixture).toHaveCount(1)
    const id = (await fixture.getAttribute('data-item-id'))!
    expect(await selectedIds(page)).toEqual([id])
    const middle = await clientToWorld(page, { x: view.x + view.width / 2, y: view.y + view.height / 2 }, camera)
    const place = await itemPlace(page, id)
    expect(Math.abs(place.x - middle.x)).toBeLessThanOrEqual(FOOT / 2 + 0.01)
    expect(Math.abs(place.y - middle.y)).toBeLessThanOrEqual(FOOT / 2 + 0.01)
  } else {
    const panel = page.getByTestId('shape-panel')
    for (const [name, kind, dropAt] of [
      ['Add bar', '[data-kind="fixture"][data-fixture-type="bar"]', { x: view.x + view.width * 0.3, y: view.y + view.height * 0.3 }],
      ['Add round table', '[data-kind="table"]', { x: view.x + view.width * 0.65, y: view.y + view.height * 0.6 }],
    ] as const) {
      const tile = (await panel.getByRole('button', { name, exact: true }).boundingBox())!
      await mouseDrag(page, { x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 }, dropAt, { steps: 20 })
      const item = page.getByTestId('canvas').locator(kind)
      await expect(item).toHaveCount(1)
      const id = (await item.getAttribute('data-item-id'))!
      const want = await clientToWorld(page, dropAt, camera)
      const place = await itemPlace(page, id)
      // Dropped where the pointer let go, snapped to the 1 ft grid.
      expect(Math.abs(place.x - want.x)).toBeLessThanOrEqual(FOOT / 2 + 0.01)
      expect(Math.abs(place.y - want.y)).toBeLessThanOrEqual(FOOT / 2 + 0.01)
      expect(await selectedIds(page)).toEqual([id])
    }
    // A plain click adds one more in the middle.
    await panel.getByRole('button', { name: 'Add cake table', exact: true }).click()
    await expect(page.getByTestId('canvas').locator('[data-fixture-type="cake"]')).toHaveCount(1)
  }
  await expectSaved(page)
  expect((await storedItems(page, layout.id)).length).toBeGreaterThan(0)
})

test('on a phone, a tile dragged out of the Shapes drawer lands on the canvas where the finger lifts', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'The Shapes drawer is the phone layout; the laptop drag is above.')
  await presetAuthor(context, 'Noa')
  const { layout } = await openWith(page, testInfo, 'Drawer drag', [])
  const camera = await settledCamera(page)
  const view = (await viewport(page).boundingBox())!

  await page.getByTestId('open-shapes').tap()
  const drawer = page.getByTestId('shape-drawer')
  const dialog = drawer.getByRole('dialog', { name: 'Shapes' })
  await expect(dialog).toBeVisible()
  const tile = (await drawer.getByRole('button', { name: 'Add round table', exact: true }).boundingBox())!
  const start = { x: tile.x + tile.width / 2, y: tile.y + tile.height / 2 }
  const dropAt = { x: view.x + view.width * 0.6, y: view.y + view.height * 0.55 }

  // One finger: sideways first (up and down would scroll the list), then on to the drop point.
  const touch = await Touch.on(page)
  await touch.down([{ ...start, id: 1 }])
  for (let i = 1; i <= 6; i++) await touch.move([{ x: start.x + i * 6, y: start.y, id: 1 }])
  // The drawer steps aside while the tile is dragged, so the canvas under it shows.
  await expect(dialog).toBeHidden()
  const turn = { x: start.x + 36, y: start.y }
  for (let i = 1; i <= 12; i++) {
    const f = i / 12
    await touch.move([{ x: turn.x + (dropAt.x - turn.x) * f, y: turn.y + (dropAt.y - turn.y) * f, id: 1 }])
  }
  await touch.up()

  // One table, where the finger lifted (snapped to the 1 ft grid), selected; the drawer closed.
  await expect(drawer).toBeHidden()
  await expect(canvasTables(page)).toHaveCount(1)
  const [id] = await tableIds(page)
  expect(await selectedIds(page)).toEqual([id])
  const want = await clientToWorld(page, dropAt, camera)
  const place = await itemPlace(page, id)
  expect(Math.abs(place.x - want.x)).toBeLessThanOrEqual(FOOT / 2 + 0.01)
  expect(Math.abs(place.y - want.y)).toBeLessThanOrEqual(FOOT / 2 + 0.01)
  expect(await settledCamera(page)).toEqual(camera)
  await expectSaved(page)
  const stored = await storedItems(page, layout.id)
  expect(stored).toHaveLength(1)
  expect(stored[0]).toMatchObject({ id, kind: 'table', shape: 'round', seatCount: 8 })
})

test('zoom buttons step the zoom, show the percent and fit the content', async ({ context, page }, testInfo) => {
  await presetAuthor(context, 'Noa')
  const { ids } = await openWith(page, testInfo, 'Zoom', [{ preset: 'round', x: 0, y: 0 }, { preset: 'round', x: 900, y: 600 }])
  const controls = page.getByTestId('zoom-controls')
  const view = (await viewport(page).boundingBox())!
  const box = (await controls.boundingBox())!
  // Bottom right corner of the canvas, every button at least 44 px.
  expect(box.x + box.width).toBeGreaterThan(view.x + view.width - 24)
  expect(box.x + box.width).toBeLessThanOrEqual(view.x + view.width)
  expect(box.y + box.height).toBeLessThanOrEqual(view.y + view.height)
  for (const b of await controls.getByRole('button').all()) {
    const r = (await b.boundingBox())!
    expect(r.height).toBeGreaterThanOrEqual(44)
    expect(r.width).toBeGreaterThanOrEqual(44)
  }

  const button = (name: string) => controls.getByRole('button', { name, exact: true })
  const expectZoom = async (percent: number) => {
    await expect(zoomLevel(page)).toHaveText(`${percent}%`)
    expect((await settledCamera(page)).zoom).toBeCloseTo(percent / 100, 6)
  }
  await press(page, button('Zoom to 100%'))
  await expectZoom(100)
  await press(page, button('Zoom in'))
  await expectZoom(150)
  await press(page, button('Zoom in'))
  await expectZoom(200)
  await press(page, button('Zoom out'))
  await expectZoom(150)
  await press(page, button('Zoom out'))
  await press(page, button('Zoom out'))
  await expectZoom(75)
  if (testInfo.project.name === 'desktop') {
    await page.keyboard.press('ControlOrMeta+=')
    await expectZoom(100)
    await page.keyboard.press('ControlOrMeta+-')
    await expectZoom(75)
    await page.keyboard.press('ControlOrMeta+0')
    await expectZoom(100)
  }

  // Fit to content: both tables on screen, their middle at the middle of the
  // canvas less what covers its edges (EditorShell's canvasInsets): the
  // toolbar's band along the top (58 px, PHONE_TOOLBAR_BOTTOM_PX) and the zoom
  // controls along the bottom, which sit above the sheet's strip on a phone,
  // each with 8 px to spare. On a laptop the two bands are equal, so that is
  // the canvas's own middle.
  const fitArea = { top: view.y + 58 + 8, bottom: box.y - 8 }
  await press(page, button('Fit to content'))
  const camera = await settledCamera(page)
  for (const id of ids) {
    const c = await tableClientCenter(page, id, camera)
    expect(c.x).toBeGreaterThan(view.x)
    expect(c.x).toBeLessThan(view.x + view.width)
    expect(c.y).toBeGreaterThan(view.y)
    expect(c.y).toBeLessThan(view.y + view.height)
  }
  const a = await tableClientCenter(page, ids[0], camera)
  const b = await tableClientCenter(page, ids[1], camera)
  expect(Math.abs((a.x + b.x) / 2 - (view.x + view.width / 2))).toBeLessThan(2)
  expect(Math.abs((a.y + b.y) / 2 - (fitArea.top + fitArea.bottom) / 2)).toBeLessThan(2)
  await expect(zoomLevel(page)).toHaveText(`${Math.round(camera.zoom * 100)}%`)
})

test('Space+drag and a middle-button drag pan without moving anything', async ({ context, page }, testInfo) => {
  laptopOnly(testInfo)
  await presetAuthor(context, 'Noa')
  const { ids } = await openWith(page, testInfo, 'Pan', [{ preset: 'round', x: 0, y: 0 }])
  const before = await itemTransforms(page)
  const camera = await settledCamera(page)
  const start = await tableClientCenter(page, ids[0], camera)

  await page.mouse.move(start.x, start.y)
  await page.keyboard.down('Space')
  await mouseDrag(page, start, { x: start.x + 150, y: start.y - 60 })
  await page.keyboard.up('Space')
  let now = await settledCamera(page)
  expect(now.x).toBeCloseTo(camera.x + 150, 1)
  expect(now.y).toBeCloseTo(camera.y - 60, 1)
  expect(await itemTransforms(page)).toEqual(before)
  expect(await selectedIds(page)).toEqual([])

  const from = { x: start.x + 150, y: start.y - 60 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(from.x - 40, from.y + 90, { steps: 10 })
  await page.mouse.up({ button: 'middle' })
  now = await settledCamera(page)
  expect(now.x).toBeCloseTo(camera.x + 110, 1)
  expect(now.y).toBeCloseTo(camera.y + 30, 1)
  expect(await itemTransforms(page)).toEqual(before)
})

test('on a phone, two fingers pinch to zoom and pan without moving anything', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'Touch.')
  await presetAuthor(context, 'Noa')
  const { ids } = await openWith(page, testInfo, 'Pinch', [{ preset: 'round', x: 0, y: 0 }])
  const before = await itemTransforms(page)
  const camera = await settledCamera(page)
  const center = await tableClientCenter(page, ids[0], camera)
  // Spread from 100 px to 200 px apart while the fingers move 40 px right.
  await (await Touch.on(page)).pinch(center, 100, 200, { steps: 12, pan: { x: 40, y: 0 } })
  const now = await settledCamera(page)
  expect(now.zoom / camera.zoom).toBeCloseTo(2, 2)
  // The table stays under the fingers' midpoint.
  const moved = await tableClientCenter(page, ids[0], now)
  expect(Math.abs(moved.x - (center.x + 40))).toBeLessThan(2)
  expect(Math.abs(moved.y - center.y)).toBeLessThan(2)
  expect(await itemTransforms(page)).toEqual(before)
  expect(await selectedIds(page)).toEqual([])
})

function xy(p: { x: number; y: number }): [number, number] {
  return [p.x, p.y]
}
