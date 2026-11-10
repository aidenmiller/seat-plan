/**
 * Helpers for the venue tests (milestone 7): venue templates through the
 * API, and driving the template editor at /venues/[templateId]: its mode,
 * camera, tools, panels and the fixed items it draws.
 *
 * The template editor uses the layout editor's canvas, so the camera works
 * the same way: the world SVG's transform is matrix(zoom,0,0,zoom,x,y) once
 * a gesture settles, and world points are cm.
 */
import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import type { FixedItem } from '../src/domain/venue-schema'
import type { SaveVenueOk, VenueDetail, VenueImageInfo, VenueRevisionList } from '../src/shared/api'
import { sheetAtRest, Touch, type Camera, type Point } from './canvas'
import type { Author } from './helpers'

// ---------- Venues through the API ----------

export async function apiCreateVenue(request: APIRequestContext, name: string): Promise<VenueDetail> {
  const res = await request.post('/api/venues', { data: { id: randomUUID(), name, editedBy: 'Noa' } })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as VenueDetail
}

export async function apiGetVenue(request: APIRequestContext, id: string): Promise<VenueDetail> {
  const res = await request.get(`/api/venues/${id}`)
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as VenueDetail
}

/** Saves fixed items onto a template with one PUT, as the template editor would. */
export async function apiSaveVenue(
  request: APIRequestContext,
  venue: Pick<VenueDetail, 'id' | 'version'>,
  fixedItems: FixedItem[],
  editedBy: Author = 'Noa',
): Promise<SaveVenueOk> {
  const res = await request.put(`/api/venues/${venue.id}`, {
    data: { baseVersion: venue.version, saveId: randomUUID(), editedBy, fixedItems, reference: null },
  })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as SaveVenueOk
}

export async function apiVenueRevisions(request: APIRequestContext, id: string): Promise<VenueRevisionList> {
  const res = await request.get(`/api/venues/${id}/revisions`)
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as VenueRevisionList
}

/** A straight wall from a to b, as the template stores it. */
export function wallItem(a: Point, b: Point, thickness = 15): FixedItem {
  return { id: randomUUID(), type: 'wall', points: [a, b], thickness, unsure: false, unsureNote: '' }
}

export const venueEditorPath = (venueId: string, weddingId?: string) => `/venues/${venueId}${weddingId ? `?from=${weddingId}` : ''}`

/** A venue's card on a wedding's Venues tab. */
export function venueCard(page: Page, venueId: string): Locator {
  return page.locator(`[data-testid="venue-card"][data-venue-id="${venueId}"]`)
}

// ---------- The template editor ----------

export function templateRoot(page: Page): Locator {
  return page.locator('[data-template-editor]')
}

/** Edit or View, once the editor has read this device's choice. */
export async function templateMode(page: Page): Promise<'edit' | 'view'> {
  await expect(templateRoot(page)).toHaveAttribute('data-mode', /^(edit|view)$/, { timeout: 10_000 })
  return (await templateRoot(page).getAttribute('data-mode')) as 'edit' | 'view'
}

export async function isTemplatePhone(page: Page): Promise<boolean> {
  await templateMode(page)
  return (await templateRoot(page).getAttribute('data-phone')) === 'true'
}

/** Flips the top bar's Edit / View switch to `mode`. */
export async function setTemplateMode(page: Page, mode: 'edit' | 'view'): Promise<void> {
  if ((await templateMode(page)) === mode) return
  const control = page.getByTestId('mode-switch')
  if ((await control.getAttribute('role')) === 'switch') await control.click()
  else await control.getByRole('button', { name: mode === 'edit' ? 'Edit' : 'View', exact: true }).click()
  await expect(templateRoot(page)).toHaveAttribute('data-mode', mode)
}

export function templateStatus(page: Page): Locator {
  return page.getByTestId('save-status')
}

/** Waits until the template editor has opened and says Saved (with no draft open). */
export async function expectTemplateSaved(page: Page, timeout = 10_000): Promise<void> {
  await expect(templateStatus(page)).toHaveAttribute('data-status', 'saved', { timeout })
  await expect(templateStatus(page)).toHaveText('Saved')
}

/** Opens the template editor and waits until it can take edits (Edit mode, saved). */
export async function openTemplateEditor(page: Page, venueId: string, weddingId?: string): Promise<void> {
  await page.goto(venueEditorPath(venueId, weddingId))
  await setTemplateMode(page, 'edit')
  await expectTemplateSaved(page)
}

/** The fixed items the template canvas draws, by type. */
export function fixedOnCanvas(page: Page, type?: FixedItem['type']): Locator {
  const canvas = page.getByTestId('template-canvas')
  return type ? canvas.locator(`[data-fixed-type="${type}"]`) : canvas.locator('[data-fixed-id]')
}

/** A wall's points (cm) as the canvas draws them. */
export async function drawnWallPoints(wall: Locator): Promise<Point[]> {
  const attr = (await wall.locator('polyline[data-venue-type="wall"]').getAttribute('points')) ?? ''
  return attr
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number)
      return { x, y }
    })
}

/** A door's or other box item's place (cm) and turn, from its SVG transform. */
export async function drawnBoxPlace(item: Locator): Promise<Point & { rotation: number }> {
  const t = (await item.locator('[data-venue-type]').first().getAttribute('transform')) ?? ''
  const tr = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(t)
  const rot = /rotate\(([-\d.e]+)\)/.exec(t)
  if (!tr) throw new Error(`No place in ${t}`)
  return { x: Number(tr[1]), y: Number(tr[2]), rotation: rot ? Number(rot[1]) : 0 }
}

function parseMatrix(transform: string | null): Camera {
  const m = /^matrix\(([^,]+),0,0,([^,]+),([^,]+),([^)]+)\)$/.exec(transform ?? '')
  if (!m) throw new Error(`Not a camera transform: ${transform}`)
  return { zoom: Number(m[1]), x: Number(m[3]), y: Number(m[4]) }
}

/** The template canvas's camera once it has settled (see e2e/canvas.ts settledCamera). */
export async function templateCamera(page: Page): Promise<Camera> {
  let last: string | null = null
  await expect
    .poll(
      async () => {
        const s = await page.evaluate(() => {
          const svg = document.querySelector('[data-testid="template-canvas"]')
          const world = svg?.querySelector(':scope > g') ?? null
          const wrapper = svg?.parentElement as HTMLElement | null
          return { world: world?.getAttribute('transform') ?? null, moving: (wrapper?.style.transform ?? '') !== '' }
        })
        const key = s.moving ? null : s.world
        const stable = key !== null && key === last
        last = key
        return stable
      },
      { intervals: [100, 200, 200, 250], timeout: 10_000, message: 'the template camera settles' },
    )
    .toBe(true)
  return parseMatrix(last)
}

export async function templateViewportBox(page: Page) {
  const box = await page.getByTestId('template-viewport').boundingBox()
  if (!box) throw new Error('No template viewport')
  return box
}

/** A world point (cm) as a client point (page px). */
export async function templateToClient(page: Page, p: Point, camera?: Camera): Promise<Point> {
  const c = camera ?? (await templateCamera(page))
  const box = await templateViewportBox(page)
  return { x: box.x + c.x + p.x * c.zoom, y: box.y + c.y + p.y * c.zoom }
}

/** The world point (cm) at the middle of the template viewport, snapped to whole feet. */
export async function templateCenterOnGrid(page: Page, camera?: Camera): Promise<Point> {
  const c = camera ?? (await templateCamera(page))
  const box = await templateViewportBox(page)
  const foot = 30.48
  const x = (box.width / 2 - c.x) / c.zoom
  const y = (box.height / 2 - c.y) / c.zoom
  return { x: Math.round(x / foot) * foot, y: Math.round(y / foot) * foot }
}

/** Picks a tool: from the tool column on desktops, from the Tools drawer on phones. */
export async function pickTool(page: Page, toolId: string): Promise<void> {
  if (await isTemplatePhone(page)) {
    await page.getByTestId('open-tools').click()
    const drawer = page.getByTestId('tool-drawer')
    await drawer.getByTestId(`tool-${toolId}`).click()
    await expect(drawer).toBeHidden()
  } else {
    const tool = page.getByTestId('tool-panel').getByTestId(`tool-${toolId}`)
    await tool.click()
    await expect(tool).toHaveAttribute('aria-pressed', 'true')
  }
}

/**
 * Opens one of the right panel's tabs (Properties, Plan image, Revisions,
 * Draft): a click on desktops; on phones a tap in the bottom sheet, which
 * then rises to half and comes to rest.
 */
export async function openTemplateTab(page: Page, name: 'Properties' | 'Plan image' | 'Revisions' | 'Draft'): Promise<void> {
  if (await isTemplatePhone(page)) {
    const sheet = page.getByTestId('bottom-sheet')
    const tab = sheet.getByRole('tab', { name, exact: true })
    if ((await sheet.getAttribute('data-snap')) === 'strip' || (await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(sheet).not.toHaveAttribute('data-snap', 'strip')
    await sheetAtRest(page)
  } else {
    const tab = page.getByTestId('template-right-panel').getByRole('tab', { name, exact: true })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
  }
}

/** A tap on phones (through Chrome's touch events), a click elsewhere, at a client point. */
export async function tapOrClick(page: Page, at: Point): Promise<void> {
  if (await isTemplatePhone(page)) await (await Touch.on(page)).tap(at)
  else await page.mouse.click(at.x, at.y)
}

// ---------- The floor plan import ----------

export type PlanFile = { name: string; mimeType: string; buffer: Buffer }

/**
 * Opens the import dialog (the top bar's Import plan on desktops, the
 * Properties tab's button in the sheet on phones), picks the file and starts
 * the import. Returns the uploaded image as the server stored it.
 */
export async function startImport(page: Page, venueId: string, file: PlanFile): Promise<VenueImageInfo> {
  if (await isTemplatePhone(page)) {
    await openTemplateTab(page, 'Properties')
    await page.getByTestId('import-plan-properties').click()
  } else {
    await page.getByTestId('import-plan').click()
  }
  const dialog = page.getByRole('dialog', { name: 'Import a floor plan' })
  await expect(dialog).toContainText('Nothing changes in this venue until you press Accept.')
  await dialog.getByTestId('import-file').setInputFiles(file)
  const start = dialog.getByTestId('import-start')
  // A PDF is opened first (pdf.js), then Start wakes up.
  await expect(start).toBeEnabled({ timeout: 15_000 })
  const uploaded = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === `/api/venues/${venueId}/images`, {
    timeout: 20_000,
  })
  await start.click()
  const res = await uploaded
  expect([200, 201]).toContain(res.status())
  return (await res.json()) as VenueImageInfo
}

/** The width and height a PNG's header gives. */
export function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}
