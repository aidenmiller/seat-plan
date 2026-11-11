/**
 * Partner names, one pair per wedding, and guest sides stored by place
 * (partner1, partner2, both). A wedding made for Sam and Alex in the New
 * wedding dialog imports the sample CSV, whose sides say Partner 1 and
 * Partner 2, and from then on every side reads Sam, Alex or Both: the side
 * filter, the guest table or cards, the CSV export, and the seating block's
 * side labels. Renaming a partner in Settings relabels every guest at once.
 */
import { expect, test } from '@playwright/test'
import Papa from 'papaparse'
import { isPhoneLayout, press, setMode } from './canvas'
import { apiListGuests, csvTextLines, download, expectHydrated, guestEntry, guestsPath, narrowScreen, waitForGuestList } from './guest-list'
import { apiCreateLayout, editorPath, expectSaved, presetAuthor, signIn, uniqueName } from './helpers'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

test.beforeEach(async ({ context }) => {
  await presetAuthor(context, 'Noa')
})

test("a wedding for Sam and Alex shows its own names on every side, in the import, the export and the ceremony", async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await signIn(page)

  // New wedding, with the partners' names.
  const name = uniqueName('Sam and Alex', testInfo)
  await page.getByRole('button', { name: 'New wedding' }).click()
  const create = page.getByRole('dialog', { name: 'New wedding' })
  await expect(create.getByLabel('Name')).toHaveAttribute('placeholder', 'e.g. Sam & Alex')
  await create.getByLabel('Name').fill(name)
  await create.getByLabel('Partner 1').fill('Sam')
  await create.getByLabel('Partner 2').fill(' Alex ')
  await create.getByRole('button', { name: 'Create wedding' }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${UUID}/layouts$`))
  const weddingId = new URL(page.url()).pathname.split('/')[2]!
  expect(await (await page.request.get(`/api/weddings/${weddingId}`)).json()).toMatchObject({ name, partner1Name: 'Sam', partner2Name: 'Alex' })

  // The sample CSV: its sides say Partner 1, Partner 2 and Both, which every wedding reads.
  await page.goto(guestsPath(weddingId))
  await waitForGuestList(page)
  const samplePath = testInfo.outputPath('guests-sample.csv')
  await download(page, page.getByTestId('sample-csv'), samplePath)
  await page.getByTestId('open-import').click()
  await expectHydrated(page.getByTestId('import-file'))
  await page.getByTestId('import-file').setInputFiles(samplePath)
  const preview = page.getByTestId('import-preview')
  // Row, First name, Last name, Nickname, Partner, Household, Side: the preview names the side.
  await expect(preview.locator('tbody tr').first().locator('td').nth(6)).toHaveText('Sam')
  await page.getByTestId('import-check').click()
  await expect(page.getByTestId('import-review')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('import-review')).not.toHaveAttribute('aria-busy', 'true')
  await expect(page.getByTestId('count-new')).toHaveText('10')
  await expect(page.getByTestId('import-warnings')).toHaveCount(0)
  await page.getByTestId('import-commit').click()
  await expect(page.getByTestId('import-result')).toBeVisible({ timeout: 10_000 })
  const guests = await apiListGuests(page.request, weddingId)
  const sideOf = (first: string) => guests.find((g) => g.firstName === first)!.side
  expect([sideOf('Zoë'), sideOf('Daniel'), sideOf('José')]).toEqual(['partner1', 'partner2', 'both'])

  // The guest list: the side filter and each guest's side read Sam, Alex or Both.
  await page.goto(guestsPath(weddingId))
  await waitForGuestList(page)
  const filter = page.getByTestId('filter-side')
  await expect(filter.locator('option')).toHaveText(['Any side', 'Sam', 'Alex', 'Both'])
  const zoe = guests.find((g) => g.firstName === 'Zoë')!
  const daniel = guests.find((g) => g.firstName === 'Daniel')!
  if (narrowScreen(page)) {
    await expect(guestEntry(page, zoe.id)).toContainText('Side: Sam')
    await expect(guestEntry(page, daniel.id)).toContainText('Side: Alex')
  } else {
    await expect(guestEntry(page, zoe.id).getByTestId('cell-side').locator('option:checked')).toHaveText('Sam')
    await expect(guestEntry(page, daniel.id).getByTestId('cell-side').locator('option:checked')).toHaveText('Alex')
  }
  await filter.selectOption('Alex')
  await expect(page.getByTestId('guest-count')).toContainText('Showing 5 of 10 guests')
  await filter.selectOption({ label: 'Any side' })

  // The CSV export writes the names, so a re-import reads them back.
  const exported = await download(page, page.getByTestId('export-csv'), testInfo.outputPath('export.csv'))
  const rows = Papa.parse<Record<string, string>>(csvTextLines(exported.bytes).join('\n'), { header: true }).data
  const exportedSide = new Map(rows.map((r) => [r.first_name, r.side]))
  expect([exportedSide.get('Zoë'), exportedSide.get('Daniel'), exportedSide.get('José')]).toEqual(['Sam', 'Alex', 'Both'])

  // The ceremony's seating block offers the partners' sides: Sam on the left, Alex on the right.
  const ceremony = await apiCreateLayout(page.request, weddingId, { name: 'Ceremony', kind: 'ceremony' })
  await page.goto(editorPath(weddingId, ceremony.id))
  await setMode(page, 'edit')
  await expect(page.getByTestId('open-shapes').or(page.getByTestId('seating-block-tool'))).toBeEnabled({ timeout: 10_000 })
  await expectSaved(page)
  const phone = await isPhoneLayout(page)
  if (phone) await page.getByTestId('open-shapes').click()
  const shapes = phone ? page.getByTestId('shape-drawer') : page.getByTestId('shape-panel')
  await press(page, shapes.getByTestId('seating-block-tool'))
  const block = page.getByTestId('seating-block-dialog')
  await expect(block.getByTestId('block-left')).toHaveValue("Sam's side")
  await expect(block.getByTestId('block-right')).toHaveValue("Alex's side")

  // Renaming a partner in Settings relabels every guest on that side.
  await page.goto(guestsPath(weddingId))
  await waitForGuestList(page)
  const settingsButton = page.getByRole('button', { name: 'Settings' })
  await expectHydrated(settingsButton)
  await settingsButton.click()
  const settings = page.getByRole('dialog', { name: 'Wedding settings' })
  await expect(settings.getByLabel('Partner 1')).toHaveValue('Sam')
  await expect(settings.getByLabel('Partner 2')).toHaveValue('Alex')
  await settings.getByLabel('Partner 2').fill('Alexis')
  await settings.getByRole('button', { name: 'Save' }).click()
  await expect(settings).toBeHidden()
  await expect(filter.locator('option')).toHaveText(['Any side', 'Sam', 'Alexis', 'Both'])
  expect((await apiListGuests(page.request, weddingId)).find((g) => g.id === daniel.id)!.side).toBe('partner2')
})
