/**
 * Acceptance check 2: no page or API route returns data without the cookie,
 * and the password never reaches the browser. New pages and routes join these
 * lists as each milestone adds them (milestone 4: the guest list, its import
 * page, the sample file, and the guest and group routes; milestone 7: the
 * template editor and every venue, image, import and revision route;
 * milestone 10: the share link and backup routes, and every restore step).
 * Share pages run their own check: without a cookie, /share/<token> shows
 * only its password page and its data route answers 401.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { expect, request as playwrightRequest, test } from '@playwright/test'
import { apiAddGuests, apiCreateGroup, apiListGroups, apiListGuests } from './guest-list'
import { makePlanPng } from './fixtures/floorplan-png'
import { apiCreateLayout, apiCreateWedding, signIn, signInRequest, sitePassword } from './helpers'
import { apiCreateVenue, apiGetVenue, apiSaveVenue, apiVenueRevisions } from './venues'
import { emptyCanvas } from '../src/domain/canvas-schema'
import type { ShareLink, VenueImageInfo } from '../src/shared/api'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const NO_ID = '00000000-0000-4000-8000-000000000000'

/** Every page, with `:wedding`, `:layout` and `:venue` standing for ids, and the sample guest file. */
const PAGE_PATHS = [
  '/',
  '/w/:wedding',
  '/w/:wedding/layouts',
  '/w/:wedding/guests',
  '/w/:wedding/guests/import',
  '/w/:wedding/groups',
  '/w/:wedding/rules',
  '/w/:wedding/venues',
  '/w/:wedding/links',
  '/w/:wedding/layouts/:layout',
  '/venues/:venue',
  '/venues/:venue?from=:wedding',
  '/samples/guests-sample.csv',
]

/** One row of an import, as the column step sends it. */
const IMPORT_ROW = { rowNumber: 2, firstName: 'Sneaky', lastName: 'Guest', groups: [], extraNotes: [] }

/** A template save, as the template editor sends it. */
const VENUE_SAVE = { baseVersion: 1, saveId: NO_ID, editedBy: 'Noa' }

/** A share link password made up for this run. */
const LINK_PASSWORD = `sneaky-${randomBytes(6).toString('hex')}`

/** Restore step 1, as the browser sends it, for a wedding named Sneaky. */
const RESTORE_START = {
  format: 'seat-plan-backup',
  version: 1,
  jobId: NO_ID,
  wedding: { id: NO_ID, name: 'Sneaky', date: null, unit: 'ft', minGapCm: 152.4 },
  guests: [],
  groups: [],
  groupMembers: [],
  rules: [],
  ruleGuests: [],
}

/**
 * Every API route but the login route, with a body where the route takes
 * one; `:guest`, `:group`, `:image`, `:revision`, `:link` and `:job` stand
 * for ids too.
 */
const API_ROUTES: { method: Method; path: string; body?: unknown }[] = [
  { method: 'GET', path: '/api/weddings' },
  { method: 'POST', path: '/api/weddings', body: { name: 'Sneaky' } },
  { method: 'GET', path: '/api/weddings/:wedding' },
  { method: 'PATCH', path: '/api/weddings/:wedding', body: { name: 'Sneaky' } },
  { method: 'DELETE', path: '/api/weddings/:wedding', body: { confirm: 'delete' } },
  { method: 'GET', path: '/api/weddings/:wedding/delete-summary' },
  { method: 'GET', path: '/api/weddings/:wedding/layouts' },
  {
    method: 'POST',
    path: '/api/weddings/:wedding/layouts',
    body: { name: 'Sneaky', kind: 'reception', venueTemplateId: null, editedBy: 'Noa' },
  },
  { method: 'GET', path: '/api/layouts/:layout' },
  { method: 'PUT', path: '/api/layouts/:layout', body: { baseVersion: 1 } },
  { method: 'PATCH', path: '/api/layouts/:layout', body: { name: 'Sneaky' } },
  { method: 'DELETE', path: '/api/layouts/:layout', body: { confirm: 'delete' } },
  { method: 'GET', path: '/api/layouts/:layout/delete-summary' },
  { method: 'GET', path: '/api/layouts/:layout/version' },
  { method: 'POST', path: '/api/layouts/:layout/duplicate', body: { editedBy: 'Noa' } },
  { method: 'POST', path: '/api/auth/logout' },
  // Guests (milestone 4).
  { method: 'GET', path: '/api/weddings/:wedding/guests' },
  { method: 'POST', path: '/api/weddings/:wedding/guests', body: { firstName: 'Sneaky', lastName: 'Guest' } },
  { method: 'POST', path: '/api/weddings/:wedding/guests/bulk', body: { guests: [{ firstName: 'Sneaky', lastName: 'Guest' }] } },
  { method: 'GET', path: '/api/weddings/:wedding/guests/export' },
  { method: 'POST', path: '/api/weddings/:wedding/guests/import/preview', body: { rows: [IMPORT_ROW] } },
  { method: 'POST', path: '/api/weddings/:wedding/guests/import/commit', body: { rows: [IMPORT_ROW], removeMissing: true } },
  { method: 'PATCH', path: '/api/guests/:guest', body: { firstName: 'Sneaky' } },
  { method: 'DELETE', path: '/api/guests/:guest' },
  { method: 'GET', path: '/api/guests/:guest/delete-summary' },
  // Groups (milestone 4).
  { method: 'GET', path: '/api/weddings/:wedding/groups' },
  { method: 'POST', path: '/api/weddings/:wedding/groups', body: { name: 'Sneaky' } },
  { method: 'PATCH', path: '/api/groups/:group', body: { name: 'Sneaky' } },
  { method: 'DELETE', path: '/api/groups/:group' },
  { method: 'POST', path: '/api/groups/:group/members', body: { guestIds: [NO_ID] } },
  { method: 'DELETE', path: '/api/groups/:group/members/:guest' },
  // Seated guests across a wedding's layouts.
  { method: 'GET', path: '/api/weddings/:wedding/guests/seats' },
  // Venue templates (milestone 7).
  { method: 'GET', path: '/api/venues' },
  { method: 'POST', path: '/api/venues', body: { name: 'Sneaky' } },
  { method: 'GET', path: '/api/venues/:venue' },
  { method: 'PUT', path: '/api/venues/:venue', body: { ...VENUE_SAVE, fixedItems: [], reference: null } },
  { method: 'PATCH', path: '/api/venues/:venue', body: { name: 'Sneaky' } },
  { method: 'DELETE', path: '/api/venues/:venue', body: { confirm: 'delete' } },
  { method: 'GET', path: '/api/venues/:venue/delete-summary' },
  { method: 'POST', path: '/api/venues/:venue/duplicate', body: { name: 'Sneaky' } },
  { method: 'GET', path: '/api/venues/:venue/wall-check' },
  { method: 'GET', path: '/api/venues/:venue/revisions' },
  { method: 'POST', path: '/api/venues/:venue/revisions/:revision/restore', body: VENUE_SAVE },
  // Floor plan images and the AI import (milestone 7).
  { method: 'POST', path: '/api/venues/:venue/images', body: 'not an image' },
  { method: 'GET', path: '/api/venues/:venue/images/:image' },
  { method: 'POST', path: '/api/venues/:venue/import', body: { imageId: NO_ID, imageWidth: 1000, imageHeight: 700 } },
  {
    method: 'POST',
    path: '/api/venues/:venue/accept-import',
    body: { ...VENUE_SAVE, fixedItems: [], imageId: NO_ID, reference: { scaleCmPerPx: 1, offsetX: 0, offsetY: 0, rotation: 0, opacity: 0.5 }, importedBy: 'ai' },
  },
  // Share links (milestone 10).
  { method: 'GET', path: '/api/weddings/:wedding/share-links' },
  { method: 'GET', path: '/api/layouts/:layout/share-links' },
  { method: 'POST', path: '/api/layouts/:layout/share-links', body: { password: LINK_PASSWORD } },
  { method: 'PATCH', path: '/api/share-links/:link', body: { enabled: false, password: LINK_PASSWORD } },
  { method: 'DELETE', path: '/api/share-links/:link' },
  // Backup and the restore steps (milestone 10).
  { method: 'GET', path: '/api/weddings/:wedding/backup' },
  { method: 'POST', path: '/api/weddings/restore', body: RESTORE_START },
  {
    method: 'POST',
    path: '/api/weddings/restore/:job/templates',
    body: { id: NO_ID, name: 'Sneaky', fixedItems: [], reference: null, importedBy: 'hand', imageId: null },
  },
  { method: 'PUT', path: '/api/weddings/restore/:job/templates/:venue/image', body: 'not an image' },
  {
    method: 'POST',
    path: '/api/weddings/restore/:job/layouts',
    body: { id: NO_ID, name: 'Sneaky', kind: 'reception', venueTemplateId: null, editedBy: 'Noa', canvas: emptyCanvas() },
  },
]

type Ids = { wedding: string; layout: string; guest: string; group: string; venue: string; image: string; revision: string; link: string; job: string }
const NO_IDS: Ids = { wedding: NO_ID, layout: NO_ID, guest: NO_ID, group: NO_ID, venue: NO_ID, image: NO_ID, revision: NO_ID, link: NO_ID, job: NO_ID }

function fill(path: string, ids: Ids): string {
  return path.replace(/:(wedding|layout|guest|group|venue|image|revision|link|job)\b/g, (_, key: keyof Ids) => ids[key])
}

test.describe('without the cookie', () => {
  for (const path of PAGE_PATHS) {
    test(`page ${fill(path, NO_IDS)} goes to the password page`, async ({ request }) => {
      const res = await request.get(fill(path, NO_IDS), { maxRedirects: 0 })
      expect(res.status()).toBe(307)
      expect(res.headers()['location']).toMatch(/\/login/)
      expect(res.headers()['x-robots-tag']).toContain('noindex')
    })
  }

  for (const { method, path, body } of API_ROUTES) {
    test(`${method} ${fill(path, NO_IDS)} answers 401`, async ({ request }) => {
      const res = await request.fetch(fill(path, NO_IDS), {
        method,
        data: body,
        maxRedirects: 0,
      })
      expect(res.status()).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
    })
  }

  test('real weddings, layouts, guests, groups and venues stay hidden, and nothing changes', async ({ request, baseURL }) => {
    // Make a real wedding, layout, guest, group and venue (with a floor plan image) as a signed-in visitor.
    const owner = await playwrightRequest.newContext({ baseURL })
    try {
      await signInRequest(owner)
      const secret = `Hidden wedding ${Date.now()}`
      const wedding = await apiCreateWedding(owner, secret)
      const layout = await apiCreateLayout(owner, wedding.id, { name: `Hidden layout ${Date.now()}` })
      const [guest] = await apiAddGuests(owner, wedding.id, [{ firstName: 'Hiddenfirst', lastName: `Hiddenlast${Date.now()}`, notes: 'Hidden note' }])
      const group = await apiCreateGroup(owner, wedding.id, `Hidden group ${Date.now()}`, [guest.id])
      const venue = await apiCreateVenue(owner, `Hidden venue ${Date.now()}`)
      const wallName = `Hidden wall ${Date.now()}`
      await apiSaveVenue(owner, venue, [
        { id: randomUUID(), type: 'wall', name: wallName, points: [{ x: 0, y: 0 }, { x: 500, y: 0 }], thickness: 15, unsure: false, unsureNote: '' },
      ])
      const upload = await owner.post(`/api/venues/${venue.id}/images`, { data: makePlanPng(), headers: { 'content-type': 'application/octet-stream' } })
      expect(upload.status()).toBe(201)
      const image = (await upload.json()) as VenueImageInfo
      const [revision] = (await apiVenueRevisions(owner, venue.id)).revisions
      const linkRes = await owner.post(`/api/layouts/${layout.id}/share-links`, {
        data: { id: randomUUID(), label: `Hidden caterer ${Date.now()}`, password: LINK_PASSWORD },
      })
      expect(linkRes.status()).toBe(201)
      const link = (await linkRes.json()) as ShareLink
      const token = link.path.split('/')[2]!
      const ids: Ids = {
        wedding: wedding.id,
        layout: layout.id,
        guest: guest.id,
        group: group.id,
        venue: venue.id,
        image: image.id,
        revision: revision.id,
        link: link.id,
        job: randomUUID(),
      }
      const hidden = [secret, layout.name, guest.lastName, 'Hidden note', group.name, venue.name, wallName, image.sha256, link.label, token]

      for (const path of PAGE_PATHS) {
        const res = await request.get(fill(path, ids), { maxRedirects: 0 })
        expect(res.status(), path).toBe(307)
        const text = await res.text()
        for (const word of hidden) expect(text, path).not.toContain(word)
      }
      for (const { method, path, body } of API_ROUTES) {
        const res = await request.fetch(fill(path, ids), { method, data: body, maxRedirects: 0 })
        expect(res.status(), `${method} ${path}`).toBe(401)
        const text = await res.text()
        for (const word of hidden) expect(text, `${method} ${path}`).not.toContain(word)
      }

      // The share link's own page shows only its password form; its data stays closed.
      const sharePage = await request.get(link.path, { maxRedirects: 0 })
      expect(sharePage.status()).toBe(200)
      expect(sharePage.headers()['x-robots-tag']).toContain('noindex')
      expect(sharePage.headers()['referrer-policy']).toBe('no-referrer')
      const sharePageText = await sharePage.text()
      expect(sharePageText).toContain('Type the password you were given with this link.')
      for (const word of hidden.filter((w) => w !== token)) expect(sharePageText, link.path).not.toContain(word)
      const shareData = await request.get(`${link.path}/data`, { maxRedirects: 0 })
      expect(shareData.status()).toBe(401)
      const shareDataText = await shareData.text()
      for (const word of hidden) expect(shareDataText, `${link.path}/data`).not.toContain(word)

      // The signed-out PATCH, DELETE and PUT changed nothing.
      const weddingNow = await owner.get(`/api/weddings/${wedding.id}`)
      expect(weddingNow.status()).toBe(200)
      expect((await weddingNow.json()).name).toBe(secret)
      const layoutNow = await owner.get(`/api/layouts/${layout.id}`)
      expect(layoutNow.status()).toBe(200)
      expect(await layoutNow.json()).toMatchObject({ name: layout.name, version: 1 })
      // No guest added or removed, the guest and the group as they were.
      const guestsNow = await apiListGuests(owner, wedding.id)
      expect(guestsNow.map((g) => [g.id, g.firstName, g.lastName])).toEqual([[guest.id, guest.firstName, guest.lastName]])
      const groupsNow = await apiListGroups(owner, wedding.id)
      expect(groupsNow.map((g) => [g.id, g.name, g.memberIds])).toEqual([[group.id, group.name, [guest.id]]])
      // The venue as it was: same name, version and wall, no reference image, not deleted, no copy made.
      const venueNow = await apiGetVenue(owner, venue.id)
      expect(venueNow).toMatchObject({ name: venue.name, version: 2, referenceImage: null })
      expect(venueNow.fixedItems.map((i) => i.name)).toEqual([wallName])
      const venues = (await (await owner.get('/api/venues')).json()) as { name: string }[]
      expect(venues.filter((v) => v.name === 'Sneaky' || v.name.startsWith(venue.name))).toEqual([expect.objectContaining({ name: venue.name })])
      expect((await owner.get(`/api/venues/${venue.id}/images/${image.id}`)).status()).toBe(200)
      // The share link is still on with its password, and no restore made a wedding.
      const linksNow = (await (await owner.get(`/api/layouts/${layout.id}/share-links`)).json()) as ShareLink[]
      expect(linksNow.map((l) => [l.id, l.enabled, l.lastOpenedAt])).toEqual([[link.id, true, null]])
      expect((await request.post(`${link.path}/login`, { data: { password: LINK_PASSWORD } })).status()).toBe(200)
      const weddingsNow = (await (await owner.get('/api/weddings')).json()) as { name: string }[]
      expect(weddingsNow.filter((w) => w.name.startsWith('Sneaky'))).toEqual([])
    } finally {
      await owner.dispose()
    }
  })

  test('robots.txt is readable without the cookie', async ({ request }) => {
    const res = await request.get('/robots.txt')
    expect(res.status()).toBe(200)
    expect(await res.text()).toContain('User-Agent: *')
  })

  test('the login page itself carries noindex', async ({ request }) => {
    const res = await request.get('/login')
    expect(res.headers()['x-robots-tag']).toContain('noindex')
  })
})

test('no response the app loads contains the password', async ({ page }) => {
  const password = sitePassword()
  const leaks: string[] = []
  page.on('response', async (res) => {
    try {
      const body = await res.body()
      if (body.includes(Buffer.from(password))) leaks.push(res.url())
    } catch {
      // Redirects and aborted requests have no body.
    }
  })
  await signIn(page)
  await page.reload()
  await page.waitForLoadState('networkidle')
  // The wedding pages and the editor too.
  const wedding = await apiCreateWedding(page.request, `Password check ${Date.now()}`)
  const venue = await apiCreateVenue(page.request, `Password check venue ${Date.now()}`)
  const layout = await apiCreateLayout(page.request, wedding.id, { name: 'Plan', venueTemplateId: venue.id })
  await apiAddGuests(page.request, wedding.id, [{ firstName: 'Ava', lastName: 'Cohen' }])
  for (const path of [
    `/w/${wedding.id}/layouts`,
    `/w/${wedding.id}/guests`,
    `/w/${wedding.id}/guests/import`,
    `/w/${wedding.id}/groups`,
    `/w/${wedding.id}/venues`,
    `/w/${wedding.id}/links`,
    `/w/${wedding.id}/layouts/${layout.id}`,
    `/venues/${venue.id}?from=${wedding.id}`,
  ]) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  }
  expect(leaks).toEqual([])
})
