/**
 * Acceptance check 13: importing the sample CSV twice creates no duplicates,
 * and the second import reports 0 new. Also the rest of the re-import
 * summary (spec section 6, "Import"; PLAN change 10): an edited copy of the
 * file reports exactly the one changed meal, the one new row and the one
 * guest missing from it, names the table that guest sat at, and removing
 * them empties that seat without raising the layout's version (PLAN change
 * 7). A name written with an accent matches the guest written without it.
 *
 * Each test makes its own wedding, so the two projects, which share the
 * database, never see each other's guests.
 */
import { writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import {
  apiAddGuests,
  apiGuestByName,
  apiListGroups,
  apiListGuests,
  apiSeatGuests,
  BOM,
  csvTextLines,
  download,
  expectHydrated,
  guestEntry,
  guestsPath,
  waitForGuestList,
} from './guest-list'
import { apiAddTables, apiCreateLayout, apiCreateWedding, apiGetLayout, presetAuthor, signIn, uniqueName } from './helpers'

test.beforeEach(async ({ context }) => {
  await presetAuthor(context, 'Noa')
})

const SAMPLE_HEADER = 'first_name,last_name,partner,household,side,groups,rsvp,meal,child,notes,Table wish'

/** Each column of the sample file and the field the column step should guess for it. */
const GUESSES: [header: string, value: string, label: string][] = [
  ['first_name', 'first_name', 'First name'],
  ['last_name', 'last_name', 'Last name'],
  ['partner', 'partner', 'Partner'],
  ['household', 'household', 'Household'],
  ['side', 'side', 'Side'],
  ['groups', 'groups', 'Groups'],
  ['rsvp', 'rsvp', 'RSVP'],
  ['meal', 'meal', 'Meal'],
  ['child', 'child', 'Child'],
  ['notes', 'notes', 'Notes'],
  ['Table wish', 'add_to_notes', 'Add to notes'],
]

/** Downloads the sample from the Guests page, checks its first bytes and header, and keeps it at `path`. */
async function downloadSample(page: Page, path: string): Promise<string[]> {
  const sample = await download(page, page.getByTestId('sample-csv'), path)
  expect(sample.name).toBe('guests-sample.csv')
  expect(sample.bytes.subarray(0, 3).equals(BOM), 'the sample starts with a byte order mark').toBe(true)
  const lines = csvTextLines(sample.bytes)
  expect(lines[0]).toBe(SAMPLE_HEADER)
  expect(lines).toHaveLength(11)
  return lines
}

/** From the Guests page: Import CSV, pick the file, keep the guessed columns, and wait for the server's summary. */
async function importUpToSummary(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await page.getByTestId('open-import').click()
  await expect(page).toHaveURL(/\/guests\/import$/)
  await expectHydrated(page.getByTestId('import-file'))
  await page.getByTestId('import-file').setInputFiles(file)
  await expect(page.getByTestId('import-columns')).toBeVisible()
  await page.getByTestId('import-check').click()
  await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('import-review')).not.toHaveAttribute('aria-busy', 'true')
}

async function expectCounts(page: Page, counts: { new: number; changed: number; unchanged: number; review?: number; missing: number }): Promise<void> {
  await expect(page.getByTestId('count-new')).toHaveText(String(counts.new))
  await expect(page.getByTestId('count-changed')).toHaveText(String(counts.changed))
  await expect(page.getByTestId('count-unchanged')).toHaveText(String(counts.unchanged))
  await expect(page.getByTestId('count-review')).toHaveText(String(counts.review ?? 0))
  await expect(page.getByTestId('count-missing')).toHaveText(String(counts.missing))
}

/** Presses Import and waits for the result list; returns its lines. */
async function commit(page: Page): Promise<string[]> {
  await page.getByTestId('import-commit').click()
  const result = page.getByTestId('import-result')
  await expect(result).toBeVisible({ timeout: 10_000 })
  return (await result.locator('li').allTextContents()).map((t) => t.trim())
}

test('the sample CSV imports through column matching, and importing it again adds and changes no one', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Import sample', testInfo))
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)
  const samplePath = testInfo.outputPath('guests-sample.csv')
  await downloadSample(page, samplePath)

  // Column matching: every column guessed from its header, the unknown one into notes.
  await page.getByTestId('open-import').click()
  await expect(page).toHaveURL(/\/guests\/import$/)
  await expectHydrated(page.getByTestId('import-file'))
  await page.getByTestId('import-file').setInputFiles(samplePath)
  const columns = page.getByTestId('import-columns')
  await expect(columns).toContainText('guests-sample.csv: 10 rows')
  await expect(page.getByTestId('import-column')).toHaveCount(GUESSES.length)
  for (const [header, value, label] of GUESSES) {
    const select = page.locator(`[data-testid="import-column"][data-column="${header}"] select`)
    await expect(select, header).toHaveValue(value)
    await expect(select.locator('option:checked'), header).toHaveText(label)
  }
  await expect(page.getByTestId('mapping-problems')).toHaveCount(0)

  // Any match can change, and the preview follows: "Table wish" ignored leaves it out of the notes.
  const wish = page.locator('[data-testid="import-column"][data-column="Table wish"] select')
  const preview = page.getByTestId('import-preview')
  await expect(preview.locator('tbody tr').first()).toContainText('Table wish: Near the dance floor')
  await wish.selectOption('ignore')
  await expect(preview.locator('tbody tr').first()).not.toContainText('Near the dance floor')
  await wish.selectOption('add_to_notes')

  // The preview: the first 10 rows as they will be read.
  await expect(columns.getByRole('heading', { name: 'First 10 rows' })).toBeVisible()
  await expect(preview.locator('tbody tr')).toHaveCount(10)
  const first = preview.locator('tbody tr').first().locator('td')
  await expect(first.nth(1)).toHaveText('Zoë')
  await expect(first.nth(2)).toHaveText('Kowalczyk')
  // Row, First name, Last name, Nickname (blank in the sample), Partner, Household, Side, Groups.
  await expect(first.nth(3)).toHaveText('')
  await expect(first.nth(4)).toHaveText('Łukasz Kowalczyk')
  await expect(first.nth(7)).toHaveText('Noa Family; Noa Cousins')
  await expect(preview.locator('tbody tr').nth(9).locator('td').nth(1)).toHaveText('Theo')

  // The summary: ten new guests, the file's groups to make.
  await page.getByTestId('import-check').click()
  await expect(page.getByTestId('import-review')).not.toHaveAttribute('aria-busy', 'true')
  await expectCounts(page, { new: 10, changed: 0, unchanged: 0, missing: 0 })
  await expect(page.getByTestId('import-groups')).toContainText('Groups to make (8)')
  await expect(page.getByTestId('import-missing')).toHaveCount(0)
  expect(await commit(page)).toEqual(['10 guests added.', '0 guests changed.', '0 guests with no change.', '8 groups made.', '13 group memberships added.', '2 couples linked.'])

  // Back on the guest list: the ten guests, partners linked both ways, notes from the extra column.
  await page.getByTestId('import-back').click()
  await expect(page).toHaveURL(new RegExp(`${guestsPath(wedding.id)}$`))
  await waitForGuestList(page)
  await expect(page.getByTestId('guest-count')).toHaveText('10 guests')
  const guests = await apiListGuests(page.request, wedding.id)
  expect(guests).toHaveLength(10)
  const zoe = guests.find((g) => g.firstName === 'Zoë')!
  const lukasz = guests.find((g) => g.firstName === 'Łukasz')!
  expect(zoe.partnerId).toBe(lukasz.id)
  expect(lukasz.partnerId).toBe(zoe.id)
  expect(zoe.notes).toBe('Allergic to nuts\nTable wish: Near the dance floor')
  await expect(guestEntry(page, zoe.id)).toContainText('Łukasz Kowalczyk')
  await expect(guestEntry(page, zoe.id)).toContainText('Noa Cousins')
  const groupsBefore = await apiListGroups(page.request, wedding.id)
  expect(groupsBefore.map((g) => g.name).sort()).toEqual(
    ['Aiden Cousins', 'Aiden Family', 'Aiden HS Friends', 'Book Club', 'Noa College', 'Noa Cousins', 'Noa Family', 'Work Friends'],
  )

  // The same file again: nothing new, nothing changed, nobody missing.
  await importUpToSummary(page, samplePath)
  await expectCounts(page, { new: 0, changed: 0, unchanged: 10, missing: 0 })
  await expect(page.getByTestId('import-new')).toHaveCount(0)
  await expect(page.getByTestId('import-changed')).toHaveCount(0)
  await expect(page.getByTestId('import-groups')).toHaveCount(0)
  await expect(page.getByTestId('import-duplicates')).toHaveCount(0)
  expect(await commit(page)).toEqual(['0 guests added.', '0 guests changed.', '10 guests with no change.'])

  const after = await apiListGuests(page.request, wedding.id)
  expect(after).toHaveLength(10)
  expect(after.map((g) => `${g.firstName} ${g.lastName}`).sort()).toEqual(guests.map((g) => `${g.firstName} ${g.lastName}`).sort())
  expect(after.find((g) => g.id === zoe.id)?.notes).toBe(zoe.notes)
  const groupsAfter = await apiListGroups(page.request, wedding.id)
  expect(groupsAfter.map((g) => [g.name, g.memberIds.length]).sort()).toEqual(groupsBefore.map((g) => [g.name, g.memberIds.length]).sort())
  await page.getByTestId('import-back').click()
  await waitForGuestList(page)
  await expect(page.getByTestId('guest-count')).toHaveText('10 guests')
})

test('an edited copy reports one changed meal, one new guest and one missing guest, names their table, and removing them empties the seat', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000)
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Import edited', testInfo))
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)
  const samplePath = testInfo.outputPath('guests-sample.csv')
  const lines = await downloadSample(page, samplePath)
  await importUpToSummary(page, samplePath)
  await expectCounts(page, { new: 10, changed: 0, unchanged: 0, missing: 0 })
  await commit(page)

  // Theo Lee sits at Table 1 of "Plan", seated through the layout API.
  const theo = (await apiGuestByName(page.request, wedding.id, 'Theo', 'Lee'))!
  const created = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  await apiAddTables(page.request, created, 1)
  await apiSeatGuests(page.request, await apiGetLayout(page.request, created.id), [[theo.id]])
  const seated = await apiGetLayout(page.request, created.id)
  const table = seated.canvas.items.find((i) => i.kind === 'table')!
  expect(table.kind === 'table' && table.seats[0].guestId).toBe(theo.id)

  // The edited copy: Sam's meal changes, Theo's row is gone, Nadia is new.
  expect(lines.some((l) => l.startsWith('Sam,Lee,') && l.includes(',yes,Fish,'))).toBe(true)
  const edited = [
    ...lines.filter((l) => !l.startsWith('Theo,Lee,')).map((l) => (l.startsWith('Sam,Lee,') ? l.replace(',yes,Fish,', ',yes,Beef,') : l)),
    'Nadia,Haddad,,,Both,,yes,Vegan,no,,',
  ]
  const editedPath = testInfo.outputPath('guests-edited.csv')
  await writeFile(editedPath, Buffer.concat([BOM, Buffer.from(edited.join('\r\n') + '\r\n', 'utf8')]))

  await page.getByTestId('import-back').click()
  await waitForGuestList(page)
  await importUpToSummary(page, editedPath)
  await expectCounts(page, { new: 1, changed: 1, unchanged: 8, missing: 1 })
  await expect(page.getByTestId('import-new')).toContainText('New guests (1)')
  const changed = page.getByTestId('import-changed')
  await expect(changed).toContainText('Changed guests (1)')
  await expect(changed.locator('li li')).toHaveText(['Meal: Fish to Beef'])
  await expect(changed).toContainText('Sam Lee')
  const missing = page.getByTestId('import-missing')
  await expect(missing).toContainText('On the guest list but not in this file (1)')
  await expect(missing).toContainText('Theo Lee')
  await expect(page.getByTestId('import-missing-seats')).toContainText('Removing them clears these seats:')
  await expect(page.getByTestId('import-missing-seats').locator('li')).toHaveText(['Plan: Table 1 (Theo Lee)'])

  await page.getByTestId('import-remove-missing').check()
  const result = await commit(page)
  expect(result).toEqual(['1 guest added.', '1 guest changed.', '8 guests with no change.', '1 guest removed.'])
  await expect(page.getByTestId('import-done')).toContainText('Seats cleared:')
  await expect(page.getByTestId('import-done').locator('ul').nth(1).locator('li')).toHaveText(['Plan: Table 1'])

  // The seat is empty, and the layout's version stayed where it was.
  const after = await apiGetLayout(page.request, created.id)
  const tableAfter = after.canvas.items.find((i) => i.kind === 'table')!
  expect(tableAfter.kind === 'table' && tableAfter.seats.every((s) => !s.guestId)).toBe(true)
  expect(after.version).toBe(seated.version)
  const guests = await apiListGuests(page.request, wedding.id)
  expect(guests).toHaveLength(10)
  expect(guests.some((g) => g.id === theo.id)).toBe(false)
  expect(guests.find((g) => g.firstName === 'Sam')?.meal).toBe('Beef')
  expect(guests.find((g) => g.firstName === 'Nadia')).toMatchObject({ lastName: 'Haddad', side: 'Both', rsvp: 'yes', meal: 'Vegan' })

  await page.getByTestId('import-back').click()
  await waitForGuestList(page)
  await expect(page.getByTestId('guest-count')).toHaveText('10 guests')
  await expect(guestEntry(page, theo.id)).toHaveCount(0)
})

test('a file with "Zoë" matches the guest "Zoe" already on the list', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Import accents', testInfo))
  const [zoe] = await apiAddGuests(page.request, wedding.id, [{ firstName: 'Zoe', lastName: 'Kowalczyk' }])
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)

  const csv = Buffer.from('first_name,last_name,meal\r\nZoë,Kowalczyk,Fish\r\n', 'utf8')
  await importUpToSummary(page, { name: 'zoe.csv', mimeType: 'text/csv', buffer: csv })
  await expectCounts(page, { new: 0, changed: 1, unchanged: 0, missing: 0 })
  const changed = page.getByTestId('import-changed')
  await expect(changed).toContainText('Zoe Kowalczyk')
  await expect(changed.locator('li li')).toHaveText(['Meal: empty to Fish'])
  await expect(page.getByTestId('import-new')).toHaveCount(0)
  await expect(page.getByTestId('import-duplicates')).toHaveCount(0)
  expect(await commit(page)).toEqual(['0 guests added.', '1 guest changed.', '0 guests with no change.'])

  const guests = await apiListGuests(page.request, wedding.id)
  expect(guests).toHaveLength(1)
  expect(guests[0]).toMatchObject({ id: zoe.id, firstName: 'Zoe', lastName: 'Kowalczyk', meal: 'Fish' })
})
