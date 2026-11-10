/**
 * Seating rules (spec section 7, "Rules"; milestone 6).
 *
 * Acceptance check 14: partners seated at different tables show a problem
 * on both tables and in the top bar count. Acceptance check 15: an apart
 * rule between two guests at one table shows a problem, and moving one of
 * them away clears it.
 *
 * Also the main paths: the Rules page adds a rule with a whole group at
 * once and flags a clash with a couple rule, and seated guests selected on
 * the canvas become a Keep together rule from the guest menu.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { CreateRuleBody, StoredRule } from '../src/shared/api'
import { clickWith, isPhoneLayout, itemLocator, lowerSheet, mouseDrag, selectedIds, setMode, settledCamera, sheetAtRest, Touch, viewport, worldToClient, type Point } from './canvas'
import { apiAddGuests, apiCreateGroup, apiLinkPartners, expectHydrated } from './guest-list'
import { apiCreateWedding, expectSaved, presetAuthor, signIn, uniqueName } from './helpers'
import { openEditor, seatCircle, seatOnScreen, serverSeats, setupSeating, tableOnScreen } from './seating'

test.beforeEach(async ({ context }) => {
  await presetAuthor(context, 'Noa')
})

const rulesPath = (weddingId: string) => `/w/${weddingId}/rules`

async function apiListRules(page: Page, weddingId: string): Promise<StoredRule[]> {
  const res = await page.request.get(`/api/weddings/${weddingId}/rules`)
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as StoredRule[]
}

async function apiCreateRule(page: Page, weddingId: string, body: CreateRuleBody): Promise<StoredRule> {
  const res = await page.request.post(`/api/weddings/${weddingId}/rules`, { data: body })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as StoredRule
}

/** A right panel tab on a laptop; the bottom sheet's tab, raised to half, on a phone. */
async function openTab(page: Page, name: 'Problems' | 'Groups'): Promise<Locator> {
  if (await isPhoneLayout(page)) {
    const sheet = page.getByTestId('bottom-sheet')
    const tab = sheet.getByRole('tab', { name })
    if ((await sheet.getAttribute('data-snap')) === 'strip' || (await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(sheet).not.toHaveAttribute('data-snap', 'strip')
    await sheetAtRest(page)
    return sheet
  }
  const panel = page.getByTestId('right-panel')
  await panel.getByRole('tab', { name }).click()
  await expect(panel.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
  return panel
}

/** Drags a seated guest to `to`: the mouse on a laptop; a finger held still first on a phone. */
async function dragGuest(page: Page, from: Point, to: Point): Promise<void> {
  if (!(await isPhoneLayout(page))) return mouseDrag(page, from, to, { steps: 16 })
  const touch = await Touch.on(page)
  await touch.down([{ ...from, id: 1 }])
  await page.waitForTimeout(650)
  await touch.move([{ x: from.x + 6, y: from.y, id: 1 }])
  for (let i = 1; i <= 12; i++) {
    const f = i / 12
    await touch.move([{ x: from.x + 6 + (to.x - from.x - 6) * f, y: from.y + (to.y - from.y) * f, id: 1 }])
  }
  await touch.up()
}

const problemCount = (page: Page) => page.getByTestId('problem-count')

/** The top bar count reads `n` problems: a 44 px button, the words on a laptop, the number alone on a phone. */
async function expectProblemCount(page: Page, n: number): Promise<void> {
  const count = problemCount(page)
  const words = n === 1 ? '1 seating problem' : `${n} seating problems`
  await expect(count).toHaveAttribute('data-count', String(n))
  await expect(count).toHaveAccessibleName(words)
  await expect(count).toHaveText((await isPhoneLayout(page)) ? String(n) : words.replace(' ', ''))
  const box = (await count.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeGreaterThanOrEqual(44)
}

test('the Rules page adds a Keep apart rule with a whole group at once, and flags its clash with a couple rule', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Rules page', testInfo))
  const [ava, ben, cara, dov] = await apiAddGuests(page.request, wedding.id, [
    { firstName: 'Ava', lastName: 'Cohen' },
    { firstName: 'Ben', lastName: 'Levi' },
    { firstName: 'Cara', lastName: 'Diaz' },
    { firstName: 'Dov', lastName: 'Katz' },
  ])
  await apiLinkPartners(page.request, ava.id, ben.id)
  await apiCreateGroup(page.request, wedding.id, 'Aiden HS Friends', [ben.id, cara.id])

  await page.goto(rulesPath(wedding.id))
  const add = page.getByTestId('add-rule')
  await expectHydrated(add)
  // The couple rule comes from the partner link, switched on.
  const couple = page.getByTestId('couple-rule')
  await expect(couple).toHaveCount(1)
  // The pair's order follows their ids.
  const coupleNames = /Ava Cohen and Ben Levi|Ben Levi and Ava Cohen/
  await expect(couple).toContainText(coupleNames)
  await expect(couple.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('rules-empty')).toBeVisible()

  await add.click()
  const dialog = page.getByTestId('rule-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Keep apart').check()
  // The whole group at once, then one more guest by search.
  await dialog.getByTestId('guest-picker-group').selectOption({ label: 'Aiden HS Friends (2)' })
  const picked = dialog.getByTestId('picked-guests')
  await expect(picked.locator('li')).toHaveCount(2)
  await expect(picked).toContainText('Ben Levi')
  await expect(picked).toContainText('Cara Diaz')
  await dialog.getByTestId('guest-picker-search').fill('ava')
  await dialog.getByTestId('guest-picker-results').getByRole('button', { name: 'Ava Cohen' }).click()
  await expect(picked.locator('li')).toHaveCount(3)
  for (const chip of await picked.getByRole('button').all()) {
    const box = (await chip.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
  await dialog.getByTestId('rule-save').click()
  await expect(dialog).toBeHidden()

  const rule = page.getByTestId('rule')
  await expect(rule).toHaveCount(1)
  await expect(rule).toContainText('Keep apart')
  await expect(rule).toContainText('Ava Cohen, Cara Diaz and Ben Levi')
  const [stored] = await apiListRules(page, wedding.id)
  expect(stored).toMatchObject({ kind: 'apart', nextToEachOther: false, appliesTo: 'both', enabled: true })
  expect([...stored.guestIds].sort()).toEqual([ava.id, ben.id, cara.id].sort())
  expect(stored.guestIds).not.toContain(dov.id)

  // Ava and Ben are partners (together) and now also kept apart: both lines flag the clash.
  await expect(rule.getByTestId('rule-clash')).toContainText(new RegExp(`Clashes with Couple: (${coupleNames.source})`))
  await expect(couple.getByTestId('rule-clash')).toContainText('Clashes with Keep apart')

  // Switching the couple rule off clears the clash, on both partners, after a reload too.
  await couple.getByRole('switch').click()
  await expect(couple.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('rule-clash')).toHaveCount(0)
  await page.reload()
  await expectHydrated(page.getByTestId('add-rule'))
  await expect(page.getByTestId('couple-rule').getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('rule')).toHaveCount(1)
  await expect(page.getByTestId('rule-clash')).toHaveCount(0)
})

test('partners seated at different tables show a problem on both tables and in the top bar count (check 14)', async ({ page }, testInfo) => {
  const s = await setupSeating(page, testInfo, {
    guests: [
      { firstName: 'Jane', lastName: 'Doe' },
      { firstName: 'Bo', lastName: 'Ray' },
      { firstName: 'Ann', lastName: 'Lee' },
    ],
    partners: [['Jane', 'Bo']],
    tables: [
      { at: { x: 0, y: 0 }, guests: ['Jane'] },
      { at: { x: 1200, y: 0 }, guests: ['Bo'] },
      { at: { x: 0, y: 900 }, guests: ['Ann'] },
    ],
  })
  const [t1, t2, t3] = s.tables
  await openEditor(page, s)

  // Both tables carry the red badge, with a red ring on each partner's seat; the third table none.
  for (const t of [t1, t2]) {
    await expect(itemLocator(page, t)).toHaveAttribute('data-problem', 'problem')
    await expect(itemLocator(page, t).locator('[data-problem-badge="problem"]')).toHaveCount(1)
    await expect(itemLocator(page, t).locator('[data-seat-problem]')).toHaveCount(1)
  }
  await expect(itemLocator(page, t3)).not.toHaveAttribute('data-problem', /.+/)
  await expect(itemLocator(page, t3).locator('[data-seat-problem]')).toHaveCount(0)
  await expectProblemCount(page, 1)

  // The count opens the Problems list, which names the partners and what is wrong.
  if (await isPhoneLayout(page)) await problemCount(page).tap()
  else await problemCount(page).click()
  const panel = page.getByTestId('problems-panel')
  await expect(panel).toBeVisible()
  if (await isPhoneLayout(page)) await sheetAtRest(page)
  const line = panel.getByTestId('problem-item')
  await expect(line).toHaveCount(1)
  await expect(line).toContainText(/Jane Doe and Bo Ray|Bo Ray and Jane Doe/)
  await expect(line).toContainText('Partners split across 2 tables')

  // Clicking it selects both tables and pans to the middle of them.
  await line.click()
  await expect.poll(async () => (await selectedIds(page)).sort()).toEqual([t1, t2].sort())
  const camera = await settledCamera(page)
  const mid = await worldToClient(page, { x: 600, y: 0 }, camera)
  const box = (await viewport(page).boundingBox())!
  expect(Math.abs(mid.x - (box.x + box.width / 2))).toBeLessThan(3)
  expect(Math.abs(mid.y - (box.y + box.height / 2))).toBeLessThan(3)
})

test('an apart rule at one table shows a problem, and moving one guest away clears it (check 15)', async ({ page }, testInfo) => {
  test.setTimeout(45_000)
  const s = await setupSeating(page, testInfo, {
    guests: [
      { firstName: 'Ann', lastName: 'Lee' },
      { firstName: 'Eli', lastName: 'Brooks' },
      { firstName: 'Cy', lastName: 'Park' },
    ],
    tables: [
      { at: { x: 0, y: 0 }, guests: ['Ann', 'Cy', 'Eli'] },
      { at: { x: 420, y: 0 } },
    ],
  })
  const [t1, t2] = s.tables
  const eli = s.byName('Eli')
  await apiCreateRule(page, s.weddingId, { kind: 'apart', guestIds: [s.byName('Ann').id, eli.id] })
  await openEditor(page, s)

  await expect(itemLocator(page, t1)).toHaveAttribute('data-problem', 'problem')
  // Ann (seat 1) and Eli (seat 3) get red rings; Cy, who is in no rule, none.
  await expect(itemLocator(page, t1).locator('[data-seat-problem]')).toHaveCount(2)
  await expect(itemLocator(page, t2)).not.toHaveAttribute('data-problem', /.+/)
  await expectProblemCount(page, 1)
  const panel = await openTab(page, 'Problems')
  const line = panel.getByTestId('problem-item')
  await expect(line).toHaveCount(1)
  await expect(line).toContainText('Should sit apart, but share Table 1')

  // Move Eli to Table 2: the problem goes.
  await lowerSheet(page)
  await setMode(page, 'edit')
  await dragGuest(page, await seatOnScreen(page, t1, 2), await tableOnScreen(page, t2))
  await expect(seatCircle(page, t2, 0)).toHaveAttribute('data-seat-state', 'taken')
  await expect(itemLocator(page, t1)).not.toHaveAttribute('data-problem', /.+/)
  await expect(page.locator('[data-seat-problem]')).toHaveCount(0)
  await expect(problemCount(page)).toHaveCount(0)
  await expect((await openTab(page, 'Problems')).getByTestId('problem-item')).toHaveCount(0)
  await expectSaved(page)
  const seats = await serverSeats(page, s.layout.id)
  expect(seats[t1]).not.toContain(eli.id)
  expect(seats[t2][0]).toBe(eli.id)
})

test('seated guests selected on the canvas become a Keep together rule from the guest menu', async ({ page }, testInfo) => {
  const s = await setupSeating(page, testInfo, {
    guests: [
      { firstName: 'Ann', lastName: 'Lee' },
      { firstName: 'Eli', lastName: 'Brooks' },
    ],
    tables: [
      { at: { x: 0, y: 0 }, guests: ['Ann'] },
      { at: { x: 420, y: 0 }, guests: ['Eli'] },
    ],
  })
  const [t1, t2] = s.tables
  const ann = s.byName('Ann')
  const eli = s.byName('Eli')
  await openEditor(page, s)
  await setMode(page, 'edit')
  await expect(problemCount(page)).toHaveCount(0)
  const a = await seatOnScreen(page, t1, 0)
  const b = await seatOnScreen(page, t2, 0)
  const menu = page.getByTestId('canvas-menu')
  if (!(await isPhoneLayout(page))) {
    // Click one, Shift+click the other, then right click on either.
    await page.mouse.click(a.x, a.y)
    await clickWith(page, b, ['Shift'])
    await expect(page.getByTestId('guest-selection')).toHaveCount(2)
    await page.mouse.click(b.x, b.y, { button: 'right' })
    await expect(menu).toHaveAccessibleName('2 guests menu')
    await menu.getByRole('menuitem', { name: 'Keep together' }).click()
  } else {
    // Phones: tap one, turn on Select, tap the other, then the More button.
    const touch = await Touch.on(page)
    await touch.tap(a)
    await page.getByTestId('phone-select').tap()
    await touch.tap(b)
    await expect(page.getByTestId('guest-selection')).toHaveCount(2)
    await page.getByTestId('guest-more').tap()
    await expect(menu).toHaveAccessibleName('2 guests menu')
    await menu.getByRole('menuitem', { name: 'Keep together' }).tap()
  }
  await expect(page.getByTestId('editor-notice')).toHaveText('Rule added: keep together.')

  // The rule is saved, and since they sit at two tables it is broken at once.
  await expect.poll(async () => (await apiListRules(page, s.weddingId)).map((r) => [r.kind, [...r.guestIds].sort()])).toEqual([['together', [ann.id, eli.id].sort()]])
  await expectProblemCount(page, 1)
  await expect(itemLocator(page, t1)).toHaveAttribute('data-problem', 'problem')
  await expect(itemLocator(page, t2)).toHaveAttribute('data-problem', 'problem')
  await expect((await openTab(page, 'Problems')).getByTestId('problem-item')).toContainText('Split across 2 tables')
})
