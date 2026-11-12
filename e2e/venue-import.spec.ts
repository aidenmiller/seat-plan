/**
 * Acceptance check 22: uploading a floor plan image returns an editable
 * vector draft over the faded original, and nothing changes in the template
 * until Accept is pressed (spec section 5, "Floor plan import with AI"; PLAN
 * section 7, "Floor plan import", "Scale", "Draft and Accept").
 *
 * The app talks to the stand-in Anthropic API (e2e/stand-in-anthropic.ts),
 * which answers the PNG plan from fixtures/floorplan-png.ts with the draft
 * recorded in fixtures/floorplan-draft.json. The template is read through the
 * API at each step: its version and fixed items stay as they were until
 * Accept; after Accept its walls are the draft's; Undo import puts the empty
 * template back. A refusal from the model shows a plain message.
 *
 * Saves from another device (the same planner, through the API, so the
 * words say "you") meet an open draft's Accept and a later Undo import:
 * nothing is lost, the editor asks or says what it loaded, and the second
 * try goes through. The stored plan picture
 * runs through the import again from the Plan image tab.
 */
import { expect, test } from '@playwright/test'
import { PLAN_PNG, PLAN_PNG_CM_PER_PX, makePlanPng } from './fixtures/floorplan-png'
import { signIn, uniqueName } from './helpers'
import { REFUSAL_MARKER, readRecordedDraft, standInCallsFor } from './stand-in-anthropic'
import {
  apiCreateVenue,
  apiGetVenue,
  apiSaveVenue,
  apiVenueRevisions,
  drawnBoxPlace,
  drawnWallPoints,
  expectTemplateSaved,
  fixedOnCanvas,
  openTemplateEditor,
  openTemplateTab,
  pngSize,
  startImport,
  templateStatus,
  wallItem,
} from './venues'
import type { Point } from './canvas'

const PNG_FILE = () => ({ name: 'floor-plan.png', mimeType: 'image/png', buffer: makePlanPng() })
const S = PLAN_PNG_CM_PER_PX
const cm = (p: Point): Point => ({ x: p.x * S, y: p.y * S })

function expectPoints(actual: Point[], expected: Point[], digits = 6) {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((p, i) => {
    expect(actual[i].x, `point ${i} x`).toBeCloseTo(p.x, digits)
    expect(actual[i].y, `point ${i} y`).toBeCloseTo(p.y, digits)
  })
}

test('check 22: a PNG plan comes back as an editable draft over the faded original; the template changes only on Accept, and Undo import puts it back', async ({
  page,
}, testInfo) => {
  test.slow()
  await signIn(page)
  const name = uniqueName('Import Hall', testInfo)
  const venue = await apiCreateVenue(page.request, name)
  await openTemplateEditor(page, venue.id)
  const empty = await apiGetVenue(page.request, venue.id)
  expect(empty).toMatchObject({ version: 1, fixedItems: [], reference: null, referenceImage: null, importedBy: 'hand' })

  // ---- Upload the plan; the stand-in model answers with the recorded draft.
  const image = await startImport(page, venue.id, PNG_FILE())
  expect(image).toMatchObject({ contentType: 'image/png', width: PLAN_PNG.width, height: PLAN_PNG.height })
  await expect(page.getByRole('dialog', { name: 'Import a floor plan' })).toBeHidden({ timeout: 20_000 })
  await expect(templateStatus(page)).toHaveAttribute('data-status', 'draft')
  await expect(templateStatus(page)).toHaveText('Draft, not saved')
  const panel = page.getByTestId('draft-panel')
  await expect(panel).toContainText('From a picture.')
  await expect(panel).toContainText('Nothing changes in this venue until you press Accept.')

  // What the app sent: the stored picture at its own size, the prompt, and the JSON schema.
  const calls = await standInCallsFor(name)
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({
    model: 'claude-sonnet-5-5',
    imageMediaType: 'image/png',
    imageSha256: image.sha256,
    imageWidth: PLAN_PNG.width,
    imageHeight: PLAN_PNG.height,
    schemaType: 'json_schema',
    answer: 'recorded draft',
    segments: [],
  })
  expect(calls[0].prompt).toContain('The plan is a picture with no line data.')

  // ---- Over the faded original: the stored picture, half see-through, at the draft's scale.
  const original = page.getByTestId('template-canvas').locator('[data-testid="reference-image"]')
  await expect(original).toBeVisible()
  await expect(original).toHaveAttribute('opacity', '0.5')
  expect(Number(await original.getAttribute('width'))).toBeCloseTo(PLAN_PNG.width * S, 6)
  expect(Number(await original.getAttribute('height'))).toBeCloseTo(PLAN_PNG.height * S, 6)
  const href = (await original.getAttribute('href')) ?? ''
  expect(href).toBe(image.url)
  const served = await page.request.get(href)
  expect(served.status()).toBe(200)
  expect(served.headers()['content-type']).toBe('image/png')
  expect(pngSize(await served.body())).toEqual({ width: PLAN_PNG.width, height: PLAN_PNG.height })
  // The fixed items draw above it.
  expect(await page.getByTestId('template-canvas').evaluate((svg) => {
    const img = svg.querySelector('[data-testid="reference-image"]')
    const items = svg.querySelector('[data-layer="fixed"]')
    return !!img && !!items && (img.compareDocumentPosition(items) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  })).toBe(true)

  // ---- The draft is vector shapes in cm, at the scale of the plan's 40'-0" label.
  const recorded = readRecordedDraft().draft as { walls: { points: Point[] }[] }
  await expect(fixedOnCanvas(page, 'wall')).toHaveCount(2)
  await expect(fixedOnCanvas(page, 'room')).toHaveCount(1)
  await expect(fixedOnCanvas(page, 'door')).toHaveCount(1)
  await expect(fixedOnCanvas(page, 'column')).toHaveCount(1)
  const drawn = await Promise.all((await fixedOnCanvas(page, 'wall').all()).map(drawnWallPoints))
  drawn.sort((a, b) => b.length - a.length)
  expectPoints(drawn[0], recorded.walls[0].points.map(cm))
  expectPoints(drawn[1], recorded.walls[1].points.map(cm))
  // The door sits in the gap in the bottom wall, 90 px wide.
  const door = await drawnBoxPlace(fixedOnCanvas(page, 'door'))
  expect(door.x).toBeCloseTo(((PLAN_PNG.door.from + PLAN_PNG.door.to) / 2) * S, 6)
  expect(door.y).toBeCloseTo(PLAN_PNG.room.bottom * S, 6)

  // The item the model was unsure of is highlighted and listed.
  const column = fixedOnCanvas(page, 'column')
  await expect(column).toHaveAttribute('data-unsure', 'true')
  await expect(column.locator('[data-unsure-mark]')).toHaveCount(1)
  const toCheck = panel.getByTestId('unsure-list')
  await expect(toCheck).toContainText('1 item to check')
  await expect(toCheck).toContainText('Could be a post or a planter')

  // Nothing was saved yet.
  expect(await apiGetVenue(page.request, venue.id)).toMatchObject({ version: 1, fixedItems: [], reference: null, referenceImage: null, importedBy: 'hand' })

  // ---- Rerun asks the model again with the same picture (no new upload); its draft replaces this one.
  await panel.getByTestId('draft-rerun').click()
  await expect.poll(async () => (await standInCallsFor(name)).length, { timeout: 20_000 }).toBe(2)
  await expect(page.getByRole('dialog', { name: 'Run the import again' })).toBeHidden({ timeout: 20_000 })
  expect((await standInCallsFor(name))[1]).toMatchObject({ imageSha256: image.sha256, answer: 'recorded draft' })
  await expect(panel).toBeVisible()
  await expect(fixedOnCanvas(page, 'wall')).toHaveCount(2)
  await expect(fixedOnCanvas(page, 'column')).toHaveAttribute('data-unsure', 'true')
  expect(await apiGetVenue(page.request, venue.id)).toMatchObject({ version: 1, fixedItems: [], referenceImage: null })

  // ---- Every shape stays editable: check the unsure column off in its properties.
  await toCheck.getByRole('button', { name: /Column/ }).click()
  await openTemplateTab(page, 'Properties')
  const note = page.getByTestId('unsure-note')
  await expect(note).toContainText('Could be a post or a planter')
  await note.getByRole('button', { name: 'Mark as checked' }).click()
  await expect(column).not.toHaveAttribute('data-unsure', 'true')
  await openTemplateTab(page, 'Draft')
  await expect(toCheck).toContainText('Nothing marked unsure.')
  // Still nothing saved, and the editor still says it is a draft.
  await expect(templateStatus(page)).toHaveText('Draft, not saved')
  expect(await apiGetVenue(page.request, venue.id)).toMatchObject({ version: 1, fixedItems: [], referenceImage: null })

  // ---- Scale: the labelled line, measured at this scale, is shown to confirm. Accept waits for it.
  const scale = panel.getByTestId('scale-step')
  await expect(scale).toContainText(`The label “40'-0"” measures 40′ 0″ at this scale.`)
  // The labelled line is drawn on the plan (a flat SVG line, so it is counted, not "seen").
  await expect(page.getByTestId('scale-line')).toHaveCount(1)
  const accept = panel.getByTestId('draft-accept')
  await expect(accept).toBeDisabled()
  await scale.getByTestId('scale-confirm').click()
  await expect(scale).toContainText('Scale set.')
  await expect(accept).toBeEnabled()

  // ---- Accept: one save, with the walls, the picture and its place.
  const accepted = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === `/api/venues/${venue.id}/accept-import`)
  await accept.click()
  expect((await accepted).status()).toBe(200)
  await expect(page.getByTestId('editor-notice')).toHaveText('Import saved. Undo import is in Revisions.')
  await expectTemplateSaved(page)
  const saved = await apiGetVenue(page.request, venue.id)
  expect(saved).toMatchObject({ version: 2, importedBy: 'ai', reference: { scaleCmPerPx: S, offsetX: 0, offsetY: 0, rotation: 0, opacity: 0.5 } })
  expect(saved.referenceImage?.id).toBe(image.id)
  expect(saved.fixedItems.map((i) => i.type).sort()).toEqual(['column', 'door', 'room', 'wall', 'wall'])
  const walls = saved.fixedItems.flatMap((i) => (i.type === 'wall' ? [i] : [])).sort((a, b) => b.points.length - a.points.length)
  expectPoints(walls[0].points, recorded.walls[0].points.map(cm))
  expectPoints(walls[1].points, recorded.walls[1].points.map(cm))
  for (const w of walls) expect(w.thickness).toBeCloseTo(PLAN_PNG.wall * S, 6)
  const savedDoor = saved.fixedItems.find((i) => i.type === 'door')
  expect(savedDoor?.type === 'door' && walls.some((w) => w.id === savedDoor.wallId)).toBe(true)
  expect(saved.fixedItems.find((i) => i.type === 'room')).toMatchObject({ name: 'Main Room' })
  // The edit made in the draft was kept.
  expect(saved.fixedItems.find((i) => i.type === 'column')).toMatchObject({ unsure: false })
  const revisions = await apiVenueRevisions(page.request, venue.id)
  expect(revisions.revisions[0]).toMatchObject({ reason: 'import', fixedItemCount: 5, referenceImageId: image.id })
  expect(revisions.undoImportRevisionId).not.toBeNull()

  // After a reload the walls are the template's; the original is on its hidden layer.
  await page.reload()
  await expectTemplateSaved(page)
  await expect(fixedOnCanvas(page, 'wall')).toHaveCount(2)
  await expect(page.getByTestId('reference-image')).toHaveCount(0)
  await openTemplateTab(page, 'Plan image')
  const show = page.getByTestId('show-reference')
  await show.click()
  await expect(page.getByTestId('reference-image')).toBeVisible()

  // ---- Undo import puts the empty template back, as a new save.
  await openTemplateTab(page, 'Revisions')
  const undone = page.waitForResponse((res) => res.request().method() === 'POST' && /\/revisions\/[^/]+\/restore$/.test(new URL(res.url()).pathname))
  await page.getByTestId('undo-import').click()
  expect((await undone).status()).toBe(200)
  await expect(fixedOnCanvas(page)).toHaveCount(0)
  await expectTemplateSaved(page)
  const restored = await apiGetVenue(page.request, venue.id)
  expect(restored).toMatchObject({ version: 3, fixedItems: [], reference: null, referenceImage: null })
  await page.reload()
  await expectTemplateSaved(page)
  await expect(fixedOnCanvas(page)).toHaveCount(0)
})

test('a refusal from the AI model shows a plain message, and the template stays as it was', async ({ page }, testInfo) => {
  await signIn(page)
  const name = `${REFUSAL_MARKER} ${uniqueName('hall', testInfo)}`
  const venue = await apiCreateVenue(page.request, name)
  await openTemplateEditor(page, venue.id)
  await startImport(page, venue.id, PNG_FILE())

  const dialog = page.getByRole('dialog', { name: 'Import a floor plan' })
  const error = dialog.getByTestId('import-error')
  await expect(error).toHaveText('The AI model would not read this plan.', { timeout: 20_000 })
  await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible()
  expect((await standInCallsFor(name)).map((c) => c.answer)).toEqual(['refusal'])

  // Try again asks once more, with the same picture, and gets the same answer.
  await dialog.getByRole('button', { name: 'Try again' }).click()
  await expect(error).toHaveText('The AI model would not read this plan.', { timeout: 20_000 })
  expect((await standInCallsFor(name)).map((c) => c.answer)).toEqual(['refusal', 'refusal'])

  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('draft-panel')).toHaveCount(0)
  await expectTemplateSaved(page)
  expect(await apiGetVenue(page.request, venue.id)).toMatchObject({ version: 1, fixedItems: [], reference: null, referenceImage: null })
})

test('a save from another device while a draft is open: Accept asks, then goes over it; Undo import loads a newer save first; the stored plan runs again', async ({
  page,
}, testInfo) => {
  test.slow()
  await signIn(page)
  const name = uniqueName('Busy Hall', testInfo)
  const venue = await apiCreateVenue(page.request, name)
  await openTemplateEditor(page, venue.id)
  const image = await startImport(page, venue.id, PNG_FILE())
  await expect(page.getByRole('dialog', { name: 'Import a floor plan' })).toBeHidden({ timeout: 20_000 })
  const panel = page.getByTestId('draft-panel')
  await panel.getByTestId('scale-step').getByTestId('scale-confirm').click()

  // ---- The planner changes a wall from their phone while this tab checks the draft (version 1 to 2).
  const aidenWall = wallItem({ x: 0, y: 0 }, { x: 500, y: 0 })
  await apiSaveVenue(page.request, venue, [aidenWall])

  // Accept meets his save: nothing is lost, and the panel asks before going over it.
  const firstTry = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === `/api/venues/${venue.id}/accept-import`)
  await panel.getByTestId('draft-accept').click()
  expect((await firstTry).status()).toBe(409)
  await expect(panel.getByTestId('draft-over')).toHaveText(
    'You changed this venue in another tab or on another device after you opened it. Accept your draft over it?',
  )
  await expect(templateStatus(page)).toHaveText('Draft, not saved')
  expect(await apiGetVenue(page.request, venue.id)).toMatchObject({ version: 2, fixedItems: [aidenWall] })

  // Accept over it: saved from his version, in one go.
  const secondTry = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === `/api/venues/${venue.id}/accept-import`)
  await panel.getByRole('button', { name: 'Accept over it' }).click()
  expect((await secondTry).status()).toBe(200)
  await expect(page.getByTestId('editor-notice')).toHaveText('Import saved. Undo import is in Revisions.')
  await expectTemplateSaved(page)
  const accepted = await apiGetVenue(page.request, venue.id)
  expect(accepted).toMatchObject({ version: 3, importedBy: 'ai' })
  expect(accepted.referenceImage?.id).toBe(image.id)
  expect(accepted.fixedItems.map((i) => i.type).sort()).toEqual(['column', 'door', 'room', 'wall', 'wall'])

  // ---- Run the import again from the Plan image tab: the stored picture goes back to the model, no upload.
  await openTemplateTab(page, 'Plan image')
  await page.getByTestId('rerun-stored').click()
  await expect(page.getByRole('dialog', { name: 'Run the import again' })).toBeHidden({ timeout: 20_000 })
  await expect(panel).toContainText('From the saved plan picture.')
  const calls = await standInCallsFor(name)
  expect(calls.map((c) => [c.imageSha256, c.answer])).toEqual([
    [image.sha256, 'recorded draft'],
    [image.sha256, 'recorded draft'],
  ])
  await panel.getByTestId('draft-discard').click()
  await expect(panel).toHaveCount(0)
  await expect(fixedOnCanvas(page, 'wall')).toHaveCount(2)
  expect((await apiGetVenue(page.request, venue.id)).version).toBe(3)

  // ---- Another save from the phone; Undo import loads that version and asks to try again.
  const aidenAgain = [wallItem({ x: 0, y: 0 }, { x: 0, y: 700 })]
  await apiSaveVenue(page.request, accepted, aidenAgain)
  await openTemplateTab(page, 'Revisions')
  const undo = page.getByTestId('undo-import')
  const refused = page.waitForResponse((res) => res.request().method() === 'POST' && /\/revisions\/[^/]+\/restore$/.test(new URL(res.url()).pathname))
  await undo.click()
  expect((await refused).status()).toBe(409)
  await expect(page.getByTestId('revisions-error')).toHaveText('Loaded your changes from another tab or device. Try Undo import again.')
  await expect(fixedOnCanvas(page, 'wall')).toHaveCount(1)
  await expectTemplateSaved(page)
  const undone = page.waitForResponse((res) => res.request().method() === 'POST' && /\/revisions\/[^/]+\/restore$/.test(new URL(res.url()).pathname))
  await undo.click()
  expect((await undone).status()).toBe(200)
  // Back to the venue as it was just before the import: the phone's first wall, no plan picture.
  await expectTemplateSaved(page)
  expect(await apiGetVenue(page.request, venue.id)).toMatchObject({ version: 5, fixedItems: [aidenWall], referenceImage: null })
  await expect(fixedOnCanvas(page, 'wall')).toHaveCount(1)

  // ---- Back on this tab after the phone saved once more: that version loads, with a word about it.
  await apiSaveVenue(page.request, { id: venue.id, version: 5 }, [aidenWall, ...aidenAgain])
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByTestId('editor-notice')).toHaveText('Loaded your changes from another tab or device.')
  await expect(fixedOnCanvas(page, 'wall')).toHaveCount(2)
  await expectTemplateSaved(page)
})
