/**
 * Acceptance check 24: tapping the + on an empty seat on a phone lists
 * unassigned guests, and picking one seats them (spec section 4, "Seating
 * guests"). The + shows in every empty seat at the middle and close levels
 * in Edit mode only, and a laptop clicks it and searches the list. With 25
 * new tables on screen, a seat at the edge of the view opens its picker
 * like any other (no cap on how many seats have a +).
 */
import { expect, test } from '@playwright/test'
import { isPhoneLayout, itemLocator, selectedIds, setMode, settledCamera, Touch } from './canvas'
import { expectSaved } from './helpers'
import { detailLevel, drawn, openEditor, seatCircle, seatOnScreen, serverSeats, setupSeating } from './seating'

test('the + on an empty seat lists unassigned guests, and picking one seats them there', async ({ page }, testInfo) => {
  const s = await setupSeating(page, testInfo, {
    guests: [
      { firstName: 'Jane', lastName: 'Doe' },
      { firstName: 'Ann', lastName: 'Lee' },
      { firstName: 'Bo', lastName: 'Ray' },
      { firstName: 'Cy', lastName: 'Ng', rsvp: 'no' },
    ],
    tables: [{ at: { x: 0, y: 0 }, guests: ['Jane'] }],
  })
  const [t] = s.tables
  const ann = s.byName('Ann')
  await openEditor(page, s)
  const phone = await isPhoneLayout(page)
  await setMode(page, 'edit')
  await settledCamera(page)
  expect(['middle', 'close']).toContain(await detailLevel(page))

  // Every empty seat shows a +, the taken one none; View mode hides them.
  const plus = itemLocator(page, t).locator('[data-seat-plus]')
  await expect(plus).toHaveCount(7)
  await expect.poll(() => drawn(plus.first())).toBe(true)
  await setMode(page, 'view')
  await expect.poll(() => drawn(plus.first())).toBe(false)
  await setMode(page, 'edit')

  const seat = await seatOnScreen(page, t, 2)
  if (phone) await (await Touch.on(page)).tap(seat)
  else await page.mouse.click(seat.x, seat.y)
  const picker = page.getByTestId('seat-picker')
  await expect(picker).toBeVisible()
  await expect(picker).toContainText('Table 1, seat 3')
  // Unassigned guests only: not Jane (seated), not Cy (said no).
  await expect(picker.getByTestId('seat-picker-guest')).toHaveText(['Ann Lee', 'Bo Ray'])
  expect(await selectedIds(page)).toEqual([])
  // Every row is a whole tap target, and the picker fits the screen.
  for (const row of await picker.getByTestId('seat-picker-guest').all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  const box = (await picker.boundingBox())!
  const width = page.viewportSize()!.width
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(width)

  if (!phone) {
    await picker.getByTestId('seat-picker-search').fill('le')
    await expect(picker.getByTestId('seat-picker-guest')).toHaveText(['Ann Lee'])
  }
  const choice = picker.locator(`[data-guest-id="${ann.id}"]`)
  if (phone) await choice.tap()
  else await choice.click()
  await expect(picker).toHaveCount(0)
  await expect(seatCircle(page, t, 2)).toHaveAttribute('data-seat-state', 'taken')
  await expect(plus).toHaveCount(6)
  await expectSaved(page)
  expect((await serverSeats(page, s.layout.id))[t][2]).toBe(ann.id)
})

test('with 25 new tables on screen, a seat at the edge of the view opens its picker too', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'A laptop shows 25 tables at the middle level.')
  const s = await setupSeating(page, testInfo, {
    guests: [{ firstName: 'Ann', lastName: 'Lee' }],
    tables: Array.from({ length: 25 }, (_, i) => ({ at: { x: (i % 5) * 300, y: Math.floor(i / 5) * 300 }, seats: 10 })),
  })
  await openEditor(page, s)
  await settledCamera(page)
  expect(await detailLevel(page)).toBe('middle')
  await expect(page.getByTestId('canvas').locator('[data-seat-plus]')).toHaveCount(250)
  // The last table's seat furthest from the middle of the view.
  const last = s.tables[24]
  const seat = await seatOnScreen(page, last, 3)
  await page.mouse.click(seat.x, seat.y)
  await expect(page.getByTestId('seat-picker')).toContainText('Table 25, seat 4')
  expect(await selectedIds(page)).toEqual([])
})
