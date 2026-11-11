/**
 * Acceptance check 23: a vector PDF floor plan imports its walls from the
 * PDF's own lines (spec section 5 step 2; PLAN change 21 and section 7,
 * "Floor plan import" and "Scale").
 *
 * The PDF is made with pdf-lib when the test runs
 * (src/domain/floorplan/__fixtures__/plans.ts: a 10 m by 8 m room at 1:50,
 * 20 cm walls drawn as one thick stroke, a 0.9 m door with its leaf and
 * swing, hatching, a column, a partition inside a squeezed form XObject and
 * a "10.00 m" dimension line). In the browser, pdf.js renders the page and
 * reads its lines; the import sends them numbered with the picture. The
 * stand-in model labels them by id and never sends coordinates back, so the
 * walls can only come from the PDF itself. The scale comes from the PDF's own
 * dimension line; once confirmed, the accepted walls must be the PDF's lines
 * at that scale, and the room's real sizes.
 *
 * A black and white scan stored as CCITT fax renders its picture, which only
 * works when pdf.js finds its image decoders under /pdfjs-wasm/.
 */
import { expect, test } from '@playwright/test'
import { makeCcittScanPdf, makeRoomPdf, PAGE_PT, PT_PER_M, ROOM } from '../src/domain/floorplan/__fixtures__/plans'
import type { FixedItem } from '../src/domain/venue-schema'
import { presetAuthor, signIn, uniqueName } from './helpers'
import { standInCallsFor, type SeenSegment } from './stand-in-anthropic'
import { apiCreateVenue, apiGetVenue, expectTemplateSaved, fixedOnCanvas, openTemplateEditor, startImport, templateStatus } from './venues'

test.beforeEach(async ({ context }) => {
  await presetAuthor(context, 'Noa')
})

type Wall = Extract<FixedItem, { type: 'wall' }>

/** How far a wall is from a PDF line (px) at a scale: the larger end gap, either way round, in cm. */
function wallGap(wall: Wall, s: SeenSegment, cmPerPx: number): number {
  if (wall.points.length !== 2) return Infinity
  const [a, b] = wall.points
  const p = { x: s.x1 * cmPerPx, y: s.y1 * cmPerPx }
  const q = { x: s.x2 * cmPerPx, y: s.y2 * cmPerPx }
  const d = (u: { x: number; y: number }, v: { x: number; y: number }) => Math.hypot(u.x - v.x, u.y - v.y)
  return Math.min(Math.max(d(a, p), d(b, q)), Math.max(d(a, q), d(b, p)))
}

test('check 23: a vector PDF imports its walls from its own lines, at the scale its dimension line gives', async ({ page }, testInfo) => {
  test.slow()
  await signIn(page)
  const name = uniqueName('Vector Hall', testInfo)
  const venue = await apiCreateVenue(page.request, name)
  await openTemplateEditor(page, venue.id)

  const pdf = Buffer.from(await makeRoomPdf())
  const image = await startImport(page, venue.id, { name: 'room-plan.pdf', mimeType: 'application/pdf', buffer: pdf })
  // The page went up as a PNG rendered at the largest size the model reads whole.
  expect(image.contentType).toBe('image/png')
  expect(image.width / image.height).toBeCloseTo(PAGE_PT.width / PAGE_PT.height, 2)
  expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(2576)
  await expect(page.getByRole('dialog', { name: 'Import a floor plan' })).toBeHidden({ timeout: 30_000 })
  await expect(templateStatus(page)).toHaveText('Draft, not saved')
  const panel = page.getByTestId('draft-panel')
  await expect(panel).toContainText('From PDF page 1, using its own lines.')
  await expect(page.getByTestId('template-canvas').locator('[data-testid="reference-image"]')).toHaveAttribute('opacity', '0.5')

  // ---- What went to the model: the picture and the PDF's own lines, numbered.
  const calls = await standInCallsFor(name)
  expect(calls).toHaveLength(1)
  const call = calls[0]
  expect(call).toMatchObject({ answer: 'pdf walls', imageSha256: image.sha256, imageWidth: image.width, imageHeight: image.height, schemaType: 'json_schema' })
  expect(call.prompt).toContain('The plan comes from a PDF, and its lines are listed below, numbered.')
  expect(call.prompt).toContain('"MAIN ROOM"')
  // The walls and the door leaf; hatching, the dimension line and the swing never get there.
  expect(call.segments.length).toBeGreaterThanOrEqual(6)
  expect(call.segments.length).toBeLessThanOrEqual(7)
  const thickest = Math.max(...call.segments.map((s) => s.thickness))
  const wallLines = call.segments.filter((s) => s.thickness >= thickest / 5)
  expect(wallLines).toHaveLength(ROOM.wallLengths.length)

  // ---- The draft draws one wall per labelled line, and the door in its gap.
  await expect(fixedOnCanvas(page, 'wall')).toHaveCount(wallLines.length)
  await expect(fixedOnCanvas(page, 'door')).toHaveCount(1)
  // Nothing was saved yet.
  expect(await apiGetVenue(page.request, venue.id)).toMatchObject({ version: 1, fixedItems: [], referenceImage: null })

  // ---- The scale comes from the PDF's "10.00 m" line; confirm it and accept.
  const scale = panel.getByTestId('scale-step')
  await expect(scale).toContainText('The label “10.00 m” measures')
  await scale.getByTestId('scale-confirm').click()
  await expect(scale).toContainText('Scale set.')
  await panel.getByTestId('draft-accept').click()
  await expect(page.getByTestId('editor-notice')).toHaveText('Import saved. Undo import is in Revisions.')
  await expectTemplateSaved(page)

  const saved = await apiGetVenue(page.request, venue.id)
  expect(saved).toMatchObject({ version: 2, importedBy: 'pdf vectors' })
  expect(saved.referenceImage?.id).toBe(image.id)
  const cmPerPx = saved.reference?.scaleCmPerPx ?? NaN
  // The confirmed scale is the dimension line's: 10 m over the room's width on the page, in the picture's pixels.
  const pxPerPt = image.width / PAGE_PT.width
  expect(cmPerPx).toBeCloseTo(1000 / (ROOM.width * PT_PER_M * pxPerPt), 2)

  // Every accepted wall is one of the PDF's lines at that scale (within half a pixel of the listed, rounded line).
  const walls = saved.fixedItems.filter((i): i is Wall => i.type === 'wall')
  expect(walls).toHaveLength(wallLines.length)
  const halfPixel = 0.75 * cmPerPx
  for (const line of wallLines) {
    const gaps = walls.map((w) => wallGap(w, line, cmPerPx))
    expect(Math.min(...gaps), `the wall from PDF line ${line.id}`).toBeLessThan(halfPixel)
  }
  // So the room comes out at its real size: 4 m and 5.1 m either side of the door, 8 m and 10 m sides, a 1.76 m partition.
  const lengths = walls.map((w) => Math.hypot(w.points[1].x - w.points[0].x, w.points[1].y - w.points[0].y) / 100).sort((a, b) => a - b)
  const expected = [...ROOM.wallLengths].sort((a, b) => a - b)
  lengths.forEach((m, i) => expect(Math.abs(m - expected[i]), `wall ${i}: ${m.toFixed(3)} m`).toBeLessThan(0.01))
  // The outer walls keep the PDF's own 20 cm thickness.
  const outer = walls.filter((w) => Math.abs(w.thickness - ROOM.wall * 100) < 1)
  expect(outer).toHaveLength(5)
  // The room is 10 m by 8 m between the walls' centre lines.
  const xs = outer.flatMap((w) => w.points.map((p) => p.x))
  const ys = outer.flatMap((w) => w.points.map((p) => p.y))
  expect((Math.max(...xs) - Math.min(...xs)) / 100).toBeCloseTo(ROOM.width, 2)
  expect((Math.max(...ys) - Math.min(...ys)) / 100).toBeCloseTo(ROOM.depth, 2)
  // The door sits in the 0.9 m gap on the bottom wall.
  const door = saved.fixedItems.find((i) => i.type === 'door')
  expect(door?.type === 'door' && door.width / 100).toBeCloseTo(ROOM.doorTo - ROOM.doorFrom, 2)
  expect(door?.type === 'door' && walls.some((w) => w.id === door.wallId)).toBe(true)
})

test('a black and white scan (CCITT fax) renders its picture: pdf.js loads its decoders from /pdfjs-wasm/', async ({ page }, testInfo) => {
  await signIn(page)
  const name = uniqueName('Scanned Hall', testInfo)
  const venue = await apiCreateVenue(page.request, name)
  await openTemplateEditor(page, venue.id)

  // The decoders are served behind the sign-in, from the pinned pdfjs-dist.
  const wasm = await page.request.get('/pdfjs-wasm/jbig2.wasm')
  expect(wasm.status()).toBe(200)
  expect((await wasm.body()).subarray(0, 4).toString('latin1')).toBe('\0asm')

  const decoders = page.waitForResponse((res) => new URL(res.url()).pathname === '/pdfjs-wasm/jbig2.wasm', { timeout: 20_000 })
  const pdf = Buffer.from(await makeCcittScanPdf())
  const image = await startImport(page, venue.id, { name: 'scan.pdf', mimeType: 'application/pdf', buffer: pdf })
  expect((await decoders).status()).toBe(200)
  // The uploaded page is the scan's picture (solid black here), not a blank white page.
  const centre = await page.evaluate(async (url) => {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return Array.from(ctx.getImageData(img.naturalWidth >> 1, img.naturalHeight >> 1, 1, 1).data)
  }, image.url)
  expect(centre.slice(0, 3)).toEqual([0, 0, 0])
  // It went to the model as a picture (the stand-in has no reply recorded for this size, and refuses it).
  const dialog = page.getByRole('dialog', { name: 'Import a floor plan' })
  await expect(dialog.getByTestId('import-error')).toHaveText('The AI service refused the request (request req_stand_in). The server log says why.', { timeout: 20_000 })
  const calls = await standInCallsFor(name)
  expect(calls.map((c) => [c.imageSha256, c.segments.length])).toEqual([[image.sha256, 0]])
})
