/**
 * Wedding members end to end, on the People tab: an owner changes someone's
 * role; a removed member gets the Not found page; the only owner cannot
 * leave, while an editor can.
 *
 * Memberships are set straight in the database (e2e/db.ts): Blake (B) owns
 * each wedding and Casey (C) edits it.
 */
import { expect, test, type Page } from '@playwright/test'
import { newDevice } from './accounts'
import { dbAddMember, dbCreateWedding } from './db'
import { E2E_USERS, signIn, uniqueName } from './helpers'

async function weddingOfBlakeAndCasey(name: string): Promise<string> {
  const weddingId = await dbCreateWedding(name)
  await dbAddMember(weddingId, E2E_USERS.b.email, 'owner')
  await dbAddMember(weddingId, E2E_USERS.c.email, 'editor')
  return weddingId
}

function memberRow(page: Page, name: string) {
  return page.getByTestId('member').filter({ hasText: name })
}

test('an owner makes an editor an owner, and back', async ({ page }, testInfo) => {
  const weddingId = await weddingOfBlakeAndCasey(uniqueName('Roles', testInfo))
  await signIn(page, 'b', `/w/${weddingId}/people`)
  const role = memberRow(page, 'Casey').getByLabel('Role of Casey')
  await expect(role).toHaveValue('editor')

  const saved = page.waitForResponse((res) => res.request().method() === 'PATCH' && res.url().includes(`/members/`))
  await role.selectOption('owner')
  expect((await saved).status()).toBe(200)
  await page.reload()
  await expect(role).toHaveValue('owner')

  await role.selectOption('editor')
  await expect(role).toHaveValue('editor')
  await page.reload()
  await expect(role).toHaveValue('editor')
})

test('a removed member gets the Not found page', async ({ page, browser }, testInfo) => {
  const name = uniqueName('Removed', testInfo)
  const weddingId = await weddingOfBlakeAndCasey(name)
  const casey = await newDevice(browser)
  try {
    await signIn(casey.page, 'c', `/w/${weddingId}/layouts`)
    await expect(casey.page.getByTestId('wedding-title')).toHaveText(name)

    await signIn(page, 'b', `/w/${weddingId}/people`)
    await memberRow(page, 'Casey').getByRole('button', { name: 'Remove Casey' }).click()
    const confirm = page.getByRole('dialog', { name: 'Remove Casey?' })
    await confirm.getByRole('button', { name: 'Remove' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(memberRow(page, 'Casey')).toHaveCount(0)

    await casey.page.reload()
    await expect(casey.page.getByRole('heading', { name: 'Not found' })).toBeVisible()
    await expect(casey.page.getByTestId('wedding-title')).toHaveCount(0)
  } finally {
    await casey.context.close()
  }
})

test('the only owner cannot leave, and an editor can', async ({ page, browser }, testInfo) => {
  const name = uniqueName('Leaving', testInfo)
  const weddingId = await weddingOfBlakeAndCasey(name)
  await signIn(page, 'b', `/w/${weddingId}/people`)
  await expect(page.getByTestId('leave-blocked')).toHaveText('You are the only owner. Make someone else an owner before you leave.')
  await expect(page.getByRole('button', { name: 'Leave this wedding' })).toBeDisabled()

  const casey = await newDevice(browser)
  try {
    await signIn(casey.page, 'c', `/w/${weddingId}/people`)
    await expect(casey.page.getByLabel('Role of Blake')).toHaveCount(0)
    await casey.page.getByRole('button', { name: 'Leave this wedding' }).click()
    const confirm = casey.page.getByRole('dialog', { name: 'Leave this wedding?' })
    await confirm.getByRole('button', { name: 'Leave' }).click()
    await expect(casey.page).toHaveURL(/\/$/)
    await expect(casey.page.getByRole('heading', { name: 'Weddings' })).toBeVisible()
    await expect(casey.page.getByTestId('wedding-card').filter({ hasText: name })).toHaveCount(0)
  } finally {
    await casey.context.close()
  }

  await page.reload()
  await expect(memberRow(page, 'Casey')).toHaveCount(0)
})
