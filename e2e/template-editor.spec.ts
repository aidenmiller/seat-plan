/**
 * Milestone 7, the template editor (spec section 5, "Venue templates"; PLAN
 * section 7): draw a wall by clicking its points and double-clicking the
 * last, type an exact length for a side, drop a door near the wall and see it
 * snap on, drag out a room, undo and redo, and find it all again after a
 * reload. A layout that uses the template draws the wall; moving the wall
 * through one of its tables lists that layout and table in the template
 * editor (and a later change that crosses nothing new does not list it
 * again), and the layout editor outlines the table.
 *
 * The drawing test runs on the laptop; phones get a short smoke test (Tools
 * drawer, two taps and Finish, saved, at 390 px).
 */
import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { addRoundTable } from '../src/domain/round-table'
import type { Table } from '../src/domain/canvas-schema'
import { mouseDrag, Touch, type Point } from './canvas'
import { apiCreateLayout, apiCreateWedding, apiGetLayout, apiPutCanvas, canvasTables, editorPath, presetAuthor, signIn, uniqueName } from './helpers'
import {
  apiCreateVenue,
  apiGetVenue,
  drawnBoxPlace,
  drawnWallPoints,
  expectTemplateSaved,
  fixedOnCanvas,
  isTemplatePhone,
  openTemplateEditor,
  openTemplateTab,
  pickTool,
  setTemplateMode,
  templateCamera,
  templateCenterOnGrid,
  templateToClient,
  templateViewportBox,
} from './venues'

const FOOT = 30.48

test.beforeEach(async ({ context }) => {
  await presetAuthor(context, 'Noa')
})

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)

test('draw a wall, type a side length, snap a door, add a room, undo and redo, and find it all after a reload; a layout shows the wall and flags a table it is moved through', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Drawing with a mouse is a laptop test; phones have their own smoke test below.')
  test.slow()
  await signIn(page)
  const venueName = uniqueName('Drawn Hall', testInfo)
  const venue = await apiCreateVenue(page.request, venueName)
  const weddingName = uniqueName('Walls', testInfo)
  const wedding = await apiCreateWedding(page.request, weddingName)

  await openTemplateEditor(page, venue.id, wedding.id)
  await page.getByRole('button', { name: 'Zoom to 100%' }).click()
  await expect.poll(async () => (await templateCamera(page)).zoom).toBe(1)
  let camera = await templateCamera(page)
  // Everything is drawn round O, a whole-foot point in the middle of the view.
  const O = await templateCenterOnGrid(page, camera)
  const at = (dxFt: number, dyFt: number): Point => ({ x: O.x + dxFt * FOOT, y: O.y + dyFt * FOOT })
  const client = (p: Point) => templateToClient(page, p, camera)

  // ---- A wall: click, click, double-click the last point.
  await pickTool(page, 'wall')
  await expect(page.getByTestId('draw-hint')).toContainText('Click to place points. Double-click or press Enter to finish.')
  const A = at(-10, -5)
  const B = at(5, -5)
  const C = at(5, 3)
  for (const p of [A, B]) {
    const c = await client(p)
    await page.mouse.click(c.x, c.y)
  }
  // Drawing: the dashed preview follows the points, and Finish shows for phones' sake.
  await expect(page.getByTestId('drawing-preview')).toHaveCount(1)
  await expect(page.getByTestId('finish-drawing')).toBeVisible()
  const c3 = await client(C)
  await page.mouse.dblclick(c3.x, c3.y)
  await expect(fixedOnCanvas(page, 'wall')).toHaveCount(1)
  const wall = fixedOnCanvas(page, 'wall')
  let points = await drawnWallPoints(wall)
  expect(points).toHaveLength(3)
  for (const [i, p] of [A, B, C].entries()) {
    expect(points[i].x).toBeCloseTo(p.x, 6)
    expect(points[i].y).toBeCloseTo(p.y, 6)
  }
  // Finished: back to Select, the new wall selected with its first side picked.
  await expect(page.getByTestId('draw-hint')).toBeHidden()
  const props = page.getByTestId('template-properties')
  await expect(props.getByTestId('side-length-section')).toContainText('Side 1 of 2')
  const length = props.getByTestId('side-length')
  await expect(length).toHaveValue('15′ 0″')

  // ---- Type the exact length: 20 ft moves the far end along the side's line.
  await length.click()
  await length.fill('20 ft')
  await length.press('Enter')
  await expect(length).toHaveValue('20′ 0″')
  points = await drawnWallPoints(wall)
  expect(dist(points[0], points[1])).toBeCloseTo(20 * FOOT, 6)
  expect(points[0].x).toBeCloseTo(A.x, 6)
  expect(points[0].y).toBeCloseTo(A.y, 6)
  expect(points[1].y).toBeCloseTo(A.y, 6)
  // Any unit works: the field shows feet and inches.
  await length.click()
  await length.fill('6.096 m')
  await length.press('Enter')
  await expect(length).toHaveValue('20′ 0″')

  // ---- A door dropped 2 ft below the wall snaps onto it, turned along it.
  await pickTool(page, 'door')
  const doorDrop = at(0, -3)
  const d = await client(doorDrop)
  await page.mouse.click(d.x, d.y)
  await expect(fixedOnCanvas(page, 'door')).toHaveCount(1)
  const door = await drawnBoxPlace(fixedOnCanvas(page, 'door'))
  // Along the wall it stays where it was dropped (within the half pixel a click can land off); across, it sits on the wall's line.
  expect(Math.abs(door.x - doorDrop.x)).toBeLessThan(1)
  expect(door.y).toBeCloseTo(A.y, 6)
  expect(Math.round(door.rotation) % 180).toBe(0)
  await expect(props).toContainText('On a wall.')

  // ---- A room, dragged out as a rectangle (snapped to whole feet).
  await pickTool(page, 'room')
  await mouseDrag(page, await client(at(-9, -3)), await client(at(-4, 1)))
  await expect(fixedOnCanvas(page, 'room')).toHaveCount(1)
  const roomPoints = (await fixedOnCanvas(page, 'room').locator('polygon').getAttribute('points')) ?? ''
  expect(roomPoints.trim().split(/\s+/)).toHaveLength(4)

  // ---- Undo takes the room away, Redo brings it back.
  const toolbar = page.getByTestId('template-toolbar')
  await toolbar.getByRole('button', { name: 'Undo' }).click()
  await expect(fixedOnCanvas(page, 'room')).toHaveCount(0)
  await expect(fixedOnCanvas(page, 'wall')).toHaveCount(1)
  await expect(fixedOnCanvas(page, 'door')).toHaveCount(1)
  await toolbar.getByRole('button', { name: 'Redo' }).click()
  await expect(fixedOnCanvas(page, 'room')).toHaveCount(1)

  // ---- Saved: after a reload everything is there, and the server has it.
  await expectTemplateSaved(page)
  await page.reload()
  await expectTemplateSaved(page)
  await expect(fixedOnCanvas(page, 'wall')).toHaveCount(1)
  await expect(fixedOnCanvas(page, 'door')).toHaveCount(1)
  await expect(fixedOnCanvas(page, 'room')).toHaveCount(1)
  points = await drawnWallPoints(fixedOnCanvas(page, 'wall'))
  expect(dist(points[0], points[1])).toBeCloseTo(20 * FOOT, 6)
  const stored = await apiGetVenue(page.request, venue.id)
  expect(stored.version).toBeGreaterThan(1)
  expect(stored.fixedItems.map((i) => i.type).sort()).toEqual(['door', 'room', 'wall'])
  const storedWall = stored.fixedItems.find((i) => i.type === 'wall')
  const storedDoor = stored.fixedItems.find((i) => i.type === 'door')
  expect(storedWall?.type === 'wall' && dist(storedWall.points[0], storedWall.points[1])).toBeCloseTo(20 * FOOT, 6)
  expect(storedDoor?.type === 'door' && storedDoor.wallId).toBe(storedWall?.id)

  // ---- A layout that uses the venue draws its wall, door and room.
  const layoutName = 'Dinner plan'
  const layout = await apiCreateLayout(page.request, wedding.id, { name: layoutName, venueTemplateId: venue.id })
  // One round table 10 ft below the wall's first side, clear of it.
  const fresh = await apiGetLayout(page.request, layout.id)
  const tableId = randomUUID()
  const withTable = addRoundTable(fresh.canvas, tableId)
  const tableAt = at(-6.5, 5)
  const canvas = { ...withTable, items: withTable.items.map((i) => (i.id === tableId ? ({ ...i, x: tableAt.x, y: tableAt.y } as Table) : i)) }
  await apiPutCanvas(page.request, fresh, canvas)

  const layoutPage = await page.context().newPage()
  await layoutPage.goto(editorPath(wedding.id, layout.id))
  const venueLayer = layoutPage.getByTestId('canvas').locator('[data-layer="venue"]')
  await expect(venueLayer.locator('[data-venue-type="wall"]')).toHaveCount(1)
  await expect(venueLayer.locator('[data-venue-type="door"]')).toHaveCount(1)
  await expect(venueLayer.locator('[data-venue-type="room"]')).toHaveCount(1)
  await expect(canvasTables(layoutPage)).toHaveCount(1)
  await expect(canvasTables(layoutPage).first()).not.toHaveAttribute('data-wall-crossing', 'true')
  await layoutPage.close()

  // ---- Moving the wall 10 ft down puts it through that table.
  await page.reload()
  await expectTemplateSaved(page)
  camera = await templateCamera(page)
  // The wall's first side, clear of the door in its middle.
  const grab = await client(at(-8, -5))
  await page.mouse.click(grab.x, grab.y)
  await expect(props.getByTestId('side-length-section')).toBeVisible()
  await mouseDrag(page, grab, { x: grab.x, y: grab.y + 10 * FOOT * camera.zoom })
  points = await drawnWallPoints(fixedOnCanvas(page, 'wall'))
  expect(points[0].y).toBeCloseTo(tableAt.y, 3)
  await expectTemplateSaved(page)

  const banner = page.getByTestId('wall-check')
  await expect(banner).toContainText('This change puts a wall through 1 table in 1 layout')
  const affected = banner.getByRole('listitem')
  await expect(affected).toHaveCount(1)
  await expect(affected).toContainText(`${weddingName} · ${layoutName}`)
  await expect(affected).toContainText('Table 1')
  const check = (await (await page.request.get(`/api/venues/${venue.id}/wall-check`)).json()) as {
    layouts: { layoutId: string; tables: { tableId: string; label: string }[] }[]
  }
  expect(check.layouts).toEqual([expect.objectContaining({ layoutId: layout.id, tables: [expect.objectContaining({ tableId, label: 'Table 1' })] })])

  const link = affected.getByRole('link', { name: `${weddingName} · ${layoutName}` })
  await expect(link).toHaveAttribute('href', editorPath(wedding.id, layout.id))

  // ---- A later change that crosses nothing new (a thicker wall) is not blamed for that table again.
  const rechecked = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/venues/${venue.id}/wall-check`)
  const thickness = props.getByTestId('wall-thickness')
  await thickness.click()
  await thickness.fill('8 in')
  await thickness.press('Enter')
  await expectTemplateSaved(page)
  expect((await rechecked).status()).toBe(200)
  await expect(banner).toHaveCount(0)

  // ---- The layout editor outlines that table.
  await page.goto(editorPath(wedding.id, layout.id))
  const table = canvasTables(page).first()
  await expect(table).toHaveAttribute('data-wall-crossing', 'true')
  await expect(table.locator('[data-wall-outline]')).toHaveCount(1)
  await expect(table.locator(':scope > title')).toHaveText(/crosses a wall$/)
})

test('phone smoke test: the template editor fits 390 px, and a wall drawn with taps and Finish is saved', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'The laptop has the full drawing test above.')
  await signIn(page)
  const venue = await apiCreateVenue(page.request, uniqueName('Pocket Hall', testInfo))
  await page.goto(`/venues/${venue.id}`)
  expect(await isTemplatePhone(page)).toBe(true)
  // Phones open in View mode; Edit shows the Tools button.
  await expect(page.getByTestId('mode-switch')).toHaveAttribute('aria-checked', 'false')
  await setTemplateMode(page, 'edit')
  await expectTemplateSaved(page)

  // Nothing is wider than the phone, and the controls are big enough to tap.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  for (const control of [
    page.getByTestId('open-tools'),
    page.getByTestId('template-toolbar').getByRole('button', { name: 'Undo' }),
    page.getByTestId('mode-switch'),
    page.getByRole('link', { name: 'Back to venues' }),
  ]) {
    const box = await control.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }

  await page.getByRole('button', { name: 'Zoom to 100%' }).click()
  await expect.poll(async () => (await templateCamera(page)).zoom).toBe(1)
  const camera = await templateCamera(page)
  const O = await templateCenterOnGrid(page, camera)
  const box = await templateViewportBox(page)
  const A = { x: O.x - 4 * FOOT, y: O.y }
  const B = { x: O.x + 4 * FOOT, y: O.y }
  const a = await templateToClient(page, A, camera)
  const b = await templateToClient(page, B, camera)
  expect(a.x).toBeGreaterThan(box.x)
  expect(b.x).toBeLessThan(box.x + box.width)

  // Tools, Wall, two taps, Finish.
  await pickTool(page, 'wall')
  const touch = await Touch.on(page)
  await touch.tap(a)
  await touch.tap(b)
  const finish = page.getByTestId('finish-drawing')
  await expect(finish).toBeVisible()
  const finishBox = await finish.boundingBox()
  expect(finishBox?.height ?? 0).toBeGreaterThanOrEqual(44)
  await finish.tap()
  await expect(fixedOnCanvas(page, 'wall')).toHaveCount(1)
  const points = await drawnWallPoints(fixedOnCanvas(page, 'wall'))
  expect(points).toHaveLength(2)
  expect(dist(points[0], points[1])).toBeCloseTo(8 * FOOT, 6)

  // The side's length shows in the sheet's Properties tab.
  await openTemplateTab(page, 'Properties')
  await expect(page.getByTestId('side-length-section').getByTestId('side-length')).toHaveValue('8′ 0″')
  // The canvas labels the picked side with its length too.
  await expect(page.getByTestId('template-overlay').getByTestId('side-length')).toHaveText('8′ 0″')

  await expectTemplateSaved(page)
  await page.reload()
  await expect(fixedOnCanvas(page, 'wall')).toHaveCount(1)
  expect((await apiGetVenue(page.request, venue.id)).fixedItems.map((i) => i.type)).toEqual(['wall'])
})
