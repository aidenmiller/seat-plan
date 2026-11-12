/**
 * Stored backups, in the browser: an owner's "Saved backups" in the wedding
 * settings (Back up now, the list, Download, Restore as a new wedding), the
 * admin's Backups page (status, runs, every backup, Run now), and who may see
 * them. The backup store is a folder (playwright.config.ts, BACKUP_STORE_DIR).
 */
import { randomBytes } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import type { BackupFile } from '../src/domain/backup/schema'
import type { BackupNowReply } from '../src/shared/backups-api'
import type { LayoutSummary } from '../src/shared/api'
import { dbAddMember } from './db'
import { apiAddGuests, apiListGuests, apiSeatGuests, download, expectHydrated } from './guest-list'
import { apiAddTables, apiCreateLayout, apiCreateWedding, apiGetLayout, E2E_USERS, signIn, uniqueName } from './helpers'

/** The page's own width never exceeds the window's: lists scroll inside their own boxes. */
async function expectNoSidewaysScroll(page: Page) {
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }))
  expect(widths.page).toBeLessThanOrEqual(widths.view)
}

test('an owner backs up now, sees the backup, downloads it, and restores it as a new wedding', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await signIn(page, 'b')
  const request = page.request

  // A wedding with three guests, two of them seated at a table.
  const name = uniqueName('Stored backup', testInfo)
  const wedding = await apiCreateWedding(request, name)
  const last = `Stored${randomBytes(3).toString('hex')}`
  const guests = await apiAddGuests(request, wedding.id, [
    { firstName: 'Mira', lastName: last },
    { firstName: 'Theo', lastName: last },
    { firstName: 'Lena', lastName: last },
  ])
  const layout = await apiCreateLayout(request, wedding.id, { name: 'Reception', venueTemplateId: null })
  await apiAddTables(request, layout, 1)
  await apiSeatGuests(request, await apiGetLayout(request, layout.id), [[guests[0]!.id, guests[1]!.id]])

  // Settings, then the saved backups: none yet.
  await page.goto(`/w/${wedding.id}/layouts`)
  const settingsButton = page.getByRole('button', { name: 'Settings' })
  await expectHydrated(settingsButton)
  await settingsButton.click()
  const settings = page.getByRole('dialog', { name: 'Wedding settings' })
  await expect(settings.getByText('Backed up every night when something changed. Kept for 30 days, then one a month for a year.')).toBeVisible()
  await settings.getByRole('button', { name: 'Show saved backups' }).click()
  await expect(settings.getByTestId('no-backups')).toHaveText('No backups yet. The first one is made tonight.')

  // Back up now: the new backup appears.
  await settings.getByRole('button', { name: 'Back up now' }).click()
  await expect(settings.getByTestId('backup-now-result')).toHaveText('Backed up.')
  const rows = settings.getByTestId('backup-row')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Made by hand')
  await expect(rows.first()).toContainText('3 guests, 1 layout')

  // A second one straight away is turned down.
  await settings.getByRole('button', { name: 'Back up now' }).click()
  await expect(settings.getByTestId('backup-now-result')).toHaveText('This wedding was already backed up in the last few minutes.')
  await expect(rows).toHaveCount(1)
  await expectNoSidewaysScroll(page)

  // Download gives a normal backup file.
  const saved = await download(page, rows.first().getByRole('link', { name: 'Download' }), testInfo.outputPath('stored.json'))
  expect(saved.name).toMatch(new RegExp(`^${name} backup \\d{4}-\\d{2}-\\d{2}\\.json$`))
  const file = JSON.parse(saved.bytes.toString('utf8')) as BackupFile
  expect(file).toMatchObject({ format: 'seat-plan-backup', wedding: { name } })
  expect(file.guests).toHaveLength(3)

  // Restore as a new wedding: it says what it does, then opens the new wedding.
  await rows.first().getByRole('button', { name: 'Restore as a new wedding' }).click()
  const confirm = page.getByRole('dialog', { name: 'Restore as a new wedding' })
  await expect(confirm).toContainText('It changes nothing in any existing wedding.')
  await confirm.getByRole('button', { name: 'Restore as a new wedding' }).click()
  await expect(confirm.getByTestId('restore-done')).toContainText(`Restored as ${name} (restored).`, { timeout: 30_000 })
  await confirm.getByRole('link', { name: 'Open the restored wedding' }).click()

  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/layouts$/)
  await expect(page).not.toHaveURL(new RegExp(wedding.id))
  const restoredId = new URL(page.url()).pathname.split('/')[2]!
  expect(restoredId).not.toBe(wedding.id)
  await expect(page.getByTestId('wedding-title')).toHaveText(`${name} (restored)`)
  const restoredGuests = await apiListGuests(request, restoredId)
  expect(restoredGuests.map((g) => g.firstName).sort()).toEqual(['Lena', 'Mira', 'Theo'])
  const layoutsRes = await request.get(`/api/weddings/${restoredId}/layouts`)
  const restoredLayouts = (await layoutsRes.json()) as LayoutSummary[]
  expect(restoredLayouts.map((l) => l.name)).toEqual(['Reception'])
  const restored = await apiGetLayout(request, restoredLayouts[0]!.id)
  const seated = restored.canvas.items.flatMap((item) => (item.kind === 'table' ? item.seats.flatMap((s) => (s.guestId ? [s.guestId] : [])) : []))
  expect(seated).toHaveLength(2)
  for (const id of seated) expect(restoredGuests.map((g) => g.id)).toContain(id)
})

test('the admin sees the backup and the run, and Run now completes', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await signIn(page, 'a')
  const name = uniqueName('Admin backup', testInfo)
  const wedding = await apiCreateWedding(page.request, name)
  await apiAddGuests(page.request, wedding.id, [{ firstName: 'Ola', lastName: 'Admin' }])
  const made = await page.request.post(`/api/weddings/${wedding.id}/backups`)
  expect(made.status(), await made.text()).toBe(201)
  const { backup } = (await made.json()) as BackupNowReply

  await page.goto('/admin/backups')
  await expect(page.getByRole('heading', { name: 'Backups', level: 2 })).toBeVisible()
  await expect(page.getByTestId('backup-configured')).toContainText('Set up')
  await expect(page.getByTestId('backup-storage')).toBeVisible()
  // The run that made it is listed.
  await expect(page.getByTestId('backup-runs').getByText('Back up now by Avery').first()).toBeVisible()

  // The wedding's backup, picked from the filter.
  await page.getByLabel('Show backups of').selectOption({ label: name })
  const row = page.getByTestId('backups').getByTestId('backup-row')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Made by hand')
  await expect(row.getByRole('link', { name: /^Download/ })).toHaveAttribute('href', `/api/admin/backups/${backup.id}`)
  await expect(row.getByRole('button', { name: 'Restore as a new wedding' })).toBeVisible()
  await expectNoSidewaysScroll(page)

  // Run now finishes, and the run is added to the list.
  const before = await page.getByTestId('backup-run').count()
  await page.getByRole('button', { name: 'Run now' }).click()
  await expect(page.getByTestId('run-result')).toContainText(/^The run /, { timeout: 150_000 })
  await expect(page.getByTestId('backup-run')).toHaveCount(before + 1)
  await expect(page.getByTestId('backup-runs').getByText('Run now by Avery').first()).toBeVisible()
  // Run now is not the nightly schedule, so a run of the cron that never happened is still warned about.
  await expect(page.getByTestId('backup-banner')).toContainText('The nightly backup has never run. Check the schedule in Vercel.')
})

test('a planner who is not an admin gets Not found, and an editor does not see saved backups', async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000)
  await signIn(page, 'b', '/admin/backups')
  await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible()

  // Blake's wedding, with Casey as an editor.
  const wedding = await apiCreateWedding(page.request, uniqueName('Editor backup', testInfo))
  await dbAddMember(wedding.id, E2E_USERS.c.email, 'editor')
  const context = await browser.newContext(testInfo.project.use)
  try {
    const editor = await context.newPage()
    await signIn(editor, 'c')
    await editor.goto(`/w/${wedding.id}/layouts`)
    await expect(editor.getByTestId('wedding-title')).toHaveText(wedding.name)
    await expect(editor.getByRole('button', { name: 'Settings' })).toHaveCount(0)
    await expect(editor.getByTestId('saved-backups')).toHaveCount(0)
    // The route is the owner's too.
    const res = await editor.request.get(`/api/weddings/${wedding.id}/backups`)
    expect(res.status()).toBeGreaterThanOrEqual(403)
    expect(res.status()).toBeLessThanOrEqual(404)
  } finally {
    await context.close()
  }
})
