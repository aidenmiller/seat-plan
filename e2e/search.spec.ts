/**
 * Acceptance check 5: typing part of a name in the side list's search and
 * clicking the result pans to that guest's seat, on a phone and a laptop
 * (spec section 6, "Seated and unassigned"; DECISIONS 23; PLAN "Phones").
 *
 * The camera glides to at least close level with the seat in the middle of
 * the part of the canvas nothing covers, the seat pulses for two seconds,
 * and the names around it show. It works in Edit and in View mode (phones
 * open in View). On a phone the sheet drops to its strip first, and a slow
 * tap on a name (held past the 450 ms that would start a drag in Edit mode)
 * still pans, with no "Switch to Edit" refusal.
 */
import { expect, test, type Page } from '@playwright/test'
import { editorMode, isPhoneLayout, itemLocator, setMode, settledCamera, Touch, viewport } from './canvas'
import {  } from './helpers'
import { detailLevel, drawn, guestRow, openEditor, openGuestsTab, seatOnScreen, setupSeating } from './seating'

/** The seat's center lies in the part of the canvas nothing covers, near its middle. */
async function expectSeatInView(page: Page, tableId: string, seatIndex: number): Promise<void> {
  const seat = await seatOnScreen(page, tableId, seatIndex)
  const vp = (await viewport(page).boundingBox())!
  let bottom = vp.y + vp.height
  if (await isPhoneLayout(page)) bottom = Math.min(bottom, (await page.getByTestId('bottom-sheet').boundingBox())!.y)
  expect(seat.x).toBeGreaterThan(vp.x + 40)
  expect(seat.x).toBeLessThan(vp.x + vp.width - 40)
  expect(seat.y).toBeGreaterThan(vp.y + 40)
  expect(seat.y).toBeLessThan(bottom - 40)
  // Near the middle across, and well clear of the bottom (the sheet's strip and the zoom controls).
  expect(Math.abs(seat.x - (vp.x + vp.width / 2))).toBeLessThan(40)
}

test('searching a name and clicking it pans and zooms to their seat, which pulses, in Edit and View mode', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const s = await setupSeating(page, testInfo, {
    guests: [
      { firstName: 'Jane', lastName: 'Doe' },
      { firstName: 'Bo', lastName: 'Ray' },
      { firstName: 'Ann', lastName: 'Lee' },
    ],
    tables: [
      { at: { x: 0, y: 0 }, guests: ['Bo'] },
      { at: { x: 3000, y: 1800 }, guests: [null, null, null, null, 'Jane', 'Ann'] },
    ],
  })
  const [t1, t2] = s.tables
  const jane = s.byName('Jane')
  const bo = s.byName('Bo')
  await openEditor(page, s)
  const phone = await isPhoneLayout(page)
  // Phones open in View mode; laptops in Edit.
  expect(await editorMode(page)).toBe(phone ? 'view' : 'edit')
  const before = await settledCamera(page)
  expect(before.zoom).toBeLessThan(0.8)
  expect(await detailLevel(page)).not.toBe('close')

  const panel = await openGuestsTab(page)
  await panel.getByTestId('side-list-search').fill('jan')
  const row = guestRow(panel.getByTestId('side-list-seated'), jane.id)
  await expect(row).toBeVisible()
  await expect(panel.getByTestId('side-list-guest')).toHaveCount(1)
  if (phone) await row.tap()
  else await row.click()
  if (phone) await expect(page.getByTestId('bottom-sheet')).toHaveAttribute('data-snap', 'strip')

  // The seat pulses for two seconds, then stops.
  await expect(itemLocator(page, t2).locator('[data-seat-pulse]')).toHaveCount(1)
  const after = await settledCamera(page)
  expect(after.zoom).toBeGreaterThanOrEqual(0.8 - 1e-6)
  expect(await detailLevel(page)).toBe('close')
  await expectSeatInView(page, t2, 4)
  // The names around the seat show: Jane's own label and Ann's beside her.
  const names = page.locator(`[data-names-for="${t2}"]`)
  await expect(names.locator('[data-name-for="4"]')).toHaveText(/Jane( Doe| D\.)/)
  await expect(names.locator('[data-name-for="5"]')).toHaveText(/Ann( Lee| L\.)/)
  await expect.poll(() => drawn(names.locator('[data-name-for="4"]'))).toBe(true)
  await expect(itemLocator(page, t2).locator('[data-seat-pulse]')).toHaveCount(0, { timeout: 4_000 })
  await expect(page.getByTestId('editor-notice')).toHaveCount(0)

  // View mode on a laptop too. On a phone, a tap held past 450 ms still pans in View mode.
  await setMode(page, 'view')
  const again = await openGuestsTab(page)
  await again.getByTestId('side-list-search').fill('Ray')
  const boRow = guestRow(again, bo.id)
  await expect(boRow).toBeVisible()
  if (phone) {
    const box = (await boRow.boundingBox())!
    await (await Touch.on(page)).longPress({ x: box.x + 40, y: box.y + box.height / 2 }, 650)
  } else {
    await boRow.click()
  }
  await expect(itemLocator(page, t1).locator('[data-seat-pulse]')).toHaveCount(1)
  await settledCamera(page)
  await expectSeatInView(page, t1, 0)
  await expect(page.getByTestId('editor-notice')).toHaveCount(0)
})
