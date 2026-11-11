/**
 * Milestone 4 review findings, checked in the browser (both projects unless
 * a test says otherwise):
 *  - browser Back shows the guest lists as they are now, not as Next's
 *    client cache kept them: the editor's Guests tab after adding guests, and
 *    the Guests page after an import;
 *  - Export CSV sends an edit still waiting in the row queue first, and says
 *    so when it cannot, with Export anyway;
 *  - the laptop table keeps each row's delete button on screen;
 *  - paste names keeps what was typed when Esc is pressed, marks names
 *    already on the list, and adds a line for a "two people" line it cannot
 *    split;
 *  - the phone's Edit dialog saves a field still open when a tap outside
 *    closes it;
 *  - the import keeps its picks when you go back to fix a column, and offers
 *    the other older encoding for a file that is not UTF-8;
 *  - the selection bar says how many selected guests the filters hide;
 *  - the editor's RSVP filter "No" shows the declined guests, and a declined
 *    guest still seated is named apart in the Seated heading.
 */
import { writeFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import Papa from 'papaparse'
import { SAMPLE_CSV_FILE } from '../src/domain/csv/sample'
import { editorMode, isPhoneLayout, sheetAtRest } from './canvas'
import {
  apiAddGuests,
  apiListGuests,
  apiSeatGuests,
  csvTextLines,
  download,
  expectHydrated,
  expectRowsSaved,
  guestEntry,
  guestsPath,
  selectGuest,
  waitForGuestList,
} from './guest-list'
import { apiAddTables, apiCreateLayout, apiCreateWedding, apiGetLayout, editorPath, presetAuthor, signIn, uniqueName } from './helpers'

test.beforeEach(async ({ context }) => {
  await presetAuthor(context, 'Noa')
})

/** Opens the editor's Guests tab: the right panel's on a laptop, the bottom sheet's on a phone. */
async function openGuestsTab(page: Page): Promise<Locator> {
  if (await isPhoneLayout(page)) {
    const sheet = page.getByTestId('bottom-sheet')
    await sheet.getByRole('tab', { name: 'Guests' }).click()
    await expect(sheet.getByRole('tab', { name: 'Guests' })).toHaveAttribute('aria-selected', 'true')
    await sheetAtRest(page)
    return sheet.getByTestId('guests-panel')
  }
  const panel = page.getByTestId('right-panel')
  await panel.getByRole('tab', { name: 'Guests' }).click()
  await expect(panel.getByRole('tab', { name: 'Guests' })).toHaveAttribute('aria-selected', 'true')
  return panel.getByTestId('guests-panel')
}

test('browser Back shows the guest lists as they are now, in the editor and on the Guests page', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Back is fresh', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })

  // The editor first, with no guests yet; then on to the Guests page through its link.
  await page.goto(editorPath(wedding.id, layout.id))
  await editorMode(page)
  let panel = await openGuestsTab(page)
  await expect(panel.getByTestId('guests-empty')).toBeVisible()
  await panel.getByRole('link', { name: 'Add guests on the Guests tab' }).click()
  await expect(page).toHaveURL(new RegExp(`${guestsPath(wedding.id)}$`))
  await waitForGuestList(page)
  await apiAddGuests(page.request, wedding.id, [
    { firstName: 'Ann', lastName: 'Lee' },
    { firstName: 'Ben', lastName: 'Ray' },
  ])

  // Back: the editor's page comes from the client cache, and still fetches the list.
  await page.goBack()
  await editorMode(page)
  panel = await openGuestsTab(page)
  await expect(panel.getByTestId('side-list-counts')).toHaveText('2 guests · 0 seated · 2 unassigned')

  // Forward to the Guests page (it fetches the two new guests), then import the sample.
  await page.goForward()
  await waitForGuestList(page)
  await expect(page.getByTestId('guest-count')).toHaveText('2 guests')
  const samplePath = testInfo.outputPath('guests-sample.csv')
  await writeFile(samplePath, SAMPLE_CSV_FILE)
  await page.getByTestId('open-import').click()
  await expectHydrated(page.getByTestId('import-file'))
  await page.getByTestId('import-file').setInputFiles(samplePath)
  await page.getByTestId('import-check').click()
  await expect(page.getByTestId('import-review')).not.toHaveAttribute('aria-busy', 'true', { timeout: 10_000 })
  await page.getByTestId('import-commit').click()
  await expect(page.getByTestId('import-result')).toContainText('10 guests added.', { timeout: 10_000 })

  // Back to the Guests page: it shows the imported guests, not the list from before.
  await page.goBack()
  await waitForGuestList(page)
  await expect(page.getByTestId('guest-count')).toHaveText('12 guests')
})

test('Export CSV sends an edit still waiting to be saved, and says so when it cannot', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'Cells edit in place on the laptop table; the phone edits in a dialog it closes first.')
  test.setTimeout(45_000)
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Export waits', testInfo))
  const [ann] = await apiAddGuests(page.request, wedding.id, [{ firstName: 'Ann', lastName: 'Lee' }])
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)
  const row = guestEntry(page, ann.id)

  // Type a meal and go straight to Export: the edit waits 300 ms before it is sent.
  await row.getByTestId('cell-meal').click()
  await row.getByTestId('cell-meal-input').fill('Fish')
  const first = await download(page, page.getByTestId('export-csv'), testInfo.outputPath('first.csv'))
  const rows = Papa.parse<Record<string, string>>(csvTextLines(first.bytes).join('\n'), { header: true }).data
  expect(rows.find((r) => r.guest_id === ann.id)?.meal).toBe('Fish')

  // An edit the server does not take yet: the export says so and offers to go on.
  await page.route(`**/api/guests/${ann.id}`, (route) =>
    route.request().method() === 'PATCH' ? route.fulfill({ status: 503, body: '{"error":"down"}' }) : route.fallback(),
  )
  await row.getByTestId('cell-meal').click()
  await row.getByTestId('cell-meal-input').fill('Beef')
  await page.getByTestId('export-csv').click()
  const warning = page.getByTestId('export-unsaved')
  await expect(warning).toContainText('Some changes are not saved yet')
  const anyway = await download(page, warning.getByTestId('export-anyway'), testInfo.outputPath('anyway.csv'))
  const old = Papa.parse<Record<string, string>>(csvTextLines(anyway.bytes).join('\n'), { header: true }).data
  expect(old.find((r) => r.guest_id === ann.id)?.meal).toBe('Fish')
  await expect(warning).toHaveCount(0)

  // Once the server is back, the edit lands.
  await page.unroute(`**/api/guests/${ann.id}`)
  // Coming back online sends the waiting edit at once, skipping the backoff.
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expectRowsSaved(page)
  await expect.poll(async () => (await apiListGuests(page.request, wedding.id))[0]!.meal, { timeout: 40_000 }).toBe('Beef')
})

test('the laptop table keeps each row’s delete button and first name on screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'Phones show cards.')
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Table fits', testInfo))
  const guests = await apiAddGuests(
    page.request,
    wedding.id,
    Array.from({ length: 30 }, (_, i) => ({ firstName: `Guest${String(i).padStart(2, '0')}`, lastName: 'Long', notes: 'A long note that takes room' })),
  )
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)
  const first = guestEntry(page, guests[0]!.id)
  // At 1440 px the whole row fits: delete, first name and where they sit, with no sideways scroll.
  await expect(first.getByTestId('delete-guest')).toBeInViewport()
  await expect(first.getByTestId('cell-seats')).toBeInViewport()
  // The box is at most 75% of the window tall and scrolls inside, and the
  // rows it hides do not stretch the page: scrolled to the end of the page,
  // the whole box, and so its sideways scrollbar, is on screen.
  const tableBox = page.getByTestId('guest-table-box')
  expect((await tableBox.boundingBox())!.height).toBeLessThanOrEqual(900 * 0.75 + 1)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const box = (await tableBox.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(900)
  await expect(first.getByTestId('delete-guest')).toBeInViewport()
  // The header row stays at the top when the rows scroll.
  await tableBox.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
  await expect(page.getByTestId('sort-firstName')).toBeInViewport()
  await expect(guestEntry(page, guests[29]!.id).getByTestId('delete-guest')).toBeInViewport()

  // On a narrower laptop the table scrolls sideways; the first column and first name stay put.
  await page.setViewportSize({ width: 1024, height: 768 })
  await tableBox.evaluate((el) => el.scrollTo({ top: 0, left: el.scrollWidth }))
  expect(await tableBox.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(first.getByTestId('cell-firstName')).toBeInViewport()
  await expect(first.getByTestId('delete-guest')).toBeInViewport()
  await expect(first.getByTestId('cell-seats')).toBeInViewport()
})

test('paste names keeps the text on Esc, marks names already on the list, and adds a line for two people', async ({ page }, testInfo) => {
  test.setTimeout(45_000)
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Paste again', testInfo))
  await apiAddGuests(page.request, wedding.id, [{ firstName: 'Zoë', lastName: 'Kowalczyk' }])
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)

  await page.getByTestId('open-paste-names').click()
  const dialog = page.getByTestId('paste-names-dialog')
  await dialog.getByTestId('paste-names-text').fill('Zoe Kowalczyk\nMr and Mrs John Smith\nAnna Berg\nAnna Berg')
  // Esc (to close the browser's autofill list, say) must not throw the text away.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('paste-names-text')).toHaveValue(/Mr and Mrs John Smith/)

  await dialog.getByTestId('paste-names-preview').click()
  const rows = dialog.getByTestId('paste-names-row')
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(0).getByTestId('paste-names-duplicate')).toContainText('Already on the list')
  await expect(rows.nth(3).getByTestId('paste-names-duplicate')).toContainText('Same name as line 3')
  await expect(rows.nth(1)).toContainText('Two people? Add the second person below.')

  // Add the second person under it, last name filled in, then fix the line by hand.
  await rows.nth(1).getByTestId('paste-names-add-line').click()
  await expect(rows).toHaveCount(5)
  await expect(rows.nth(2).getByRole('textbox', { name: 'Last name, line 3' })).toHaveValue('Smith')
  await expect(rows.nth(2).getByRole('textbox', { name: 'First name, line 3' })).toBeFocused()
  await page.keyboard.type('Mary')
  await rows.nth(1).getByRole('textbox', { name: 'First name, line 2' }).fill('John')
  await expect(rows.nth(1)).not.toContainText('Two people?')
  // Leave out the repeats, and add one more name at the end.
  await rows.nth(4).getByRole('button', { name: 'Remove line 5' }).click()
  await rows.nth(0).getByRole('button', { name: 'Remove line 1' }).click()
  await dialog.getByTestId('paste-names-add-name').click()
  await expect(rows).toHaveCount(4)
  await rows.nth(3).getByRole('textbox', { name: 'First name, line 4' }).fill('Cy')
  await rows.nth(3).getByRole('textbox', { name: 'Last name, line 4' }).fill('Fox')

  // Back and Check names with the same text bring the fixes back.
  await dialog.getByRole('button', { name: 'Back', exact: true }).click()
  await dialog.getByTestId('paste-names-preview').click()
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(1).getByRole('textbox', { name: 'First name, line 2' })).toHaveValue('Mary')
  await dialog.getByTestId('paste-names-save').click()
  await expect(dialog).toBeHidden()
  const names = (await apiListGuests(page.request, wedding.id)).map((g) => `${g.firstName} ${g.lastName}`).sort()
  expect(names).toEqual(['Anna Berg', 'Cy Fox', 'John Smith', 'Mary Smith', 'Zoë Kowalczyk'])

  // Cancel clears it: the next paste starts empty.
  await page.getByTestId('open-paste-names').click()
  await expect(dialog.getByTestId('paste-names-text')).toHaveValue('')
  await dialog.getByTestId('paste-names-text').fill('Dee Ray')
  await dialog.getByTestId('paste-names-cancel').click()
  await expect(dialog).toBeHidden()
  await page.getByTestId('open-paste-names').click()
  await expect(dialog.getByTestId('paste-names-text')).toHaveValue('')
})

test('a tap outside the phone’s Edit dialog saves the field still open', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'The Edit dialog is the phone’s way to edit.')
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Tap outside', testInfo))
  const [zoe] = await apiAddGuests(page.request, wedding.id, [{ firstName: 'Zoë', lastName: 'Adler' }])
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)
  await guestEntry(page, zoe.id).getByTestId('edit-guest').click()
  const dialog = page.getByTestId('guest-edit-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('edit-nickname').click()
  await dialog.getByTestId('edit-nickname-input').fill('Zozo')
  // The margin beside the panel is the backdrop. A touch there is pulled onto
  // the panel by Chromium's touch adjustment, so press it with the mouse.
  const panel = (await dialog.boundingBox())!
  await page.mouse.click(Math.max(2, panel.x / 2), 400)
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await apiListGuests(page.request, wedding.id))[0]!.nickname, { timeout: 10_000 }).toBe('Zozo')
})

test('the import keeps its picks when you go back to fix a column, and reads a Mac file as Mac', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Import picks', testInfo))
  const [samA] = await apiAddGuests(page.request, wedding.id, [
    { firstName: 'Sam', lastName: 'Lee', household: 'First Sam' },
    { firstName: 'Sam', lastName: 'Lee', household: 'Second Sam' },
  ])
  const samplePath = testInfo.outputPath('guests-sample.csv')
  await writeFile(samplePath, SAMPLE_CSV_FILE)
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)
  await page.getByTestId('open-import').click()
  await expectHydrated(page.getByTestId('import-file'))
  await page.getByTestId('import-file').setInputFiles(samplePath)
  await expect(page.getByTestId('import-encoding')).toHaveCount(0)
  await page.getByTestId('import-check').click()
  const review = page.getByTestId('import-review')
  await expect(review).not.toHaveAttribute('aria-busy', 'true', { timeout: 10_000 })

  // Row 10 is Sam Lee, who is two guests: pick the first, and remove the missing.
  const pick = page.locator('[data-testid="review-item"][data-row="10"] select')
  await pick.selectOption(samA!.id)
  await expect(review).not.toHaveAttribute('aria-busy', 'true')
  await page.getByTestId('import-remove-missing').check()

  // The pick applies: Sam is matched, and the other Sam is missing from the file.
  await expect(page.getByTestId('count-review')).toHaveText('0')
  await expect(page.getByTestId('count-missing')).toHaveText('1')

  // Back to columns, Meal ignored this time, then the summary again: the picks still apply.
  await review.getByRole('button', { name: 'Back to columns' }).click()
  await page.locator('[data-testid="import-column"][data-column="meal"] select').selectOption('ignore')
  await page.getByTestId('import-check').click()
  await expect(review).not.toHaveAttribute('aria-busy', 'true', { timeout: 10_000 })
  await expect(page.getByTestId('count-review')).toHaveText('0')
  await expect(page.getByTestId('count-missing')).toHaveText('1')
  await expect(page.getByTestId('import-remove-missing')).toBeChecked()

  // A file saved by Excel for Mac as "CSV (Macintosh)": é is byte 0x8E there.
  await review.getByRole('button', { name: 'Back to columns' }).click()
  await page.getByRole('button', { name: 'Pick another file' }).click()
  await expectHydrated(page.getByTestId('import-file'))
  const mac = Buffer.from([...Buffer.from('first_name,last_name\r\nRen'), 0x8e, ...Buffer.from('e,Dubois\r\n')])
  await page.getByTestId('import-file').setInputFiles({ name: 'mac.csv', mimeType: 'text/csv', buffer: mac })
  await expect(page.getByTestId('import-encoding')).toBeVisible()
  const firstCell = page.getByTestId('import-preview').locator('tbody tr').first().locator('td').nth(1)
  await expect(firstCell).toHaveText('Renée')
  await page.getByTestId('import-encoding-select').selectOption('windows-1252')
  await expect(firstCell).toHaveText('RenŽe')
  await page.getByTestId('import-encoding-select').selectOption('mac-roman')
  await expect(firstCell).toHaveText('Renée')
})

test('the selection bar says how many selected guests the search and filters hide', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Hidden selection', testInfo))
  const [ava, ben, cy] = await apiAddGuests(page.request, wedding.id, [
    { firstName: 'Ava', lastName: 'Cohen', side: 'partner1' },
    { firstName: 'Ben', lastName: 'Levi', side: 'partner1' },
    { firstName: 'Cy', lastName: 'Diaz', side: 'partner2' },
  ])
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)
  await page.getByTestId('filter-side').selectOption('Noa')
  await selectGuest(page, ava!)
  await selectGuest(page, ben!)
  await page.getByTestId('filter-side').selectOption('Aiden')
  await selectGuest(page, cy!)
  const count = page.getByTestId('selection-count')
  await expect(count).toHaveText('3 selected (2 not shown)')
  await page.getByTestId('add-to-group').click()
  await expect(page.getByTestId('add-to-group-dialog')).toContainText('3 guests selected, 2 of them not shown by the search or filters.')
  await page.getByTestId('add-to-group-dialog').getByRole('button', { name: 'Cancel' }).click()
  await page.getByTestId('keep-shown').click()
  await expect(count).toHaveText('1 selected')
  await expect(page.getByTestId('keep-shown')).toHaveCount(0)
})

test('the editor’s RSVP filter "No" shows the declined guests, and a seated one is named apart', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Declined', testInfo))
  const [ann, , dee] = await apiAddGuests(page.request, wedding.id, [
    { firstName: 'Ann', lastName: 'Lee', rsvp: 'yes' },
    { firstName: 'Bo', lastName: 'Ray', rsvp: 'no' },
    { firstName: 'Dee', lastName: 'Fox', rsvp: 'no' },
  ])
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan' })
  await apiAddTables(page.request, layout, 1)
  await apiSeatGuests(page.request, await apiGetLayout(page.request, layout.id), [[ann!.id, dee!.id]])
  await page.goto(editorPath(wedding.id, layout.id))
  await editorMode(page)
  const panel = await openGuestsTab(page)
  await expect(panel.getByTestId('side-list-counts')).toHaveText('1 guest · 1 seated · 0 unassigned · 2 declined')
  await expect(panel.getByTestId('side-list-seated').getByRole('heading')).toHaveText('Seated (1 + 1 declined)')
  const unassigned = panel.getByTestId('side-list-unassigned')
  await expect(unassigned).toContainText('1 declined guest is hidden.')

  if (await isPhoneLayout(page)) await panel.getByRole('button', { name: 'Filters' }).click()
  await panel.getByTestId('side-list-rsvp').selectOption('no')
  await expect(unassigned.getByTestId('side-list-guest')).toHaveCount(1)
  await expect(unassigned).toContainText('Bo Ray')
  await expect(unassigned).not.toContainText('is hidden')
  const showDeclined = panel.getByTestId('side-list-show-declined')
  await expect(showDeclined).toBeChecked()
  await expect(showDeclined).toBeDisabled()
})
