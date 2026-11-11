/**
 * Notes on the plan (spec section 9; milestone 9), at 1440 px and 390 px
 * with touch: a sticky note placed with its tool and typed into, an arrow
 * drawn from a table that follows the table when it moves, the notes
 * layer's Show and Lock switches, and the Notes tab (author, a click that
 * brings the note into view, Done greying it out). On a ceremony layout too:
 * the Sticky tool places a note among the chair rows, and Lock lets a click
 * through a note to the chair under it.
 */
import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { resolveArrow } from '../src/domain/arrows'
import { emptyCanvas, type Author, type Canvas, type Item, type Note } from '../src/domain/canvas-schema'
import { generateSeatingBlock } from '../src/domain/ceremony'
import { makeNote } from '../src/domain/notes'
import { makeItem } from '../src/domain/presets'
import { chairRowSeatCenters } from '../src/domain/seating'
import {
  clientToWorld,
  isPhoneLayout,
  itemLocator,
  itemPlace,
  mouseDrag,
  selectedIds,
  setMode,
  settledCamera,
  sheetAtRest,
  tableClientCenter,
  Touch,
  viewport,
  worldToClient,
  zoomButtonsTo,
  type Point,
} from './canvas'
import { apiCreateLayout, apiCreateWedding, apiGetLayout, apiPutCanvas, editorPath, expectSaved, presetAuthor, signIn, uniqueName, waitForEditor } from './helpers'

const FOOT = 30.48

/** A wedding and a layout (reception unless said) holding these items, opened in the editor in Edit mode. */
async function openWith(page: Page, testInfo: TestInfo, label: string, items: Item[], kind: 'reception' | 'ceremony' = 'reception') {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName(label, testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan', kind })
  const canvas: Canvas = { ...emptyCanvas(), items }
  const saved = await apiPutCanvas(page.request, layout, canvas)
  await page.goto(editorPath(wedding.id, layout.id))
  if (kind === 'ceremony') {
    // A ceremony's shape panel has the seating block tool where tables would be.
    await setMode(page, 'edit')
    await expect(page.getByTestId('open-shapes').or(page.getByTestId('seating-block-tool'))).toBeEnabled({ timeout: 10_000 })
  } else {
    await waitForEditor(page)
  }
  await expectSaved(page)
  return { wedding, layout, version: saved.version }
}

/** Round tables at these points, numbered 1, 2, ... */
function roundTables(...at: Point[]): Item[] {
  const items: Item[] = []
  for (const p of at) items.push(makeItem('round', p, randomUUID(), { ...emptyCanvas(), items }))
  return items
}

function note(type: Note['type'], at: Point, author: Author, text: string, createdAt: number): Note {
  return { ...makeNote(type, at, author, 'yellow', createdAt, randomUUID()), text }
}

async function storedItems(page: Page, layoutId: string): Promise<Item[]> {
  return (await apiGetLayout(page.request, layoutId)).canvas.items
}

/** A tap on phones, a click elsewhere, at a page point. */
async function tapAt(page: Page, at: Point): Promise<void> {
  if (await isPhoneLayout(page)) await (await Touch.on(page)).tap(at)
  else await page.mouse.click(at.x, at.y)
}

/** A one-finger drag on phones, a mouse drag elsewhere. */
async function dragFrom(page: Page, from: Point, to: Point): Promise<void> {
  if (await isPhoneLayout(page)) await (await Touch.on(page)).drag(from, to, { steps: 12 })
  else await mouseDrag(page, from, to, { steps: 12 })
}

/** Arms a note tool ("Sticky note", "Arrow note"): the shape panel on a laptop, the Shapes drawer on a phone. */
async function armNoteTool(page: Page, name: string): Promise<void> {
  if (await isPhoneLayout(page)) {
    await page.getByTestId('open-shapes').tap()
    const drawer = page.getByTestId('shape-drawer')
    const tool = drawer.getByRole('button', { name, exact: true })
    expect((await tool.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await tool.tap()
    // The drawer closes so the next tap lands on the plan.
    await expect(drawer).toBeHidden()
  } else {
    const tool = page.getByTestId('shape-panel').getByRole('button', { name, exact: true })
    await tool.click()
    await expect(tool).toHaveAttribute('aria-pressed', 'true')
  }
  await expect(page.getByTestId('note-tool-hint')).toBeVisible()
}

/** An item's middle on screen (page px), as the browser lays it out. */
async function clientMiddle(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Not on screen')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** An arrow's start as the plan draws it (cm): its place plus the line's first point (arrows never turn). */
async function drawnArrowStart(page: Page, id: string): Promise<Point> {
  return itemLocator(page, id).evaluate((g) => {
    const tr = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(g.getAttribute('transform') ?? '')
    const line = g.querySelector('line[data-note-line]')
    return { x: Number(tr?.[1]) + Number(line?.getAttribute('x1')), y: Number(tr?.[2]) + Number(line?.getAttribute('y1')) }
  })
}

/** Opens the Notes tab: the right panel's tab on a laptop, the bottom sheet's on a phone. */
async function openNotesTab(page: Page): Promise<Locator> {
  if (await isPhoneLayout(page)) {
    const sheet = page.getByTestId('bottom-sheet')
    await sheet.getByRole('tab', { name: 'Notes' }).click()
    await expect(sheet.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
    await expect(sheet).not.toHaveAttribute('data-snap', 'strip')
    await sheetAtRest(page)
    return sheet.getByTestId('notes-panel')
  }
  const panel = page.getByTestId('right-panel')
  await panel.getByRole('tab', { name: 'Notes' }).click()
  await expect(panel.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
  return panel.getByTestId('notes-panel')
}

test('a sticky note placed with its tool takes typing, shows on the plan and saves with its author', async ({ context, page }, testInfo) => {
  await presetAuthor(context, 'Noa')
  // Two tables far apart, so the middle of the view is clear.
  const { layout } = await openWith(page, testInfo, 'Sticky', roundTables({ x: 0, y: 0 }, { x: 1200, y: 0 }))
  const camera = await settledCamera(page)
  const spot = await worldToClient(page, { x: 600, y: 0 }, camera)

  await armNoteTool(page, 'Sticky note')
  await tapAt(page, spot)
  const sticky = page.getByTestId('canvas').locator('[data-kind="note"][data-note-type="sticky"]')
  await expect(sticky).toHaveCount(1)
  const id = (await sticky.getAttribute('data-item-id'))!
  expect(await selectedIds(page)).toEqual([id])
  await expect(page.getByTestId('note-tool-hint')).toHaveCount(0)

  // Typing starts at once in the box over the note.
  const editor = page.getByTestId('note-editor')
  await expect(editor).toBeFocused()
  await page.keyboard.type('Call the florist')
  await expect(editor).toHaveValue('Call the florist')
  // Esc ends typing on a laptop; a phone taps the plan elsewhere.
  if (await isPhoneLayout(page)) await tapAt(page, await worldToClient(page, { x: 600, y: 400 }, camera))
  else await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(sticky.locator('[data-note-text]')).toContainText('Call')
  await expect(sticky.locator('[data-note-text]')).toContainText('florist')
  await expect(sticky.locator('[data-note-author]')).toHaveText('N')

  await expectSaved(page)
  const stored = (await storedItems(page, layout.id)).find((i) => i.id === id) as Note
  expect(stored).toMatchObject({ kind: 'note', type: 'sticky', text: 'Call the florist', author: 'Noa', done: false })
  const want = await clientToWorld(page, spot, camera)
  expect(Math.abs(stored.x - want.x)).toBeLessThanOrEqual(FOOT / 2 + 0.01)
  expect(Math.abs(stored.y - want.y)).toBeLessThanOrEqual(FOOT / 2 + 0.01)
})

test('an arrow drawn from a table attaches to it and its end follows the table when it moves', async ({ context, page }, testInfo) => {
  await presetAuthor(context, 'Noa')
  const [table, other] = roundTables({ x: 0, y: 0 }, { x: 700, y: 400 })
  const { layout } = await openWith(page, testInfo, 'Arrow', [table, other])
  const camera = await settledCamera(page)
  const from = await tableClientCenter(page, table.id, camera)
  const to = await worldToClient(page, { x: 450, y: -150 }, camera)

  await armNoteTool(page, 'Arrow note')
  await dragFrom(page, from, to)
  const arrow = page.getByTestId('canvas').locator('[data-kind="note"][data-note-type="arrow"]')
  await expect(arrow).toHaveCount(1)
  const id = (await arrow.getAttribute('data-item-id'))!
  expect(await selectedIds(page)).toEqual([id])
  await expect(arrow.locator('[data-arrow-head]')).toHaveCount(1)
  await expect(page.getByTestId('arrow-start')).toHaveAttribute('data-attached', 'true')
  await expect(page.getByTestId('arrow-end')).toHaveAttribute('data-attached', 'false')
  await expectSaved(page)
  const first = await storedItems(page, layout.id)
  const stored = first.find((i) => i.id === id) as Note
  expect(stored.attachedTo).toEqual({ start: table.id, end: null })

  // The start sits on the table's chair ring, where the line towards the end leaves it.
  const startBefore = await drawnArrowStart(page, id)
  const ring = Math.hypot(startBefore.x - table.x, startBefore.y - table.y)
  expect(ring).toBeGreaterThan(100)
  const expectedBefore = resolveArrow(stored, { items: first }).start
  expect(startBefore.x).toBeCloseTo(expectedBefore.x, 1)
  expect(startBefore.y).toBeCloseTo(expectedBefore.y, 1)

  // Let the arrow go, pick the table and drag it 100 px down.
  if (await isPhoneLayout(page)) await tapAt(page, await worldToClient(page, { x: -100, y: 400 }, camera))
  else await page.keyboard.press('Escape')
  expect(await selectedIds(page)).toEqual([])
  await tapAt(page, from)
  expect(await selectedIds(page)).toEqual([table.id])
  await dragFrom(page, from, { x: from.x, y: from.y + 100 })
  await expect.poll(async () => (await itemPlace(page, table.id)).y, { message: 'the table moves down' }).toBeGreaterThanOrEqual(2 * FOOT)
  await expectSaved(page)

  const after = await storedItems(page, layout.id)
  const moved = after.find((i) => i.id === table.id)!
  expect(moved.y).toBeGreaterThanOrEqual(2 * FOOT)
  // The arrow itself was not edited: its end is worked out from the table.
  const arrowAfter = after.find((i) => i.id === id) as Note
  expect(arrowAfter.attachedTo).toEqual({ start: table.id, end: null })
  const startAfter = await drawnArrowStart(page, id)
  const expectedAfter = resolveArrow(arrowAfter, { items: after }).start
  expect(startAfter.x).toBeCloseTo(expectedAfter.x, 1)
  expect(startAfter.y).toBeCloseTo(expectedAfter.y, 1)
  // Still on the moved table's chair ring, and it moved down with it.
  expect(Math.hypot(startAfter.x - moved.x, startAfter.y - moved.y)).toBeCloseTo(ring, 0)
  expect(startAfter.y - startBefore.y).toBeGreaterThan(moved.y / 2)
})

test('the notes switches: Show hides and shows every note; Lock lets a click through to the table under a note', async ({ context, page }, testInfo) => {
  await presetAuthor(context, 'Noa')
  const [table] = roundTables({ x: 0, y: 0 })
  // A sticky note on the table, and one beside it.
  const onTable = note('sticky', { x: 0, y: 0 }, 'Aiden', 'Bob sits here', Date.now() - 60_000)
  const beside = note('text', { x: 600, y: 0 }, 'Noa', 'Bar opens at 6', Date.now() - 30_000)
  const { layout, version } = await openWith(page, testInfo, 'Layer', [table, onTable, beside])
  const show = page.getByTestId('notes-show')
  const lock = page.getByTestId('notes-lock')
  for (const button of [show, lock]) {
    const box = (await button.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
  await expect(show).toHaveAttribute('aria-pressed', 'true')
  await expect(lock).toHaveAttribute('aria-pressed', 'false')
  const sticky = itemLocator(page, onTable.id)
  await expect(sticky).toBeVisible()
  await expect(itemLocator(page, beside.id)).toBeVisible()

  // Hide: both notes go, and a click on the table's middle picks the table.
  await show.click()
  await expect(show).toHaveAttribute('aria-pressed', 'false')
  await expect(sticky).toBeHidden()
  await expect(itemLocator(page, beside.id)).toBeHidden()
  const center = await tableClientCenter(page, table.id)
  await tapAt(page, center)
  expect(await selectedIds(page)).toEqual([table.id])

  // Show: both come back, and the same click picks the note on top.
  await show.click()
  await expect(show).toHaveAttribute('aria-pressed', 'true')
  await expect(sticky).toBeVisible()
  await expect(itemLocator(page, beside.id)).toBeVisible()
  await tapAt(page, center)
  expect(await selectedIds(page)).toEqual([onTable.id])

  // Lock: a click on the note picks the table under it, and on the other note picks nothing.
  await lock.click()
  await expect(lock).toHaveAttribute('aria-pressed', 'true')
  await expect(sticky).toBeVisible()
  await tapAt(page, center)
  expect(await selectedIds(page)).toEqual([table.id])
  await tapAt(page, await clientMiddle(itemLocator(page, beside.id)))
  expect(await selectedIds(page)).toEqual([])

  // Unlocked, the note is picked again.
  await lock.click()
  await expect(lock).toHaveAttribute('aria-pressed', 'false')
  await tapAt(page, center)
  expect(await selectedIds(page)).toEqual([onTable.id])

  // The switches are kept on this device, not in the layout: nothing was saved.
  expect((await apiGetLayout(page.request, layout.id)).version).toBe(version)
})

test('notes on a ceremony layout: the Sticky tool places one by the rows, and Lock lets a click through to a chair', async ({ context, page }, testInfo) => {
  await presetAuthor(context, 'Noa')
  const rows = generateSeatingBlock({ rows: 2, chairsPerRow: 3, origin: { x: 0, y: 0 } }, () => randomUUID())
  const front = rows.find((r) => r.rowNumber === 1)!
  const chair = chairRowSeatCenters(front)[0]!
  const onChair = note('sticky', chair, 'Aiden', 'Grandma sits here', Date.now() - 60_000)
  const { layout } = await openWith(page, testInfo, 'Ceremony notes', [...rows, onChair], 'ceremony')
  let camera = await settledCamera(page)

  // The Sticky tool places a note in the aisle, which takes typing and saves with its author.
  await armNoteTool(page, 'Sticky note')
  await tapAt(page, await worldToClient(page, { x: 0, y: 45 }, camera))
  const placed = page.getByTestId('canvas').locator(`[data-kind="note"][data-note-type="sticky"]:not([data-item-id="${onChair.id}"])`)
  await expect(placed).toHaveCount(1)
  const id = (await placed.getAttribute('data-item-id'))!
  const editor = page.getByTestId('note-editor')
  await expect(editor).toBeFocused()
  await page.keyboard.type('Ushers here')
  if (await isPhoneLayout(page)) await tapAt(page, await worldToClient(page, { x: 0, y: 150 }, camera))
  else await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expectSaved(page)
  expect((await storedItems(page, layout.id)).find((i) => i.id === id)).toMatchObject({ kind: 'note', type: 'sticky', text: 'Ushers here', author: 'Noa' })

  // The note over the chair takes a click; locked, the click goes through to the chair and picks its row.
  camera = await settledCamera(page)
  const chairAt = await worldToClient(page, chair, camera)
  await tapAt(page, chairAt)
  expect(await selectedIds(page)).toEqual([onChair.id])
  const lock = page.getByTestId('notes-lock')
  await lock.click()
  await expect(lock).toHaveAttribute('aria-pressed', 'true')
  await tapAt(page, chairAt)
  expect(await selectedIds(page)).toEqual([front.id])
})

test('the Notes tab lists each note with its author, a click brings the note into view, and Done greys it out', async ({ context, page }, testInfo) => {
  await presetAuthor(context, 'Noa')
  const [table] = roundTables({ x: 0, y: 0 })
  // The newer note far off to the right; the older one beside the table.
  const far = note('sticky', { x: 3000, y: 0 }, 'Aiden', 'Ask about the cake', Date.now() - 60_000)
  const near = note('box', { x: 0, y: 400 }, 'Noa', '', Date.now() - 3_600_000)
  const { layout } = await openWith(page, testInfo, 'Notes tab', [table, far, near])
  const phone = await isPhoneLayout(page)

  // Zoomed in on the middle, the far note is off screen.
  await zoomButtonsTo(page, '100%')
  const view = (await viewport(page).boundingBox())!
  const offScreen = await clientMiddle(itemLocator(page, far.id))
  expect(offScreen.x).toBeGreaterThan(view.x + view.width)

  const panel = await openNotesTab(page)
  const rows = panel.locator('li[data-note-id]')
  await expect(rows).toHaveCount(2)
  // Newest first, each with who added it.
  await expect(rows.nth(0)).toHaveAttribute('data-note-id', far.id)
  await expect(rows.nth(0)).toContainText('Ask about the cake')
  await expect(rows.nth(0)).toContainText('Aiden')
  await expect(rows.nth(1)).toHaveAttribute('data-note-id', near.id)
  await expect(rows.nth(1)).toContainText('Box')
  await expect(rows.nth(1)).toContainText('Noa')
  expect((await rows.nth(0).getByTestId('note-row').boundingBox())!.height).toBeGreaterThanOrEqual(44)

  // A click selects the note and brings it into view (a phone lowers its sheet).
  await rows.nth(0).getByTestId('note-row').click()
  if (phone) await expect(page.getByTestId('bottom-sheet')).toHaveAttribute('data-snap', 'strip')
  await settledCamera(page)
  expect(await selectedIds(page)).toEqual([far.id])
  const shown = await clientMiddle(itemLocator(page, far.id))
  const free = phone ? Math.min(view.y + view.height, (await page.getByTestId('bottom-sheet').boundingBox())!.y) : view.y + view.height
  expect(shown.x).toBeGreaterThan(view.x)
  expect(shown.x).toBeLessThan(view.x + view.width)
  expect(shown.y).toBeGreaterThan(view.y)
  expect(shown.y).toBeLessThan(free)

  // Done: the row and the note on the plan grey out, and the server has it.
  const again = await openNotesTab(page)
  const row = again.locator(`li[data-note-id="${far.id}"]`)
  await row.getByTestId('note-done').click()
  await expect(row).toHaveAttribute('data-done', 'true')
  await expect(row.getByTestId('note-chip')).toHaveClass(/opacity-45/)
  await expect(itemLocator(page, far.id)).toHaveAttribute('data-done', 'true')
  await expect(itemLocator(page, far.id)).toHaveAttribute('opacity', '0.45')
  await expect(itemLocator(page, near.id)).not.toHaveAttribute('data-done', 'true')
  // The Done filter lists it alone.
  await again.getByRole('radio', { name: /^Done/ }).click()
  await expect(again.locator('li[data-note-id]')).toHaveCount(1)
  await expectSaved(page)
  const stored = (await storedItems(page, layout.id)).find((i) => i.id === far.id) as Note
  expect(stored.done).toBe(true)
})
