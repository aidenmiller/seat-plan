/**
 * Venue templates have owners (venue-access.ts), and the screens say so:
 * the library venue is Library with no Rename or Delete for a planner, opens
 * read-only with a banner and no tools, and "Make my own copy" makes a venue
 * marked Yours that can be edited. A co-member sees another planner's venue
 * as Shared by <name> once a layout uses it, can open it read-only and can
 * copy it. The admin edits the library venue.
 *
 * Both projects share one database, so every card is found by its venue id
 * and every name is made unique.
 */
import { expect, test, type Page } from '@playwright/test'
import { dbAddMember } from './db'
import { expectHydrated } from './guest-list'
import { apiCreateLayout, apiCreateWedding, E2E_USERS, signIn, signInRequest, uniqueName } from './helpers'
import { apiCreateVenue, setTemplateMode, templateMode, venueCard } from './venues'
import type { VenueSummary } from '../src/shared/api'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** The library venue's id (the one Toronto Beach Club seeded by the migrations). */
async function libraryVenueId(page: Page): Promise<string> {
  const res = await page.request.get('/api/venues')
  expect(res.status()).toBe(200)
  const venues = (await res.json()) as VenueSummary[]
  const library = venues.find((v) => v.name === 'Toronto Beach Club' && v.access === 'library')
  expect(library, 'the seeded library venue is listed').toBeTruthy()
  return library!.id
}

/** No drawing tools anywhere: not the desktop panel, not the phone's Tools button, no Edit/View switch, no import. */
async function expectNoEditControls(page: Page): Promise<void> {
  await expect(page.getByTestId('template-read-only')).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Tools' })).toHaveCount(0)
  await expect(page.getByTestId('open-tools')).toHaveCount(0)
  await expect(page.getByTestId('mode-switch')).toHaveCount(0)
  await expect(page.getByTestId('import-plan')).toHaveCount(0)
  // Pan and zoom stay.
  await expect(page.getByTestId('zoom-controls')).toBeVisible()
  await expect(page.getByTestId('save-status')).toHaveText('View only')
}

test('a planner sees the library venue as Library, opens it read-only, and makes a copy of their own', async ({ page }, testInfo) => {
  await signIn(page, 'b')
  const wedding = await apiCreateWedding(page.request, uniqueName('Library', testInfo))
  const libraryId = await libraryVenueId(page)
  const saves: string[] = []
  page.on('request', (req) => {
    if (req.method() !== 'GET' && new URL(req.url()).pathname.startsWith('/api/venues')) saves.push(`${req.method()} ${new URL(req.url()).pathname}`)
  })

  await page.goto(`/w/${wedding.id}/venues`)
  await expect(page.getByText('Library venues are shared by everyone.')).toBeVisible()
  const card = venueCard(page, libraryId)
  await expect(card.getByTestId('venue-badge')).toHaveText('Library')
  await expect(card.getByTitle('Click to rename')).toHaveCount(0)
  await expect(card.getByRole('button', { name: /^Delete/ })).toHaveCount(0)
  await expect(card.getByRole('button', { name: /^Duplicate/ })).toHaveCount(0)
  await expect(card.getByRole('button', { name: /^Make my own copy/ })).toBeVisible()

  // Open: read-only, with the banner and no tools.
  await expectHydrated(card.getByRole('link', { name: /^Open/ }))
  await card.getByRole('link', { name: /^Open/ }).click()
  await expect(page).toHaveURL(new RegExp(`/venues/${libraryId}\\?from=${wedding.id}$`))
  await expect(page.getByTestId('template-read-only')).toContainText('This is a library venue. Only the admin can change it.')
  await expectNoEditControls(page)
  await expect(page.getByTitle('Click to rename')).toHaveCount(0)

  // Make my own copy: opens "<name> copy", which is theirs to edit.
  const copyButton = page.getByTestId('make-copy')
  await expectHydrated(copyButton)
  await copyButton.click()
  await expect(page).toHaveURL(new RegExp(`/venues/(?!${libraryId})${UUID}\\?from=${wedding.id}$`))
  const copyId = new URL(page.url()).pathname.split('/')[2]
  await expect(page.getByTestId('venue-title')).toHaveText('Toronto Beach Club copy')
  await expect(page.getByTestId('template-read-only')).toHaveCount(0)
  await expect(page.getByTestId('mode-switch')).toBeVisible()
  await setTemplateMode(page, 'edit')
  expect(await templateMode(page)).toBe('edit')
  await expect(page.getByTestId('save-status')).toHaveText('Saved')

  // Back on the tab the copy is Yours, with Rename and Delete.
  await page.getByRole('link', { name: 'Back to venues' }).click()
  const mine = venueCard(page, copyId)
  await expect(mine.getByTestId('venue-badge')).toHaveText('Yours')
  await expect(mine.getByRole('button', { name: /^Delete/ })).toBeVisible()
  await expect(mine.getByTitle('Click to rename')).toBeVisible()
  await expect(venueCard(page, libraryId).getByTestId('venue-badge')).toHaveText('Library')

  // The read-only page sent no save or other change of its own; the only change was the copy.
  expect(saves.filter((s) => s.startsWith('PUT') || s.startsWith('PATCH') || s.startsWith('DELETE'))).toEqual([])
  expect(saves.filter((s) => s.endsWith('/duplicate'))).toHaveLength(1)
})

test("another planner's venue is Shared by its owner, opens read-only, and can be copied", async ({ page, request }, testInfo) => {
  // Blake owns a private venue and uses it in a layout of their wedding; Casey is an editor there.
  await signInRequest(request, 'b')
  const wedding = await apiCreateWedding(request, uniqueName('Shared venue', testInfo))
  const venueName = uniqueName('Blake hall', testInfo)
  const venue = await apiCreateVenue(request, venueName)
  await apiCreateLayout(request, wedding.id, { name: 'Reception', venueTemplateId: venue.id })
  await dbAddMember(wedding.id, E2E_USERS.c.email, 'editor')

  await signIn(page, 'c')
  await page.goto(`/w/${wedding.id}/venues`)
  const card = venueCard(page, venue.id)
  await expect(card.getByTestId('venue-badge')).toHaveText(`Shared by ${E2E_USERS.b.displayName}`)
  await expect(page.getByTestId('venue-group-used')).toContainText(venueName)
  await expect(card.getByRole('button', { name: /^Delete/ })).toHaveCount(0)
  await expect(card.getByTitle('Click to rename')).toHaveCount(0)

  await expectHydrated(card.getByRole('link', { name: /^Open/ }))
  await card.getByRole('link', { name: /^Open/ }).click()
  await expect(page.getByTestId('template-read-only')).toContainText(`This venue belongs to ${E2E_USERS.b.displayName}. You can view it.`)
  await expectNoEditControls(page)

  const copyButton = page.getByTestId('make-copy')
  await expectHydrated(copyButton)
  await copyButton.click()
  await expect(page.getByTestId('venue-title')).toHaveText(`${venueName} copy`)
  await expect(page.getByTestId('template-read-only')).toHaveCount(0)
  await expect(page.getByTestId('mode-switch')).toBeVisible()
  const copyId = new URL(page.url()).pathname.split('/')[2]

  // The copy is Casey's own: Yours on the tab, and not listed for anyone else.
  await page.getByRole('link', { name: 'Back to venues' }).click()
  await expect(venueCard(page, copyId).getByTestId('venue-badge')).toHaveText('Yours')
  await expect(venueCard(page, venue.id).getByTestId('venue-badge')).toHaveText(`Shared by ${E2E_USERS.b.displayName}`)
})

test('the admin edits the library venue', async ({ page }, testInfo) => {
  await signIn(page, 'a')
  const wedding = await apiCreateWedding(page.request, uniqueName('Admin library', testInfo))
  const libraryId = await libraryVenueId(page)
  await page.goto(`/w/${wedding.id}/venues`)
  const card = venueCard(page, libraryId)
  await expect(card.getByTestId('venue-badge')).toHaveText('Library')
  await expect(card.getByTitle('Click to rename')).toBeVisible()
  await expect(card.getByRole('button', { name: /^Delete/ })).toBeVisible()
  await expect(card.getByRole('button', { name: /^Make my own copy/ })).toHaveCount(0)

  await expectHydrated(card.getByRole('link', { name: /^Open/ }))
  await card.getByRole('link', { name: /^Open/ }).click()
  await expect(page).toHaveURL(new RegExp(`/venues/${libraryId}`))
  await expect(page.getByTestId('venue-title')).toHaveText('Toronto Beach Club')
  await expect(page.getByTestId('template-read-only')).toHaveCount(0)
  await expect(page.getByTestId('mode-switch')).toBeVisible()
  await setTemplateMode(page, 'edit')
  await expect(page.getByTestId('save-status')).toHaveText('Saved')
  // Edit tools: the desktop panel, or the Tools button on a phone.
  await expect(page.getByRole('complementary', { name: 'Tools' }).or(page.getByTestId('open-tools'))).toBeVisible()
})
