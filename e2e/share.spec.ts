/**
 * Acceptance check 21: a venue share link made with the editor's Share
 * button asks for its own password in a fresh browser (signed out). A
 * wrong password is refused; the right one opens that one layout in View mode
 * and nothing else. A new password signs the viewer out, and so does turning
 * the link off in the Links tab.
 *
 * The viewer (PLAN change 24, section 7 "Share view"): the plan with tables
 * and names, search that pans to a seat, a seat card with name, meal and
 * child flag only, no edit controls; "Table names only" hides every name,
 * from the page and from the data; notes show only when the link shows
 * them; ceremony layouts show their chair rows; and an open viewer shows the
 * password page within 60 seconds of the link being turned off, with no
 * focus or reload (the page's clock is moved on instead of waiting).
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { emptyCanvas, type Canvas, type Item, type Table } from '../src/domain/canvas-schema'
import { DEFAULT_RIGHT_LABEL, generateSeatingBlock } from '../src/domain/ceremony'
import { makeNote } from '../src/domain/notes'
import { makeItem } from '../src/domain/presets'
import { SHARE_RECHECK_MS } from '../src/domain/share-view'
import type { ShareLink, ShareView } from '../src/shared/api'
import { itemLocator, itemTransforms, LAPTOP, mouseDrag, PHONE, settledCamera, tableClientCenter, Touch, viewport, type Point } from './canvas'
import { apiAddGuests, apiSeatGuests, expectHydrated } from './guest-list'
import { apiAddTables, apiCreateLayout, apiCreateWedding, apiGetLayout, apiPutCanvas, editorPath, signIn, uniqueName } from './helpers'
import { detailLevel, seatOnScreen } from './seating'

/** A note author: the signed-in user's name and account id. */
const NOA = { name: 'Noa', id: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a' }

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

  // A planner's session (here an admin's) opens the link too, and that does not count as the venue opening it.
  await page.goto(path)
  await expect(page.getByTestId('share-layout-name')).toHaveText(shared.name)
  await page.goto(`/w/${wedding.id}/links`)
  const card = page.getByTestId('share-link')
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('Caterer')
  await expect(card).toContainText(shared.name)
  await expect(card).toContainText('Not opened yet')

  // A fresh, signed-out browser gets the link's password page, and its data stays closed.
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
    await expect(view.getByTestId('share-wedding-name')).toHaveText(wedding.name)
    await expect(view.getByTestId('share-viewer')).toHaveAttribute('data-mode', 'view')

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
    expect(shareView.guests.map((g) => `${g.firstName} ${g.lastName}`)).toEqual([`${guest!.firstName} ${guest!.lastName}`])
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

    // Even a planner's session no longer opens it.
    await page.goto(path)
    await expectPasswordPage(page)
  } finally {
    await viewer.close()
  }
})

// ---------- The viewer ----------

/** A signed-out browser, set up as this project's device. */
async function venueBrowser(browser: Browser, testInfo: TestInfo): Promise<BrowserContext> {
  return browser.newContext(testInfo.project.name === 'phone' ? PHONE : LAPTOP)
}

const isPhone = (testInfo: TestInfo) => testInfo.project.name === 'phone'

/** Makes a link through the API, with a password made up for this run. */
async function apiMakeLink(
  request: APIRequestContext,
  layoutId: string,
  options: { showNames?: boolean; showNotes?: boolean } = {},
): Promise<{ link: ShareLink; password: string }> {
  const password = madeUpPassword()
  const res = await request.post(`/api/layouts/${layoutId}/share-links`, { data: { id: randomUUID(), label: 'Venue', password, ...options } })
  expect(res.status(), await res.text()).toBe(201)
  return { link: (await res.json()) as ShareLink, password }
}

async function apiChangeLink(request: APIRequestContext, linkId: string, body: Record<string, unknown>): Promise<void> {
  const res = await request.patch(`/api/share-links/${linkId}`, { data: body })
  expect(res.status(), await res.text()).toBe(200)
}

/** Opens the link in `view` and signs in with its password; waits for the plan. */
async function openViewer(view: Page, path: string, password: string): Promise<void> {
  await view.goto(path)
  await expectPasswordPage(view)
  await typeSharePassword(view, password)
  await expect(view.getByTestId('share-viewer')).toBeVisible()
  await expect(view.getByTestId('canvas')).toBeVisible()
  await settledCamera(view)
}

/** A round table at `at` holding `guests` from seat 1 on. */
function roundTable(canvas: Canvas, at: Point, guests: (string | null)[]): Table {
  const t = makeItem('round', at, randomUUID(), canvas) as Table
  return { ...t, seats: t.seats.map((seat) => ({ ...seat, guestId: guests[seat.index] ?? null })) }
}

/** The seat's center lies in the canvas, near its middle across. */
async function expectSeatInView(view: Page, tableId: string, seatIndex: number): Promise<void> {
  const seat = await seatOnScreen(view, tableId, seatIndex)
  const vp = (await viewport(view).boundingBox())!
  expect(seat.x).toBeGreaterThan(vp.x + 40)
  expect(seat.x).toBeLessThan(vp.x + vp.width - 40)
  expect(seat.y).toBeGreaterThan(vp.y + 40)
  expect(seat.y).toBeLessThan(vp.y + vp.height - 40)
  expect(Math.abs(seat.x - (vp.x + vp.width / 2))).toBeLessThan(40)
}

/** Shows a seat's card the way this device would: a tap on a phone, a resting mouse on a laptop. */
async function showSeatCard(view: Page, tableId: string, seatIndex: number, phone: boolean) {
  const seat = await seatOnScreen(view, tableId, seatIndex)
  if (phone) await (await Touch.on(view)).tap(seat)
  else {
    await view.mouse.move(seat.x - 30, seat.y - 30)
    await view.mouse.move(seat.x, seat.y, { steps: 3 })
  }
  const card = view.getByTestId('share-seat-card')
  await expect(card).toBeVisible()
  return card
}

test('the share viewer shows the plan and names, finds a guest, and follows the link’s names and notes switches', async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000)
  const phone = isPhone(testInfo)
  await signIn(page)
  const request = page.request
  const tag = randomBytes(3).toString('hex')
  const wedding = await apiCreateWedding(request, uniqueName('Viewer wedding', testInfo))
  const layout = await apiCreateLayout(request, wedding.id, { name: uniqueName('Dinner plan', testInfo) })
  const guestNote = `Guest note ${tag}`
  const [jane, ann, bo] = await apiAddGuests(request, wedding.id, [
    { firstName: 'Jane', lastName: `Doe${tag}`, meal: 'Fish', notes: guestNote },
    { firstName: 'Ann', lastName: `Lee${tag}`, meal: 'Pasta', isChild: true },
    { firstName: 'Bo', lastName: `Ray${tag}`, meal: 'Beef' },
  ])
  let canvas: Canvas = { ...emptyCanvas(), items: [] }
  const t1 = roundTable(canvas, { x: 0, y: 0 }, [bo!.id])
  canvas = { ...canvas, items: [t1 as Item] }
  const t2 = roundTable(canvas, { x: 3000, y: 1800 }, [null, null, null, null, jane!.id, ann!.id])
  const noteText = `Keep Uncle Bob away from the bar ${tag}`
  const note = { ...makeNote('sticky', { x: 1500, y: -400 }, NOA, 'yellow', Date.now(), randomUUID()), text: noteText }
  canvas = { ...canvas, items: [t1 as Item, t2 as Item, note] }
  await apiPutCanvas(request, layout, canvas)
  const saved = await apiGetLayout(request, layout.id)
  const { link, password } = await apiMakeLink(request, layout.id, { showNames: true, showNotes: false })

  const viewer = await venueBrowser(browser, testInfo)
  try {
    const view = await viewer.newPage()
    await openViewer(view, link.path, password)

    // The top bar: the layout's and the wedding's names, and the search.
    await expect(view.getByTestId('share-layout-name')).toHaveText(layout.name)
    await expect(view.getByTestId('share-wedding-name')).toHaveText(wedding.name)
    await expect(view.getByTestId('share-search')).toBeVisible()

    // Both tables, with their taken and empty seats; the note stays out (notes are off).
    await expect(view.getByTestId('canvas').locator('[data-kind="table"]')).toHaveCount(2)
    await expect(itemLocator(view, t2.id).locator('circle[data-seat-index="4"]')).toHaveAttribute('data-seat-state', 'taken')
    await expect(itemLocator(view, t2.id).locator('circle[data-seat-index="0"]')).toHaveAttribute('data-seat-state', 'empty')
    await expect(view.getByTestId('canvas').locator('[data-kind="note"]')).toHaveCount(0)
    expect(await view.content()).not.toContain(noteText)

    // Nothing that edits, and nothing else from the app: no shapes, mode switch, panels, Problems, links or zoom-only + and −.
    for (const id of ['shape-panel', 'open-shapes', 'mode-switch', 'share-button', 'right-panel', 'bottom-sheet', 'save-status', 'canvas-toolbar']) {
      await expect(view.getByTestId(id)).toHaveCount(0)
    }
    await expect(view.getByText('Problems')).toHaveCount(0)
    await expect(view.locator('a[href]')).toHaveCount(0)
    await expect(view.getByRole('button', { name: 'Fit to content' })).toBeVisible()

    // A drag on a table pans the view and moves nothing; a tap shows no handles or seat buttons.
    const before = await itemTransforms(view)
    const camera = await settledCamera(view)
    const start = await tableClientCenter(view, t1.id, camera)
    if (phone) await (await Touch.on(view)).drag(start, { x: start.x + 90, y: start.y + 70 }, { steps: 12 })
    else await mouseDrag(view, start, { x: start.x + 90, y: start.y + 70 })
    const panned = await settledCamera(view)
    expect(panned.x).toBeCloseTo(camera.x + 90, 1)
    expect(panned.y).toBeCloseTo(camera.y + 70, 1)
    expect(await itemTransforms(view)).toEqual(before)
    const center = await tableClientCenter(view, t1.id, panned)
    if (phone) await (await Touch.on(view)).tap(center)
    else await view.mouse.click(center.x, center.y)
    await expect(view.locator('[data-handle]')).toHaveCount(0)
    await expect(view.locator('[data-overlay-control]')).toHaveCount(0)
    if (!phone) await view.keyboard.press('Delete')
    await expect(view.getByTestId('canvas').locator('[data-kind="table"]')).toHaveCount(2)

    // Typing part of a name pans to that guest's seat, which pulses; the names around it show.
    await view.getByTestId('share-search').fill('jan')
    const result = view.getByTestId('share-search-result')
    await expect(result).toHaveCount(1)
    await expect(result).toHaveText(`Jane Doe${tag}`)
    if (phone) await result.tap()
    else await result.click()
    await expect(itemLocator(view, t2.id).locator('[data-seat-pulse]')).toHaveCount(1)
    await settledCamera(view)
    expect(await detailLevel(view)).toBe('close')
    await expectSeatInView(view, t2.id, 4)
    const names = view.locator(`[data-names-for="${t2.id}"]`)
    await expect(names.locator('[data-name-for="4"]')).toHaveText(new RegExp(`^Jane( Doe${tag}| D\\.)$`))
    await expect(names.locator('[data-name-for="5"]')).toHaveText(new RegExp(`^Ann( Lee${tag}| L\\.)$`))

    // A seat's card: name, meal and child flag, never the guest's notes.
    const card = await showSeatCard(view, t2.id, 5, phone)
    await expect(card).toContainText(`Ann Lee${tag}`)
    await expect(card).toContainText('Pasta')
    await expect(card).toContainText('Child')
    const janeCard = await showSeatCard(view, t2.id, 4, phone)
    await expect(janeCard).toContainText(`Jane Doe${tag}`)
    await expect(janeCard).toContainText('Fish')
    await expect(janeCard).not.toContainText('Child')
    expect(await view.content()).not.toContain(guestNote)

    // Table names only, and notes on: the open page follows when it regains focus.
    await apiChangeLink(request, link.id, { showNames: false, showNotes: true })
    await view.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(view.getByTestId('share-search')).toHaveCount(0)
    await expect(view.getByTestId('canvas').locator('[data-kind="note"]')).toHaveCount(1)
    await expect(view.getByTestId('canvas').locator('[data-kind="note"]')).toContainText('Uncle')
    expect(await detailLevel(view)).toBe('close')
    await expect(itemLocator(view, t2.id).locator('circle[data-seat-index="4"]')).toHaveAttribute('data-seat-state', 'taken')
    await expect(view.locator('[data-guest-name]')).toHaveCount(0)
    await expect(view.locator('[data-seat-initials]')).toHaveCount(0)
    // What the page draws (the first server reply, from when names were on, stays in its script tags).
    const drawnPlan = await view.getByTestId('share-viewer').evaluate((el) => el.outerHTML)
    for (const g of [jane!, ann!, bo!]) expect(drawnPlan).not.toContain(g.lastName)
    const nameless = await showSeatCard(view, t2.id, 4, phone)
    await expect(nameless).toContainText('Fish')
    await expect(nameless).not.toContainText('Jane')

    // The data itself holds no names, and still no guest notes.
    const data = await viewer.request.get(`${link.path}/data`)
    expect(data.status()).toBe(200)
    const body = await data.text()
    for (const g of [jane!, ann!, bo!]) {
      expect(body).not.toContain(g.lastName)
      expect(body).not.toContain(g.id)
    }
    expect(body).not.toContain('Jane')
    expect(body).not.toContain('Ann')
    expect(body).not.toContain('"firstName"')
    expect(body).not.toContain('"lastName"')
    expect(body).not.toContain(guestNote)
    expect(body).toContain(noteText)
    const shared = JSON.parse(body) as ShareView
    expect(shared.guests).toHaveLength(3)
    expect(shared.guests.every((g) => g.firstName === undefined && g.lastName === undefined)).toBe(true)

    // Looking never changed the plan.
    expect((await apiGetLayout(request, layout.id)).version).toBe(saved.version)
  } finally {
    await viewer.close()
  }
})

test('a ceremony share shows its chair rows, and an open viewer sees the password page within 60 seconds of the link being turned off', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(90_000)
  await signIn(page)
  const request = page.request
  const tag = randomBytes(3).toString('hex')
  const wedding = await apiCreateWedding(request, uniqueName('Ceremony share', testInfo))
  const layout = await apiCreateLayout(request, wedding.id, { name: uniqueName('Vows', testInfo), kind: 'ceremony' })
  const [cy] = await apiAddGuests(request, wedding.id, [{ firstName: 'Cyrille', lastName: `Okafor${tag}`, meal: 'Veg' }])
  const rows = generateSeatingBlock({ rows: 2, chairsPerRow: 4, origin: { x: 0, y: 0 } }, () => randomUUID()).map((row) =>
    row.blockLabel !== DEFAULT_RIGHT_LABEL
      ? row
      : row.rowNumber === 1
        ? { ...row, reservedFor: 'Family, row 1' }
        : { ...row, seats: row.seats.map((seat) => (seat.index === 2 ? { ...seat, guestId: cy!.id } : seat)) },
  )
  const seatedRow = rows.find((r) => r.seats.some((s) => s.guestId === cy!.id))!
  await apiPutCanvas(request, layout, { ...emptyCanvas(), items: rows })
  const { link, password } = await apiMakeLink(request, layout.id)

  const viewer = await venueBrowser(browser, testInfo)
  try {
    // The page's clock runs as usual until the test moves it on.
    await viewer.clock.install()
    const view = await viewer.newPage()
    await openViewer(view, link.path, password)

    // The chair rows as the editor draws them, with the reserved row's label and the seated guest.
    await expect(view.getByTestId('canvas').locator('[data-kind="chairRow"]')).toHaveCount(4)
    await expect(view.getByTestId('canvas').locator('[data-reserved-label]')).toHaveText('Family, row 1')
    await expect(itemLocator(view, seatedRow.id).locator('[data-seat-index="2"]')).toHaveAttribute('data-seat-state', 'taken')
    await view.getByTestId('share-search').fill('cyr')
    await expect(itemLocator(view, seatedRow.id).locator('[data-seat-pulse]')).toHaveCount(1)
    await settledCamera(view)
    await expect(view.locator(`[data-names-for="${seatedRow.id}"] [data-name-for="2"]`)).toHaveText(new RegExp(`^Cyrille( Okafor${tag}| O\\.)$`))

    // Turned off in the app: the open page has no focus or reload to tell it.
    await apiChangeLink(request, link.id, { enabled: false })
    await expect(view.getByTestId('share-viewer')).toBeVisible()
    await view.clock.fastForward(SHARE_RECHECK_MS)
    await expectPasswordPage(view)
    await expect(view.getByTestId('share-viewer')).toHaveCount(0)
    await expect(view.getByTestId('canvas')).toHaveCount(0)
    expect(await view.locator('body').innerText()).not.toContain(cy!.lastName)
  } finally {
    await viewer.close()
  }
})
