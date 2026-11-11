import { randomBytes, randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type BrowserContext, type Page, type Route, type TestInfo } from '@playwright/test'
import type { Canvas } from '../src/domain/canvas-schema'
import { addRoundTable } from '../src/domain/round-table'
import type { LayoutDetail, SaveLayoutOk, WeddingSummary } from '../src/shared/api'
import { addControl, setMode } from './canvas'
import { E2E_USERS, userPassword, type Who } from './users'

export { addRoundTable, addPreset } from './canvas'
export { E2E_USERS, userPassword, type Who } from './users'

/** The site password this run's server was started with (made up per run; it only opens /setup now). */
export function sitePassword(): string {
  const value = process.env.E2E_SITE_PASSWORD
  if (!value) throw new Error('E2E_SITE_PASSWORD is not set; run through playwright.config.ts')
  return value
}

/** Signs the page in as one of the run's accounts (e2e/users.ts): A, an admin, unless told otherwise. */
export async function signIn(page: Page, who: Who = 'a', next = '/'): Promise<void> {
  await page.goto(next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('Email').fill(E2E_USERS[who].email)
  await page.getByLabel('Password').fill(userPassword(who))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/** Signs a bare request context in (no page), for setting up data through the API. */
export async function signInRequest(request: APIRequestContext, who: Who = 'a'): Promise<void> {
  const res = await request.post('/api/auth/login', { data: { email: E2E_USERS[who].email, password: userPassword(who) } })
  expect(res.status()).toBe(200)
}

// ---------- Who is using this device ----------

/** The localStorage key src/client/author.ts reads. */
export const AUTHOR_KEY = 'seat-plan:author'
export type Author = 'Noa' | 'Aiden'

/**
 * Picks who is using this device before any page script runs, so the "Who is
 * using this device?" prompt stays away. Only fills an empty choice, so a test
 * can still switch with the top bar.
 */
export async function presetAuthor(context: BrowserContext, author: Author = 'Noa'): Promise<void> {
  await context.addInitScript(
    ([key, value]) => {
      try {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value)
      } catch {
        // about:blank and the like have no storage.
      }
    },
    [AUTHOR_KEY, author] as const,
  )
}

// ---------- Names ----------

/**
 * A name no other test (or the other project, which shares the database)
 * will use: "Label phone 3f9a1c".
 */
export function uniqueName(label: string, testInfo: TestInfo): string {
  return `${label} ${testInfo.project.name} ${randomBytes(3).toString('hex')}`
}

// ---------- Data through the API (the page's cookies) ----------

export async function apiCreateWedding(request: APIRequestContext, name: string): Promise<WeddingSummary> {
  const res = await request.post('/api/weddings', { data: { id: randomUUID(), name } })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as WeddingSummary
}

export async function apiCreateLayout(
  request: APIRequestContext,
  weddingId: string,
  options: { name: string; kind?: 'reception' | 'ceremony'; venueTemplateId?: string | null; editedBy?: Author },
): Promise<LayoutDetail> {
  const res = await request.post(`/api/weddings/${weddingId}/layouts`, {
    data: {
      id: randomUUID(),
      name: options.name,
      kind: options.kind ?? 'reception',
      venueTemplateId: options.venueTemplateId ?? null,
      editedBy: options.editedBy ?? 'Noa',
    },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as LayoutDetail
}

export async function apiGetLayout(request: APIRequestContext, layoutId: string): Promise<LayoutDetail> {
  const res = await request.get(`/api/layouts/${layoutId}`)
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as LayoutDetail
}

/** Saves `tables` round tables onto a layout with one PUT, as the editor would. */
export async function apiAddTables(
  request: APIRequestContext,
  layout: Pick<LayoutDetail, 'id' | 'version' | 'canvas'>,
  tables: number,
  editedBy: Author = 'Noa',
): Promise<SaveLayoutOk> {
  let canvas: Canvas = layout.canvas
  for (let i = 0; i < tables; i++) canvas = addRoundTable(canvas, randomUUID())
  const res = await request.put(`/api/layouts/${layout.id}`, {
    data: { baseVersion: layout.version, saveId: randomUUID(), editedBy, tabId: 'e2e-setup', canvas },
  })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as SaveLayoutOk
}

/** Saves a whole canvas onto a layout with one PUT, as the editor would. */
export async function apiPutCanvas(
  request: APIRequestContext,
  layout: Pick<LayoutDetail, 'id' | 'version'>,
  canvas: Canvas,
  editedBy: Author = 'Noa',
): Promise<SaveLayoutOk> {
  const res = await request.put(`/api/layouts/${layout.id}`, {
    data: { baseVersion: layout.version, saveId: randomUUID(), editedBy, tabId: 'e2e-setup', canvas },
  })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as SaveLayoutOk
}

// ---------- The editor ----------

export const editorPath = (weddingId: string, layoutId: string) => `/w/${weddingId}/layouts/${layoutId}`

export function saveStatus(page: Page) {
  return page.getByTestId('save-status')
}

/** The tables on the canvas. */
export function canvasTables(page: Page) {
  return page.getByTestId('canvas').locator('[data-kind="table"]')
}

/** The shape panel's Round tile (desktops; on phones it sits in the Shapes drawer, see addRoundTable). */
export function addTableButton(page: Page) {
  return page.getByTestId('shape-panel').getByRole('button', { name: 'Add round table' })
}

/**
 * Waits until the editor has opened the layout and can take edits. Phones
 * open in View mode, so this switches the editor to Edit first.
 */
export async function waitForEditor(page: Page): Promise<void> {
  await setMode(page, 'edit')
  await expect(addControl(page)).toBeEnabled({ timeout: 10_000 })
}

export async function expectSaved(page: Page, timeout = 10_000): Promise<void> {
  await expect(saveStatus(page)).toHaveAttribute('data-status', 'saved', { timeout })
  await expect(saveStatus(page)).toHaveText('Saved')
}

/** The ids of the tables on the canvas, in drawing order. */
export async function tableIds(page: Page): Promise<string[]> {
  return canvasTables(page).evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-item-id') ?? ''))
}

/**
 * Holds every layout save (PUT /api/layouts/:id) this page sends until
 * release(), so a test can line up edits before any of them lands.
 */
export async function holdLayoutSaves(page: Page) {
  const held: Route[] = []
  let open = false
  await page.route('**/api/layouts/*', async (route) => {
    if (open || route.request().method() !== 'PUT') return route.fallback()
    held.push(route)
  })
  return {
    /** How many saves are waiting. */
    count: () => held.length,
    async waitForHeld(n = 1): Promise<void> {
      await expect.poll(() => held.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(n)
    },
    /** Lets the held saves (and every later one) through. */
    async release(): Promise<void> {
      open = true
      for (const route of held.splice(0)) await route.fallback()
    },
  }
}
