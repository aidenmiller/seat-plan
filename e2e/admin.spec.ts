/**
 * The admin pages end to end, as Avery (A, the run's admin): a reset link
 * sets a new password and signs out the account's old sessions; turning an
 * account off sends its open page to sign in on its next request; a new
 * planner signs up through a planner invite. Each test uses accounts of its
 * own (e2e/accounts.ts). Anyone else gets the Not found page.
 */
import { expect, test, type Page } from '@playwright/test'
import { madeUpPassword, newAccount, newDevice, readOneTimeLink, signInWith, uniqueEmail } from './accounts'
import { dbClearAttemptCounts } from './db'
import { signIn } from './helpers'

test.beforeEach(async () => {
  await dbClearAttemptCounts()
})

function userRow(page: Page, email: string) {
  return page.getByTestId('admin-user').filter({ hasText: email })
}

test('only an admin sees the admin pages', async ({ page }) => {
  await signIn(page, 'b', '/admin/users')
  await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible()
  await page.goto('/admin/weddings')
  await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible()
})

test('the admin pages never scroll sideways as a whole: their tables scroll in their own box', async ({ page }) => {
  await signIn(page, 'a', '/admin/users')
  for (const path of ['/admin/users', '/admin/weddings']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible()
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }))
    expect(widths.page, path).toBeLessThanOrEqual(widths.view)
  }
})

test('a reset link sets a new password and signs out the old sessions', async ({ page, browser }) => {
  const account = await newAccount('Forgetful')
  const theirs = await newDevice(browser)
  const fresh = await newDevice(browser)
  try {
    await signInWith(theirs.page, account.email, account.password)

    await signIn(page, 'a', '/admin/users')
    await userRow(page, account.email).getByRole('button', { name: 'Reset link' }).click()
    const dialog = page.getByRole('dialog', { name: `Reset link for ${account.displayName}` })
    await dialog.getByRole('button', { name: 'Make reset link' }).click()
    const link = await readOneTimeLink(page)
    expect(new URL(link).pathname).toBe('/reset')
    await expect(dialog.getByText('it works once and expires in 24 hours')).toBeVisible()
    await dialog.getByRole('button', { name: 'Done' }).click()

    await fresh.page.goto(link)
    await expect(fresh.page.getByRole('heading', { name: 'Set a new password' })).toBeVisible()
    await expect(fresh.page.getByText(`For ${account.displayName} (${account.email}).`)).toBeVisible()
    const next = madeUpPassword()
    await fresh.page.getByLabel('New password', { exact: true }).fill(next)
    await fresh.page.getByLabel('Confirm new password').fill(next)
    await fresh.page.getByRole('button', { name: 'Set password' }).click()
    await expect(fresh.page.getByRole('heading', { name: 'Your password is set' })).toBeVisible()
    // The used link is gone from the address bar.
    await expect(fresh.page).toHaveURL(/\/reset$/)

    // Their old session is over.
    await theirs.page.reload()
    await expect(theirs.page).toHaveURL(/\/login/)

    // The new password works.
    await fresh.page.getByRole('link', { name: 'Sign in' }).click()
    await fresh.page.getByLabel('Email').fill(account.email)
    await fresh.page.getByLabel('Password').fill(next)
    await fresh.page.getByRole('button', { name: 'Sign in' }).click()
    await expect(fresh.page.getByRole('heading', { name: 'Weddings' })).toBeVisible()

    // The link works once.
    await theirs.page.goto(link)
    await expect(theirs.page.getByRole('heading', { name: 'This reset link cannot be used' })).toBeVisible()
  } finally {
    await theirs.context.close()
    await fresh.context.close()
  }
})

test('turning an account off sends its open page to sign in on its next request', async ({ page, browser }) => {
  const account = await newAccount('Leaver')
  const theirs = await newDevice(browser)
  try {
    await signInWith(theirs.page, account.email, account.password)
    await expect(theirs.page.getByRole('heading', { name: 'Weddings' })).toBeVisible()

    await signIn(page, 'a', '/admin/users')
    const row = userRow(page, account.email)
    await expect(row.getByTestId('admin-user-status')).toHaveText('Active')
    await row.getByRole('button', { name: 'Turn off' }).click()
    const confirm = page.getByRole('dialog', { name: /Turn off .* account\?/ })
    await confirm.getByRole('button', { name: 'Turn off' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(row.getByTestId('admin-user-status')).toHaveText('Turned off')

    await theirs.page.reload()
    await expect(theirs.page).toHaveURL(/\/login/)
    // And it cannot sign in again until it is turned back on.
    await theirs.page.getByLabel('Email').fill(account.email)
    await theirs.page.getByLabel('Password').fill(account.password)
    await theirs.page.getByRole('button', { name: 'Sign in' }).click()
    await expect(theirs.page.locator('#login-error')).toHaveText('That email or password is wrong. Try again.')

    await row.getByRole('button', { name: 'Turn on' }).click()
    await expect(row.getByTestId('admin-user-status')).toHaveText('Active')
    await theirs.page.getByLabel('Password').fill(account.password)
    await theirs.page.getByRole('button', { name: 'Sign in' }).click()
    await expect(theirs.page.getByRole('heading', { name: 'Weddings' })).toBeVisible()
  } finally {
    await theirs.context.close()
  }
})

test('a new planner signs up through a planner invite', async ({ page, browser }) => {
  await signIn(page, 'a', '/admin/users')
  await page.getByRole('button', { name: 'Invite a new planner' }).click()
  const form = page.getByRole('dialog', { name: 'Invite a new planner' })
  await expect(form.getByRole('radio')).toHaveCount(0)
  await form.getByRole('button', { name: 'Make invite link' }).click()
  const link = await readOneTimeLink(page)
  await page.getByRole('dialog', { name: 'Invite link' }).getByRole('button', { name: 'Done' }).click()
  const waiting = page.getByTestId('pending-invite')
  await expect(waiting.first()).toContainText('Planner invite')
  const before = await waiting.count()

  const planner = await newDevice(browser)
  const email = uniqueEmail('planner')
  try {
    await planner.page.goto(link)
    // "Make your account" since the signed-out pages dropped the old name; a name in it still passes.
    await expect(planner.page.getByRole('heading', { name: /^Make your (.+ )?account$/ })).toBeVisible()
    await expect(planner.page.getByTestId('invite-intro')).toContainText('Avery invited you to plan weddings')
    const password = madeUpPassword()
    await planner.page.getByLabel('Email').fill(email)
    await planner.page.getByLabel('Your name').fill('Piper')
    await planner.page.getByLabel('Password', { exact: true }).fill(password)
    await planner.page.getByLabel('Confirm password').fill(password)
    await planner.page.getByRole('button', { name: 'Create account' }).click()
    await expect(planner.page).toHaveURL(/\/$/)
    await expect(planner.page.getByRole('heading', { name: 'Weddings' })).toBeVisible()
  } finally {
    await planner.context.close()
  }

  await page.reload()
  await expect(userRow(page, email)).toContainText('Piper')
  await expect(page.getByTestId('pending-invite')).toHaveCount(before - 1)
})
