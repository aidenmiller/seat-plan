/**
 * The editor's top bar keeps its height while the save status changes (PLAN
 * section 6 and EditorShell: the status has a fixed slot and the name is cut
 * short, so the canvas never jumps on a save). Checked at each project's
 * width; the phone project is 390 px, where room is tightest.
 *
 * Every change to the top bar is recorded in the page as it happens (a
 * MutationObserver and a ResizeObserver), so a height change that lasts a
 * single frame still fails the test.
 */
import { expect, test, type Page } from '@playwright/test'
import {
  addTableButton,
  apiCreateLayout,
  apiCreateWedding,
  editorPath,
  expectSaved,
  holdLayoutSaves,
  presetAuthor,
  saveStatus,
  signIn,
  uniqueName,
  waitForEditor,
} from './helpers'

type HeaderSample = { status: string; text: string; height: number; canvasTop: number }
type HeaderLogWindow = Window & { __headerLog?: HeaderSample[] }

/** Starts recording the top bar's height and the canvas's top edge at every change. */
async function recordHeader(page: Page): Promise<void> {
  await page.evaluate(() => {
    const header = document.querySelector('header')
    const status = document.querySelector('[data-testid="save-status"]')
    const canvas = document.querySelector('[data-testid="canvas"]')
    if (!header || !status || !canvas) throw new Error('The editor is not on the page')
    const log: HeaderSample[] = []
    const take = () =>
      log.push({
        status: status.getAttribute('data-status') ?? '',
        text: status.textContent ?? '',
        height: header.getBoundingClientRect().height,
        canvasTop: canvas.getBoundingClientRect().top,
      })
    take()
    new MutationObserver(take).observe(header, { attributes: true, childList: true, characterData: true, subtree: true })
    new ResizeObserver(take).observe(header)
    ;(window as HeaderLogWindow).__headerLog = log
  })
}

async function headerLog(page: Page): Promise<HeaderSample[]> {
  return page.evaluate(() => (window as HeaderLogWindow).__headerLog ?? [])
}

async function headerHeight(page: Page): Promise<number> {
  const box = await page.locator('header').boundingBox()
  if (!box) throw new Error('No top bar')
  return box.height
}

/** Nothing on the page is wider than the screen. */
async function expectNoSideScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, screen: window.innerWidth }))
  expect(widths.page).toBeLessThanOrEqual(widths.screen)
}

test('the top bar keeps its height while the status goes from Saving to Saved', async ({ context, page }, testInfo) => {
  if (testInfo.project.name === 'phone') expect(page.viewportSize()?.width).toBe(390)
  await presetAuthor(context, 'Noa')
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Top bar', testInfo))
  // A long name, so the name, the status and the Noa / Aiden switch all compete for the row.
  const name = 'Reception plan for the big room with the long head table and the dance floor'
  const layout = await apiCreateLayout(page.request, wedding.id, { name })

  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  await expectSaved(page)
  await expect(page.locator('header')).toHaveCount(1)
  await expect(page.getByTestId('layout-title')).toHaveText(name)
  const height = await headerHeight(page)
  await recordHeader(page)
  await expectNoSideScroll(page)

  // Saving: the save is held, so the status stays on Saving.
  const saves = await holdLayoutSaves(page)
  await addTableButton(page).click()
  await saves.waitForHeld()
  await expect(saveStatus(page)).toHaveAttribute('data-status', 'saving')
  await expect(saveStatus(page)).toHaveText('Saving…')
  expect(await headerHeight(page)).toBe(height)
  await expectNoSideScroll(page)

  // Saved.
  await saves.release()
  await expectSaved(page)
  expect(await headerHeight(page)).toBe(height)

  // The longest status: the server fails once, so it reads "Not saved, retrying", then Saved.
  let failing = true
  await page.route('**/api/layouts/*', async (route) => {
    if (!failing || route.request().method() !== 'PUT') return route.fallback()
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' }) })
  })
  await addTableButton(page).click()
  await expect(saveStatus(page)).toHaveAttribute('data-status', 'retrying')
  await expect(saveStatus(page)).toHaveText('Not saved, retrying')
  await expect(saveStatus(page)).toHaveAttribute('title', 'Not saved, retrying. The server answered 503.')
  expect(await headerHeight(page)).toBe(height)
  await expectNoSideScroll(page)
  failing = false
  await expectSaved(page)
  expect(await headerHeight(page)).toBe(height)

  // Every state the top bar went through had the same height, and the canvas never moved.
  const log = await headerLog(page)
  const seen = new Set(log.map((sample) => sample.status))
  for (const status of ['saving', 'saved', 'retrying']) expect(seen, `the log saw ${status}`).toContain(status)
  expect(log.map((sample) => sample.text)).toContain('Saving…')
  for (const sample of log) {
    expect(sample.height, `top bar height while "${sample.text}"`).toBe(height)
    expect(sample.canvasTop, `canvas top while "${sample.text}"`).toBe(log[0].canvasTop)
  }
})
