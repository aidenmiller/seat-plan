/**
 * Backup and restore (spec section 11): Download backup in the wedding's
 * settings saves one JSON file; Restore from file on the home screen makes a
 * new wedding from it, with its guests, groups, partner links, layouts and
 * seats under new ids. The venue's walls change after the backup, so the
 * restore brings it back as "Name (restored)" with its floor plan image
 * (PLAN change 5), sent by the browser as raw bytes. A version 1 file, from
 * before partner names, restores as Noa and Aiden's wedding.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { BackupFile } from '../src/domain/backup/schema'
import type { LayoutSummary, VenueImageInfo } from '../src/shared/api'
import { makePlanPng } from './fixtures/floorplan-png'
import {
  apiAddGuests,
  apiCreateGroup,
  apiLinkPartners,
  apiListGroups,
  apiListGuests,
  apiSeatGuests,
  download,
  expectHydrated,
  guestEntries,
  guestsPath,
  shownNames,
  waitForGuestList,
} from './guest-list'
import {
  apiAddTables,
  apiCreateLayout,
  apiCreateWedding,
  apiGetLayout,
  canvasTables,
  editorPath,
  signIn,
  uniqueName,
} from './helpers'
import { apiCreateVenue, apiGetVenue, apiSaveVenue, wallItem } from './venues'

/** The guest ids seated in a layout, in drawing order. */
function seatedIds(canvas: { items: readonly { kind: string; seats?: readonly { guestId: string | null }[] }[] }): string[] {
  return canvas.items.flatMap((item) => (item.kind === 'table' ? (item.seats ?? []).flatMap((s) => (s.guestId ? [s.guestId] : [])) : []))
}

test('download a backup and restore it as a new wedding with its guests and layouts', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  await signIn(page)
  const request = page.request

  // A wedding with three guests (two partners), a group, a venue with a floor plan image, and two layouts.
  const name = uniqueName('Backup wedding', testInfo)
  const wedding = await apiCreateWedding(request, name)
  const last = `Backup${randomBytes(3).toString('hex')}`
  const guests = await apiAddGuests(request, wedding.id, [
    { firstName: 'Mira', lastName: last, side: 'partner2' },
    { firstName: 'Theo', lastName: last, side: 'partner1' },
    { firstName: 'Lena', lastName: last },
  ])
  await apiLinkPartners(request, guests[0]!.id, guests[1]!.id)
  await apiCreateGroup(request, wedding.id, 'Cousins', [guests[1]!.id, guests[2]!.id])

  const venue = await apiCreateVenue(request, uniqueName('Backup venue', testInfo))
  const upload = await request.post(`/api/venues/${venue.id}/images`, { data: makePlanPng(), headers: { 'content-type': 'application/octet-stream' } })
  expect(upload.status(), await upload.text()).toBe(201)
  const image = (await upload.json()) as VenueImageInfo
  const accepted = await request.post(`/api/venues/${venue.id}/accept-import`, {
    data: {
      baseVersion: venue.version,
      saveId: randomUUID(),
      editedBy: 'Noa',
      fixedItems: [wallItem({ x: 0, y: 0 }, { x: 1200, y: 0 })],
      imageId: image.id,
      reference: { scaleCmPerPx: 1.5, offsetX: 0, offsetY: 0, rotation: 0, opacity: 0.5 },
      importedBy: 'ai',
    },
  })
  expect(accepted.status(), await accepted.text()).toBe(200)

  const reception = await apiCreateLayout(request, wedding.id, { name: 'Reception', venueTemplateId: venue.id })
  await apiAddTables(request, reception, 1)
  await apiSeatGuests(request, await apiGetLayout(request, reception.id), [guests.map((g) => g.id)])
  await apiCreateLayout(request, wedding.id, { name: 'Dinner', venueTemplateId: null })

  // Download backup, from the wedding's settings.
  await page.goto(`/w/${wedding.id}/layouts`)
  const settingsButton = page.getByRole('button', { name: 'Settings' })
  await expectHydrated(settingsButton)
  await settingsButton.click()
  const settings = page.getByRole('dialog', { name: 'Wedding settings' })
  const filePath = testInfo.outputPath('backup.json')
  const saved = await download(page, settings.getByRole('link', { name: 'Download backup' }), filePath)
  expect(saved.name).toMatch(new RegExp(`^${name} backup \\d{4}-\\d{2}-\\d{2}\\.json$`))
  const file = JSON.parse(saved.bytes.toString('utf8')) as BackupFile
  // Version 2: the partners' names, sides as codes, and the members (read only).
  expect(file).toMatchObject({ format: 'seat-plan-backup', version: 2, wedding: { name, partner1Name: 'Noa', partner2Name: 'Aiden' } })
  expect(Array.isArray(file.members)).toBe(true)
  expect(file.guests.map((g) => g.firstName).sort()).toEqual(['Lena', 'Mira', 'Theo'])
  expect(Object.fromEntries(file.guests.map((g) => [g.firstName, g.side]))).toEqual({ Mira: 'partner2', Theo: 'partner1', Lena: 'both' })
  expect(file.layouts.map((l) => l.name).sort()).toEqual(['Dinner', 'Reception'])
  expect(file.templates.map((t) => t.name)).toEqual([venue.name])
  expect(file.images.map((i) => i.sha256)).toEqual([image.sha256])

  // The venue's walls change after the backup, so the restore cannot reuse it.
  await apiSaveVenue(request, await apiGetVenue(request, venue.id), [wallItem({ x: 0, y: 0 }, { x: 900, y: 0 })])

  // Restore from file, on the home screen.
  await page.goto('/')
  const input = page.getByTestId('restore-file')
  await expectHydrated(input)
  await input.setInputFiles(filePath)
  const dialog = page.getByRole('dialog', { name: 'Restore from file' })
  await expect(dialog).toContainText(`${name} with 3 guests, 2 layouts and 0 rules.`)
  await dialog.getByRole('button', { name: 'Restore' }).click()
  await expect(dialog.getByRole('status')).toHaveText(`Restored as ${name} (restored).`, { timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Open wedding' }).click()

  // The new wedding, with both layouts.
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/layouts$/)
  const restoredId = new URL(page.url()).pathname.split('/')[2]!
  expect(restoredId).not.toBe(wedding.id)
  await expect(page.getByTestId('wedding-title')).toHaveText(`${name} (restored)`)
  await expect(page.getByTestId('layout-card')).toHaveCount(2)
  expect((await page.getByTestId('layout-name').allInnerTexts()).sort()).toEqual(['Dinner', 'Reception'])

  // Its guests, under new ids, with the partner link and the group.
  const restoredGuests = await apiListGuests(request, restoredId)
  expect(restoredGuests.map((g) => g.firstName).sort()).toEqual(['Lena', 'Mira', 'Theo'])
  const byFirst = new Map(restoredGuests.map((g) => [g.firstName, g]))
  for (const g of restoredGuests) expect(guests.map((old) => old.id)).not.toContain(g.id)
  expect(byFirst.get('Mira')!.partnerId).toBe(byFirst.get('Theo')!.id)
  expect(byFirst.get('Theo')!.partnerId).toBe(byFirst.get('Mira')!.id)
  expect(restoredGuests.map((g) => [g.firstName, g.side]).sort()).toEqual([['Lena', 'both'], ['Mira', 'partner2'], ['Theo', 'partner1']])
  expect(await (await request.get(`/api/weddings/${restoredId}`)).json()).toMatchObject({ partner1Name: 'Noa', partner2Name: 'Aiden' })
  const [group] = await apiListGroups(request, restoredId)
  expect(group).toMatchObject({ name: 'Cousins' })
  expect([...group!.memberIds].sort()).toEqual([byFirst.get('Theo')!.id, byFirst.get('Lena')!.id].sort())

  await page.goto(guestsPath(restoredId))
  await waitForGuestList(page)
  await expect(guestEntries(page)).toHaveCount(3)
  expect((await shownNames(page, restoredGuests)).sort()).toEqual([`Lena ${last}`, `Mira ${last}`, `Theo ${last}`])

  // The restored Reception seats the restored guests, on a copy of the venue with its floor plan image.
  const listed = (await (await request.get(`/api/weddings/${restoredId}/layouts`)).json()) as LayoutSummary[]
  const restoredReception = await apiGetLayout(request, listed.find((l) => l.name === 'Reception')!.id)
  expect(seatedIds(restoredReception.canvas)).toEqual(['Mira', 'Theo', 'Lena'].map((first) => byFirst.get(first)!.id))
  expect(restoredReception.venueTemplateId).not.toBe(venue.id)
  const copy = await apiGetVenue(request, restoredReception.venueTemplateId!)
  expect(copy.name).toBe(`${venue.name} (restored)`)
  expect(copy.fixedItems).toHaveLength(1)
  expect(copy.referenceImage?.sha256).toBe(image.sha256)

  await page.goto(editorPath(restoredId, restoredReception.id))
  await expect(canvasTables(page)).toHaveCount(1)

  // The original wedding is as it was.
  expect((await apiListGuests(request, wedding.id)).map((g) => g.id).sort()).toEqual(guests.map((g) => g.id).sort())

  // A version 1 file, from before partner names, restores as Noa and Aiden's wedding with sides by place.
  const words = { partner1: 'Noa', partner2: 'Aiden', both: 'Both' } as const
  const { id, date, unit, minGapCm } = file.wedding
  const v1: Record<string, unknown> = {
    ...file,
    version: 1,
    wedding: { id, name: file.wedding.name, date, unit, minGapCm },
    guests: file.guests.map((g) => ({ ...g, side: words[g.side] })),
  }
  delete v1.members
  const v1Path = testInfo.outputPath('backup-v1.json')
  writeFileSync(v1Path, JSON.stringify(v1))
  await page.goto('/')
  await expectHydrated(input)
  await input.setInputFiles(v1Path)
  const again = page.getByRole('dialog', { name: 'Restore from file' })
  await again.getByRole('button', { name: 'Restore' }).click()
  await expect(again.getByRole('status')).toHaveText(`Restored as ${name} (restored).`, { timeout: 15_000 })
  await again.getByRole('button', { name: 'Open wedding' }).click()
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/layouts$/)
  const fromV1 = new URL(page.url()).pathname.split('/')[2]!
  expect(fromV1).not.toBe(restoredId)
  expect(await (await request.get(`/api/weddings/${fromV1}`)).json()).toMatchObject({ partner1Name: 'Noa', partner2Name: 'Aiden' })
  expect((await apiListGuests(request, fromV1)).map((g) => [g.firstName, g.side]).sort()).toEqual([['Lena', 'both'], ['Mira', 'partner2'], ['Theo', 'partner1']])
  await page.goto(guestsPath(fromV1))
  await waitForGuestList(page)
  await expect(page.getByTestId('filter-side').locator('option')).toHaveText(['Any side', 'Noa', 'Aiden', 'Both'])
})
