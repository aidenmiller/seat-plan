/**
 * Acceptance check 25: pasting 10 names, one per line, adds 10 guests after
 * a preview (spec section 6, "Guests page"; DECISIONS 25). The preview
 * splits each line into first and last name ("Last, First"; particles such
 * as "van der" stay with the last name; honorifics are dropped), a line
 * with no last name blocks saving until it is fixed, and saving adds all
 * ten at once.
 */
import { expect, test } from '@playwright/test'
import { apiListGuests, guestEntry, guestsPath, waitForGuestList } from './guest-list'
import { apiCreateWedding, signIn, uniqueName } from './helpers'

/** Each pasted line and how the preview should split it ('' for a part to fix by hand). */
const LINES: [line: string, first: string, last: string][] = [
  ['Smith, John', 'John', 'Smith'],
  ['Anna van der Berg', 'Anna', 'van der Berg'],
  ['Mary Ann Smith', 'Mary Ann', 'Smith'],
  ['José García', 'José', 'García'],
  ['Dr. Priya Raman', 'Priya', 'Raman'],
  ['Łukasz Nowak', 'Łukasz', 'Nowak'],
  ["Siobhán O'Connor", 'Siobhán', "O'Connor"],
  ['Prince', 'Prince', ''],
  ['Kwame Mensah', 'Kwame', 'Mensah'],
  ['Mei-Ling Chen', 'Mei-Ling', 'Chen'],
]
const FIXED_LINE = 7
const FIXED_LAST = 'Nelson'

test('pasting 10 names shows them split for checking, and after fixing one, saving adds 10 guests', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Paste names', testInfo))
  await page.goto(guestsPath(wedding.id))
  await waitForGuestList(page)
  await expect(page.getByTestId('guests-empty')).toBeVisible()

  await page.getByTestId('open-paste-names').click()
  const dialog = page.getByTestId('paste-names-dialog')
  await expect(dialog).toBeVisible()
  // Blank lines and stray spaces around the names do not count.
  await dialog.getByTestId('paste-names-text').fill(`${LINES.map(([line]) => line).join('\n')}\n\n  \n`)
  await dialog.getByTestId('paste-names-preview').click()

  // The preview: one row per line, split into first and last name.
  const rows = dialog.getByTestId('paste-names-row')
  await expect(rows).toHaveCount(10)
  await expect(dialog).toContainText('10 names to add.')
  for (const [i, [line, first, last]] of LINES.entries()) {
    await expect(dialog.getByLabel(`First name, line ${i + 1}`, { exact: true }), line).toHaveValue(first)
    await expect(dialog.getByLabel(`Last name, line ${i + 1}`, { exact: true }), line).toHaveValue(last)
  }

  // "Prince" has no last name: saving waits until the line is fixed.
  await expect(rows.nth(FIXED_LINE)).toContainText('Needs a last name')
  await expect(dialog).toContainText('Fix or remove 1 line first.')
  const save = dialog.getByTestId('paste-names-save')
  await expect(save).toBeDisabled()
  await dialog.getByLabel(`Last name, line ${FIXED_LINE + 1}`, { exact: true }).fill(FIXED_LAST)
  await expect(rows.nth(FIXED_LINE)).not.toContainText('Needs a last name')
  await expect(save).toBeEnabled()
  await expect(save).toHaveText('Add 10 guests')

  await save.click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('guests-notice')).toHaveText('Added 10 guests.')
  await expect(page.getByTestId('guest-count')).toHaveText('10 guests')

  // The server has exactly these ten, and the list shows each one.
  const expected = LINES.map(([, first, last], i) => `${first} ${i === FIXED_LINE ? FIXED_LAST : last}`)
  const guests = await apiListGuests(page.request, wedding.id)
  expect(guests.map((g) => `${g.firstName} ${g.lastName}`).sort()).toEqual([...expected].sort())
  for (const guest of guests) {
    await expect(guestEntry(page, guest.id)).toContainText(guest.firstName)
    await expect(guestEntry(page, guest.id)).toContainText(guest.lastName)
  }

  // A reload shows the same ten.
  await page.reload()
  await waitForGuestList(page)
  await expect(page.getByTestId('guest-count')).toHaveText('10 guests')
})
