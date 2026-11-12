/**
 * Acceptance check 26: dragging a table within 5 ft of another shows the gap
 * and a warning, and still lets the move happen (spec section 4, "Space
 * check"). The gap is between the table edges, chairs not counted, in the
 * wedding's unit (feet and inches here).
 */
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { emptyCanvas, type Canvas } from '../src/domain/canvas-schema'
import { makeItem } from '../src/domain/presets'
import { DEFAULT_MIN_GAP_CM, gapText, nearestTableGap } from '../src/domain/spacing'
import { isPhoneLayout, readTable, settledCamera, tableClientCenter, Touch, type Point } from './canvas'
import { apiCreateLayout, apiCreateWedding, apiGetLayout, apiPutCanvas, editorPath, expectSaved, signIn, uniqueName, waitForEditor } from './helpers'

const FOOT = 30.48

test('dragging a table within 5 ft of another shows the gap in feet and inches with a warning, and the move happens', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Space check', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  // Two round tables 400 cm apart center to center: about 8′ 1″ between their edges.
  const still = randomUUID()
  const moving = randomUUID()
  let canvas: Canvas = emptyCanvas()
  canvas = { ...canvas, items: [makeItem('round', { x: 0, y: 0 }, still, canvas)] }
  canvas = { ...canvas, items: [...canvas.items, makeItem('round', { x: 400, y: 0 }, moving, canvas)] }
  const startGap = nearestTableGap(canvas, moving)!.gapCm
  expect(startGap).toBeGreaterThan(DEFAULT_MIN_GAP_CM)
  const saved = await apiPutCanvas(page.request, layout, canvas)

  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  await expectSaved(page)
  const phone = await isPhoneLayout(page)
  const camera = await settledCamera(page)
  const start = await tableClientCenter(page, moving, camera)
  const readout = page.getByTestId('gap-readout')
  const touch = phone ? await Touch.on(page) : null

  // On a phone one finger moves a table once it is selected; a tap selects it.
  if (touch) {
    await touch.tap(start)
    expect((await readTable(page, moving)).selected).toBe(true)
  }
  const down = async (p: Point) => (touch ? touch.down([{ ...p, id: 1 }]) : (await page.mouse.move(p.x, p.y), page.mouse.down()))
  const moveTo = async (p: Point) => (touch ? touch.move([{ ...p, id: 1 }]) : page.mouse.move(p.x, p.y))
  const up = async () => (touch ? touch.up() : page.mouse.up())
  const at = (feet: number): Point => ({ x: start.x + feet * FOOT * camera.zoom, y: start.y })

  await down(start)
  for (const f of [0.25, 0.5, 0.75, 1]) await moveTo(at(f))
  // A foot farther away: the gap shows, with no warning.
  await expect(readout).toBeVisible()
  await expect(readout).toHaveAttribute('data-warn', 'false')
  await expect(readout).toHaveText(/^\d+′ \d+″$/)
  await expect(readout).not.toHaveClass(/amber/)

  // Five feet closer than the start: under 5 ft, so the readout warns.
  for (let f = 0.5; f >= -5; f -= 0.5) await moveTo(at(f))
  await expect(readout).toHaveAttribute('data-warn', 'true')
  await expect(readout).toHaveText(/^(\d+′ )?\d+″ · too close$/)
  await expect(readout).toHaveClass(/amber/)
  const shown = (await readout.textContent()) ?? ''
  await up()
  await expect(readout).toBeHidden()

  // The move happened, and saved.
  const after = await readTable(page, moving)
  expect(after.x - 400).toBeLessThan(-5 * FOOT + 31)
  expect(after.x - 400).toBeGreaterThan(-5 * FOOT - 31)
  await expectSaved(page)
  const stored = await apiGetLayout(page.request, layout.id)
  expect(stored.version).toBe(saved.version + 1)
  const storedTable = stored.canvas.items.find((item) => item.id === moving)!
  expect(storedTable.x).toBeCloseTo(after.x, 6)
  // The readout said what the space check works out for where the table landed.
  const gap = nearestTableGap(stored.canvas, moving)!
  expect(gap.otherId).toBe(still)
  expect(gap.gapCm).toBeLessThan(DEFAULT_MIN_GAP_CM)
  expect(gap.gapCm).toBeGreaterThan(0)
  expect(shown).toBe(`${gapText(gap.gapCm, 'ft')} · too close`)
})

test('two 60 in round tables with their edges 5 ft apart read 5′ 0″ with no warning; 4 ft apart they warn', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Five feet', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  // Centers 11 ft apart on the grid: 6 ft between the table edges (each 2½ ft from its center), chairs not counted.
  const still = randomUUID()
  const moving = randomUUID()
  let canvas: Canvas = emptyCanvas()
  canvas = { ...canvas, items: [makeItem('round', { x: 0, y: 0 }, still, canvas)] }
  canvas = { ...canvas, items: [...canvas.items, makeItem('round', { x: 11 * FOOT, y: 0 }, moving, canvas)] }
  expect(nearestTableGap(canvas, moving)!.gapCm).toBeCloseTo(6 * FOOT, 6)
  await apiPutCanvas(page.request, layout, canvas)

  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  await expectSaved(page)
  const phone = await isPhoneLayout(page)
  const camera = await settledCamera(page)
  const start = await tableClientCenter(page, moving, camera)
  const readout = page.getByTestId('gap-readout')
  const touch = phone ? await Touch.on(page) : null
  if (touch) {
    await touch.tap(start)
    expect((await readTable(page, moving)).selected).toBe(true)
  }
  const down = async (p: Point) => (touch ? touch.down([{ ...p, id: 1 }]) : (await page.mouse.move(p.x, p.y), page.mouse.down()))
  const moveTo = async (p: Point) => (touch ? touch.move([{ ...p, id: 1 }]) : page.mouse.move(p.x, p.y))
  const up = async () => (touch ? touch.up() : page.mouse.up())
  // Feet toward the other table; the grid snaps the center back onto whole feet.
  const at = (feet: number): Point => ({ x: start.x - feet * FOOT * camera.zoom, y: start.y })

  await down(start)
  for (const f of [0.25, 0.5, 0.75, 1]) await moveTo(at(f))
  // Edges exactly 5 ft apart: the minimum itself, so no warning.
  await expect(readout).toHaveText('5′ 0″')
  await expect(readout).toHaveAttribute('data-warn', 'false')
  await expect(readout).not.toHaveClass(/amber/)

  for (const f of [1.25, 1.5, 1.75, 2]) await moveTo(at(f))
  // 4 ft apart: under the minimum, in amber.
  await expect(readout).toHaveText('4′ 0″ · too close')
  await expect(readout).toHaveAttribute('data-warn', 'true')
  await expect(readout).toHaveClass(/amber/)
  await up()
  await expect(readout).toBeHidden()

  // The table stays where it was dropped (a warning never blocks the move), 9 ft from the other's center.
  expect((await readTable(page, moving)).x).toBeCloseTo(9 * FOOT, 6)
  await expectSaved(page)
  const stored = await apiGetLayout(page.request, layout.id)
  const gap = nearestTableGap(stored.canvas, moving)!
  expect(gap.gapCm).toBeCloseTo(4 * FOOT, 6)
  expect(gapText(gap.gapCm, 'ft')).toBe('4′ 0″')

  // Dragged back a foot, the readout is plain 5′ 0″ again.
  const now = await settledCamera(page)
  const from = await tableClientCenter(page, moving, now)
  await down(from)
  for (const f of [0.25, 0.5, 0.75, 1]) await moveTo({ x: from.x + f * FOOT * now.zoom, y: from.y })
  await expect(readout).toHaveText('5′ 0″')
  await expect(readout).toHaveAttribute('data-warn', 'false')
  await up()
  await expectSaved(page)
  expect(nearestTableGap((await apiGetLayout(page.request, layout.id)).canvas, moving)!.gapCm).toBeCloseTo(5 * FOOT, 6)
})
