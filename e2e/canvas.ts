/**
 * Helpers for driving the canvas editor (milestone 3) from Playwright: the
 * Edit / View switch, adding presets, reading the camera and the drawn
 * tables, mouse drags with Shift or Alt, and real multi-touch through
 * Chrome's own touch events (CDP Input.dispatchTouchEvent), as Chrome on a
 * phone would send them (PLAN section 9).
 *
 * Coordinates: "client" points are CSS px in the page, as Playwright's mouse
 * takes them; "world" points are cm on the canvas. Read the camera only once
 * it has settled (settledCamera), since the editor writes it into the world
 * SVG about 150 ms after a gesture stops.
 */
import { devices, expect, type BrowserContextOptions, type CDPSession, type Locator, type Page } from '@playwright/test'

export type Point = { x: number; y: number }
export type Camera = { zoom: number; x: number; y: number }

// ---------- The two devices, as in playwright.config.ts ----------

/** A laptop, for a second browser context in a test (the desktop project's settings). */
export const LAPTOP: BrowserContextOptions = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1440, height: 900 },
  baseURL: process.env.E2E_BASE_URL,
}

/** A phone, for a second browser context in a test (the phone project's settings). */
export const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: devices['iPhone 14'].userAgent,
  baseURL: process.env.E2E_BASE_URL,
}

// ---------- Edit and View ----------

export function editorRoot(page: Page): Locator {
  return page.locator('[data-editor-root]')
}

/** Edit or View, once the editor has read this device's choice. */
export async function editorMode(page: Page): Promise<'edit' | 'view'> {
  await expect(editorRoot(page)).toHaveAttribute('data-mode', /^(edit|view)$/, { timeout: 10_000 })
  return (await editorRoot(page).getAttribute('data-mode')) as 'edit' | 'view'
}

/** True when the editor uses the phone layout (canvas fills the screen, bottom sheet). */
export async function isPhoneLayout(page: Page): Promise<boolean> {
  await editorMode(page)
  return (await editorRoot(page).getAttribute('data-phone')) === 'true'
}

/** Flips the top bar's Edit / View switch to `mode`. */
export async function setMode(page: Page, mode: 'edit' | 'view'): Promise<void> {
  if ((await editorMode(page)) === mode) return
  const control = page.getByTestId('mode-switch')
  if ((await control.getAttribute('role')) === 'switch') await control.click()
  else await control.getByRole('button', { name: mode === 'edit' ? 'Edit' : 'View', exact: true }).click()
  await expect(editorRoot(page)).toHaveAttribute('data-mode', mode)
}

/**
 * What adds shapes: the shape panel's Round tile on desktops, the Shapes
 * button (which opens the panel as a drawer) on phones. Both are disabled
 * until the page can take edits.
 */
export function addControl(page: Page): Locator {
  return page.getByTestId('open-shapes').or(page.getByTestId('shape-panel').getByRole('button', { name: 'Add round table' }))
}

/** Adds a preset by its tile ("Add round table"): a click on desktops; on phones, Shapes then a tap in the drawer. */
export async function addPreset(page: Page, name: string): Promise<void> {
  if (await isPhoneLayout(page)) {
    await page.getByTestId('open-shapes').click()
    const drawer = page.getByTestId('shape-drawer')
    await drawer.getByRole('button', { name, exact: true }).click()
    await expect(drawer).toBeHidden()
  } else {
    await page.getByTestId('shape-panel').getByRole('button', { name, exact: true }).click()
  }
}

export async function addRoundTable(page: Page): Promise<void> {
  await addPreset(page, 'Add round table')
}

// ---------- The camera ----------

function parseMatrix(transform: string | null): Camera {
  const m = /^matrix\(([^,]+),0,0,([^,]+),([^,]+),([^)]+)\)$/.exec(transform ?? '')
  if (!m) throw new Error(`Not a camera transform: ${transform}`)
  return { zoom: Number(m[1]), x: Number(m[3]), y: Number(m[4]) }
}

async function cameraSnapshot(page: Page): Promise<{ world: string | null; moving: boolean }> {
  return page.evaluate(() => {
    const svg = document.querySelector('[data-testid="canvas"]')
    const world = svg?.querySelector(':scope > g') ?? null
    const wrapper = svg?.parentElement as HTMLElement | null
    return { world: world?.getAttribute('transform') ?? null, moving: (wrapper?.style.transform ?? '') !== '' }
  })
}

/**
 * The camera once it has settled: the wrapper is back to no transform and
 * the world SVG's transform has stayed the same for two reads in a row.
 */
export async function settledCamera(page: Page): Promise<Camera> {
  let last: string | null = null
  await expect
    .poll(
      async () => {
        const s = await cameraSnapshot(page)
        const key = s.moving ? null : s.world
        const stable = key !== null && key === last
        last = key
        return stable
      },
      { intervals: [100, 200, 200, 250], timeout: 10_000, message: 'the camera settles' },
    )
    .toBe(true)
  return parseMatrix(last)
}

export function viewport(page: Page): Locator {
  return page.getByTestId('editor-viewport')
}

async function viewportOrigin(page: Page): Promise<Point> {
  const box = await viewport(page).boundingBox()
  if (!box) throw new Error('No canvas viewport')
  return { x: box.x, y: box.y }
}

/** A world point (cm) as a client point (page px), with the settled camera. */
export async function worldToClient(page: Page, p: Point, camera?: Camera): Promise<Point> {
  const c = camera ?? (await settledCamera(page))
  const o = await viewportOrigin(page)
  return { x: o.x + c.x + p.x * c.zoom, y: o.y + c.y + p.y * c.zoom }
}

export function zoomLevel(page: Page): Locator {
  return page.getByTestId('zoom-level')
}

/** Presses Zoom in or Zoom out until the zoom reads `percent` ("50%"). */
export async function zoomButtonsTo(page: Page, percent: string): Promise<void> {
  const target = Number(percent.replace('%', ''))
  for (let i = 0; i < 12; i++) {
    const now = Number((await zoomLevel(page).textContent())?.replace('%', ''))
    if (now === target) break
    await page.getByRole('button', { name: now > target ? 'Zoom out' : 'Zoom in', exact: true }).click()
    await expect(zoomLevel(page)).not.toHaveText(`${now}%`)
  }
  await expect(zoomLevel(page)).toHaveText(percent)
  await settledCamera(page)
}

// ---------- What the canvas draws ----------

export function itemLocator(page: Page, id: string): Locator {
  return page.getByTestId('canvas').locator(`[data-item-id="${id}"]`)
}

export type DrawnSeat = { index: number; cx: number; cy: number; state: string }
export type DrawnTable = {
  id: string
  x: number
  y: number
  rotation: number
  shape: 'round' | 'rect'
  width: number
  height: number
  number: number
  selected: boolean
  tight: boolean
  locked: boolean
  name: string
  count: string
  /** Seat circles in the table's own frame (cm), in seat order. */
  seats: DrawnSeat[]
  /** Seat circle radius (cm). */
  seatRadius: number
}

/** A table as the world SVG draws it: its place, size and seat circles, read from the SVG attributes. */
export async function readTable(page: Page, id: string): Promise<DrawnTable> {
  return itemLocator(page, id).evaluate((g, tableId) => {
    const t = g.getAttribute('transform') ?? ''
    const tr = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(t)
    const rot = /rotate\(([-\d.e]+)\)/.exec(t)
    const body = g.querySelector(':scope > circle:not([data-seat-index]):not([data-tight-outline]), :scope > rect:not([data-tight-outline])')
    const round = body?.tagName.toLowerCase() === 'circle'
    const num = (el: Element | null, name: string) => Number(el?.getAttribute(name) ?? NaN)
    const seats = [...g.querySelectorAll('circle[data-seat-index]')].map((c) => ({
      index: num(c, 'data-seat-index'),
      cx: num(c, 'cx'),
      cy: num(c, 'cy'),
      state: c.getAttribute('data-seat-state') ?? '',
    }))
    seats.sort((a, b) => a.index - b.index)
    const firstSeat = g.querySelector('circle[data-seat-index]')
    return {
      id: tableId,
      x: tr ? Number(tr[1]) : NaN,
      y: tr ? Number(tr[2]) : NaN,
      rotation: rot ? Number(rot[1]) : 0,
      shape: round ? ('round' as const) : ('rect' as const),
      width: round ? 2 * num(body, 'r') : num(body, 'width'),
      height: round ? 2 * num(body, 'r') : num(body, 'height'),
      number: Number(g.getAttribute('data-table-number')),
      selected: g.getAttribute('data-selected') === 'true',
      tight: g.getAttribute('data-tight') === 'true',
      locked: g.getAttribute('data-locked') === 'true',
      name: g.querySelector('[data-table-name]')?.textContent ?? '',
      count: g.querySelector('[data-seat-count]')?.textContent ?? '',
      seats,
      seatRadius: firstSeat ? num(firstSeat, 'r') : 0,
    }
  }, id)
}

/** A table's center on screen (page px). */
export async function tableClientCenter(page: Page, id: string, camera?: Camera): Promise<Point> {
  const t = await readTable(page, id)
  return worldToClient(page, { x: t.x, y: t.y }, camera)
}

/** The centers on screen (page px) of a table's body and of each seat circle, in seat order, as the browser lays them out. */
export async function screenSeats(page: Page, id: string): Promise<{ body: Point; seats: (Point & { size: number })[] }> {
  return itemLocator(page, id).evaluate((g) => {
    const center = (el: Element) => {
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width }
    }
    const body = g.querySelector(':scope > circle:not([data-seat-index]):not([data-tight-outline]), :scope > rect:not([data-tight-outline])')
    const seats = [...g.querySelectorAll('circle[data-seat-index]')]
      .sort((a, b) => Number(a.getAttribute('data-seat-index')) - Number(b.getAttribute('data-seat-index')))
      .map(center)
    return { body: body ? center(body) : { x: NaN, y: NaN }, seats }
  })
}

/**
 * Checks that seat circles sit evenly around a round table: equal angles
 * between neighbors (within `toleranceDeg`) at an equal distance from the
 * center, measured from where the browser draws them.
 */
export async function expectEvenlySpaced(page: Page, id: string, count: number, toleranceDeg = 0.5): Promise<void> {
  const { body, seats } = await screenSeats(page, id)
  expect(seats).toHaveLength(count)
  const angles = seats.map((s) => (Math.atan2(s.y - body.y, s.x - body.x) * 180) / Math.PI)
  const radii = seats.map((s) => Math.hypot(s.x - body.x, s.y - body.y))
  const step = 360 / count
  for (let i = 0; i < count; i++) {
    const next = angles[(i + 1) % count]
    const gap = (((next - angles[i]) % 360) + 360) % 360
    expect(Math.abs(gap - step), `angle from seat ${i + 1} to seat ${((i + 1) % count) + 1}: ${gap.toFixed(3)}°`).toBeLessThanOrEqual(toleranceDeg)
    expect(Math.abs(radii[i] - radii[0]), `seat ${i + 1}'s distance from the center`).toBeLessThan(0.5)
    expect(Math.abs(seats[i].size - seats[0].size), `seat ${i + 1}'s size`).toBeLessThan(0.5)
  }
}

/** Each item's id and SVG transform, to show that nothing moved. */
export async function itemTransforms(page: Page): Promise<Record<string, string>> {
  return page
    .getByTestId('canvas')
    .locator('[data-item-id]')
    .evaluateAll((nodes) => Object.fromEntries(nodes.map((n) => [n.getAttribute('data-item-id') ?? '', n.getAttribute('transform') ?? ''])))
}

export async function selectedIds(page: Page): Promise<string[]> {
  return page
    .getByTestId('canvas')
    .locator('[data-item-id][data-selected="true"]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-item-id') ?? ''))
}

// ---------- Panels ----------

/** The Properties tab's contents: the right panel on desktops, the bottom sheet on phones (raised to half). */
export async function openProperties(page: Page): Promise<Locator> {
  if (await isPhoneLayout(page)) {
    const sheet = page.getByTestId('bottom-sheet')
    if ((await sheet.getAttribute('data-snap')) === 'strip' || (await sheet.getByRole('tab', { name: 'Properties' }).getAttribute('aria-selected')) !== 'true') {
      await sheet.getByRole('tab', { name: 'Properties' }).click()
    }
    await expect(sheet).not.toHaveAttribute('data-snap', 'strip')
    await sheetAtRest(page)
  }
  return page.getByTestId('properties-panel')
}

/** Waits for the bottom sheet to finish easing to its height (200 ms), so what is under a point stays put. */
export async function sheetAtRest(page: Page): Promise<void> {
  const sheet = page.getByTestId('bottom-sheet')
  let last = NaN
  await expect
    .poll(
      async () => {
        const y = (await sheet.boundingBox())?.y ?? NaN
        const still = Math.abs(y - last) < 0.5
        last = y
        return still
      },
      { intervals: [100, 100, 150, 250], message: 'the sheet comes to rest' },
    )
    .toBe(true)
}

/** Phones: drags the bottom sheet back down to its strip, so the canvas shows again. Desktops: nothing. */
export async function lowerSheet(page: Page): Promise<void> {
  if (!(await isPhoneLayout(page))) return
  const sheet = page.getByTestId('bottom-sheet')
  if ((await sheet.getAttribute('data-snap')) === 'strip') return
  await sheetAtRest(page)
  const handle = await page.getByTestId('bottom-sheet-handle').boundingBox()
  if (!handle) throw new Error('No sheet handle')
  const touch = await Touch.on(page)
  const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  await touch.drag(from, { x: from.x, y: 830 }, { steps: 12 })
  await expect(sheet).toHaveAttribute('data-snap', 'strip')
  await sheetAtRest(page)
}

/** Types into a panel field and presses Enter, which saves it. */
export async function commitField(field: Locator, text: string): Promise<void> {
  await field.click()
  await field.fill(text)
  await field.press('Enter')
}

// ---------- Mouse ----------

export type DragOptions = { steps?: number; modifiers?: ('Shift' | 'Alt')[]; release?: boolean }

/** A mouse drag in small steps, with Shift or Alt held from before the press. */
export async function mouseDrag(page: Page, from: Point, to: Point, options: DragOptions = {}): Promise<void> {
  const { steps = 12, modifiers = [], release = true } = options
  for (const key of modifiers) await page.keyboard.down(key)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + (to.x - from.x) / steps, from.y + (to.y - from.y) / steps)
  await page.mouse.move(to.x, to.y, { steps: Math.max(1, steps - 1) })
  if (release) {
    await page.mouse.up()
    for (const key of modifiers) await page.keyboard.up(key)
  }
}

// ---------- Touch, through Chrome's own touch events ----------

type TouchPoint = Point & { id: number }

/**
 * Real touches: each call sends Input.dispatchTouchEvent, which Chrome turns
 * into touch and pointer events (pointerType "touch") exactly as a phone's
 * screen would. Needs a context with hasTouch.
 */
export class Touch {
  private constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}

  static async on(page: Page): Promise<Touch> {
    return new Touch(page, await page.context().newCDPSession(page))
  }

  private async send(type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: TouchPoint[]): Promise<void> {
    await this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })),
    })
  }

  /** Fingers down at these points (all fingers that should be down now). */
  async down(points: TouchPoint[]): Promise<void> {
    await this.send('touchStart', points)
  }

  /** The fingers that are down, at their new places. */
  async move(points: TouchPoint[]): Promise<void> {
    await this.send('touchMove', points)
  }

  /** Lifts fingers; `remaining` are the ones still down. */
  async up(remaining: TouchPoint[] = []): Promise<void> {
    await this.send('touchEnd', remaining)
  }

  async tap(at: Point): Promise<void> {
    await this.down([{ ...at, id: 1 }])
    await this.up()
  }

  /** One finger from `from` to `to` in steps, optionally held still first (450 ms arms a long press). */
  async drag(from: Point, to: Point, options: { steps?: number; holdMs?: number; release?: boolean } = {}): Promise<void> {
    const { steps = 10, holdMs = 0, release = true } = options
    await this.down([{ ...from, id: 1 }])
    if (holdMs > 0) await this.page.waitForTimeout(holdMs)
    for (let i = 1; i <= steps; i++) {
      const f = i / steps
      await this.move([{ x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f, id: 1 }])
    }
    if (release) await this.up()
  }

  /** Holds one finger still, then lifts it: the long press that opens the menu. */
  async longPress(at: Point, ms = 650): Promise<void> {
    await this.down([{ ...at, id: 1 }])
    await this.page.waitForTimeout(ms)
    await this.up()
  }

  /**
   * Two fingers about `center`, `fromDistance` apart, spread or pinched to
   * `toDistance` while their midpoint moves by `pan`.
   */
  async pinch(center: Point, fromDistance: number, toDistance: number, options: { steps?: number; pan?: Point } = {}): Promise<void> {
    const { steps = 10, pan = { x: 0, y: 0 } } = options
    const at = (d: number, c: Point): TouchPoint[] => [
      { x: c.x - d / 2, y: c.y, id: 1 },
      { x: c.x + d / 2, y: c.y, id: 2 },
    ]
    const start = at(fromDistance, center)
    await this.down([start[0]])
    await this.down(start)
    for (let i = 1; i <= steps; i++) {
      const f = i / steps
      await this.move(at(fromDistance + (toDistance - fromDistance) * f, { x: center.x + pan.x * f, y: center.y + pan.y * f }))
    }
    const end = at(toDistance, { x: center.x + pan.x, y: center.y + pan.y })
    await this.up([end[1]])
    await this.up()
  }
}

/** Presses a button the way this device would: a tap on touch screens, a click elsewhere. */
export async function press(page: Page, target: Locator): Promise<void> {
  if (await isPhoneLayout(page)) await target.tap()
  else await target.click()
}

/** A handle's center on screen ("e", "se", ...), for the one selected item. */
export async function handleCenter(page: Page, handle: string): Promise<Point> {
  const box = await page.getByTestId(`handle-${handle}`).boundingBox()
  if (!box) throw new Error(`No ${handle} handle`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** A one-finger drag on phones, a mouse drag elsewhere. */
export async function pointerDrag(page: Page, from: Point, to: Point, options: { steps?: number } = {}): Promise<void> {
  if (await isPhoneLayout(page)) await (await Touch.on(page)).drag(from, to, { steps: options.steps ?? 12 })
  else await mouseDrag(page, from, to, { steps: options.steps ?? 12 })
}

/** A mouse click with keys held (page.mouse.click takes no modifiers). */
export async function clickWith(page: Page, at: Point, keys: ('Shift' | 'Alt' | 'ControlOrMeta')[]): Promise<void> {
  for (const key of keys) await page.keyboard.down(key)
  await page.mouse.click(at.x, at.y)
  for (const key of keys) await page.keyboard.up(key)
}

/** Any item's center (cm) and rotation, from its SVG transform. */
export async function itemPlace(page: Page, id: string): Promise<Point & { rotation: number }> {
  const t = (await itemLocator(page, id).getAttribute('transform')) ?? ''
  const tr = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(t)
  const rot = /rotate\(([-\d.e]+)\)/.exec(t)
  if (!tr) throw new Error(`No place for ${id}: ${t}`)
  return { x: Number(tr[1]), y: Number(tr[2]), rotation: rot ? Number(rot[1]) : 0 }
}

/** A client point (page px) as a world point (cm), with the settled camera. */
export async function clientToWorld(page: Page, p: Point, camera?: Camera): Promise<Point> {
  const c = camera ?? (await settledCamera(page))
  const box = await viewport(page).boundingBox()
  if (!box) throw new Error('No canvas viewport')
  return { x: (p.x - box.x - c.x) / c.zoom, y: (p.y - box.y - c.y) / c.zoom }
}
