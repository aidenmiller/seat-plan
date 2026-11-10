/**
 * The Groups page (spec section 7, "Groups"; the basic page milestone 4
 * needs): make a group, refuse a second one with the same name in another
 * case, rename it in place, recolor it from the palette, add members by
 * searching (accents ignored), take one out, and delete the group, which
 * leaves its guests on the list (DECISIONS 31).
 *
 * The editor's Groups tab (milestone 6): acceptance check 16, closeness
 * lines sorted loosest first with their tooltips, and group highlighting.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { Group } from '../src/shared/api'
import { isPhoneLayout, itemLocator, sheetAtRest } from './canvas'
import { apiAddGuests, apiCreateGroup, apiListGroups, apiListGuests, expectRowsSaved, groupsPath, guestEntry, guestsPath, waitForGroupsPage, waitForGuestList } from './guest-list'
import { apiCreateWedding, presetAuthor, signIn, uniqueName } from './helpers'
import { openEditor, seatCircle, setupSeating } from './seating'

test.beforeEach(async ({ context }) => {
  await presetAuthor(context, 'Noa')
})

async function serverGroups(page: Page, weddingId: string): Promise<Group[]> {
  return apiListGroups(page.request, weddingId)
}

test('make, rename, recolor, add members by search, take one out, and delete a group', async ({ page }, testInfo) => {
  test.setTimeout(45_000)
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Groups', testInfo))
  const [ava, , , zoe] = await apiAddGuests(page.request, wedding.id, [
    { firstName: 'Ava', lastName: 'Cohen' },
    { firstName: 'Ben', lastName: 'Levi' },
    { firstName: 'Cara', lastName: 'Diaz' },
    { firstName: 'Zoë', lastName: 'Adler' },
  ])
  await page.goto(groupsPath(wedding.id))
  await waitForGroupsPage(page)
  await expect(page.getByTestId('groups-empty')).toBeVisible()

  // Make one.
  const form = page.getByTestId('new-group-form')
  await form.getByTestId('new-group-input').fill('Noa Family')
  await form.getByRole('button', { name: 'Add group' }).click()
  const card = page.getByTestId('group-card')
  await expect(card).toHaveCount(1)
  await expect(card.getByTestId('group-name')).toContainText('Noa Family')
  await expect(card.getByTestId('group-count')).toHaveText('0 guests')
  await expect(form.getByTestId('new-group-input')).toHaveValue('')
  const [made] = await serverGroups(page, wedding.id)
  expect(made).toMatchObject({ name: 'Noa Family', memberIds: [] })

  // The same name in another case is refused.
  await form.getByTestId('new-group-input').fill('noa family')
  await form.getByRole('button', { name: 'Add group' }).click()
  await expect(form.getByRole('alert')).toHaveText('Could not make the group. A group with that name already exists.')
  await expect(card).toHaveCount(1)
  await form.getByTestId('new-group-input').fill('')

  // Rename in place: Enter saves.
  await card.getByTestId('group-name').click()
  const nameInput = card.getByTestId('group-name-input')
  await expect(nameInput).toBeFocused()
  await nameInput.fill("Noa's Family")
  await nameInput.press('Enter')
  await expect(card.getByTestId('group-name')).toContainText("Noa's Family")
  await expect.poll(async () => (await serverGroups(page, wedding.id))[0]?.name).toBe("Noa's Family")

  // Recolor from the palette.
  const swatch = card.getByTestId('group-color')
  await expect(swatch).toHaveAccessibleName("Color of Noa's Family")
  await swatch.click()
  await expect(swatch).toHaveAttribute('aria-expanded', 'true')
  const green = card.locator('label').filter({ hasText: 'Green' })
  await expect(green).toHaveCount(1)
  const box = await green.boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)
  await green.click()
  await expect(swatch).toHaveAttribute('aria-expanded', 'false')
  await expect(swatch.locator('span')).toHaveCSS('background-color', 'rgb(21, 128, 61)')
  await expectRowsSaved(page)
  await expect.poll(async () => (await serverGroups(page, wedding.id))[0]?.color).toBe('#15803D')

  // Open it and add members by searching: "zoe" finds Zoë.
  await card.getByRole('button', { name: 'Open' }).click()
  const search = card.getByTestId('group-member-search')
  await search.fill('zoe')
  const matches = card.getByTestId('group-member-matches')
  await expect(matches.locator('li')).toHaveCount(1)
  await matches.getByRole('button', { name: "Add Zoë Adler to Noa's Family" }).click()
  const members = card.getByTestId('group-members')
  await expect(members.locator('li')).toHaveCount(1)
  await expect(members).toContainText('Zoë Adler')
  // A member drops out of the search results.
  await expect(matches).toContainText('No guest matches who is not in the group.')
  await search.fill('cohen')
  await matches.getByRole('button', { name: "Add Ava Cohen to Noa's Family" }).click()
  await expect(members.locator('li')).toHaveCount(2)
  await expect(card.getByTestId('group-count')).toHaveText('2 guests')
  await expect.poll(async () => [...((await serverGroups(page, wedding.id))[0]?.memberIds ?? [])].sort()).toEqual([ava.id, zoe.id].sort())

  // Take one out.
  await members.getByRole('button', { name: "Take Ava Cohen out of Noa's Family" }).click()
  await expect(members.locator('li')).toHaveCount(1)
  await expect(members).not.toContainText('Ava Cohen')
  await expect(card.getByTestId('group-count')).toHaveText('1 guest')
  await expect.poll(async () => (await serverGroups(page, wedding.id))[0]?.memberIds).toEqual([zoe.id])

  // The Guests page shows the group on its member.
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)
  await expect(guestEntry(page, zoe.id)).toContainText("Noa's Family")
  await expect(guestEntry(page, ava.id)).not.toContainText("Noa's Family")

  // Delete it: the guests stay.
  await page.goto(groupsPath(wedding.id))
  await waitForGroupsPage(page)
  await page.getByTestId('group-card').getByRole('button', { name: "Delete Noa's Family" }).click()
  const dialog = page.getByTestId('delete-group-dialog')
  await expect(dialog.getByRole('heading')).toHaveText("Delete Noa's Family")
  await expect(dialog).toContainText('The group goes for good. Its 1 guest stays on the guest list.')
  await dialog.getByTestId('delete-group-confirm').click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('group-card')).toHaveCount(0)
  await expect(page.getByTestId('groups-empty')).toBeVisible()
  expect(await serverGroups(page, wedding.id)).toEqual([])
  expect(await apiListGuests(page.request, wedding.id)).toHaveLength(4)

  // And it stays gone after a reload.
  await page.reload()
  await waitForGroupsPage(page)
  await expect(page.getByTestId('groups-empty')).toBeVisible()
})

// ---------- Closeness and highlighting in the editor (milestone 6) ----------

/** The Groups tab: the right panel's on a laptop, the bottom sheet's (raised to half) on a phone. */
async function openGroupsTab(page: Page): Promise<Locator> {
  if (await isPhoneLayout(page)) {
    const sheet = page.getByTestId('bottom-sheet')
    const tab = sheet.getByRole('tab', { name: 'Groups' })
    if ((await sheet.getAttribute('data-snap')) === 'strip' || (await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(sheet).not.toHaveAttribute('data-snap', 'strip')
    await sheetAtRest(page)
    return sheet.getByTestId('groups-panel')
  }
  const panel = page.getByTestId('right-panel')
  await panel.getByRole('tab', { name: 'Groups' }).click()
  await expect(panel.getByRole('tab', { name: 'Groups' })).toHaveAttribute('aria-selected', 'true')
  return panel.getByTestId('groups-panel')
}

const MEMBERS = Array.from({ length: 12 }, (_, i) => ({ firstName: `Friend${i + 1}`, lastName: 'Hs' }))

test('no table over 10 seats: a group of 12 at two tables scores 100% tight, sorted after a looser group, and picking groups rings their seats and fades the rest (check 16)', async ({ page }, testInfo) => {
  test.setTimeout(45_000)
  const s = await setupSeating(page, testInfo, {
    guests: [...MEMBERS, { firstName: 'Ava', lastName: 'Cohen' }, { firstName: 'Zoë', lastName: 'Adler' }],
    tables: [
      { at: { x: 0, y: 0 }, seats: 10, guests: MEMBERS.slice(0, 10).map((m) => m.firstName) },
      { at: { x: 420, y: 0 }, seats: 10, guests: ['Friend11', 'Friend12', 'Ava'] },
      { at: { x: 0, y: 420 }, seats: 8, guests: ['Zoë'] },
      { at: { x: 420, y: 420 }, seats: 10 },
    ],
  })
  const [t1, t2, t3, t4] = s.tables
  const friends = await apiCreateGroup(page.request, s.weddingId, 'Aiden HS Friends', MEMBERS.map((m) => s.byName(m.firstName).id))
  const family = await apiCreateGroup(page.request, s.weddingId, 'Noa Family', [s.byName('Ava').id, s.byName('Zoë').id])
  await openEditor(page, s)
  const panel = await openGroupsTab(page)

  // Loosest first: Noa Family (2 tables where 1 would do), then the 12 friends at 2 tables of 10.
  const lines = panel.getByTestId('group-closeness')
  await expect(lines).toHaveCount(2)
  await expect(lines.nth(0)).toHaveAttribute('data-group-id', family.id)
  await expect(lines.nth(1)).toHaveAttribute('data-group-id', friends.id)
  // 20 of the 66 pairs sit 420 cm (13′ 9″) apart, the rest at one table: about 4 ft on average.
  const friendsLine = lines.nth(1).getByTestId('closeness-line')
  await expect(friendsLine).toHaveAttribute('aria-label', 'Aiden HS Friends · 12 of 12 seated · 2 tables (2 possible) · 100% tight · 4 ft spread')
  await expect(lines.nth(0).getByTestId('closeness-line')).toHaveAttribute('aria-label', 'Noa Family · 2 of 2 seated · 2 tables (1 possible) · 50% tight · 19 ft spread')
  // Each number explains itself in plain words.
  await expect(friendsLine.locator('[data-part="tight"]')).toHaveAttribute('title', '2 tables possible out of 2 tables used. 100% means they could not sit any closer.')
  for (const part of ['seated', 'tables', 'spread']) await expect(friendsLine.locator(`[data-part="${part}"]`)).toHaveAttribute('title', /\w/)

  // Show the friends: their 12 seats get rings in the group color; tables without them fade, and so does Ava's seat.
  const pick = (line: Locator) => line.locator('button[aria-pressed]')
  await pick(lines.nth(1)).click()
  await expect(pick(lines.nth(1))).toHaveAttribute('aria-pressed', 'true')
  const rings = page.getByTestId('canvas').locator('[data-group-ring]')
  await expect(rings).toHaveCount(12)
  await expect(itemLocator(page, t1).locator('[data-group-ring]')).toHaveCount(10)
  await expect(itemLocator(page, t2).locator('[data-group-ring]')).toHaveCount(2)
  for (const color of await rings.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-ring-color') ?? '')))
    expect(color.toLowerCase()).toBe(friends.color.toLowerCase())
  for (const t of [t3, t4]) await expect(itemLocator(page, t)).toHaveAttribute('data-faded', 'true')
  for (const t of [t1, t2]) await expect(itemLocator(page, t)).not.toHaveAttribute('data-faded', /.+/)
  await expect(seatCircle(page, t2, 2)).toHaveAttribute('opacity', '0.25')
  await expect(seatCircle(page, t2, 0)).not.toHaveAttribute('opacity', /.+/)

  // Show Noa Family too: Ava's and Zoë's seats ring in its color, and Table 3 comes back.
  await pick(lines.nth(0)).click()
  await expect(rings).toHaveCount(14)
  await expect(seatCircle(page, t2, 2)).not.toHaveAttribute('opacity', /.+/)
  await expect(itemLocator(page, t3).locator('[data-group-ring]')).toHaveAttribute('data-ring-color', new RegExp(`^${family.color}$`, 'i'))
  await expect(itemLocator(page, t3)).not.toHaveAttribute('data-faded', /.+/)
  await expect(itemLocator(page, t4)).toHaveAttribute('data-faded', 'true')

  // Show all clears it.
  await panel.getByTestId('groups-clear').click()
  await expect(rings).toHaveCount(0)
  await expect(page.getByTestId('canvas').locator('[data-faded]')).toHaveCount(0)
})
