/**
 * Cross-user isolation, end to end in a real browser. The integration tests
 * (src/server/auth/isolation.int.test.ts, route-auth.test.ts, page-auth.test.ts)
 * check the same rules route by route against the handlers; this spec checks
 * them through the running app with real sessions.
 *
 * Accounts (e2e/users.ts): B plays the owner (O) and C the outsider (X), so
 * admin power never hides a failure; A, the admin, is used for the admin check
 * only. O makes a wedding with a guest, a group, a rule, a layout with a table,
 * a password-protected share link and a private venue template the layout uses.
 *  1. X sees none of it: not on the home page, on any page (the Not found page)
 *     or in any API reply (404, and no reply holds O's names); O's data is
 *     unchanged afterwards.
 *  2. A share link needs its own password from X and from a signed-out visitor,
 *     and none from O.
 *  3. Making X an editor (straight in the database) takes effect on the next
 *     request: editor calls work, owner-only calls answer 403 and owner-only
 *     controls are hidden; removing X takes it all away again.
 *  4. The admin opens the wedding under an "Admin view" banner and the visit is logged.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { LAPTOP, PHONE } from './canvas'
import { dbAddMember, dbCountActivity, dbRemoveMember, dbUserId } from './db'
import { makePlanPng } from './fixtures/floorplan-png'
import { apiAddGuests, apiCreateGroup, apiListGuests, expectHydrated } from './guest-list'
import { E2E_USERS, apiAddTables, apiCreateLayout, apiCreateWedding, apiGetLayout, editorPath, signInRequest, uniqueName, type Who } from './helpers'
import { API_ROUTES, apiCalls, pagePaths, type ApiCall, type Ids } from './routes'
import { apiCreateVenue, apiGetVenue, apiVenueRevisions } from './venues'
import { USER_HEADER } from '../src/shared/user-header'
import type { ShareLink, StoredRule, VenueImageInfo } from '../src/shared/api'

type World = {
  ids: Ids
  /** What the pages and replies X sees must never hold. */
  secrets: string[]
  weddingName: string
  layoutName: string
  layoutVersion: number
  guestNames: string[]
  guestIds: string[]
  venueName: string
  token: string
  linkPassword: string
}

test.describe.configure({ mode: 'serial' })

let owner: BrowserContext
let outsider: BrowserContext
let outsiderId: string
let world: World
const seen = { pages: 0, routes: 0, editorPages: 0 }

/** A context with this project's device settings, signed in as one of the run's accounts. */
async function signedInContext(browser: Browser, who: Who, phone: boolean): Promise<BrowserContext> {
  const context = await browser.newContext(phone ? PHONE : LAPTOP)
  await signInRequest(context.request, who)
  return context
}

/** The page's text with scripts' data too: the whole HTML the server sent plus what is on screen. */
async function everything(page: Page): Promise<string> {
  return (await page.content()) + (await page.locator('body').innerText())
}

function expectNothingSecret(text: string, what: string, except: string[] = []): void {
  for (const secret of world.secrets) if (!except.includes(secret)) expect(text.includes(secret), `${what} holds "${secret}"`).toBe(false)
}

/** One call as the app's own client would make it: the user header and a content type on a change. */
async function call(request: APIRequestContext, userId: string, { method, path, body }: Pick<ApiCall, 'method' | 'path' | 'body'>) {
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers[USER_HEADER] = userId
  if (typeof body === 'string') headers['content-type'] = 'application/octet-stream'
  else if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await request.fetch(path, { method, headers, data: body as never, maxRedirects: 0 })
  return { status: res.status(), text: await res.text() }
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(120_000)
  const phone = testInfo.project.name === 'phone'
  owner = await signedInContext(browser, 'b', phone)
  outsider = await signedInContext(browser, 'c', phone)
  outsiderId = await dbUserId(E2E_USERS.c.email)

  const request = owner.request
  const weddingName = uniqueName('Iso wedding', testInfo)
  const layoutName = uniqueName('Iso layout', testInfo)
  const venueName = uniqueName('Iso venue', testInfo)
  const tag = randomBytes(3).toString('hex')
  const wedding = await apiCreateWedding(request, weddingName)
  const venue = await apiCreateVenue(request, venueName)
  const layout = await apiCreateLayout(request, wedding.id, { name: layoutName, venueTemplateId: venue.id })
  await apiAddTables(request, layout, 1)
  const guests = await apiAddGuests(request, wedding.id, [
    { firstName: 'Isofirst', lastName: `Isolast${tag}` },
    { firstName: 'Otherfirst', lastName: `Otherlast${tag}` },
  ])
  const group = await apiCreateGroup(request, wedding.id, uniqueName('Iso group', testInfo), [guests[0]!.id])
  const ruleNote = `Iso rule note ${tag}`
  const ruleRes = await request.post(`/api/weddings/${wedding.id}/rules`, {
    data: { kind: 'apart', guestIds: [guests[0]!.id, guests[1]!.id], note: ruleNote },
  })
  expect(ruleRes.status(), await ruleRes.text()).toBe(201)
  const rule = (await ruleRes.json()) as StoredRule
  const upload = await request.post(`/api/venues/${venue.id}/images`, { data: makePlanPng(), headers: { 'content-type': 'application/octet-stream' } })
  expect(upload.status(), await upload.text()).toBe(201)
  const image = (await upload.json()) as VenueImageInfo
  const [revision] = (await apiVenueRevisions(request, venue.id)).revisions
  const linkPassword = `iso-${randomBytes(6).toString('hex')}`
  const linkLabel = `Iso caterer ${tag}`
  const linkRes = await request.post(`/api/layouts/${layout.id}/share-links`, { data: { id: randomUUID(), label: linkLabel, password: linkPassword } })
  expect(linkRes.status(), await linkRes.text()).toBe(201)
  const link = (await linkRes.json()) as ShareLink
  const token = link.path.split('/')[2]!

  world = {
    ids: {
      wedding: wedding.id,
      layout: layout.id,
      guest: guests[0]!.id,
      group: group.id,
      rule: rule.id,
      venue: venue.id,
      image: image.id,
      revision: revision!.id,
      link: link.id,
      job: randomUUID(),
    },
    secrets: [weddingName, layoutName, venueName, guests[0]!.lastName, guests[1]!.lastName, group.name, ruleNote, linkLabel, token, image.sha256],
    weddingName,
    layoutName,
    layoutVersion: (await apiGetLayout(request, layout.id)).version,
    guestNames: guests.map((g) => g.lastName),
    guestIds: guests.map((g) => g.id),
    venueName,
    token,
    linkPassword,
  }
})

test.afterAll(async () => {
  console.log(`isolation walked ${seen.pages} pages, ${seen.editorPages} editor pages and ${seen.routes} API routes as the outsider`)
  await owner?.close()
  await outsider?.close()
})

/** The Not found page the app shows for a wedding, layout or venue the viewer may not open. */
async function expectNotFound(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await expect(page.getByRole('heading', { name: 'Not found' }), path).toBeVisible()
  await expect(page.getByTestId('wedding-title'), path).toHaveCount(0)
  expectNothingSecret(await everything(page), `page ${path}`)
}

/** Everything O has, as O sees it now. */
async function ownerView() {
  const request = owner.request
  const { ids } = world
  const wedding = await (await request.get(`/api/weddings/${ids.wedding}`)).json()
  const guests = await apiListGuests(request, ids.wedding)
  const layout = await apiGetLayout(request, ids.layout)
  const venue = await apiGetVenue(request, ids.venue)
  const links = (await (await request.get(`/api/layouts/${ids.layout}/share-links`)).json()) as ShareLink[]
  const rules = (await (await request.get(`/api/weddings/${ids.wedding}/rules`)).json()) as StoredRule[]
  const groups = (await (await request.get(`/api/weddings/${ids.wedding}/groups`)).json()) as { id: string; name: string; memberIds: string[] }[]
  const weddings = (await (await request.get('/api/weddings')).json()) as { id: string; name: string }[]
  return {
    weddingName: (wedding as { name: string }).name,
    guests: guests.map((g) => [g.id, g.firstName, g.lastName]).sort(),
    layout: [layout.name, layout.version, layout.canvas.items.length],
    venue: [venue.name, venue.version],
    links: links.map((l) => [l.id, l.enabled, l.label]),
    rules: rules.map((r) => [r.id, r.enabled, r.note]),
    groups: groups.map((g) => [g.id, g.name, g.memberIds]),
    weddingNames: weddings.map((w) => w.name).sort(),
  }
}

test('the outsider sees none of the owner’s wedding on any page or route, and nothing changes', async () => {
  test.setTimeout(180_000)
  const { ids } = world
  const before = await ownerView()
  expect(before.layout).toEqual([world.layoutName, world.layoutVersion, 1])

  // The outsider's home page does not list the wedding.
  const page = await outsider.newPage()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Weddings' })).toBeVisible()
  await expect(page.getByTestId('wedding-card').filter({ hasText: world.weddingName })).toHaveCount(0)
  expectNothingSecret(await everything(page), 'the outsider’s home page')

  // Every page, built with the owner's ids, is the Not found page.
  const paths = pagePaths(ids).filter((p) => p !== '/' && !p.endsWith('.csv'))
  expect(paths.length).toBeGreaterThanOrEqual(11)
  for (const path of paths) {
    await expectNotFound(page, path)
    seen.pages++
    if (/\/layouts\/[0-9a-f-]{36}$/.test(path)) seen.editorPages++
  }

  // Every API route, built with the owner's ids, called as the app's client would.
  const hijacks: Record<string, unknown> = {
    'POST /api/weddings': { id: ids.wedding, name: 'Hijack wedding' },
    'POST /api/venues': { id: ids.venue, name: 'Hijack venue' },
    'POST /api/weddings/restore': {
      format: 'seat-plan-backup',
      version: 2,
      jobId: randomUUID(),
      wedding: { id: ids.wedding, name: 'Hijack restore', date: null, unit: 'ft', minGapCm: 152.4, partner1Name: null, partner2Name: null },
      guests: [],
      groups: [],
      groupMembers: [],
      rules: [],
      ruleGuests: [],
    },
  }
  const replies: string[] = []
  for (const route of apiCalls(ids)) {
    const label = `${route.method} ${route.path}`
    if (route.access === 'session') continue // signing the outsider out would end this test's session
    const hijack = hijacks[`${route.method} ${route.template}`]
    const res = await call(outsider.request, outsiderId, hijack === undefined ? route : { ...route, body: hijack })
    replies.push(res.text)
    expectNothingSecret(res.text, `reply to ${label}`)
    if (route.access === 'user') {
      // Routes about the caller, not one wedding: lists hold only the caller's own, and a create with the owner's id is refused.
      if (route.method === 'GET') expect(res.status, label).toBe(200)
      else if (route.template === '/api/weddings/restore') {
        // A restore always makes a new wedding of the caller's own, under a fresh id: it never writes into the owner's.
        expect(res.status, `${label}: ${res.text}`).toBe(201)
        expect((JSON.parse(res.text) as { weddingId: string }).weddingId).not.toBe(ids.wedding)
      } else expect(res.status, `${label}: ${res.text}`).toBeGreaterThanOrEqual(400)
    } else {
      expect(res.status, `${label}: ${res.text}`).toBe(404)
    }
    seen.routes++
  }
  expect(seen.routes).toBeGreaterThanOrEqual(API_ROUTES.length - 1)
  // The share link's data route answers 401 without the link's cookie, for a signed-in non-member too.
  const shareData = await call(outsider.request, outsiderId, { method: 'GET', path: `/share/${world.token}/data` })
  expect(shareData.status).toBe(401)
  expectNothingSecret(shareData.text, 'the share data reply')

  // The owner's data is unchanged, and the owner reloads the wedding with everything in it.
  expect(await ownerView()).toEqual(before)
  const ownerPage = await owner.newPage()
  await ownerPage.goto(`/w/${ids.wedding}/guests`)
  await expect(ownerPage.getByTestId('guest-row').or(ownerPage.getByTestId('guest-card'))).toHaveCount(world.guestIds.length)
  await ownerPage.close()
  await page.close()
})

test('a share link asks the outsider and a signed-out visitor for its password, and not its owner', async ({ browser }, testInfo) => {
  const path = `/share/${world.token}`
  const expectPasswordForm = async (page: Page) => {
    await expect(page.getByTestId('share-password-page')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByTestId('share-layout-name')).toHaveCount(0)
    // The link's own address is in the page the visitor opened, so that part is no secret from them.
    expectNothingSecret(await everything(page), 'the share password page', [world.token])
  }

  const outsiderPage = await outsider.newPage()
  await outsiderPage.goto(path)
  await expectPasswordForm(outsiderPage)
  await outsiderPage.close()

  const ownerPage = await owner.newPage()
  await ownerPage.goto(path)
  await expect(ownerPage.getByTestId('share-layout-name')).toHaveText(world.layoutName)
  await expect(ownerPage.getByLabel('Password')).toHaveCount(0)
  await ownerPage.close()

  const visitor = await browser.newContext(testInfo.project.name === 'phone' ? PHONE : LAPTOP)
  try {
    const page = await visitor.newPage()
    await page.goto(path)
    await expectPasswordForm(page)
    const field = page.getByLabel('Password')
    await expectHydrated(field)
    await field.fill(world.linkPassword)
    await page.getByRole('button', { name: 'Open plan' }).click()
    await expect(page.getByTestId('share-layout-name')).toHaveText(world.layoutName)
  } finally {
    await visitor.close()
  }
})

test('an editor added in the database gets in at once, owner-only things stay closed, and removal shuts it again', async () => {
  test.setTimeout(120_000)
  const { ids } = world
  const before = await ownerView()
  const page = await outsider.newPage()
  const as = (method: ApiCall['method'], path: string, body?: unknown) => call(outsider.request, outsiderId, { method, path, body })

  // Not a member yet.
  expect((await as('GET', `/api/weddings/${ids.wedding}`)).status).toBe(404)

  await dbAddMember(ids.wedding, outsiderId, 'editor')
  try {
    // The home page lists the wedding, with the editor role.
    await page.goto('/')
    const card = page.getByTestId('wedding-card').filter({ hasText: world.weddingName })
    await expect(card).toHaveCount(1)
    await expect(card.getByTestId('wedding-role')).toHaveText('Editor')
    await expect(card.getByRole('button', { name: /^Delete / })).toHaveCount(0)

    // The wedding's pages open.
    for (const path of pagePaths(ids).filter((p) => p.startsWith('/w/'))) {
      const res = await page.goto(path)
      expect(res?.status(), path).toBeLessThan(400)
      await expect(page.getByRole('heading', { name: 'Not found' }), path).toHaveCount(0)
    }
    await page.goto(`/w/${ids.wedding}/layouts/${ids.layout}`)
    await expect(page.getByTestId('canvas')).toBeVisible()
    // The owner-only Share button is not in the editor.
    await expect(page.getByTestId('save-status')).toBeVisible()
    await expect(page.getByTestId('share-button')).toHaveCount(0)
    // The venue the layout uses can be opened (read only).
    await page.goto(`/venues/${ids.venue}?from=${ids.wedding}`)
    await expect(page.getByRole('heading', { name: 'Not found' })).toHaveCount(0)

    // Owner-only controls are not shown: no Settings button, a note on the Links tab.
    await page.goto(`/w/${ids.wedding}/layouts`)
    await expect(page.getByTestId('wedding-title')).toHaveText(world.weddingName)
    await expect(page.getByRole('button', { name: 'Settings' })).toHaveCount(0)
    await page.goto(`/w/${ids.wedding}/links`)
    await expect(page.getByTestId('links-owners-only')).toBeVisible()
    await expect(page.getByTestId('share-link')).toHaveCount(1)
    await expect(page.getByRole('button', { name: /new password|turn off|remove|delete/i })).toHaveCount(0)

    // Editor-level calls work.
    expect((await as('GET', `/api/weddings/${ids.wedding}`)).status).toBe(200)
    expect((await as('GET', `/api/weddings/${ids.wedding}/layouts`)).status).toBe(200)
    expect((await as('GET', `/api/weddings/${ids.wedding}/guests`)).status).toBe(200)
    expect((await as('GET', `/api/layouts/${ids.layout}`)).status).toBe(200)
    expect((await as('GET', `/api/venues/${ids.venue}`)).status).toBe(200)
    const added = await as('POST', `/api/weddings/${ids.wedding}/guests`, { id: randomUUID(), firstName: 'Editor', lastName: `Added${randomBytes(3).toString('hex')}` })
    expect(added.status, added.text).toBe(201)
    const addedGuest = JSON.parse(added.text) as { id: string }
    expect((await as('PATCH', `/api/guests/${addedGuest.id}`, { firstName: 'Editor2' })).status).toBe(200)
    expect((await as('DELETE', `/api/guests/${addedGuest.id}`)).status).toBeLessThan(300)

    // Owner-only calls answer 403 and change nothing; so does changing the venue template.
    const refused: [ApiCall['method'], string, unknown?][] = [
      ['PATCH', `/api/weddings/${ids.wedding}`, { name: 'Editor rename' }],
      ['DELETE', `/api/weddings/${ids.wedding}`, { confirm: 'delete' }],
      ['GET', `/api/weddings/${ids.wedding}/delete-summary`],
      ['GET', `/api/weddings/${ids.wedding}/backup`],
      ['POST', `/api/layouts/${ids.layout}/share-links`, { id: randomUUID(), password: 'editor-made-password' }],
      ['PATCH', `/api/share-links/${ids.link}`, { enabled: false }],
      ['DELETE', `/api/share-links/${ids.link}`],
      ['PATCH', `/api/venues/${ids.venue}`, { name: 'Editor rename' }],
      ['DELETE', `/api/venues/${ids.venue}`, { confirm: 'delete' }],
    ]
    for (const [method, path, body] of refused) {
      const res = await as(method, path, body)
      expect(res.status, `${method} ${path}: ${res.text.slice(0, 200)}`).toBe(403)
    }
    expect(await ownerView()).toEqual(before)
  } finally {
    await dbRemoveMember(ids.wedding, outsiderId)
  }

  // Removed: the very next load is Not found, and the calls answer 404.
  await expectNotFound(page, `/w/${ids.wedding}/layouts`)
  await expectNotFound(page, `/w/${ids.wedding}/layouts/${ids.layout}`)
  await expectNotFound(page, `/venues/${ids.venue}?from=${ids.wedding}`)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Weddings' })).toBeVisible()
  await expect(page.getByTestId('wedding-card').filter({ hasText: world.weddingName })).toHaveCount(0)
  for (const [method, path, body] of [
    ['GET', `/api/weddings/${ids.wedding}`],
    ['GET', `/api/layouts/${ids.layout}`],
    ['GET', `/api/venues/${ids.venue}`],
    ['POST', `/api/weddings/${ids.wedding}/guests`, { id: randomUUID(), firstName: 'Late', lastName: 'Guest' }],
    ['PATCH', `/api/weddings/${ids.wedding}`, { name: 'Late rename' }],
  ] as [ApiCall['method'], string, unknown?][]) {
    const res = await as(method, path, body)
    expect(res.status, `${method} ${path}`).toBe(404)
    expectNothingSecret(res.text, `${method} ${path}`)
  }
  expect(await ownerView()).toEqual(before)
  await page.close()
})

test('an admin who is not a member opens the wedding under the Admin view banner, and it is logged', async ({ browser }, testInfo) => {
  const admin = await signedInContext(browser, 'a', testInfo.project.name === 'phone')
  try {
    const adminId = await dbUserId(E2E_USERS.a.email)
    const { ids } = world
    const logged = await dbCountActivity('admin_access', adminId, ids.wedding)
    const page = await admin.newPage()
    await page.goto(`/w/${ids.wedding}/layouts`)
    await expect(page.getByTestId('wedding-title')).toHaveText(world.weddingName)
    await expect(page.getByTestId('admin-view-banner')).toHaveText('Admin view: you are not a member of this wedding. Changes are logged.')
    await page.goto(editorPath(ids.wedding, ids.layout))
    await expect(page.getByTestId('admin-view-banner')).toBeVisible()
    await expect.poll(() => dbCountActivity('admin_access', adminId, ids.wedding)).toBeGreaterThan(logged)
    expect(await dbCountActivity('admin_access', adminId, ids.wedding)).toBeGreaterThan(0)
    // The owner's own view has no banner.
    const ownerPage = await owner.newPage()
    await ownerPage.goto(`/w/${ids.wedding}/layouts`)
    await expect(ownerPage.getByTestId('wedding-title')).toBeVisible()
    await expect(ownerPage.getByTestId('admin-view-banner')).toHaveCount(0)
    await ownerPage.close()
  } finally {
    await admin.close()
  }
})

