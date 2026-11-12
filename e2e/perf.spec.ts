/**
 * Acceptance check 27, the speed target (PLAN section 6): with 40 tables, 400
 * seated guests and 100 other shapes, zooming from 10% to 800% and back and
 * panning stay smooth.
 *
 * The page drives the gesture itself, one trackpad-style wheel event per
 * animation frame (Ctrl+wheel zooms, as Chrome sends a pinch; a two-axis
 * scroll pans), and records the time between frames with
 * requestAnimationFrame, the settle after each part included. It fails when
 * more than 5% of frames take longer than 20 ms, or longer than 33 ms with
 * the CPU slowed 4 times (Chrome's CPU throttling, standing in for a phone).
 *
 * Zooming must not re-render React: the app has no commit counter, so the
 * test checks that every item element is the same DOM node after the
 * gestures and that nothing inside the furniture layer changed at all.
 *
 * Laptop project only, one test at a time (the config runs one worker), so
 * nothing else competes for the CPU.
 */
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { settledCamera, viewport, zoomButtonsTo, zoomLevel } from './canvas'
import { dbAddGuests } from './db'
import { apiCreateLayout, apiCreateWedding, apiPutCanvas, canvasTables, editorPath, expectSaved, signIn, uniqueName } from './helpers'
import { perfCanvas, perfGuestNames, PERF_SHAPES, PERF_TABLES } from './perf-layout'

test.describe.configure({ mode: 'serial' })

type Step = { dx: number; dy: number; ctrl: boolean } | { pause: number }
type Run = { intervals: number[]; frames: number; phases: string[] }

/** Zoom in from 10% to 800% (55 frames), pause, back out, pause, pan 90 frames, pause. Pauses let the camera settle. */
function gesturePlan(): Step[] {
  const plan: Step[] = []
  for (let i = 0; i < 55; i++) plan.push({ dx: 0, dy: -8, ctrl: true })
  plan.push({ pause: 300 })
  for (let i = 0; i < 55; i++) plan.push({ dx: 0, dy: 8, ctrl: true })
  plan.push({ pause: 300 })
  for (let i = 0; i < 90; i++) plan.push({ dx: 6, dy: 3, ctrl: false })
  plan.push({ pause: 300 })
  return plan
}

/** Plays the plan in the page, one wheel event per frame at the canvas's middle, recording every frame interval. */
async function playGesture(page: Page): Promise<Run> {
  const box = (await viewport(page).boundingBox())!
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  return page.evaluate(
    ({ plan, at }) =>
      new Promise<Run>((resolve) => {
        const target = document.querySelector('[data-editor-viewport]')!
        const intervals: number[] = []
        const phases: string[] = []
        let phase = 'start'
        let last: number | null = null
        let i = 0
        let pauseUntil = 0
        const frame = (t: number) => {
          if (last !== null) {
            intervals.push(t - last)
            phases.push(phase)
          }
          last = t
          if (t < pauseUntil) return requestAnimationFrame(frame)
          if (i >= plan.length) return resolve({ intervals, frames: intervals.length, phases })
          const step = plan[i++]
          if ('pause' in step) {
            pauseUntil = t + step.pause
            phase = `settle after ${phase}`
          } else {
            phase = step.ctrl ? (step.dy < 0 ? 'zoom in' : 'zoom out') : 'pan'
            const init = { deltaX: step.dx, deltaY: step.dy, deltaMode: 0, ctrlKey: step.ctrl, clientX: at.x, clientY: at.y }
            target.dispatchEvent(new WheelEvent('wheel', { ...init, bubbles: true, cancelable: true }))
          }
          requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      }),
    { plan: gesturePlan(), at },
  )
}

/**
 * Frames arrive on whole display refreshes (16.7 ms at 60 Hz), so a frame
 * counts as slow when it runs more than 1 ms past the limit: two refreshes
 * (33.4 ms) meet the 33 ms limit, three (50 ms) do not.
 */
const VSYNC_JITTER_MS = 1

function summary(run: Run, limitMs: number) {
  const sorted = [...run.intervals].sort((a, b) => a - b)
  const slow = run.intervals.filter((ms) => ms > limitMs + VSYNC_JITTER_MS).length
  const refreshes: Record<string, number> = {}
  for (const ms of run.intervals) {
    const n = String(Math.max(1, Math.round(ms / (1000 / 60))))
    refreshes[n] = (refreshes[n] ?? 0) + 1
  }
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  return {
    frames: run.frames,
    slow,
    slowShare: slow / run.frames,
    median: Math.round(pct(0.5) * 10) / 10,
    p95: Math.round(pct(0.95) * 10) / 10,
    worst: Math.round(sorted[sorted.length - 1] * 10) / 10,
    /** How many frames took 1, 2, 3... display refreshes. */
    refreshes,
    /** Where the slow frames were. */
    slowIn: run.phases.reduce<Record<string, number>>((acc, phase, i) => {
      if (run.intervals[i] > limitMs + VSYNC_JITTER_MS) acc[phase] = (acc[phase] ?? 0) + 1
      return acc
    }, {}),
  }
}

/** Marks every item element and starts recording changes inside the furniture layer. */
async function watchItems(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __items: Element[]; __mutations: number }
    const svg = document.querySelector('[data-testid="canvas"]')!
    w.__items = [...svg.querySelectorAll('[data-item-id]')]
    w.__mutations = 0
    const furniture = svg.querySelector('[data-layer="furniture"]')!
    new MutationObserver((records) => {
      w.__mutations += records.length
    }).observe(furniture, { subtree: true, childList: true, attributes: true, characterData: true })
    return w.__items.length
  })
}

async function itemsKept(page: Page): Promise<{ same: boolean; count: number; mutations: number }> {
  return page.evaluate(() => {
    const w = window as unknown as { __items: Element[]; __mutations: number }
    const now = [...document.querySelectorAll('[data-testid="canvas"] [data-item-id]')]
    return { same: now.length === w.__items.length && now.every((el, i) => el === w.__items[i]), count: now.length, mutations: w.__mutations }
  })
}

test('40 tables, 400 seated guests and 100 shapes zoom from 10% to 800% and back, and pan, smoothly', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The speed test runs once, in the laptop project; the 4x slower CPU stands in for a phone.')
  test.setTimeout(120_000)
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Speed', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Big room' })
  const guests = await dbAddGuests(wedding.id, perfGuestNames())
  await apiPutCanvas(page.request, layout, perfCanvas(randomUUID, guests))

  await page.goto(editorPath(wedding.id, layout.id))
  await expectSaved(page)
  await expect(canvasTables(page)).toHaveCount(PERF_TABLES)
  await expect(page.getByTestId('canvas').locator('[data-kind="shape"]')).toHaveCount(PERF_SHAPES)
  await expect(page.getByTestId('canvas').locator('[data-seat-state="taken"]')).toHaveCount(400)

  await zoomButtonsTo(page, '10%')
  const items = await watchItems(page)
  expect(items).toBe(PERF_TABLES + PERF_SHAPES)

  // Normal speed: no more than 5% of frames over 20 ms.
  const normal = await playGesture(page)
  await settledCamera(page)
  await expect(zoomLevel(page)).toHaveText('10%')
  const fast = summary(normal, 20)
  testInfo.annotations.push({ type: 'frames at normal speed', description: JSON.stringify(fast) })

  // Zooming and panning re-rendered nothing: the same elements, untouched.
  const kept = await itemsKept(page)
  expect(kept.count).toBe(items)
  expect(kept.same, 'every item element is the same node').toBe(true)
  expect(kept.mutations, 'changes inside the furniture layer').toBe(0)

  // A CPU four times slower: no more than 5% of frames over 33 ms.
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  let throttled: Run
  try {
    throttled = await playGesture(page)
    await settledCamera(page)
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  }
  const slow = summary(throttled, 33)
  testInfo.annotations.push({ type: 'frames with 4x CPU throttling', description: JSON.stringify(slow) })
  console.log(`perf: normal ${JSON.stringify(fast)}; 4x slower CPU ${JSON.stringify(slow)}`)

  expect(fast.frames).toBeGreaterThan(150)
  expect(fast.slowShare, `frames over 20 ms at normal speed: ${JSON.stringify(fast)}`).toBeLessThanOrEqual(0.05)
  expect(slow.slowShare, `frames over 33 ms with the CPU slowed 4x: ${JSON.stringify(slow)}`).toBeLessThanOrEqual(0.05)
  expect((await itemsKept(page)).same).toBe(true)
})
