/**
 * The venue route handlers against the test database, signed in with a
 * made-up password: list and create, open, save (200, 409, 410, 422), rename,
 * duplicate, delete refused with the layout list, delete summary, image
 * upload (type, size and limit checks) and serving, Accept then "Undo
 * import" through the restore route, revisions and the wall check.
 */
import { createHash, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../test/db'
import { makeGridPng } from '@/domain/floorplan/__fixtures__/plans'
import type { FixedItem } from '@/domain/venue-schema'
import { SITE_COOKIE, createSiteToken } from '@/server/auth/tokens'
import {
  MAX_VENUE_IMAGE_BYTES,
  type SaveVenueConflict,
  type SaveVenueOk,
  type VenueDeleteSummary,
  type VenueDetail,
  type VenueImageInfo,
  type VenueInUse,
  type VenueRevisionList,
  type VenueSummary,
  type VenueWallCheck,
} from '@/shared/api'

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'venues-route-test-secret-32-chars-plus')
  vi.stubEnv('SITE_PASSWORD', 'venues-route-made-up-password')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

type Params = Record<string, string>
type Handler = (req: NextRequest, ctx: { params: Promise<Params> }) => Promise<Response>

type CallOptions = { body?: unknown; raw?: Uint8Array; headers?: Record<string, string> }

async function send(mod: Record<string, unknown>, method: string, params: Params, opts: CallOptions = {}) {
  const headers: Record<string, string> = { cookie: `${SITE_COOKIE}=${createSiteToken()}`, ...opts.headers }
  // A copy: request bodies need a plain ArrayBuffer behind them.
  let body: BodyInit | undefined = opts.raw ? new Uint8Array(opts.raw) : undefined
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
  }
  const req = new NextRequest(`https://seat.example/api/venues/${params.id ?? ''}`, { method, headers, body })
  return (mod[method] as Handler)(req, { params: Promise.resolve(params) })
}

async function call(mod: Record<string, unknown>, method: string, params: Params, opts: CallOptions = {}) {
  const res = await send(mod, method, params, opts)
  const text = await res.text()
  return { status: res.status, cache: res.headers.get('cache-control'), body: text ? JSON.parse(text) : null }
}

async function db() {
  return (await import('@/server/db/client')).getDb()
}

const routes = async () => ({
  list: await import('./route'),
  one: await import('./[id]/route'),
  summary: await import('./[id]/delete-summary/route'),
  duplicate: await import('./[id]/duplicate/route'),
  revisions: await import('./[id]/revisions/route'),
  restore: await import('./[id]/revisions/[revisionId]/restore/route'),
  images: await import('./[id]/images/route'),
  image: await import('./[id]/images/[imageId]/route'),
  accept: await import('./[id]/accept-import/route'),
  wallCheck: await import('./[id]/wall-check/route'),
})

const wall = (id: string, x1: number, y1: number, x2: number, y2: number): FixedItem => ({
  id,
  type: 'wall',
  unsure: false,
  unsureNote: '',
  thickness: 20,
  points: [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ],
})

const reference = { scaleCmPerPx: 2, offsetX: -100, offsetY: -50, rotation: 0, opacity: 0.4 }

describe('/api/venues', () => {
  it('creates, lists, opens, saves, renames and duplicates a template', async () => {
    const r = await routes()
    const id = randomUUID()
    const created = await call(r.list, 'POST', {}, { body: { id, name: '  Harbour Room ', editedBy: 'Noa' } })
    expect(created.status).toBe(201)
    expect(created.cache).toBe('no-store')
    const venue = created.body as VenueDetail
    expect(venue).toMatchObject({ id, name: 'Harbour Room', version: 1, fixedItems: [], reference: null, referenceImage: null, usedBy: 0 })
    expect((await call(r.list, 'POST', {}, { body: { id, name: 'Again' } })).status).toBe(201)
    expect((await call(r.list, 'POST', {}, { body: { name: '   ' } })).status).toBe(422)
    expect((await call(r.list, 'POST', {}, { body: '{not json' })).status).toBe(400)

    const listed = await call(r.list, 'GET', {})
    expect(listed.cache).toBe('no-store')
    expect((listed.body as VenueSummary[]).find((v) => v.id === id)).toMatchObject({ name: 'Harbour Room', usedBy: 0, version: 1 })

    expect(await call(r.one, 'GET', { id })).toMatchObject({ status: 200, cache: 'no-store', body: { id } })
    expect((await call(r.one, 'GET', { id: 'not-a-uuid' })).status).toBe(404)
    expect((await call(r.one, 'GET', { id: randomUUID() })).status).toBe(404)

    // Save: lands, answers a retry, and a stale save is a 409 with a sentence to show.
    const saveId = randomUUID()
    const items = [wall('w1', 0, 0, 900, 0)]
    const body = { baseVersion: 1, saveId, editedBy: 'Aiden', fixedItems: items, reference }
    const saved = await call(r.one, 'PUT', { id }, { body })
    expect(saved.status).toBe(200)
    expect(saved.body as SaveVenueOk).toEqual({ status: 'saved', version: 2, updatedAt: expect.any(String), editedBy: 'Aiden' })
    expect((await call(r.one, 'PUT', { id }, { body })).body).toMatchObject({ status: 'already-saved', version: 2 })
    const stale = await call(r.one, 'PUT', { id }, { body: { ...body, saveId: randomUUID(), editedBy: 'Noa' } })
    expect(stale.status).toBe(409)
    expect(stale.body as SaveVenueConflict).toEqual({
      error: 'conflict',
      message: 'Aiden saved this venue after you opened it. Load their version to go on.',
      version: 2,
      updatedAt: (saved.body as SaveVenueOk).updatedAt,
      editedBy: 'Aiden',
      lastSaveId: saveId,
    })
    // Fixed items are checked with the fixed item schema.
    const bad = await call(r.one, 'PUT', { id }, { body: { ...body, baseVersion: 2, fixedItems: [{ id: 'w', type: 'wall', points: [] }] } })
    expect(bad.status).toBe(422)
    expect(bad.body.error).toBe('invalid')
    expect(bad.body.issues.length).toBeGreaterThan(0)
    expect((await call(r.one, 'PUT', { id }, { body: '[' })).status).toBe(400)

    // Rename keeps the version.
    const renamed = await call(r.one, 'PATCH', { id }, { body: { name: 'Harbour Hall' } })
    expect(renamed).toMatchObject({ status: 200, body: { name: 'Harbour Hall', version: 2, fixedItems: items, reference } })
    expect((await call(r.one, 'PATCH', { id }, { body: { name: '' } })).status).toBe(422)
    expect((await call(r.one, 'PATCH', { id: randomUUID() }, { body: { name: 'X' } })).status).toBe(404)

    // Duplicate.
    const copy = await call(r.duplicate, 'POST', { id }, { body: { editedBy: 'Noa' } })
    expect(copy.status).toBe(201)
    expect(copy.body).toMatchObject({ name: 'Harbour Hall copy', version: 1, fixedItems: items, reference })
    expect((await call(r.duplicate, 'POST', { id: randomUUID() }, { body: {} })).status).toBe(404)
    expect((await call(r.duplicate, 'POST', { id: 'x' }, { body: {} })).status).toBe(404)

    // Revisions: newest first.
    const revisions = await call(r.revisions, 'GET', { id })
    expect(revisions.cache).toBe('no-store')
    expect((revisions.body as VenueRevisionList).revisions.map((x) => x.reason)).toEqual(['save', 'save'])
  })

  it('refuses to delete a template in use, listing the layouts, then deletes once it is free', async () => {
    const r = await routes()
    const { makeWedding, makeLayout, canvasOf } = await import('@/server/repo/test-fixtures')
    const { updateLayout } = await import('@/server/repo/layouts')
    const created = await call(r.list, 'POST', {}, { body: { name: 'Pavilion' } })
    const id = (created.body as VenueDetail).id
    const w = await makeWedding(await db(), 'Noa & Aiden')
    const layoutId = await makeLayout(await db(), w, canvasOf(), { name: 'Reception', venueTemplateId: id })

    const summary = await call(r.summary, 'GET', { id })
    expect(summary.body as VenueDeleteSummary).toEqual({
      kind: 'venue',
      name: 'Pavilion',
      layouts: [{ weddingId: w, weddingName: 'Noa & Aiden', layoutId, layoutName: 'Reception' }],
      images: 0,
      revisions: 1,
    })

    expect((await call(r.one, 'DELETE', { id }, { body: {} })).status).toBe(422)
    const refused = await call(r.one, 'DELETE', { id }, { body: { confirm: 'delete' } })
    expect(refused.status).toBe(409)
    expect(refused.body as VenueInUse).toEqual({
      error: 'in_use',
      message: 'One layout uses this venue. Pick another venue for it first.',
      layouts: [{ weddingId: w, weddingName: 'Noa & Aiden', layoutId, layoutName: 'Reception' }],
    })

    await updateLayout(await db(), layoutId, { venueTemplateId: null })
    expect(await call(r.one, 'DELETE', { id }, { body: { confirm: 'delete' } })).toMatchObject({ status: 200, body: { ok: true } })
    expect((await call(r.one, 'DELETE', { id }, { body: { confirm: 'delete' } })).status).toBe(404)
    expect((await call(r.one, 'GET', { id })).status).toBe(404)
    expect((await call(r.summary, 'GET', { id })).status).toBe(404)
    // A save to the deleted template: 410.
    const gone = await call(r.one, 'PUT', { id }, { body: { baseVersion: 1, saveId: randomUUID(), editedBy: 'Noa', fixedItems: [], reference: null } })
    expect(gone).toMatchObject({ status: 410, body: { error: 'gone' } })
  })

  it('uploads images as raw bytes, checks type and size, and serves them privately', async () => {
    const r = await routes()
    const id = ((await call(r.list, 'POST', {}, { body: { name: 'Image test' } })).body as VenueDetail).id
    const png = makeGridPng(300, 200)

    const uploaded = await call(r.images, 'POST', { id }, { raw: png, headers: { 'content-type': 'image/png' } })
    expect(uploaded.status).toBe(201)
    const image = uploaded.body as VenueImageInfo
    expect(image).toMatchObject({ templateId: id, contentType: 'image/png', width: 300, height: 200, byteSize: png.byteLength })
    expect(image.url).toBe(`/api/venues/${id}/images/${image.id}`)
    // The same bytes again: the stored row, 200.
    expect(await call(r.images, 'POST', { id }, { raw: png })).toMatchObject({ status: 200, body: { id: image.id } })
    // The type comes from the bytes, whatever the header says.
    const gif = await call(r.images, 'POST', { id }, { raw: new TextEncoder().encode('GIF89a....'), headers: { 'content-type': 'image/png' } })
    expect(gif).toMatchObject({ status: 415, body: { error: 'unsupported_type', message: 'Upload a PNG or JPEG image.' } })
    expect((await call(r.images, 'POST', { id }, {})).status).toBe(415)
    // Over 3.5 MB: refused from the declared length, or while reading.
    const big = new Uint8Array(MAX_VENUE_IMAGE_BYTES + 10)
    big.set(png.slice(0, 33))
    const tooBig = await call(r.images, 'POST', { id }, { raw: big })
    expect(tooBig).toMatchObject({ status: 413, body: { error: 'too_large', message: 'The image is over 3.5 MB. Use a smaller one.' } })
    const declared = await call(r.images, 'POST', { id }, { raw: png, headers: { 'content-length': String(MAX_VENUE_IMAGE_BYTES + 1) } })
    expect(declared.status).toBe(413)
    expect((await call(r.images, 'POST', { id: randomUUID() }, { raw: png })).status).toBe(404)

    // The template is unchanged until Accept.
    expect((await call(r.one, 'GET', { id })).body).toMatchObject({ version: 1, referenceImage: null })

    const res = await send(r.image, 'GET', { id, imageId: image.id })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    // Kept by the browser, but asked for again on every view, so only a signed-in device sees it.
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const etag = `"${createHash('sha256').update(png).digest('hex')}"`
    expect(res.headers.get('etag')).toBe(etag)
    expect(Buffer.compare(Buffer.from(await res.arrayBuffer()), Buffer.from(png))).toBe(0)
    // A repeat view: 304 with no body, after the cookie check.
    const again = await send(r.image, 'GET', { id, imageId: image.id }, { headers: { 'if-none-match': `W/"x", ${etag}` } })
    expect(again.status).toBe(304)
    expect(again.headers.get('etag')).toBe(etag)
    expect(again.headers.get('cache-control')).toBe('private, no-cache')
    expect(await again.text()).toBe('')
    expect((await send(r.image, 'GET', { id, imageId: image.id }, { headers: { 'if-none-match': '"other"' } })).status).toBe(200)
    // Signed out: refused, whatever the browser holds.
    expect((await send(r.image, 'GET', { id, imageId: image.id }, { headers: { cookie: '', 'if-none-match': etag } })).status).toBe(401)
    expect((await send(r.image, 'GET', { id: randomUUID(), imageId: image.id }, { headers: { 'if-none-match': etag } })).status).toBe(404)

    const other = ((await call(r.list, 'POST', {}, { body: { name: 'Other' } })).body as VenueDetail).id
    expect((await call(r.image, 'GET', { id: other, imageId: image.id })).status).toBe(404)
    expect((await call(r.image, 'GET', { id, imageId: 'nope' })).status).toBe(404)
    expect((await call(r.image, 'GET', { id, imageId: randomUUID() })).status).toBe(404)
  })

  it('accepts an import, then undoes it through the restore route', async () => {
    const r = await routes()
    const id = ((await call(r.list, 'POST', {}, { body: { name: 'Accept test' } })).body as VenueDetail).id
    const image = (await call(r.images, 'POST', { id }, { raw: makeGridPng(400, 300) })).body as VenueImageInfo
    const otherId = ((await call(r.list, 'POST', {}, { body: { name: 'Accept other' } })).body as VenueDetail).id
    const otherImage = (await call(r.images, 'POST', { id: otherId }, { raw: makeGridPng(10, 10) })).body as VenueImageInfo

    const items = [wall('w1', -400, -300, 400, -300), wall('w2', 400, -300, 400, 300)]
    const body = { baseVersion: 1, saveId: randomUUID(), editedBy: 'Noa', fixedItems: items, imageId: otherImage.id, reference, importedBy: 'ai' }
    const wrongImage = await call(r.accept, 'POST', { id }, { body })
    expect(wrongImage).toMatchObject({ status: 422, body: { error: 'invalid', issues: ['imageId: That image was not uploaded to this venue'] } })
    expect((await call(r.accept, 'POST', { id }, { body: { ...body, importedBy: 'hand' } })).status).toBe(422)

    const accepted = await call(r.accept, 'POST', { id }, { body: { ...body, imageId: image.id } })
    expect(accepted).toMatchObject({ status: 200, body: { status: 'saved', version: 2 } })
    expect((await call(r.one, 'GET', { id })).body).toMatchObject({
      version: 2,
      importedBy: 'ai',
      fixedItems: items,
      reference,
      referenceImage: { id: image.id, url: image.url },
    })
    // A stale Accept (someone saved since): 409, nothing changes.
    const stale = await call(r.accept, 'POST', { id }, { body: { ...body, imageId: image.id, saveId: randomUUID() } })
    expect(stale.status).toBe(409)

    const list = (await call(r.revisions, 'GET', { id })).body as VenueRevisionList
    expect(list.revisions.map((x) => x.reason)).toEqual(['import', 'save'])
    expect(list.undoImportRevisionId).toBe(list.revisions[1]!.id)

    const undo = await call(r.restore, 'POST', { id, revisionId: list.undoImportRevisionId! }, { body: { baseVersion: 2, saveId: randomUUID(), editedBy: 'Aiden' } })
    expect(undo).toMatchObject({ status: 200, body: { status: 'saved', version: 3, editedBy: 'Aiden' } })
    expect((await call(r.one, 'GET', { id })).body).toMatchObject({ version: 3, fixedItems: [], reference: null, referenceImage: null, importedBy: 'hand' })
    // The image is still served, so the import can be redone.
    expect((await send(r.image, 'GET', { id, imageId: image.id })).status).toBe(200)

    expect((await call(r.restore, 'POST', { id, revisionId: randomUUID() }, { body: { baseVersion: 3, saveId: randomUUID(), editedBy: 'Noa' } })).status).toBe(404)
    expect((await call(r.restore, 'POST', { id, revisionId: 'x' }, { body: {} })).status).toBe(404)
    expect((await call(r.restore, 'POST', { id, revisionId: list.revisions[0]!.id }, { body: { baseVersion: 'one' } })).status).toBe(422)
    const staleRestore = await call(r.restore, 'POST', { id, revisionId: list.revisions[0]!.id }, { body: { baseVersion: 1, saveId: randomUUID(), editedBy: 'Noa' } })
    expect(staleRestore).toMatchObject({ status: 409, body: { error: 'conflict', version: 3 } })
  })

  it('lists the layouts and tables a saved wall runs through', async () => {
    const r = await routes()
    const { makeWedding, makeLayout, canvasOf, roundTable } = await import('@/server/repo/test-fixtures')
    const id = ((await call(r.list, 'POST', {}, { body: { name: 'Wall route' } })).body as VenueDetail).id
    const w = await makeWedding(await db(), 'Walls')
    const layoutId = await makeLayout(await db(), w, canvasOf({ ...roundTable('t9', 9, [null]), x: 0, y: 0 }), { name: 'Dinner', venueTemplateId: id })
    expect((await call(r.wallCheck, 'GET', { id })).body as VenueWallCheck).toEqual({
      templateVersion: 1,
      layouts: [{ weddingId: w, weddingName: 'Walls', layoutId, layoutName: 'Dinner', tables: [] }],
    })
    await call(r.one, 'PUT', { id }, { body: { baseVersion: 1, saveId: randomUUID(), editedBy: 'Noa', fixedItems: [wall('w1', -500, 0, 500, 0)], reference: null } })
    const check = await call(r.wallCheck, 'GET', { id })
    expect(check.cache).toBe('no-store')
    expect(check.body as VenueWallCheck).toEqual({
      templateVersion: 2,
      layouts: [{ weddingId: w, weddingName: 'Walls', layoutId, layoutName: 'Dinner', tables: [{ tableId: 't9', label: 'Table 9', wallIds: ['w1'] }] }],
    })
    expect((await call(r.wallCheck, 'GET', { id: randomUUID() })).status).toBe(404)
  })
})
