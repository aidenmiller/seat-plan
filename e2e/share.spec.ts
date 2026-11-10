/**
 * Acceptance check 21, its server-side parts (the plan viewer comes later):
 * a venue share link made with the editor's Share button asks for its own
 * password in a fresh browser (no site cookie). A wrong password is refused;
 * the right one opens that one layout and nothing else. A new password signs
 * the viewer out, and so does turning the link off in the Links tab.
 */
import { randomBytes } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import type { ShareView } from '../src/shared/api'
import { LAPTOP, PHONE } from './canvas'
import { apiAddGuests, apiSeatGuests, expectHydrated } from './guest-list'
import { apiAddTables, apiCreateLayout, apiCreateWedding, apiGetLayout, editorPath, presetAuthor, signIn, uniqueName } from './helpers'

test.beforeEach(async ({ context }) => {
  await presetAuthor(context, 'Noa')
})

const WRONG = 'That password is wrong, or the link was turned off.'

/** A password made up for this run. */
function madeUpPassword(): string {
  return `link-${randomBytes(6).toString('hex')}`
}

/** The password page's error line (Next's route announcer is an alert too). */
function shareError(view: Page) {
  return view.locator('#share-login-error')
}

/** Waits for the share link's password page. */
async function expectPasswordPage(view: Page): Promise<void> {
  await expect(view.getByLabel('Password')).toBeVisible()
  await expect(view.getByTestId('share-layout-name')).toHaveCount(0)
}

/** Types a password on the share link's password page. */
async function typeSharePassword(view: Page, password: string): Promise<void> {
  const field = view.getByLabel('Password')
  await expectHydrated(field)
  await field.fill(password)
  await view.getByRole('button', { name: 'Open plan' }).click()
}

test('a share link opens one layout with its own password; a new password or turning it off signs the viewer out', async ({
  page,
  browser,
}, testInfo) => {
  await signIn(page)
  const request = page.request

  // A wedding with two layouts; a guest with a private note sits in the one to share.
  const wedding = await apiCreateWedding(request, uniqueName('Share wedding', testInfo))
  const shared = await apiCreateLayout(request, wedding.id, { name: uniqueName('Reception plan', testInfo) })
  const other = await apiCreateLayout(request, wedding.id, { name: uniqueName('Other plan', testInfo) })
  const note = `Private note ${randomBytes(3).toString('hex')}`
  const [guest] = await apiAddGuests(request, wedding.id, [{ firstName: 'Ava', lastName: `Share${randomBytes(3).toString('hex')}`, notes: note }])
  await apiAddTables(request, shared, 1)
  await apiSeatGuests(request, await apiGetLayout(request, shared.id), [[guest!.id]])

  // Make the link with the editor's Share button.
  await page.goto(editorPath(wedding.id, shared.id))
  const shareButton = page.getByTestId('share-button')
  await expectHydrated(shareButton)
  await shareButton.click()
  const dialog = page.getByRole('dialog', { name: 'Share this layout' })
  await dialog.getByLabel('Who is it for (optional)').fill('Caterer')
  await dialog.getByLabel('Link password').fill('short')
  await dialog.getByRole('button', { name: 'Make link' }).click()
  await expect(dialog.getByText('Use at least 6 characters.')).toBeVisible()
  const password = madeUpPassword()
  await dialog.getByLabel('Link password').fill(password)
  await dialog.getByRole('button', { name: 'Make link' }).click()
  const urlBox = dialog.getByTestId('share-url')
  await expect(urlBox).toHaveValue(/\/share\/[A-Za-z0-9_-]{43}$/)
  const url = await urlBox.inputValue()
  const path = new URL(url).pathname
  await dialog.getByRole('button', { name: 'Done' }).click()

  // The site cookie opens the link too, and that does not count as the venue opening it.
  await page.goto(path)
  await expect(page.getByTestId('share-layout-name')).toHaveText(shared.name)
  await page.goto(`/w/${wedding.id}/links`)
  const card = page.getByTestId('share-link')
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('Caterer')
  await expect(card).toContainText(shared.name)
  await expect(card).toContainText('Not opened yet')

  // A fresh browser with no site cookie gets the link's password page, and its data stays closed.
  const viewer = await browser.newContext(testInfo.project.name === 'phone' ? PHONE : LAPTOP)
  try {
    const view = await viewer.newPage()
    await view.goto(url)
    await expectPasswordPage(view)
    expect((await viewer.request.get(`${path}/data`)).status()).toBe(401)

    // A wrong password is refused.
    await typeSharePassword(view, madeUpPassword())
    await expect(shareError(view)).toHaveText(WRONG)
    await expectPasswordPage(view)

    // The right one opens the layout, view only.
    await typeSharePassword(view, password)
    await expect(view.getByTestId('share-layout-name')).toHaveText(shared.name)
    await expect(view.getByText('Seating plan, view only')).toBeVisible()

    // It offers nothing else: no links, no other layout, no guest notes, and the rest of the site stays shut.
    await expect(view.locator('a[href]')).toHaveCount(0)
    const html = await view.content()
    expect(html).not.toContain(other.name)
    expect(html).not.toContain(note)
    const data = await viewer.request.get(`${path}/data`)
    expect(data.status()).toBe(200)
    const body = await data.text()
    expect(body).not.toContain(other.name)
    expect(body).not.toContain(note)
    expect(body).not.toContain(guest!.id)
    const shareView = JSON.parse(body) as ShareView
    expect(shareView).toMatchObject({ layoutName: shared.name, showNames: true, showNotes: false })
    expect(shareView.guests.map((g) => g.name)).toEqual([`${guest!.firstName} ${guest!.lastName}`])
    expect((await viewer.request.get(`/api/layouts/${other.id}`)).status()).toBe(401)
    expect((await viewer.request.get(`/api/weddings/${wedding.id}/layouts`)).status()).toBe(401)
    await view.goto(`/w/${wedding.id}/layouts/${other.id}`)
    await expect(view).toHaveURL(/\/login/)
    await view.goto(url)
    await expect(view.getByTestId('share-layout-name')).toHaveText(shared.name)

    // The Links tab now says the link was opened.
    await page.reload()
    await expect(card).toContainText('Last opened')

    // A new password signs the viewer out: the open page shows the password page when it regains focus.
    await card.getByRole('button', { name: 'Change password' }).click()
    const change = page.getByRole('dialog', { name: 'Change link password' })
    const newPassword = madeUpPassword()
    await change.getByLabel('New password').fill(newPassword)
    await change.getByRole('button', { name: 'Save password' }).click()
    await expect(change).toBeHidden()
    await view.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expectPasswordPage(view)
    await view.reload()
    await expectPasswordPage(view)
    await typeSharePassword(view, password)
    await expect(shareError(view)).toHaveText(WRONG)
    await typeSharePassword(view, newPassword)
    await expect(view.getByTestId('share-layout-name')).toHaveText(shared.name)

    // Turning the link off signs the viewer out too, and leaves the Links list.
    await card.getByRole('button', { name: 'Turn off' }).click()
    const off = page.getByRole('dialog', { name: 'Turn off this link?' })
    await off.getByRole('button', { name: 'Turn off' }).click()
    await expect(card).toHaveCount(0)
    await expect(page.getByText('No share links yet.')).toBeVisible()
    await view.reload()
    await expectPasswordPage(view)
    expect((await viewer.request.get(`${path}/data`)).status()).toBe(401)
    await typeSharePassword(view, newPassword)
    await expect(shareError(view)).toHaveText(WRONG)
    await expectPasswordPage(view)

    // Even the site cookie no longer opens it.
    await page.goto(path)
    await expectPasswordPage(page)
  } finally {
    await viewer.close()
  }
})
