/**
 * The account page end to end: changing your password signs out your other
 * devices on their next request, while this one stays signed in; the old
 * password stops working and the new one works. Each test uses an account of
 * its own (e2e/accounts.ts), so the run's shared accounts keep their passwords.
 */
import { expect, test } from '@playwright/test'
import { madeUpPassword, newAccount, newDevice, signInWith } from './accounts'
import { dbClearAttemptCounts } from './db'
import { presetAuthor } from './helpers'

test.beforeEach(async ({ context }) => {
  await presetAuthor(context, 'Noa')
  await dbClearAttemptCounts()
})

test('changing the password signs out the other device, and this one stays signed in', async ({ page, browser }) => {
  const account = await newAccount('Changer')
  await signInWith(page, account.email, account.password)
  const other = await newDevice(browser)
  try {
    await signInWith(other.page, account.email, account.password)

    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible()
    await expect(page.getByTestId('device')).toHaveCount(2)
    await expect(page.locator('[data-testid="device"][data-current="true"]')).toContainText('This device')

    const next = madeUpPassword()
    await page.getByLabel('Current password').fill(account.password)
    await page.getByLabel('New password', { exact: true }).fill(next)
    await page.getByLabel('Confirm new password').fill(next)
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.getByText('Your password is changed. Every other device is signed out.')).toBeVisible()
    await expect(page.getByTestId('device')).toHaveCount(1)

    // The other device is sent to sign in on its next request.
    await other.page.reload()
    await expect(other.page).toHaveURL(/\/login/)

    // This one is still signed in.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible()

    // The old password no longer works; the new one does.
    await other.page.getByLabel('Email').fill(account.email)
    await other.page.getByLabel('Password').fill(account.password)
    await other.page.getByRole('button', { name: 'Sign in' }).click()
    await expect(other.page.locator('#login-error')).toHaveText('That email or password is wrong. Try again.')
    await other.page.getByLabel('Password').fill(next)
    await other.page.getByRole('button', { name: 'Sign in' }).click()
    await expect(other.page).not.toHaveURL(/\/login/)
  } finally {
    await other.context.close()
  }
})

test('a wrong current password changes nothing', async ({ page }) => {
  const account = await newAccount('Wrong')
  await signInWith(page, account.email, account.password)
  await page.goto('/account')
  const next = madeUpPassword()
  await page.getByLabel('Current password').fill('not my password at all')
  await page.getByLabel('New password', { exact: true }).fill(next)
  await page.getByLabel('Confirm new password').fill(next)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Your current password is wrong. Try again.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible()
})

test('changing your name shows the new name', async ({ page }) => {
  const account = await newAccount('Renamer')
  await signInWith(page, account.email, account.password)
  await page.goto('/account')
  const field = page.getByLabel('Name', { exact: true })
  await expect(field).toHaveValue(account.displayName)
  await field.fill('Renamed Person')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Renamed Person')
})
