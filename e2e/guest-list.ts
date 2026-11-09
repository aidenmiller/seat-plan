/**
 * Helpers for the guest list specs (milestone 4): guests, groups and seats
 * set up through the app's own routes, and the Guests page's rows, which are
 * a table on laptops and cards on phones (below 768 px).
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, type APIRequestContext, type Download, type Locator, type Page } from '@playwright/test'
import type { Canvas } from '../src/domain/canvas-schema'
import type { CreateGuestBody, Group, Guest, LayoutDetail, SaveLayoutOk } from '../src/shared/api'
import { apiPutCanvas } from './helpers'

export const guestsPath = (weddingId: string) => `/w/${weddingId}/guests`
export const groupsPath = (weddingId: string) => `/w/${weddingId}/groups`
export const importPath = (weddingId: string) => `/w/${weddingId}/guests/import`

// ---------- Data through the API (the page's cookies) ----------

/** Adds guests in one request (the pasted-names route) and returns them in order. */
export async function apiAddGuests(request: APIRequestContext, weddingId: string, guests: CreateGuestBody[]): Promise<Guest[]> {
  const res = await request.post(`/api/weddings/${weddingId}/guests/bulk`, {
    data: { guests: guests.map((g) => ({ id: randomUUID(), ...g })) },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as Guest[]
}

export async function apiListGuests(request: APIRequestContext, weddingId: string): Promise<Guest[]> {
  const res = await request.get(`/api/weddings/${weddingId}/guests`)
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as Guest[]
}

export async function apiListGroups(request: APIRequestContext, weddingId: string): Promise<Group[]> {
  const res = await request.get(`/api/weddings/${weddingId}/groups`)
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as Group[]
}

export async function apiCreateGroup(request: APIRequestContext, weddingId: string, name: string, guestIds: string[] = []): Promise<Group> {
  const res = await request.post(`/api/weddings/${weddingId}/groups`, { data: { id: randomUUID(), name, guestIds } })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as Group
}

/** Links two guests as partners. */
export async function apiLinkPartners(request: APIRequestContext, a: string, b: string): Promise<void> {
  const res = await request.patch(`/api/guests/${a}`, { data: { partnerId: b } })
  expect(res.status(), await res.text()).toBe(200)
}

/** One guest by name, as the server has it now. */
export async function apiGuestByName(request: APIRequestContext, weddingId: string, firstName: string, lastName: string): Promise<Guest | undefined> {
  return (await apiListGuests(request, weddingId)).find((g) => g.firstName === firstName && g.lastName === lastName)
}

/**
 * Seats guests at the layout's tables with one save, as the editor would:
 * `byTable[i]` fills the i-th table (in drawing order) from seat 1 on.
 */
export async function apiSeatGuests(
  request: APIRequestContext,
  layout: Pick<LayoutDetail, 'id' | 'version' | 'canvas'>,
  byTable: readonly (readonly string[])[],
): Promise<SaveLayoutOk> {
  let t = 0
  const canvas: Canvas = {
    ...layout.canvas,
    items: layout.canvas.items.map((item) => {
      if (item.kind !== 'table') return item
      const ids = byTable[t++] ?? []
      expect(ids.length, `guests for table ${item.number}`).toBeLessThanOrEqual(item.seats.length)
      return { ...item, seats: item.seats.map((seat, i) => (ids[i] ? { ...seat, guestId: ids[i] } : seat)) }
    }),
  }
  return apiPutCanvas(request, layout, canvas)
}

// ---------- The Guests page ----------

/** True when the Guests page shows cards (phones), false for the table (laptops). */
export function narrowScreen(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 768
}

/** A guest's row in the table, or their card on a phone. */
export function guestEntry(page: Page, guestId: string): Locator {
  return page.locator(`[data-testid="guest-row"][data-guest-id="${guestId}"], [data-testid="guest-card"][data-guest-id="${guestId}"]`)
}

/** Every guest row or card shown, in order. */
export function guestEntries(page: Page): Locator {
  return page.locator('[data-testid="guest-row"], [data-testid="guest-card"]')
}

/** The names shown, in order, as "First Last". */
export async function shownNames(page: Page, guests: readonly Guest[]): Promise<string[]> {
  const byId = new Map(guests.map((g) => [g.id, `${g.firstName} ${g.lastName}`]))
  const ids = await guestEntries(page).evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-guest-id') ?? ''))
  return ids.map((id) => byId.get(id) ?? id)
}

/**
 * Waits until React has hydrated `element`, so its handlers are attached:
 * text typed or a file picked before then would never reach React's state.
 * React keeps each element's props on the node under a "__reactProps$" key.
 */
export async function expectHydrated(element: Locator): Promise<void> {
  await expect
    .poll(() => element.evaluate((node) => Object.keys(node).some((key) => key.startsWith('__reactProps$'))), {
      message: 'the page has hydrated',
    })
    .toBe(true)
}

/** Waits until the page shows the guest list and can take input (it switches to cards on phones right after hydrating). */
export async function waitForGuestList(page: Page): Promise<void> {
  await expect(page.getByTestId('add-guest-form')).toBeVisible()
  await expectHydrated(page.getByTestId('add-guest-first'))
  await expect(page.getByTestId(narrowScreen(page) ? 'guest-cards' : 'guest-table').or(page.getByTestId('guests-empty'))).toBeVisible()
}

/** Waits until the Groups page can take input. */
export async function waitForGroupsPage(page: Page): Promise<void> {
  await expect(page.getByTestId('new-group-form')).toBeVisible()
  await expectHydrated(page.getByTestId('new-group-input'))
}

/**
 * Where a guest's field edits in place: the table cell on a laptop; on a
 * phone, the field in the guest's Edit dialog (opened here when needed).
 */
export async function guestField(page: Page, guestId: string, field: 'firstName' | 'lastName' | 'nickname' | 'meal' | 'household' | 'notes' | 'partner' | 'groups'): Promise<Locator> {
  if (!narrowScreen(page)) return guestEntry(page, guestId).getByTestId(`cell-${field}`)
  const dialog = page.getByTestId('guest-edit-dialog')
  if (!(await dialog.isVisible())) {
    await guestEntry(page, guestId).getByTestId('edit-guest').click()
    await expect(dialog).toBeVisible()
  }
  return dialog.getByTestId(`edit-${field}`)
}

/** Closes the phone's Edit dialog if it is open. */
export async function closeGuestDialog(page: Page): Promise<void> {
  const dialog = page.getByTestId('guest-edit-dialog')
  if (await dialog.isVisible()) {
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(dialog).toBeHidden()
  }
}

/** Ticks a guest's check box (row or card) for Add to group. */
export async function selectGuest(page: Page, guest: Pick<Guest, 'id' | 'firstName' | 'lastName'>): Promise<void> {
  await guestEntry(page, guest.id).getByRole('checkbox', { name: `Select ${guest.firstName} ${guest.lastName}` }).check()
}

/** Waits for the page header's row save status to read Saved with nothing waiting. */
export async function expectRowsSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('row-save-status')).toHaveAttribute('data-status', 'saved', { timeout: 10_000 })
}

// ---------- Downloads ----------

/** Clicks `link` and returns the downloaded file's bytes and suggested name. */
export async function download(page: Page, link: Locator, savePath: string): Promise<{ bytes: Buffer; name: string; download: Download }> {
  const [file] = await Promise.all([page.waitForEvent('download'), link.click()])
  await file.saveAs(savePath)
  return { bytes: await readFile(savePath), name: file.suggestedFilename(), download: file }
}

/** The UTF-8 byte order mark Excel needs to read accents. */
export const BOM = Buffer.from([0xef, 0xbb, 0xbf])

/** A CSV's text without its byte order mark, split into lines (CRLF or LF). */
export function csvTextLines(bytes: Buffer): string[] {
  const text = bytes.subarray(0, 3).equals(BOM) ? bytes.subarray(3).toString('utf8') : bytes.toString('utf8')
  return text.split(/\r?\n/).filter((line) => line !== '')
}
