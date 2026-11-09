/**
 * Acceptance check 17: the red Delete button stays disabled until `delete` is
 * typed, in lower case, exactly; deleting one layout leaves the others as they
 * were; deleting a wedding removes its card.
 */
import { expect, test, type Locator } from '@playwright/test'
import {
  apiAddTables,
  apiCreateLayout,
  apiCreateWedding,
  apiGetLayout,
  canvasTables,
  expectSaved,
  presetAuthor,
  signIn,
  uniqueName,
  waitForEditor,
} from './helpers'

test.beforeEach(async ({ context }) => {
  await presetAuthor(context, 'Noa')
})

/** Types near misses into the box and checks Delete never wakes up, then types the word. */
async function confirmDelete(dialog: Locator): Promise<Locator> {
  const box = dialog.getByLabel('Type delete to confirm')
  const button = dialog.getByRole('button', { name: 'Delete', exact: true })
  await expect(box).toHaveAttribute('autocapitalize', 'none')
  await expect(button).toBeDisabled()
  for (const nearMiss of ['Delete', 'DELETE', 'delet', 'delete ', ' delete', 'deletee']) {
    await box.fill(nearMiss)
    await expect(button).toBeDisabled()
  }
  // Enter in the box does not get round the button either.
  await box.press('Enter')
  await expect(dialog).toBeVisible()
  await box.fill('')
  await box.pressSequentially('delete')
  await expect(button).toBeEnabled()
  return button
}

test('Delete waits for "delete", and deleting a layout leaves the other layouts as they were', async ({ page }, testInfo) => {
  await signIn(page)
  const wedding = await apiCreateWedding(page.request, uniqueName('Delete layouts', testInfo))
  const plans = [
    { name: 'Plan one', tables: 1 },
    { name: 'Plan two', tables: 2 },
    { name: 'Plan three', tables: 3 },
  ]
  const ids: string[] = []
  for (const plan of plans) {
    const layout = await apiCreateLayout(page.request, wedding.id, { name: plan.name })
    await apiAddTables(page.request, layout, plan.tables)
    ids.push(layout.id)
  }
  const before = await Promise.all(ids.map((id) => apiGetLayout(page.request, id)))

  await page.goto(`/w/${wedding.id}/layouts`)
  const cards = page.getByTestId('layout-card')
  await expect(cards).toHaveCount(3)

  // Cancel leaves the layout alone, even with the word typed.
  const one = page.locator(`[data-layout-id="${ids[0]}"]`)
  await one.getByRole('button', { name: 'Delete Plan one' }).click()
  let dialog = page.getByTestId('delete-dialog')
  await expect(dialog.getByRole('heading', { name: 'Delete layout' })).toBeVisible()
  await expect(dialog.getByTestId('delete-summary')).toHaveText(
    "Delete the layout 'Plan one'? This also deletes 1 table. Other layouts stay as they are.",
  )
  await dialog.getByLabel('Type delete to confirm').fill('delete')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(cards).toHaveCount(3)

  // Delete the middle one.
  const two = page.locator(`[data-layout-id="${ids[1]}"]`)
  await two.getByRole('button', { name: 'Delete Plan two' }).click()
  dialog = page.getByTestId('delete-dialog')
  await expect(dialog.getByTestId('delete-summary')).toHaveText(
    "Delete the layout 'Plan two'? This also deletes 2 tables. Other layouts stay as they are.",
  )
  // The box opens empty after the cancelled try.
  await expect(dialog.getByLabel('Type delete to confirm')).toHaveValue('')
  const button = await confirmDelete(dialog)
  await button.click()
  await expect(dialog).toBeHidden()
  await expect(two).toHaveCount(0)
  await expect(cards).toHaveCount(2)
  await page.reload()
  await expect(cards).toHaveCount(2)
  await expect(two).toHaveCount(0)
  expect((await page.request.get(`/api/layouts/${ids[1]}`)).status()).toBe(404)

  // The others keep their names and tables, seen by reopening each one.
  for (const index of [0, 2]) {
    const plan = plans[index]
    const card = page.locator(`[data-layout-id="${ids[index]}"]`)
    await expect(card.getByTestId('layout-name')).toHaveText(plan.name)
    await card.getByRole('link', { name: `Open ${plan.name}` }).click()
    await expect(page.getByTestId('layout-title')).toHaveText(plan.name)
    await waitForEditor(page)
    await expectSaved(page)
    await expect(canvasTables(page)).toHaveCount(plan.tables)
    await page.getByRole('link', { name: 'Back to layouts' }).click()
    await expect(cards).toHaveCount(2)
  }

  // And on the server: same version, canvas and last edit as before.
  for (const index of [0, 2]) {
    const after = await apiGetLayout(page.request, ids[index])
    expect(after.name).toBe(before[index].name)
    expect(after.version).toBe(before[index].version)
    expect(after.updatedAt).toBe(before[index].updatedAt)
    expect(after.canvas).toEqual(before[index].canvas)
  }
})

test('deleting a wedding removes its card and leaves other weddings alone', async ({ page }, testInfo) => {
  await signIn(page)
  const doomedName = uniqueName('Doomed wedding', testInfo)
  const keptName = uniqueName('Kept wedding', testInfo)
  const doomed = await apiCreateWedding(page.request, doomedName)
  const kept = await apiCreateWedding(page.request, keptName)
  const layout = await apiCreateLayout(page.request, doomed.id, { name: 'Only plan' })
  await apiCreateLayout(page.request, kept.id, { name: 'Kept plan' })

  await page.goto('/')
  const doomedCard = page.locator(`[data-testid="wedding-card"][data-wedding-id="${doomed.id}"]`)
  const keptCard = page.locator(`[data-testid="wedding-card"][data-wedding-id="${kept.id}"]`)
  await expect(doomedCard).toContainText('0 guests · 1 layout')
  await expect(keptCard).toBeVisible()

  await doomedCard.getByRole('button', { name: `Delete ${doomedName}` }).click()
  const dialog = page.getByTestId('delete-dialog')
  await expect(dialog.getByRole('heading', { name: 'Delete wedding' })).toBeVisible()
  await expect(dialog.getByTestId('delete-summary')).toHaveText(
    `Delete the wedding '${doomedName}'? This also deletes 1 layout.`,
  )
  const button = await confirmDelete(dialog)
  await button.click()
  await expect(dialog).toBeHidden()
  await expect(doomedCard).toHaveCount(0)
  await expect(keptCard.getByTestId('wedding-name')).toHaveText(keptName)

  await page.reload()
  await expect(keptCard).toBeVisible()
  await expect(doomedCard).toHaveCount(0)

  // Gone everywhere: the API, its layouts and its pages.
  expect((await page.request.get(`/api/weddings/${doomed.id}`)).status()).toBe(404)
  expect((await page.request.get(`/api/layouts/${layout.id}`)).status()).toBe(404)
  const res = await page.goto(`/w/${doomed.id}/layouts`)
  expect(res?.status()).toBe(404)
  expect((await page.request.get(`/api/weddings/${kept.id}`)).status()).toBe(200)
})
