/**
 * The Guests page (spec section 6, "Guests page"; PLAN section 7): add a
 * guest, edit fields in place (Enter saves, Esc cancels, an empty name is
 * refused), sort, filter and search (accents ignored), link partners and
 * see the link on both people, select three guests and add them to a new
 * group, delete a seated guest from a dialog that names the table it
 * clears, and export the list as CSV with a byte order mark and a guest_id
 * column. Laptops get a table, phones (390 px) get cards with an Edit
 * dialog; both run every test.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import Papa from 'papaparse'
import type { Guest } from '../src/shared/api'
import {
  apiAddGuests,
  apiCreateGroup,
  apiLinkPartners,
  apiListGroups,
  apiListGuests,
  apiSeatGuests,
  BOM,
  closeGuestDialog,
  csvTextLines,
  download,
  expectHydrated,
  expectRowsSaved,
  guestEntry,
  guestField,
  guestsPath,
  narrowScreen,
  selectGuest,
  shownNames,
  waitForGuestList,
} from './guest-list'
import { apiAddTables, apiCreateLayout, apiCreateWedding, apiGetLayout, signIn, uniqueName } from './helpers'

type TextField = 'firstName' | 'lastName' | 'nickname' | 'meal'

/** Opens a guest's text field for editing and returns its input. */
async function openField(page: Page, guestId: string, field: TextField): Promise<Locator> {
  await (await guestField(page, guestId, field)).click()
  const input = narrowScreen(page)
    ? page.getByTestId('guest-edit-dialog').getByTestId(`edit-${field}-input`)
    : guestEntry(page, guestId).getByTestId(`cell-${field}-input`)
  await expect(input).toBeFocused()
  return input
}

/** The text a guest's field shows when not editing (screen reader label left out). */
async function fieldText(page: Page, guestId: string, field: TextField): Promise<Locator> {
  return (await guestField(page, guestId, field)).locator('span:not(.sr-only)').first()
}

/** The list shows no partner for this guest. */
async function expectGuestPartnerNone(page: Page, guest: Guest): Promise<void> {
  if (narrowScreen(page)) await expect(guestEntry(page, guest.id).getByText(/^Partner: /)).toHaveCount(0)
  else await expect(guestEntry(page, guest.id).getByTestId('cell-partner')).toContainText('None')
}

async function serverGuest(page: Page, weddingId: string, id: string): Promise<Guest | undefined> {
  return (await apiListGuests(page.request, weddingId)).find((g) => g.id === id)
}

test('add a guest, then edit in place: Enter saves, Esc cancels, an empty name is refused', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Guests edit', testInfo))
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)

  // Add a guest by hand.
  await page.getByTestId('add-guest-first').fill('Ava')
  await page.getByTestId('add-guest-last').fill('Cohen')
  await page.getByTestId('add-guest-submit').click()
  await expect(page.getByTestId('guests-notice')).toHaveText('Added Ava Cohen.')
  await expect(page.getByTestId('guest-count')).toHaveText('1 guest')
  await expect(page.getByTestId('add-guest-first')).toHaveValue('')
  const [ava] = await apiListGuests(page.request, wedding.id)
  expect(ava).toMatchObject({ firstName: 'Ava', lastName: 'Cohen', side: 'both', rsvp: 'pending' })
  await expect(guestEntry(page, ava.id)).toBeVisible()

  // A name without a last name is refused before it reaches the server.
  await page.getByTestId('add-guest-first').fill('Bea')
  await page.getByTestId('add-guest-submit').click()
  await expect(page.getByTestId('add-guest-form').getByRole('alert')).toHaveText('First and last names cannot be empty.')
  await page.getByTestId('add-guest-first').fill('')

  // Enter saves.
  let input = await openField(page, ava.id, 'firstName')
  await input.fill('Avery')
  await input.press('Enter')
  await expect(input).toBeHidden()
  await expect(await fieldText(page, ava.id, 'firstName')).toHaveText('Avery')
  await expect.poll(async () => (await serverGuest(page, wedding.id, ava.id))?.firstName).toBe('Avery')

  // Esc puts the old value back and saves nothing (and leaves the phone's Edit dialog open).
  input = await openField(page, ava.id, 'lastName')
  await input.fill('Zzz')
  await input.press('Escape')
  await expect(input).toBeHidden()
  await expect(await fieldText(page, ava.id, 'lastName')).toHaveText('Cohen')
  if (narrowScreen(page)) await expect(page.getByTestId('guest-edit-dialog')).toBeVisible()

  // An empty name is refused, with a message, and the name stays.
  input = await openField(page, ava.id, 'firstName')
  await input.fill('   ')
  await input.press('Enter')
  const refusal = narrowScreen(page) ? page.getByTestId('guest-edit-dialog').getByRole('alert') : guestEntry(page, ava.id).getByRole('alert')
  await expect(refusal).toHaveText('First and last names cannot be empty.')
  await expect(await fieldText(page, ava.id, 'firstName')).toHaveText('Avery')

  // Optional fields: a meal, then a nickname cleared again.
  input = await openField(page, ava.id, 'meal')
  await input.fill('Fish')
  await input.press('Enter')
  input = await openField(page, ava.id, 'nickname')
  await input.fill('Aves')
  await input.press('Enter')
  await expect(await fieldText(page, ava.id, 'nickname')).toHaveText('Aves')
  input = await openField(page, ava.id, 'nickname')
  await input.fill('')
  await input.press('Enter')

  // Selects save as soon as they change.
  const rsvp = narrowScreen(page) ? page.getByTestId('guest-edit-dialog').getByTestId('edit-rsvp') : guestEntry(page, ava.id).getByTestId('cell-rsvp')
  await rsvp.selectOption('yes')
  await closeGuestDialog(page)
  await expectRowsSaved(page)
  await expect
    .poll(async () => {
      const g = await serverGuest(page, wedding.id, ava.id)
      return g && { firstName: g.firstName, lastName: g.lastName, meal: g.meal, nickname: g.nickname, rsvp: g.rsvp }
    })
    .toEqual({ firstName: 'Avery', lastName: 'Cohen', meal: 'Fish', nickname: null, rsvp: 'yes' })

  // A reload shows what the server has.
  await page.reload()
  await waitForGuestList(page)
  await expect(guestEntry(page, ava.id)).toContainText('Avery')
  await expect(guestEntry(page, ava.id)).toContainText('Fish')
})

test('sort by a column, filter by side and RSVP, and search by name or nickname with accents ignored', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Guests sort', testInfo))
  const guests = await apiAddGuests(page.request, wedding.id, [
    { firstName: 'Zoë', lastName: 'Adler', side: 'partner1', rsvp: 'yes' },
    { firstName: 'Bruno', lastName: 'Zimmer', side: 'partner2', rsvp: 'pending' },
    { firstName: 'Chloé', lastName: 'Martin', side: 'both', rsvp: 'no' },
    { firstName: 'Dan', lastName: 'Brooks', side: 'partner2', rsvp: 'yes', nickname: 'Danny' },
    { firstName: 'Élodie', lastName: 'Fournier', side: 'partner1', rsvp: 'yes' },
  ])
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)
  await expect(page.getByTestId('guest-count')).toHaveText('5 guests')
  const names = () => shownNames(page, guests)

  // Last name A to Z at first.
  expect(await names()).toEqual(['Zoë Adler', 'Dan Brooks', 'Élodie Fournier', 'Chloé Martin', 'Bruno Zimmer'])

  // First name A to Z, then Z to A ("Élodie" sorts with the E's).
  const byFirst = ['Bruno Zimmer', 'Chloé Martin', 'Dan Brooks', 'Élodie Fournier', 'Zoë Adler']
  if (narrowScreen(page)) {
    await page.getByTestId('sort-by').selectOption('firstName')
    await expect.poll(names).toEqual(byFirst)
    await page.getByRole('button', { name: 'Sorted A to Z. Sort Z to A' }).click()
  } else {
    await page.getByTestId('sort-firstName').click()
    await expect(page.getByRole('columnheader', { name: 'First name' })).toHaveAttribute('aria-sort', 'ascending')
    await expect.poll(names).toEqual(byFirst)
    await page.getByTestId('sort-firstName').click()
    await expect(page.getByRole('columnheader', { name: 'First name' })).toHaveAttribute('aria-sort', 'descending')
  }
  await expect.poll(names).toEqual([...byFirst].reverse())

  // Filters: side, then RSVP on top of it; Clear filters brings everyone back.
  await page.getByTestId('filter-side').selectOption('Aiden')
  await expect(page.getByTestId('guest-count')).toHaveText('Showing 2 of 5 guests')
  expect((await names()).sort()).toEqual(['Bruno Zimmer', 'Dan Brooks'])
  await page.getByTestId('filter-rsvp').selectOption('yes')
  await expect(page.getByTestId('guest-count')).toHaveText('Showing 1 of 5 guests')
  expect(await names()).toEqual(['Dan Brooks'])
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByTestId('guest-count')).toHaveText('5 guests')
  await page.getByTestId('filter-rsvp').selectOption('no')
  expect(await names()).toEqual(['Chloé Martin'])
  await page.getByRole('button', { name: 'Clear filters' }).click()

  // Search: accents and case ignored both ways, nicknames too.
  const search = page.getByTestId('guest-search')
  for (const [query, expected] of [
    ['zoe', ['Zoë Adler']],
    ['ELODIE', ['Élodie Fournier']],
    ['chloe mart', ['Chloé Martin']],
    ['Zoë', ['Zoë Adler']],
    ['danny', ['Dan Brooks']],
    ['zimm', ['Bruno Zimmer']],
  ] as const) {
    await search.fill(query)
    await expect(page.getByTestId('guest-count'), query).toHaveText('Showing 1 of 5 guests')
    expect(await names(), query).toEqual(expected)
  }
  await search.fill('nobody')
  await expect(page.getByText('No guest matches.')).toBeVisible()
  await search.fill('')
  await expect(page.getByTestId('guest-count')).toHaveText('5 guests')
})

test('link two guests as partners and see the link on both; linking a third moves it', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Guests partner', testInfo))
  const [ava, ben, cara] = await apiAddGuests(page.request, wedding.id, [
    { firstName: 'Ava', lastName: 'Cohen' },
    { firstName: 'Ben', lastName: 'Levi' },
    { firstName: 'Cara', lastName: 'Diaz' },
  ])
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)

  const dialog = page.getByTestId('partner-dialog')
  const pickPartner = async (guest: Guest, query: string, partner: Guest) => {
    await (await guestField(page, guest.id, 'partner')).click()
    await expect(dialog).toBeVisible()
    await dialog.getByTestId('partner-search').fill(query)
    await dialog.getByTestId('partner-options').locator(`[data-guest-id="${partner.id}"]`).click()
    await expect(dialog).toBeHidden()
    await closeGuestDialog(page)
  }
  /** The list shows `partner` as this guest's partner, or no partner. */
  const expectPartner = async (guest: Guest, partner: string | null) => {
    if (narrowScreen(page)) {
      const line = guestEntry(page, guest.id).getByText(/^Partner: /)
      if (partner) await expect(line).toHaveText(`Partner: ${partner}`)
      else await expect(line).toHaveCount(0)
    } else {
      const cell = guestEntry(page, guest.id).getByTestId('cell-partner')
      await expect(cell).toHaveText(`Partner of ${guest.firstName} ${guest.lastName}: ${partner ?? 'None'}`)
    }
  }

  await pickPartner(ava, 'ben', ben)
  await expectPartner(ava, 'Ben Levi')
  await expectPartner(ben, 'Ava Cohen')
  await expectPartner(cara, null)
  await expectRowsSaved(page)
  await expect
    .poll(async () => Object.fromEntries((await apiListGuests(page.request, wedding.id)).map((g) => [g.firstName, g.partnerId])))
    .toEqual({ Ava: ben.id, Ben: ava.id, Cara: null })

  // The dialog says who is linked; picking Cara moves Ava's link and frees Ben.
  await (await guestField(page, ava.id, 'partner')).click()
  await expect(dialog).toContainText('Linked to Ben Levi.')
  await dialog.getByTestId('partner-search').fill('dia')
  await dialog.getByTestId('partner-options').locator(`[data-guest-id="${cara.id}"]`).click()
  await expect(dialog).toBeHidden()
  await closeGuestDialog(page)
  await expectPartner(ava, 'Cara Diaz')
  await expectPartner(cara, 'Ava Cohen')
  await expectPartner(ben, null)
  await expectRowsSaved(page)
  await expect
    .poll(async () => Object.fromEntries((await apiListGuests(page.request, wedding.id)).map((g) => [g.firstName, g.partnerId])))
    .toEqual({ Ava: cara.id, Ben: null, Cara: ava.id })

  await page.reload()
  await waitForGuestList(page)
  await expectPartner(cara, 'Ava Cohen')
  await expectPartner(ben, null)
})

test('select three guests and add them to a new group at once', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Guests group', testInfo))
  const guests = await apiAddGuests(page.request, wedding.id, [
    { firstName: 'Ava', lastName: 'Cohen' },
    { firstName: 'Ben', lastName: 'Levi' },
    { firstName: 'Cara', lastName: 'Diaz' },
    { firstName: 'Dov', lastName: 'Katz' },
  ])
  const [ava, ben, cara, dov] = guests
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)

  for (const g of [ava, ben, cara]) await selectGuest(page, g)
  const bar = page.getByTestId('selection-bar')
  await expect(bar).toContainText('3 selected')
  await bar.getByTestId('add-to-group').click()
  const dialog = page.getByTestId('add-to-group-dialog')
  await expect(dialog).toContainText('3 guests selected.')
  // No groups yet, so New group is already picked.
  await expect(dialog.getByRole('radio', { name: 'New group' })).toBeChecked()
  await dialog.getByTestId('new-group-name').fill('Book Club')
  await dialog.getByRole('button', { name: 'Add to group', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('guests-notice')).toHaveText('Added 3 guests to Book Club.')
  await expect(bar.getByTestId('add-to-group')).toHaveCount(0)
  for (const g of [ava, ben, cara]) await expect(guestEntry(page, g.id)).toContainText('Book Club')
  await expect(guestEntry(page, dov.id)).not.toContainText('Book Club')

  const [group] = await apiListGroups(page.request, wedding.id)
  expect(group.name).toBe('Book Club')
  expect([...group.memberIds].sort()).toEqual([ava.id, ben.id, cara.id].sort())

  // The same group again from a fresh selection: only the one not in it yet is added.
  await selectGuest(page, cara)
  await selectGuest(page, dov)
  await bar.getByTestId('add-to-group').click()
  await expect(dialog.getByRole('radio', { name: /Book Club/ })).toBeChecked()
  await dialog.getByRole('button', { name: 'Add to group', exact: true }).click()
  await expect(page.getByTestId('guests-notice')).toHaveText('Added 1 guest to Book Club.')
  await expect(guestEntry(page, dov.id)).toContainText('Book Club')
  const [after] = await apiListGroups(page.request, wedding.id)
  expect([...after.memberIds].sort()).toEqual(guests.map((g) => g.id).sort())
})

test('deleting a seated guest names the layout and table it clears, and unlinks their partner', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Guests delete', testInfo))
  const [ava, ben, cara, dov] = await apiAddGuests(page.request, wedding.id, [
    { firstName: 'Ava', lastName: 'Cohen' },
    { firstName: 'Ben', lastName: 'Levi' },
    { firstName: 'Cara', lastName: 'Diaz' },
    { firstName: 'Dov', lastName: 'Katz' },
  ])
  await apiLinkPartners(page.request, ava.id, ben.id)
  await apiCreateGroup(page.request, wedding.id, 'Book Club', [ava.id, cara.id])
  const created = await apiCreateLayout(page.request, wedding.id, { name: 'Reception' })
  await apiAddTables(page.request, created, 2)
  await apiSeatGuests(page.request, await apiGetLayout(page.request, created.id), [[cara.id], [ava.id, ben.id]])
  const seated = await apiGetLayout(page.request, created.id)

  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)
  await expect(guestEntry(page, ava.id)).toContainText('Reception · Table 2')

  await guestEntry(page, ava.id).getByTestId('delete-guest').click()
  const dialog = page.getByTestId('delete-guest-dialog')
  await expect(dialog.getByRole('heading')).toHaveText('Delete Ava Cohen')
  await expect(dialog.getByTestId('delete-guest-seats').locator('li')).toHaveText(['Reception: Table 2'])
  await expect(dialog).toContainText('It unlinks their partner, Ben Levi.')
  await expect(dialog).toContainText('They leave 1 group.')
  await dialog.getByTestId('delete-guest-confirm').click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('guests-notice')).toHaveText('Deleted Ava Cohen.')
  await expect(guestEntry(page, ava.id)).toHaveCount(0)
  await expect(page.getByTestId('guest-count')).toHaveText('3 guests')

  // Her seat is empty, Ben keeps his, and the layout's version is unchanged (PLAN change 7).
  const after = await apiGetLayout(page.request, created.id)
  expect(after.version).toBe(seated.version)
  const tables = after.canvas.items.filter((i) => i.kind === 'table')
  expect(tables.map((t) => (t.kind === 'table' ? t.seats.map((s) => s.guestId ?? null).slice(0, 2) : []))).toEqual([
    [cara.id, null],
    [null, ben.id],
  ])
  const left = await apiListGuests(page.request, wedding.id)
  expect(left).toHaveLength(3)
  expect(left.find((g) => g.id === ben.id)?.partnerId).toBeNull()
  await expectGuestPartnerNone(page, ben)

  // Someone seated nowhere: the dialog says so, and Cancel keeps them.
  await guestEntry(page, dov.id).getByTestId('delete-guest').click()
  await expect(dialog.getByTestId('delete-guest-summary')).toHaveText('Dov Katz is not seated in any layout.')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(guestEntry(page, dov.id)).toBeVisible()
  expect(await apiListGuests(page.request, wedding.id)).toHaveLength(3)
})

test('export the guest list as CSV, with a byte order mark and a guest_id column, and re-import it with no changes', async ({ page }, testInfo) => {
  await signIn(page)
  const name = uniqueName('Guests export', testInfo)
  const wedding = await apiCreateWedding(page.request, name)
  const [zoe, lukasz] = await apiAddGuests(page.request, wedding.id, [
    { firstName: 'Zoë', lastName: 'Kowalczyk', side: 'partner1', rsvp: 'yes', meal: 'Fish', notes: 'Nut allergy' },
    { firstName: 'Łukasz', lastName: 'Kowalczyk', side: 'partner1', rsvp: 'yes', household: 'Kowalczyk' },
    { firstName: 'Theo', lastName: 'Lee', side: 'partner2', isChild: true },
  ])
  await apiLinkPartners(page.request, zoe.id, lukasz.id)
  await apiCreateGroup(page.request, wedding.id, 'Noa Family', [zoe.id, lukasz.id])
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)

  const file = await download(page, page.getByTestId('export-csv'), testInfo.outputPath('export.csv'))
  expect(file.name).toMatch(new RegExp(`^${name} guests \\d{4}-\\d{2}-\\d{2}\\.csv$`))
  expect(file.bytes.subarray(0, 3).equals(BOM), 'the export starts with a byte order mark').toBe(true)
  const lines = csvTextLines(file.bytes)
  expect(lines[0]).toBe('first_name,last_name,partner,household,side,groups,rsvp,meal,child,notes,guest_id,nickname')
  const rows = Papa.parse<Record<string, string>>(lines.join('\n'), { header: true }).data
  expect(rows).toHaveLength(3)
  const byId = new Map(rows.map((r) => [r.guest_id, r]))
  const guests = await apiListGuests(page.request, wedding.id)
  expect([...byId.keys()].sort()).toEqual(guests.map((g) => g.id).sort())
  expect(byId.get(zoe.id)).toEqual({
    first_name: 'Zoë',
    last_name: 'Kowalczyk',
    partner: 'Łukasz Kowalczyk',
    household: '',
    side: 'Noa',
    groups: 'Noa Family',
    rsvp: 'yes',
    meal: 'Fish',
    child: 'no',
    notes: 'Nut allergy',
    guest_id: zoe.id,
    nickname: '',
  })
  expect(byId.get(guests.find((g) => g.firstName === 'Theo')!.id)).toMatchObject({ child: 'yes', side: 'Aiden', rsvp: 'pending' })

  // The exported file matches on guest_id, so importing it changes nothing.
  await page.getByTestId('open-import').click()
  await expectHydrated(page.getByTestId('import-file'))
  await page.getByTestId('import-file').setInputFiles(testInfo.outputPath('export.csv'))
  await expect(page.locator('[data-testid="import-column"][data-column="guest_id"] select')).toHaveValue('guest_id')
  await page.getByTestId('import-check').click()
  await expect(page.getByTestId('import-review')).not.toHaveAttribute('aria-busy', 'true')
  await expect(page.getByTestId('count-unchanged')).toHaveText('3')
  await expect(page.getByTestId('count-new')).toHaveText('0')
  await expect(page.getByTestId('count-changed')).toHaveText('0')
})
