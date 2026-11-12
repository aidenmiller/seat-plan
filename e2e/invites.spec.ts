/**
 * Invite links end to end: an owner makes one on the People tab, someone on
 * another device makes an account through it and lands in the wedding as an
 * editor. The link then works for nobody else, and a cancelled link is
 * refused. The token travels only in the address's #fragment and in request
 * bodies, never in an address the browser asks for.
 *
 * Memberships are set straight in the database (e2e/db.ts), so the specs do
 * not depend on who creating a wedding makes its owner.
 */
import { expect, test } from '@playwright/test'
import { madeUpPassword, newDevice, readOneTimeLink, uniqueEmail } from './accounts'
import { dbAddMember, dbClearAttemptCounts, dbCreateWedding } from './db'
import { E2E_USERS, signIn, uniqueName, userPassword } from './helpers'

test.beforeEach(async () => {
  await dbClearAttemptCounts()
})

/** A wedding Blake (account B) owns, opened on its People tab. */
async function ownersPeopleTab(page: import('@playwright/test').Page, name: string): Promise<string> {
  const weddingId = await dbCreateWedding(name)
  await dbAddMember(weddingId, E2E_USERS.b.email, 'owner')
  await signIn(page, 'b', `/w/${weddingId}/people`)
  await expect(page.getByRole('heading', { name: 'People', level: 2 })).toBeVisible()
  return weddingId
}

/** Makes an editor invite on the People tab and returns its link. */
async function makeEditorInvite(page: import('@playwright/test').Page): Promise<string> {
  await page.getByRole('button', { name: 'Invite someone' }).click()
  const form = page.getByRole('dialog', { name: 'Invite someone' })
  await expect(form.getByRole('radio', { name: /Editor/ })).toBeChecked()
  await form.getByRole('button', { name: 'Make invite link' }).click()
  const shown = page.getByRole('dialog', { name: 'Invite link' })
  await expect(shown.getByText('Send this link yourself; it works once and expires in 7 days.')).toBeVisible()
  const link = await readOneTimeLink(page)
  await shown.getByRole('button', { name: 'Done' }).click()
  await expect(shown).toHaveCount(0)
  return link
}

test('an owner invites someone, who makes an account through the link and lands in the wedding as an editor', async ({ page, browser }, testInfo) => {
  const name = uniqueName('Invited', testInfo)
  const weddingId = await ownersPeopleTab(page, name)
  const link = await makeEditorInvite(page)
  const url = new URL(link)
  expect(url.pathname).toBe('/invite')
  expect(url.search).toBe('')
  const token = url.hash.slice(1)
  await expect(page.getByTestId('pending-invite')).toHaveCount(1)
  await expect(page.getByTestId('pending-invite')).toContainText('For anyone with the link')

  const guest = await newDevice(browser)
  try {
    await guest.page.goto(link)
    const asked: string[] = []
    guest.page.on('request', (req) => asked.push(req.url()))
    await expect(guest.page.getByRole('heading', { name: `Join ${name}` })).toBeVisible()
    await expect(guest.page.getByTestId('invite-intro')).toHaveText(`Blake invited you to ${name} as an editor.`)

    const password = madeUpPassword()
    await guest.page.getByLabel('Email').fill(uniqueEmail('nova'))
    await guest.page.getByLabel('Your name').fill('Nova')
    await guest.page.getByLabel('Password', { exact: true }).fill(password)
    await guest.page.getByLabel('Confirm password').fill(password)
    await guest.page.getByRole('button', { name: 'Create account' }).click()

    await expect(guest.page).toHaveURL(new RegExp(`/w/${weddingId}/layouts$`))
    await expect(guest.page.getByTestId('wedding-title')).toHaveText(name)
    await guest.page.getByRole('navigation', { name: 'Wedding' }).getByRole('link', { name: 'People' }).click()
    const me = guest.page.getByTestId('member').filter({ hasText: '(you)' })
    await expect(me).toContainText('Nova')
    await expect(me.getByTestId('member-role')).toHaveText('Editor')
    await expect(guest.page.getByTestId('people-owners-only')).toBeVisible()
    // The token went to the server only inside request bodies.
    expect(asked.length).toBeGreaterThan(0)
    for (const address of asked) expect(address).not.toContain(token)
  } finally {
    await guest.context.close()
  }

  // The owner sees the new member, and the invite is no longer waiting.
  await page.reload()
  await expect(page.getByTestId('member').filter({ hasText: 'Nova' }).getByLabel('Role of Nova')).toHaveValue('editor')
  await expect(page.getByTestId('pending-invite')).toHaveCount(0)

  // Used once, it works for nobody else.
  const late = await newDevice(browser)
  try {
    await late.page.goto(link)
    await expect(late.page.getByRole('heading', { name: 'This invite cannot be used' })).toBeVisible()
    await expect(late.page.getByText('This invite has already been used.')).toBeVisible()
    await expect(late.page.getByRole('button', { name: 'Create account' })).toHaveCount(0)
  } finally {
    await late.context.close()
  }
})

test('a cancelled invite link is refused', async ({ page, browser }, testInfo) => {
  await ownersPeopleTab(page, uniqueName('Cancelled', testInfo))
  const link = await makeEditorInvite(page)
  const waiting = page.getByTestId('pending-invite')
  await waiting.getByRole('button', { name: 'Cancel invite' }).click()
  const confirm = page.getByRole('dialog', { name: 'Cancel this invite?' })
  await confirm.getByRole('button', { name: 'Cancel invite' }).click()
  await expect(confirm).toHaveCount(0)
  await expect(waiting).toHaveCount(0)
  await expect(page.getByText('No invites waiting.')).toBeVisible()

  const guest = await newDevice(browser)
  try {
    await guest.page.goto(link)
    await expect(guest.page.getByRole('heading', { name: 'This invite cannot be used' })).toBeVisible()
    await expect(guest.page.getByText('This invite was cancelled.')).toBeVisible()
    await expect(guest.page.getByRole('button', { name: 'Create account' })).toHaveCount(0)
  } finally {
    await guest.context.close()
  }
})

test('someone with an account signs in on the invite page, stays on it, and accepts', async ({ page, browser }, testInfo) => {
  const name = uniqueName('Signed in there', testInfo)
  const weddingId = await ownersPeopleTab(page, name)
  const link = await makeEditorInvite(page)

  const casey = await newDevice(browser)
  try {
    await casey.page.goto(link)
    await expect(casey.page.getByRole('heading', { name: `Join ${name}` })).toBeVisible()
    await casey.page.getByRole('button', { name: 'I already have an account' }).click()
    const form = casey.page.getByTestId('invite-sign-in')
    await form.getByLabel('Email').fill(E2E_USERS.c.email)
    await form.getByLabel('Password').fill(userPassword('c'))
    await form.getByRole('button', { name: 'Sign in' }).click()
    // Back on the same invite, now signed in.
    await expect(casey.page.getByTestId('invite-signed-in')).toContainText('You are signed in as Casey')
    expect(new URL(casey.page.url()).pathname).toBe('/invite')
    await casey.page.getByRole('button', { name: 'Accept invite' }).click()
    await expect(casey.page).toHaveURL(new RegExp(`/w/${weddingId}/layouts$`))
    await expect(casey.page.getByTestId('wedding-title')).toHaveText(name)
  } finally {
    await casey.context.close()
  }
})

test('a signed-in planner accepts an invite with one button', async ({ page, browser }, testInfo) => {
  const name = uniqueName('Accepted', testInfo)
  const weddingId = await ownersPeopleTab(page, name)
  const link = await makeEditorInvite(page)

  const casey = await newDevice(browser)
  try {
    await signIn(casey.page, 'c')
    await casey.page.goto(link)
    await expect(casey.page.getByTestId('invite-signed-in')).toContainText(`You are signed in as Casey (${E2E_USERS.c.email}).`)
    await casey.page.getByRole('button', { name: 'Accept invite' }).click()
    await expect(casey.page).toHaveURL(new RegExp(`/w/${weddingId}/layouts$`))
    await expect(casey.page.getByTestId('wedding-title')).toHaveText(name)
  } finally {
    await casey.context.close()
  }
})
