/**
 * The editor's Guests tab (spec section 6, "Seated and unassigned"; PLAN
 * section 7; DECISIONS 22): counts at the top ("5 guests · 2 seated · 3
 * unassigned · 1 declined"), a search box that filters as you type on first
 * name, last name and nickname, Show declined, filters by group, side and
 * RSVP, and two parts, Unassigned and Seated, where each seated guest shows
 * their table. On a laptop it sits in the right panel; on a phone in the
 * bottom sheet, with the filters behind a Filters button.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { Guest } from '../src/shared/api'
import { editorMode, isPhoneLayout, sheetAtRest } from './canvas'
import { apiAddGuests, apiCreateGroup, apiSeatGuests } from './guest-list'
import { apiAddTables, apiCreateLayout, apiCreateWedding, apiGetLayout, editorPath, presetAuthor, signIn, uniqueName } from './helpers'

test.beforeEach(async ({ context }) => {
  await presetAuthor(context, 'Noa')
})

/** Opens the Guests tab: the right panel's tab on a laptop, the bottom sheet's on a phone. */
async function openGuestsTab(page: Page): Promise<Locator> {
  if (await isPhoneLayout(page)) {
    const sheet = page.getByTestId('bottom-sheet')
    await sheet.getByRole('tab', { name: 'Guests' }).click()
    await expect(sheet.getByRole('tab', { name: 'Guests' })).toHaveAttribute('aria-selected', 'true')
    await expect(sheet).not.toHaveAttribute('data-snap', 'strip')
    await sheetAtRest(page)
    await expect(page.getByTestId('right-panel')).toHaveCount(0)
    return sheet.getByTestId('guests-panel')
  }
  const panel = page.getByTestId('right-panel')
  await panel.getByRole('tab', { name: 'Guests' }).click()
  await expect(panel.getByRole('tab', { name: 'Guests' })).toHaveAttribute('aria-selected', 'true')
  return panel.getByTestId('guests-panel')
}

/** The names a part of the list shows, in order, with the table for seated guests: "Ava Cohen @ Table 1". */
async function listed(part: Locator, guests: readonly Guest[]): Promise<string[]> {
  const byId = new Map(guests.map((g) => [g.id, `${g.firstName} ${g.lastName}`]))
  const rows = await part.getByTestId('side-list-guest').evaluateAll((nodes) =>
    nodes.map((n) => ({ id: n.getAttribute('data-guest-id') ?? '', seated: n.getAttribute('data-seated') === 'true', label: n.lastElementChild?.textContent ?? '' })),
  )
  return rows.map((r) => (r.seated ? `${byId.get(r.id) ?? r.id} @ ${r.label}` : (byId.get(r.id) ?? r.id)))
}

test('the Guests tab counts, searches as you type, shows declined on request, filters, and names each seated guest’s table', async ({ page }, testInfo) => {
  test.setTimeout(45_000)
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Side list', testInfo))
  const guests = await apiAddGuests(page.request, wedding.id, [
    { firstName: 'Ava', lastName: 'Cohen', side: 'Noa', rsvp: 'yes' },
    { firstName: 'Ben', lastName: 'Levi', side: 'Aiden', rsvp: 'yes', nickname: 'Benji' },
    { firstName: 'Cara', lastName: 'Diaz', side: 'Both', rsvp: 'pending' },
    { firstName: 'Dov', lastName: 'Katz', side: 'Aiden', rsvp: 'no' },
    { firstName: 'Zoë', lastName: 'Adler', side: 'Noa', rsvp: 'yes' },
    { firstName: 'Eli', lastName: 'Brooks', side: 'Aiden', rsvp: 'yes' },
  ])
  const [ava, ben, , , zoe, eli] = guests
  await apiCreateGroup(page.request, wedding.id, 'Noa Family', [ava.id, zoe.id])
  await apiCreateGroup(page.request, wedding.id, 'Aiden HS Friends', [ben.id, eli.id])
  const created = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  await apiAddTables(page.request, created, 2)
  await apiSeatGuests(page.request, await apiGetLayout(page.request, created.id), [[ava.id], [ben.id]])

  await page.goto(editorPath(wedding.id, created.id))
  await editorMode(page)
  const panel = await openGuestsTab(page)
  const unassigned = panel.getByTestId('side-list-unassigned')
  const seated = panel.getByTestId('side-list-seated')

  // Counts: guests who said yes or have not answered, and the declined apart.
  await expect(panel.getByTestId('side-list-counts')).toHaveText('5 guests · 2 seated · 3 unassigned · 1 declined')
  await expect(unassigned.getByRole('heading')).toHaveText('Unassigned (3)')
  expect(await listed(unassigned, guests)).toEqual(['Zoë Adler', 'Eli Brooks', 'Cara Diaz'])
  await expect(unassigned).toContainText('1 declined guest is hidden.')
  await expect(seated.getByRole('heading')).toHaveText('Seated (2)')
  expect(await listed(seated, guests)).toEqual(['Ava Cohen @ Table 1', 'Ben Levi @ Table 2'])
  for (const row of await panel.getByTestId('side-list-guest').all()) {
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }

  // Search filters with every key: "z" keeps Zoë and Cara Diaz, "zo" only Zoë.
  const search = panel.getByTestId('side-list-search')
  await search.click()
  await search.press('z')
  await expect.poll(() => listed(unassigned, guests)).toEqual(['Zoë Adler', 'Cara Diaz'])
  await expect(seated).toContainText('No one matches.')
  await search.press('o')
  await expect.poll(() => listed(unassigned, guests)).toEqual(['Zoë Adler'])
  // Nicknames match too, and a seated match keeps its table.
  await search.fill('')
  await search.pressSequentially('benj', { delay: 30 })
  await expect.poll(() => listed(seated, guests)).toEqual(['Ben Levi @ Table 2'])
  await expect(unassigned).toContainText('No one matches.')
  // The counts are for the whole list, whatever the search.
  await expect(panel.getByTestId('side-list-counts')).toHaveText('5 guests · 2 seated · 3 unassigned · 1 declined')
  await search.fill('')
  await expect.poll(() => listed(unassigned, guests)).toEqual(['Zoë Adler', 'Eli Brooks', 'Cara Diaz'])

  // Show declined puts Dov in Unassigned, marked.
  const declined = panel.getByTestId('side-list-show-declined')
  await declined.check()
  await expect.poll(() => listed(unassigned, guests)).toEqual(['Zoë Adler', 'Eli Brooks', 'Cara Diaz', 'Dov Katz'])
  await expect(unassigned.locator(`[data-guest-id="${guests[3].id}"]`)).toContainText('· declined')
  await expect(unassigned).not.toContainText('is hidden')
  await declined.uncheck()
  await expect.poll(() => listed(unassigned, guests)).toEqual(['Zoë Adler', 'Eli Brooks', 'Cara Diaz'])

  // Filters: on a phone they open from a Filters button.
  if (await isPhoneLayout(page)) {
    await expect(panel.getByTestId('side-list-filters')).toHaveCount(0)
    await panel.getByRole('button', { name: 'Filters' }).click()
  }
  await panel.getByTestId('side-list-group').selectOption({ label: 'Aiden HS Friends' })
  await expect.poll(() => listed(unassigned, guests)).toEqual(['Eli Brooks'])
  expect(await listed(seated, guests)).toEqual(['Ben Levi @ Table 2'])
  if (await isPhoneLayout(page)) await expect(panel.getByRole('button', { name: 'Filters (on)' })).toBeVisible()
  await panel.getByTestId('side-list-group').selectOption({ label: 'Any group' })
  await panel.getByTestId('side-list-side').selectOption('Noa')
  await expect.poll(() => listed(unassigned, guests)).toEqual(['Zoë Adler'])
  expect(await listed(seated, guests)).toEqual(['Ava Cohen @ Table 1'])
  await panel.getByTestId('side-list-side').selectOption({ label: 'Any side' })
  await panel.getByTestId('side-list-rsvp').selectOption('pending')
  await expect.poll(() => listed(unassigned, guests)).toEqual(['Cara Diaz'])
  await expect(seated).toContainText('No one matches.')
  await panel.getByTestId('side-list-rsvp').selectOption({ label: 'Any RSVP' })
  await expect.poll(() => listed(unassigned, guests)).toEqual(['Zoë Adler', 'Eli Brooks', 'Cara Diaz'])

  // A guest added elsewhere shows when the tab comes back into focus.
  const [fay] = await apiAddGuests(page.request, wedding.id, [{ firstName: 'Fay', lastName: 'Abadi', rsvp: 'yes' }])
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => listed(unassigned, [...guests, fay])).toEqual(['Fay Abadi', 'Zoë Adler', 'Eli Brooks', 'Cara Diaz'])
  await expect(panel.getByTestId('side-list-counts')).toHaveText('6 guests · 2 seated · 4 unassigned · 1 declined')
})

test('the Guests tab of a wedding with no guests points to the Guests page', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Side list empty', testInfo))
  const created = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  await page.goto(editorPath(wedding.id, created.id))
  await editorMode(page)
  const panel = await openGuestsTab(page)
  await expect(panel.getByTestId('guests-empty')).toHaveText('No guests yet.')
  const link = panel.getByRole('link', { name: 'Add guests on the Guests tab' })
  await expect(link).toHaveAttribute('href', `/w/${wedding.id}/guests`)
})
