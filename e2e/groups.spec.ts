/**
 * The Groups page (spec section 7, "Groups"; the basic page milestone 4
 * needs): make a group, refuse a second one with the same name in another
 * case, rename it in place, recolor it from the palette, add members by
 * searching (accents ignored), take one out, and delete the group, which
 * leaves its guests on the list (DECISIONS 31).
 */
import { expect, test, type Page } from '@playwright/test'
import type { Group } from '../src/shared/api'
import { apiAddGuests, apiListGroups, apiListGuests, expectRowsSaved, groupsPath, guestEntry, guestsPath, waitForGroupsPage, waitForGuestList } from './guest-list'
import { apiCreateWedding, presetAuthor, signIn, uniqueName } from './helpers'

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
