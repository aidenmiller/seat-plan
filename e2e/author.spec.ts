/**
 * The Noa / Aiden switch (PLAN change 27, DECISIONS 20): the first visit on a
 * device asks who is using it; the choice shows in the top bar, is kept on
 * the device, and every save carries it into "Edited ... by" on the layouts
 * list.
 */
import { expect, test, type Page } from '@playwright/test'
import { addControl, setMode } from './canvas'
import { addRoundTable, apiCreateLayout, apiCreateWedding, expectSaved, signIn, uniqueName, waitForEditor } from './helpers'

function authorSwitch(page: Page) {
  return page.getByRole('group', { name: 'Who is using this device' })
}

async function expectAuthor(page: Page, author: 'Noa' | 'Aiden') {
  const other = author === 'Noa' ? 'Aiden' : 'Noa'
  await expect(authorSwitch(page).getByRole('button', { name: author })).toHaveAttribute('aria-pressed', 'true')
  await expect(authorSwitch(page).getByRole('button', { name: other })).toHaveAttribute('aria-pressed', 'false')
}

test('the first visit asks who is using the device, and saves carry that name', async ({ page }, testInfo) => {
  await signIn(page)
  const prompt = page.getByRole('dialog', { name: 'Who is using this device?' })
  await expect(prompt).toBeVisible()
  await expect(authorSwitch(page).getByRole('button', { name: 'Noa' })).toHaveAttribute('aria-pressed', 'false')
  await expect(authorSwitch(page).getByRole('button', { name: 'Aiden' })).toHaveAttribute('aria-pressed', 'false')

  await prompt.getByRole('button', { name: 'Aiden' }).click()
  await expect(prompt).toBeHidden()
  await expectAuthor(page, 'Aiden')

  // Kept on this device: no question after a reload.
  await page.reload()
  await expectAuthor(page, 'Aiden')
  await expect(prompt).toBeHidden()

  // A layout last saved by Noa.
  const wedding = await apiCreateWedding(page.request, uniqueName('Author', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan', editedBy: 'Noa' })
  await page.goto(`/w/${wedding.id}/layouts`)
  const card = page.locator(`[data-layout-id="${layout.id}"]`)
  const edited = card.getByTestId('layout-edited')
  await expect(edited).toHaveText('Edited just now by Noa')

  // Aiden saves: the editor's top bar shows Aiden, and so does the list.
  await card.getByRole('link', { name: 'Open Plan' }).click()
  await waitForEditor(page)
  await expectAuthor(page, 'Aiden')
  await addRoundTable(page)
  await expectSaved(page)
  await page.getByRole('link', { name: 'Back to layouts' }).click()
  await expect(edited).toHaveText('Edited just now by Aiden')

  // Switch to Noa in the top bar; the next save carries Noa.
  await authorSwitch(page).getByRole('button', { name: 'Noa' }).click()
  await expectAuthor(page, 'Noa')
  await card.getByRole('link', { name: 'Open Plan' }).click()
  await waitForEditor(page)
  await expectAuthor(page, 'Noa')
  await addRoundTable(page)
  await expectSaved(page)
  await page.getByRole('link', { name: 'Back to layouts' }).click()
  await expect(edited).toHaveText('Edited just now by Noa')

  const stored = (await (await page.request.get(`/api/layouts/${layout.id}`)).json()) as { editedBy: string; version: number }
  expect(stored).toMatchObject({ editedBy: 'Noa', version: 3 })
})

test('until someone is picked, the editor waits and says why', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('No author', testInfo))
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan', editedBy: 'Noa' })
  await page.goto(`/w/${wedding.id}/layouts/${layout.id}`)

  const prompt = page.getByRole('dialog', { name: 'Who is using this device?' })
  await expect(prompt).toBeVisible()
  await expect(page.getByText('Pick Noa or Aiden to start editing.')).toBeVisible()
  // Phones open in View; in Edit the add control stays off until someone is picked.
  await setMode(page, 'edit')
  await expect(addControl(page)).toBeDisabled()

  await prompt.getByRole('button', { name: 'Noa' }).click()
  await expect(prompt).toBeHidden()
  await waitForEditor(page)
  await expectAuthor(page, 'Noa')
  await expect(page.getByText('Pick Noa or Aiden to start editing.')).toBeHidden()
})
