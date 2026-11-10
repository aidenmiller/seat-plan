/**
 * Milestone 7, venue templates on a wedding's Venues tab (spec section 5,
 * "Venue templates"; PLAN section 7): New venue makes an empty template and
 * opens the template editor; the name renames in place; Duplicate copies it
 * with its walls; Delete is blocked while a layout uses the template, and the
 * dialog lists that layout; once Change venue in the dialog moves the layout
 * to another venue, the typed `delete` confirmation deletes the venue. A
 * layout whose venue was deleted shows a notice and picks another venue; the
 * layout editor's Properties change it again, to a blank canvas.
 *
 * Venues are shared by every wedding (PLAN change 5) and both projects share
 * one database, so every card is found by its venue id.
 */
import { expect, test } from '@playwright/test'
import { expectHydrated } from './guest-list'
import { openProperties } from './canvas'
import { dbMarkTemplateDeleted } from './db'
import { apiCreateLayout, apiCreateWedding, apiGetLayout, editorPath, presetAuthor, signIn, uniqueName, waitForEditor } from './helpers'
import { apiCreateVenue, apiGetVenue, apiSaveVenue, setTemplateMode, venueCard, wallItem } from './venues'
import type { VenueSummary } from '../src/shared/api'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

test.beforeEach(async ({ context }) => {
  await presetAuthor(context, 'Noa')
})

test('New venue makes an empty template and opens it; the name renames in place on the Venues tab', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Venues', testInfo))
  await page.goto(`/w/${wedding.id}/venues`)
  await expect(page.getByRole('heading', { name: 'Venues', level: 2 })).toBeVisible()
  // The seeded template is there for every wedding, and stays empty until its floor plan is sent (spec section 5).
  await expect(page.getByTestId('venue-list')).toContainText('Toronto Beach Club')
  const listed = (await (await page.request.get('/api/venues')).json()) as VenueSummary[]
  expect(listed.filter((v) => v.name === 'Toronto Beach Club')).toEqual([expect.objectContaining({ fixedItemCount: 0, hasReferenceImage: false })])
  await expectHydrated(page.getByTestId('new-venue'))

  // New venue: an empty template, opened in the template editor, with Back to this tab.
  await page.getByTestId('new-venue').click()
  await expect(page).toHaveURL(new RegExp(`/venues/${UUID}\\?from=${wedding.id}$`))
  const venueId = new URL(page.url()).pathname.split('/')[2]
  await expect(page.getByTestId('venue-title')).toHaveText('New venue')
  await setTemplateMode(page, 'edit')
  await expect(page.getByTestId('template-properties')).toContainText('Nothing drawn yet.')
  const created = await apiGetVenue(page.request, venueId)
  expect(created).toMatchObject({ name: 'New venue', version: 1, fixedItems: [], reference: null, referenceImage: null, usedBy: 0 })

  await page.getByRole('link', { name: 'Back to venues' }).click()
  await expect(page).toHaveURL(new RegExp(`/w/${wedding.id}/venues$`))
  const card = venueCard(page, venueId)
  await expect(card.getByTestId('venue-name')).toHaveText('New venue')
  await expect(card.getByTestId('venue-used-by')).toHaveText('Not used yet · Empty')

  // Rename in place: Esc cancels, an empty name is refused, Enter saves.
  const name = card.getByTestId('venue-name')
  const input = card.getByTestId('venue-name-input')
  await expectHydrated(name)
  await name.click()
  await expect(input).toBeFocused()
  await input.fill('Not this one')
  await input.press('Escape')
  await expect(name).toHaveText('New venue')
  await name.click()
  await input.fill('   ')
  await input.press('Enter')
  await expect(card.getByRole('alert')).toHaveText('Names cannot be empty.')
  await expect(name).toHaveText('New venue')

  const renamed = uniqueName('Harbour Hall', testInfo)
  await name.click()
  await input.fill(renamed)
  const saved = page.waitForResponse((res) => res.request().method() === 'PATCH' && new URL(res.url()).pathname === `/api/venues/${venueId}`)
  await input.press('Enter')
  expect((await saved).status()).toBe(200)
  await expect(name).toHaveText(renamed)
  await page.reload()
  await expect(venueCard(page, venueId).getByTestId('venue-name')).toHaveText(renamed)
  await expectHydrated(venueCard(page, venueId).getByRole('link', { name: `Open ${renamed}` }))
  // A rename leaves the version alone (it is not a save of the plan).
  expect(await apiGetVenue(page.request, venueId)).toMatchObject({ name: renamed, version: 1 })

  // The template editor shows the new name, and Open on the card goes there.
  await venueCard(page, venueId).getByRole('link', { name: `Open ${renamed}` }).click()
  await expect(page).toHaveURL(new RegExp(`/venues/${venueId}\\?from=${wedding.id}$`))
  await expect(page.getByTestId('venue-title')).toHaveText(renamed)
})

test('Duplicate copies a venue with its walls under a new name', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Venues copy', testInfo))
  const name = uniqueName('Lakeside Barn', testInfo)
  const venue = await apiCreateVenue(page.request, name)
  await apiSaveVenue(page.request, venue, [wallItem({ x: 0, y: 0 }, { x: 609.6, y: 0 }), wallItem({ x: 609.6, y: 0 }, { x: 609.6, y: 457.2 })])

  await page.goto(`/w/${wedding.id}/venues`)
  const card = venueCard(page, venue.id)
  await expect(card.getByTestId('venue-used-by')).toHaveText('Not used yet · 2 items')
  await expectHydrated(card.getByRole('button', { name: `Duplicate ${name}` }))
  const copied = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === `/api/venues/${venue.id}/duplicate`)
  await card.getByRole('button', { name: `Duplicate ${name}` }).click()
  expect((await copied).status()).toBe(201)

  // The copy shows on the tab with its own card.
  const copyCard = page.getByTestId('venue-card').filter({ has: page.getByTestId('venue-name').getByText(`${name} copy`, { exact: true }) })
  await expect(copyCard).toHaveCount(1)
  await expect(copyCard.getByTestId('venue-used-by')).toHaveText('Not used yet · 2 items')
  const copyId = (await copyCard.getAttribute('data-venue-id')) ?? ''
  expect(copyId).not.toBe(venue.id)

  // The same walls; the original is unchanged, and the copy starts its own history.
  const original = await apiGetVenue(page.request, venue.id)
  const copy = await apiGetVenue(page.request, copyId)
  expect(copy.name).toBe(`${name} copy`)
  expect(copy.fixedItems).toEqual(original.fixedItems)
  expect(original).toMatchObject({ name, version: 2 })
  expect(copy.version).toBe(1)

  // Both are listed for every wedding.
  const listed = (await (await page.request.get('/api/venues')).json()) as VenueSummary[]
  expect(listed.map((v) => v.id)).toEqual(expect.arrayContaining([venue.id, copyId]))
})

test('Delete is blocked while a layout uses the venue, and the dialog lists it; after Change venue moves that layout, typing delete deletes the venue', async ({
  page,
}, testInfo) => {
  await signIn(page)
  const weddingName = uniqueName('Venue in use', testInfo)
  const wedding = await apiCreateWedding(page.request, weddingName)
  const name = uniqueName('Orchard Pavilion', testInfo)
  const venue = await apiCreateVenue(page.request, name)
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Reception plan', venueTemplateId: venue.id })

  await page.goto(`/w/${wedding.id}/venues`)
  const card = venueCard(page, venue.id)
  await expect(card.getByTestId('venue-used-by')).toHaveText('Used by 1 layout · Empty')
  await expectHydrated(card.getByRole('button', { name: `Delete ${name}` }))

  // Blocked: the dialog names the layout (with a link to it), has no confirmation box, and Delete stays off.
  await card.getByRole('button', { name: `Delete ${name}` }).click()
  let dialog = page.getByRole('dialog', { name: 'Delete venue' })
  await expect(dialog.getByTestId('delete-summary')).toContainText(`One layout still uses “${name}”. Pick another venue for it before you delete this one.`)
  const inUse = dialog.getByTestId('venue-in-use').getByRole('link')
  await expect(inUse).toHaveCount(1)
  await expect(inUse).toHaveText(`${weddingName} · Reception plan`)
  await expect(inUse).toHaveAttribute('href', `/w/${wedding.id}/layouts/${layout.id}`)
  await expect(dialog.getByLabel('Type delete to confirm')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
  // The server refuses too, and lists the same layout.
  const refused = await page.request.delete(`/api/venues/${venue.id}`, { data: { confirm: 'delete' } })
  expect(refused.status()).toBe(409)
  expect(await refused.json()).toMatchObject({ error: 'in_use', layouts: [{ weddingId: wedding.id, layoutId: layout.id, layoutName: 'Reception plan' }] })
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  expect((await apiGetVenue(page.request, venue.id)).name).toBe(name)

  // Move the layout to another venue from the dialog; the list empties and the delete can go ahead.
  const otherName = uniqueName('Garden Room', testInfo)
  const other = await apiCreateVenue(page.request, otherName)
  await page.reload()
  await expectHydrated(card.getByRole('button', { name: `Delete ${name}` }))
  await card.getByRole('button', { name: `Delete ${name}` }).click()
  dialog = page.getByRole('dialog', { name: 'Delete venue' })
  const row = dialog.getByTestId('venue-in-use-layout')
  await expect(row).toHaveCount(1)
  await row.getByTestId('venue-in-use-change').click()
  const picker = row.getByTestId('venue-picker')
  const select = picker.getByTestId('venue-picker-select')
  // Every other venue and Blank canvas; never the one being deleted.
  await expect(select.locator('option', { hasText: otherName })).toHaveCount(1)
  await expect(select.locator('option', { hasText: 'Blank canvas' })).toHaveCount(1)
  await expect(select.locator(`option[value="${venue.id}"]`)).toHaveCount(0)
  await select.selectOption(other.id)
  const moved = page.waitForResponse((res) => res.request().method() === 'PATCH' && new URL(res.url()).pathname === `/api/layouts/${layout.id}`)
  await picker.getByTestId('venue-picker-save').click()
  expect((await moved).status()).toBe(200)
  const movedLayout = (await (await page.request.get(`/api/layouts/${layout.id}`)).json()) as { venueTemplateId: string | null; name: string }
  expect(movedLayout).toMatchObject({ venueTemplateId: other.id, name: 'Reception plan' })
  await expect(dialog.getByTestId('delete-summary')).toContainText(`This deletes “${name}”`)
  await expect(dialog.getByTestId('delete-summary')).toContainText('No layout uses it.')
  await expect(dialog.getByTestId('venue-in-use')).toHaveCount(0)
  const box = dialog.getByLabel('Type delete to confirm')
  const button = dialog.getByRole('button', { name: 'Delete', exact: true })
  await expect(button).toBeDisabled()
  await box.fill('Delete')
  await expect(button).toBeDisabled()
  await box.fill('delete')
  await expect(button).toBeEnabled()
  const deleted = page.waitForResponse((res) => res.request().method() === 'DELETE' && new URL(res.url()).pathname === `/api/venues/${venue.id}`)
  await button.click()
  expect((await deleted).status()).toBe(200)
  await expect(dialog).toBeHidden()
  await expect(card).toHaveCount(0)

  // Gone from the list, the API and the template editor.
  expect((await page.request.get(`/api/venues/${venue.id}`)).status()).toBe(404)
  const listed = (await (await page.request.get('/api/venues')).json()) as VenueSummary[]
  expect(listed.map((v) => v.id)).not.toContain(venue.id)
  const editor = await page.goto(`/venues/${venue.id}`)
  expect(editor?.status()).toBe(404)
})

test('a layout whose venue was deleted says so and picks another venue; Properties change it again, to a blank canvas', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Venue moved', testInfo))
  const oldName = uniqueName('Old Barn', testInfo)
  const old = await apiCreateVenue(page.request, oldName)
  const nextName = uniqueName('New Barn', testInfo)
  const next = await apiCreateVenue(page.request, nextName)
  await apiSaveVenue(page.request, next, [wallItem({ x: -300, y: -200 }, { x: 300, y: -200 })], 'Aiden')
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Supper', venueTemplateId: old.id })
  // As a wedding restored from the database can leave it (DECISIONS 29).
  await dbMarkTemplateDeleted(old.id)

  await page.goto(editorPath(wedding.id, layout.id))
  await waitForEditor(page)
  const notice = page.getByTestId('venue-deleted-notice')
  await expect(notice).toContainText(`The venue “${oldName}” was deleted`)
  const venueWalls = page.getByTestId('canvas').locator('[data-layer="venue"] [data-venue-type="wall"]')
  await expect(venueWalls).toHaveCount(0)

  // Pick another venue from the notice: its walls draw under the layout at once.
  await notice.getByTestId('venue-deleted-pick').click()
  const dialog = page.getByRole('dialog', { name: 'Change venue' })
  const select = dialog.getByTestId('venue-picker-select')
  await expect(select.locator(`option[value="${next.id}"]`)).toHaveCount(1)
  await expect(select.locator(`option[value="${old.id}"]`)).toHaveCount(0)
  await select.selectOption(next.id)
  await dialog.getByTestId('venue-picker-save').click()
  await expect(dialog).toBeHidden()
  await expect(notice).toHaveCount(0)
  await expect(page.getByTestId('editor-notice')).toHaveText(`This layout now uses “${nextName}”.`)
  await expect(venueWalls).toHaveCount(1)
  // Only the venue changed: the layout's version stays.
  expect(await apiGetLayout(page.request, layout.id)).toMatchObject({ venueTemplateId: next.id, version: layout.version })

  // Properties, nothing selected: the venue's name, and Change venue.
  const props = await openProperties(page)
  await expect(props.getByTestId('layout-venue')).toHaveText(nextName)
  const change = props.getByTestId('change-venue')
  const box = await change.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  await change.click()
  await select.selectOption({ label: 'Blank canvas' })
  await dialog.getByTestId('venue-picker-save').click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('editor-notice')).toHaveText('This layout is now a blank canvas.')
  await expect(venueWalls).toHaveCount(0)
  await expect(props.getByTestId('layout-venue')).toHaveText('Blank canvas')
  expect(await apiGetLayout(page.request, layout.id)).toMatchObject({ venueTemplateId: null, venueName: null })
  // After a reload it is still a blank canvas.
  await page.reload()
  await expect(page.getByTestId('canvas')).toBeVisible()
  await expect(venueWalls).toHaveCount(0)
  await expect(notice).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(testInfo.project.name === 'phone' ? 390 : 1440)
})
