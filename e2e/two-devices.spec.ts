/**
 * Acceptance check 3: Noa adds a table on her laptop; Aiden reloads on his
 * phone and sees it.
 *
 * Each project plays its own device with its own page and opens the other
 * device in a second browser context with that device's settings, so the
 * laptop is always 1440 px with a mouse and the phone always 390 px with
 * touch. The phone looks in View mode (its default) and never edits.
 */
import { expect, test } from '@playwright/test'
import { editorMode, LAPTOP, PHONE } from './canvas'
import {
  E2E_USERS,
  addRoundTable,
  apiCreateLayout,
  apiCreateWedding,
  apiGetLayout,
  canvasTables,
  editorPath,
  expectSaved,
  signIn,
  tableIds,
  uniqueName,
  waitForEditor,
} from './helpers'

test('Noa adds a table on her laptop; Aiden reloads on his phone and sees it', async ({ browser, page }, testInfo) => {
  const onPhone = testInfo.project.name === 'phone'
  const otherContext = await browser.newContext(onPhone ? LAPTOP : PHONE)
  try {
    const otherPage = await otherContext.newPage()
    const laptop = onPhone ? otherPage : page
    const phone = onPhone ? page : otherPage
    await signIn(laptop)
    await signIn(phone)

    const wedding = await apiCreateWedding(laptop.request, uniqueName('Two devices', testInfo))
    const layout = await apiCreateLayout(laptop.request, wedding.id, { name: 'Plan' })

    // Aiden has the empty layout open on his phone.
    await phone.goto(editorPath(wedding.id, layout.id))
    expect(await editorMode(phone)).toBe('view')
    await expect(phone.getByTestId('canvas')).toHaveAttribute('aria-label', 'Floor plan with 0 tables')
    await expect(canvasTables(phone)).toHaveCount(0)

    // Noa adds a table on her laptop and sees Saved.
    await laptop.goto(editorPath(wedding.id, layout.id))
    expect(await editorMode(laptop)).toBe('edit')
    await waitForEditor(laptop)
    await expectSaved(laptop)
    await addRoundTable(laptop)
    await expect(canvasTables(laptop)).toHaveCount(1)
    await expectSaved(laptop)
    const ids = await tableIds(laptop)

    const stored = await apiGetLayout(laptop.request, layout.id)
    expect(stored.version).toBe(layout.version + 1)
    // Both devices are signed in as the same planner, who is the editor.
    expect(stored.editedBy).toBe(E2E_USERS.a.displayName)
    expect(stored.canvas.items.map((item) => item.id)).toEqual(ids)

    // Aiden reloads: the table is there, on screen, and his phone is still in View.
    await phone.reload()
    await expect(canvasTables(phone)).toHaveCount(1)
    expect(await tableIds(phone)).toEqual(ids)
    await expect(phone.getByTestId('canvas')).toHaveAttribute('aria-label', 'Floor plan with 1 table')
    expect(await editorMode(phone)).toBe('view')
    const table = await canvasTables(phone).first().boundingBox()
    const screen = await phone.getByTestId('editor-viewport').boundingBox()
    expect(table && screen).toBeTruthy()
    const center = { x: table!.x + table!.width / 2, y: table!.y + table!.height / 2 }
    expect(center.x).toBeGreaterThan(screen!.x)
    expect(center.x).toBeLessThan(screen!.x + screen!.width)
    expect(center.y).toBeGreaterThan(screen!.y)
    expect(center.y).toBeLessThan(screen!.y + screen!.height)
  } finally {
    await otherContext.close()
  }
})
