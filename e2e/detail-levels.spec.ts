/**
 * Acceptance check 8: zooming a 10-seat table with 10 seated guests from
 * 800% to 10% shows full names, then initials, then circles only, with no
 * flicker at the switch points (spec section 4, "Detail levels"; PLAN
 * section 6: going down, middle below 30 px a seat, far below 18 px; going
 * up, middle at 22 px, close at 36 px).
 *
 * Each step out is a Ctrl+wheel notch pair at the table's center, and the
 * test waits for the camera to settle and the 120 ms fade to end. At every
 * step exactly one label set is drawn, the one the level calls for: names
 * (close), initials in the seat circles (middle), none (far); the table's
 * name, count and circles always. Where the level switches, one notch back
 * in and out again leaves it where it is.
 */
import { expect, test, type Page } from '@playwright/test'
import { nextLevel, seatScreenPx, type DetailLevel } from '../src/domain/detail-level'
import { isPhoneLayout, itemLocator, settledCamera, zoomLevel } from './canvas'
import {  } from './helpers'
import { detailLevel, drawn, openEditor, setupSeating, tableOnScreen, wheelZoom } from './seating'

const NAMES: [string, string][] = [
  ['Ava', 'Cohen'],
  ['Ben', 'Levi'],
  ['Cara', 'Diaz'],
  ['Dov', 'Katz'],
  ['Eli', 'Brooks'],
  ['Fay', 'Adler'],
  ['Gil', 'Moss'],
  ['Hana', 'Roth'],
  ['Ido', 'Sela'],
  ['June', 'Park'],
]

type Sets = { names: boolean; initials: boolean }

/** Which label sets are drawn now (after the fade has finished). Only the current level's set is in the page. */
async function labelSets(page: Page, tableId: string): Promise<Sets> {
  const names = page.locator(`[data-labels="close"] [data-names-for="${tableId}"] [data-guest-name]`).first()
  const initials = page.locator(`[data-labels="middle"] [data-names-for="${tableId}"] [data-seat-initials]`).first()
  return {
    names: (await names.count()) > 0 && (await drawn(names)),
    initials: (await initials.count()) > 0 && (await drawn(initials)),
  }
}

function setsFor(level: DetailLevel): Sets {
  return { names: level === 'close', initials: level === 'middle' }
}

async function expectLevel(page: Page, tableId: string, level: DetailLevel): Promise<void> {
  expect(await detailLevel(page)).toBe(level)
  await expect.poll(() => labelSets(page, tableId), { message: `label sets at ${level}` }).toEqual(setsFor(level))
  // The table's name, count and circles show at every level.
  await expect.poll(() => drawn(itemLocator(page, tableId).locator('[data-table-name]'))).toBe(true)
  await expect(itemLocator(page, tableId).locator('circle[data-seat-state="taken"]')).toHaveCount(10)
}

test('zooming a 10-seat table from 800% to 10% shows full names, then initials, then circles only, with no flicker', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const s = await setupSeating(page, testInfo, {
    guests: NAMES.map(([firstName, lastName]) => ({ firstName, lastName })),
    tables: [{ at: { x: 0, y: 0 }, seats: 10, guests: NAMES.map(([first]) => first) }],
  })
  const [t] = s.tables
  await openEditor(page, s)
  await isPhoneLayout(page)
  const at = await tableOnScreen(page, t)

  // Up to 800%.
  await wheelZoom(page, -60, 8, at)
  await expect(zoomLevel(page)).toHaveText('800%')
  await expectLevel(page, t, 'close')
  const names = page.locator(`[data-labels="close"] [data-names-for="${t}"] [data-guest-name]`)
  await expect(names).toHaveCount(10)
  expect((await names.allTextContents()).sort()).toEqual(NAMES.map(([f, l]) => `${f} ${l}`).sort())
  expect(await names.evaluateAll((els) => els.map((e) => e.getAttribute('data-name-form')))).toEqual(Array(10).fill('full'))

  // Down to 10%, a step at a time.
  let level: DetailLevel = 'close'
  const seen: DetailLevel[] = ['close']
  for (let i = 0; i < 40; i++) {
    const before = await settledCamera(page)
    if (before.zoom <= 0.1 + 1e-9) break
    await wheelZoom(page, 16, 1, at)
    const { zoom } = await settledCamera(page)
    const expected = nextLevel(level, seatScreenPx(zoom))
    await expectLevel(page, t, expected)
    if (expected !== level) {
      seen.push(expected)
      // One notch in, then back out: the level stays put on either side of the switch point.
      await wheelZoom(page, -8, 1, at)
      await expectLevel(page, t, expected)
      await wheelZoom(page, 8, 1, at)
      await expectLevel(page, t, expected)
    }
    level = expected
  }
  await expect(zoomLevel(page)).toHaveText('10%')
  expect(seen).toEqual(['close', 'middle', 'far'])
  await expectLevel(page, t, 'far')

  // And back up past 22 px a seat: initials again.
  await wheelZoom(page, -16, 11, at)
  const { zoom } = await settledCamera(page)
  expect(seatScreenPx(zoom)).toBeGreaterThanOrEqual(22)
  await expectLevel(page, t, nextLevel('far', seatScreenPx(zoom)))
})
