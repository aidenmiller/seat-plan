/**
 * Helpers for the seating specs (milestone 5): a wedding with guests and a
 * layout of tables at known places, the side list on either device, seat
 * circles on screen, and zooming with Ctrl+wheel.
 */
import { randomUUID } from 'node:crypto'
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { emptyCanvas, type Canvas, type Item, type Table } from '../src/domain/canvas-schema'
import { makeItem } from '../src/domain/presets'
import type { CreateGuestBody, Guest, LayoutDetail } from '../src/shared/api'
import { isPhoneLayout, itemLocator, settledCamera, sheetAtRest, viewport, type Point } from './canvas'
import { apiAddGuests, apiLinkPartners, apiListGuests } from './guest-list'
import { apiCreateLayout, apiCreateWedding, apiGetLayout, apiPutCanvas, editorPath, expectSaved, signIn, uniqueName } from './helpers'

export type TablePlan = { at: Point; seats?: number; guests?: (string | null)[] }

/** A round table (60 in) at `at` with `seats` seats, holding `guests` from seat 1 on. */
function roundTable(canvas: Canvas, plan: TablePlan): Table {
  const t = makeItem('round', plan.at, randomUUID(), canvas) as Table
  const count = plan.seats ?? t.seatCount
  return {
    ...t,
    seatCount: count,
    seats: Array.from({ length: count }, (_, index) => ({ index, guestId: plan.guests?.[index] ?? null })),
  }
}

export type SeatingSetup = {
  weddingId: string
  layout: LayoutDetail
  guests: Guest[]
  /** Table ids, in the order of `tables`. */
  tables: string[]
  byName(first: string): Guest
}

/**
 * Signs in, makes a wedding with `guests` (partners linked by first name),
 * and a layout with round tables at the given places; `tables[i].guests`
 * names guests by first name.
 */
export async function setupSeating(
  page: Page,
  testInfo: TestInfo,
  options: { guests: CreateGuestBody[]; partners?: [string, string][]; tables: (Omit<TablePlan, 'guests'> & { guests?: (string | null)[] })[] },
): Promise<SeatingSetup> {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Seating', testInfo))
  const guests = await apiAddGuests(page.request, wedding.id, options.guests)
  const byName = (first: string) => {
    const g = guests.find((x) => x.firstName === first)
    if (!g) throw new Error(`No guest ${first}`)
    return g
  }
  for (const [a, b] of options.partners ?? []) await apiLinkPartners(page.request, byName(a).id, byName(b).id)
  const created = await apiCreateLayout(page.request, wedding.id, { name: 'Reception' })
  let canvas: Canvas = { ...emptyCanvas(), items: [] }
  const tables: string[] = []
  for (const plan of options.tables) {
    const t = roundTable(canvas, { ...plan, guests: plan.guests?.map((n) => (n === null ? null : byName(n).id)) })
    canvas = { ...canvas, items: [...canvas.items, t as Item] }
    tables.push(t.id)
  }
  await apiPutCanvas(page.request, created, canvas)
  const layout = await apiGetLayout(page.request, created.id)
  return { weddingId: wedding.id, layout, guests: await apiListGuests(page.request, wedding.id), tables, byName }
}

export async function openEditor(page: Page, setup: SeatingSetup): Promise<void> {
  await page.goto(editorPath(setup.weddingId, setup.layout.id))
  await expectSaved(page)
}

/** The Guests tab: the right panel on a laptop, the bottom sheet (raised to half) on a phone. */
export async function openGuestsTab(page: Page): Promise<Locator> {
  if (await isPhoneLayout(page)) {
    const sheet = page.getByTestId('bottom-sheet')
    const tab = sheet.getByRole('tab', { name: 'Guests' })
    if ((await sheet.getAttribute('data-snap')) === 'strip' || (await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(sheet).not.toHaveAttribute('data-snap', 'strip')
    await sheetAtRest(page)
    return sheet.getByTestId('guests-panel')
  }
  const panel = page.getByTestId('right-panel')
  await panel.getByRole('tab', { name: 'Guests' }).click()
  await expect(panel.getByRole('tab', { name: 'Guests' })).toHaveAttribute('aria-selected', 'true')
  return panel.getByTestId('guests-panel')
}

export function guestRow(panel: Locator, guestId: string): Locator {
  return panel.locator(`[data-testid="side-list-guest"][data-guest-id="${guestId}"]`)
}

export function seatCircle(page: Page, tableId: string, seatIndex: number): Locator {
  return itemLocator(page, tableId).locator(`circle[data-seat-index="${seatIndex}"]`)
}

/** Where a seat circle is drawn on screen (page px), and its size. */
export async function seatOnScreen(page: Page, tableId: string, seatIndex: number): Promise<Point & { size: number }> {
  const box = await seatCircle(page, tableId, seatIndex).boundingBox()
  if (!box) throw new Error(`No seat ${seatIndex} at ${tableId}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, size: box.width }
}

/** The center of a table's body on screen (page px). */
export async function tableOnScreen(page: Page, tableId: string): Promise<Point> {
  const box = await itemLocator(page, tableId).locator('[data-table-body]').boundingBox()
  if (!box) throw new Error(`No table ${tableId}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export async function rowCenter(row: Locator): Promise<Point> {
  const box = await row.boundingBox()
  if (!box) throw new Error('Row not on screen')
  return { x: box.x + Math.min(60, box.width / 4), y: box.y + box.height / 2 }
}

/** Who sits where on the server: table id to guest ids by seat. */
export async function serverSeats(page: Page, layoutId: string): Promise<Record<string, (string | null)[]>> {
  const layout = await apiGetLayout(page.request, layoutId)
  return Object.fromEntries(layout.canvas.items.filter((i): i is Table => i.kind === 'table').map((t) => [t.id, t.seats.map((s) => s.guestId)]))
}

/**
 * Ctrl+wheel steps on the canvas at `at` (page px; the viewport's middle by
 * default), as a trackpad pinch or a mouse with Ctrl sends them; each
 * deltaY of 8 zooms by about 8%. Waits for the camera to settle.
 */
export async function wheelZoom(page: Page, deltaY: number, steps = 1, at?: Point): Promise<void> {
  const box = (await viewport(page).boundingBox())!
  const p = at ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.evaluate(
    ({ deltaY, steps, p }) => {
      const target = document.querySelector('[data-editor-viewport]')!
      for (let i = 0; i < steps; i++) {
        target.dispatchEvent(new WheelEvent('wheel', { deltaX: 0, deltaY, deltaMode: 0, ctrlKey: true, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true }))
      }
    },
    { deltaY, steps, p },
  )
  await settledCamera(page)
}

/** The detail level the world SVG carries now. */
export async function detailLevel(page: Page): Promise<string | null> {
  return page.getByTestId('canvas').getAttribute('data-detail')
}

/** True when the element is drawn: not hidden by CSS visibility or display, and fully faded in. */
export async function drawn(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    let node: Element | null = el
    while (node) {
      const s = getComputedStyle(node)
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.99) return false
      node = node.parentElement
    }
    return true
  })
}

/** Links two guests as partners; re-exported for specs. */
export { apiLinkPartners }
