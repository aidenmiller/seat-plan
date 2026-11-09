import { randomBytes, randomUUID } from 'node:crypto'
import { expect, type APIRequestContext, type BrowserContext, type Page, type Route, type TestInfo } from '@playwright/test'
import type { Canvas } from '../src/domain/canvas-schema'
import { addRoundTable } from '../src/domain/round-table'
import type { LayoutDetail, SaveLayoutOk, WeddingSummary } from '../src/shared/api'

/** The password this run's server was started with (made up per run). */
export function sitePassword(): string {
  const value = process.env.E2E_SITE_PASSWORD
  if (!value) throw new Error('E2E_SITE_PASSWORD is not set; run through playwright.config.ts')
  return value
}

export async function signIn(page: Page, next = '/'): Promise<void> {
  await page.goto(next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel('Password').fill(sitePassword())
  await page.getByRole('button', { name: 'Enter' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/** Signs a bare request context in (no page), for setting up data through the API. */
export async function signInRequest(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/auth/login', { data: { password: sitePassword() } })
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
  options: { name: string; venueTemplateId?: string | null; editedBy?: Author },
): Promise<LayoutDetail> {
  const res = await request.post(`/api/weddings/${weddingId}/layouts`, {
    data: {
      id: randomUUID(),
      name: options.name,
      kind: 'reception',
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

// ---------- The editor ----------

export const editorPath = (weddingId: string, layoutId: string) => `/w/${weddingId}/layouts/${layoutId}`

export function saveStatus(page: Page) {
  return page.getByTestId('save-status')
}

/** The tables on the bare canvas. */
export function canvasTables(page: Page) {
  return page.getByTestId('canvas').locator('[data-kind="table"]')
}

export function addTableButton(page: Page) {
  return page.getByRole('button', { name: 'Add round table' })
}

/** Waits until the editor has opened the layout and can take edits. */
export async function waitForEditor(page: Page): Promise<void> {
  await expect(addTableButton(page)).toBeEnabled({ timeout: 10_000 })
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
