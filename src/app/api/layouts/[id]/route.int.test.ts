/**
 * The layout route handlers against the test database, signed in with a
 * made-up password: create, open, save (200, 409, 410, 422), rename, version,
 * duplicate, delete summary and delete; text Postgres would refuse; "Save as
 * a copy" after a 410; recent save ids.
 */
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../../test/db'
import { makeUser, makeWeddingFor, sessionCookie } from '../../../../../test/auth'
import type { Db } from '@/server/locks'
import type { LayoutDetail, LayoutVersionInfo, SaveLayoutConflict, SaveLayoutOk } from '@/shared/api'

/** The cookie of the user every test acts as: the owner of each wedding it makes. */
let signedIn = ''
let me = ''

/** A wedding the signed-in user owns (routes answer 404 to anyone who is not a member). */
const makeWedding = (database: Db, name?: string) => makeWeddingFor(database, me, name)

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'layouts-route-test-secret-32-chars-plus')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  const database = await db()
  me = (await makeUser(database)).id
  signedIn = await sessionCookie(database, me)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

async function call(mod: Record<string, unknown>, method: string, id: string, body?: unknown) {
  const headers: Record<string, string> = { cookie: signedIn }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const req = new NextRequest(`https://seat.example/api/x/${id}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const res = await (mod[method] as Handler)(req, { params: Promise.resolve({ id }) })
  const text = await res.text()
  return { status: res.status, cache: res.headers.get('cache-control'), body: text ? JSON.parse(text) : null }
}

async function db() {
  return (await import('@/server/db/client')).getDb()
}

function table(id: string, number: number, seated: (string | null)[]) {
  return {
    id,
    kind: 'table',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    shape: 'round',
    width: 152.4,
    height: 152.4,
    number,
    name: `Table ${number}`,
    seatCount: seated.length,
    seatSides: 'all',
    seats: seated.map((guestId, index) => ({ index, guestId })),
  }
}

describe('/api/layouts/[id]', () => {
  it('runs the whole life of a layout', async () => {
    const { makeGuest } = await import('@/server/repo/test-fixtures')
    const { removeGuests } = await import('@/server/repo/guests')
    const w = await makeWedding(await db())
    const [ann, ben] = [await makeGuest(await db(), w, 'Ann'), await makeGuest(await db(), w, 'Ben')]

    const weddingLayouts = await import('../../weddings/[id]/layouts/route')
    const one = await import('./route')
    const version = await import('./version/route')
    const duplicate = await import('./duplicate/route')
    const summary = await import('./delete-summary/route')

    // Create: a deleted or unknown template is refused.
    const badTemplate = await call(weddingLayouts, 'POST', w, {
      name: 'Dinner',
      kind: 'reception',
      venueTemplateId: randomUUID(),
      editedBy: 'Noa',
    })
    expect(badTemplate.status).toBe(422)
    expect(badTemplate.body.error).toBe('invalid')
    const created = await call(weddingLayouts, 'POST', w, { name: 'Dinner', kind: 'reception', venueTemplateId: null, editedBy: 'Noa' })
    expect(created.status).toBe(201)
    const layout = created.body as LayoutDetail
    expect(layout).toMatchObject({ name: 'Dinner', version: 1, canvas: { schemaVersion: 1, items: [] }, template: null })
    const id = layout.id

    const listed = await call(weddingLayouts, 'GET', w)
    expect(listed.body.map((l: { id: string }) => l.id)).toEqual([id])
    expect(Object.keys(listed.body[0]).sort()).toEqual(
      [
        'editedBy',
        'editedById',
        'id',
        'kind',
        'name',
        'thumbSvg',
        'updatedAt',
        'venueDeleted',
        'venueName',
        'venueTemplateId',
        'version',
        'weddingId',
      ].sort(),
    )

    const opened = await call(one, 'GET', id)
    expect(opened).toMatchObject({ status: 200, cache: 'no-store', body: { id, lastSaveId: null, recentSaveIds: [], venueDeleted: false } })

    // Save: lands, and drops a removed guest's seat with a reason the editor can apply.
    await removeGuests(await db(), w, [ben])
    const saveId = randomUUID()
    const body = {
      baseVersion: 1,
      saveId,
      editedBy: 'Aiden',
      tabId: 'tab-a',
      canvas: { schemaVersion: 1, items: [table('t1', 1, [ann, ben])] },
    }
    const saved = await call(one, 'PUT', id, body)
    expect(saved.status).toBe(200)
    const ok = saved.body as SaveLayoutOk
    // The body's editedBy (a tab open from before accounts) is ignored: the editor is the signed-in user.
    expect(ok).toMatchObject({ status: 'saved', version: 2, editedBy: 'Pat', editedById: me })
    expect(ok.droppedSeats).toEqual([{ itemId: 't1', seatIndex: 1, guestId: ben, reason: 'removed-guest' }])
    expect(Object.keys(ok).sort()).toEqual(['droppedSeats', 'editedBy', 'editedById', 'status', 'updatedAt', 'version'])

    // The same save again (a lost reply): already saved, nothing new.
    const retry = await call(one, 'PUT', id, body)
    expect(retry).toMatchObject({ status: 200, body: { status: 'already-saved', version: 2 } })

    // A stale save from another tab: 409 naming who saved.
    const stale = await call(one, 'PUT', id, { ...body, saveId: randomUUID(), editedBy: 'Noa', tabId: 'tab-b' })
    expect(stale.status).toBe(409)
    const conflict = stale.body as SaveLayoutConflict
    expect(conflict).toEqual({
      error: 'conflict',
      version: 2,
      updatedAt: ok.updatedAt,
      editedBy: 'Pat',
      editedById: me,
      lastSaveId: saveId,
      recentSaveIds: [saveId],
    })

    // A canvas the server cannot fix: 422 with issues.
    const bad = await call(one, 'PUT', id, {
      ...body,
      baseVersion: 2,
      saveId: randomUUID(),
      canvas: { schemaVersion: 1, items: [{ ...table('t1', 1, [null]), seatCount: 2 }] },
    })
    expect(bad.status).toBe(422)
    expect(bad.body.error).toBe('invalid')
    expect(bad.body.issues.length).toBeGreaterThan(0)

    expect((await call(version, 'GET', id)).body).toEqual({
      version: 2,
      updatedAt: ok.updatedAt,
      editedBy: 'Pat',
      editedById: me,
      lastSaveId: saveId,
      recentSaveIds: [saveId],
    })

    // Rename leaves the version alone.
    const renamed = await call(one, 'PATCH', id, { name: 'Plan B' })
    expect(renamed).toMatchObject({ status: 200, body: { name: 'Plan B', version: 2 } })
    expect((await call(one, 'PATCH', id, { name: '' })).status).toBe(422)

    // Duplicate keeps the seats.
    const copy = await call(duplicate, 'POST', id, { editedBy: 'Noa' })
    expect(copy.status).toBe(201)
    expect(copy.body).toMatchObject({ name: 'Plan B copy', version: 1, editedBy: 'Pat', editedById: me })
    expect(copy.body.canvas.items[0].seats.map((s: { guestId: string | null }) => s.guestId)).toEqual([ann, null])

    expect((await call(summary, 'GET', id)).body).toEqual({
      kind: 'layout',
      name: 'Plan B',
      tables: 1,
      seatedGuests: 1,
      notes: 0,
      shareLinks: 0,
    })

    // Delete needs the word; afterwards the layout is gone and the copy is untouched.
    expect((await call(one, 'DELETE', id, { confirm: 'yes' })).status).toBe(422)
    expect((await call(one, 'DELETE', id, { confirm: 'delete' })).body).toEqual({ ok: true })
    expect((await call(one, 'GET', id)).status).toBe(404)
    expect((await call(version, 'GET', id)).status).toBe(404)
    expect(await call(one, 'PUT', id, { ...body, baseVersion: 2, saveId: randomUUID() })).toMatchObject({
      status: 410,
      body: { error: 'gone' },
    })
    expect((await call(one, 'GET', copy.body.id)).body).toMatchObject({ version: 1, name: 'Plan B copy' })
  })

  it('a layout id nobody made is 404 everywhere, a save included (the editor reads 404 as gone)', async () => {
    const one = await import('./route')
    const id = randomUUID()
    const res = await call(one, 'PUT', id, {
      baseVersion: 1,
      saveId: randomUUID(),
      editedBy: 'Noa',
      tabId: 't',
      canvas: { schemaVersion: 1, items: [] },
    })
    expect(res).toMatchObject({ status: 404, body: { error: 'not_found' } })
    expect((await call(one, 'GET', id)).status).toBe(404)
    expect((await call(one, 'PATCH', id, { name: 'X' })).status).toBe(404)
    expect((await call(one, 'DELETE', id, { confirm: 'delete' })).status).toBe(404)
  })
})

function note(id: string, text: string) {
  return {
    id,
    kind: 'note',
    type: 'sticky',
    x: 0,
    y: 0,
    rotation: 0,
    locked: false,
    width: 100,
    height: 100,
    text,
    color: 'yellow',
    author: 'Noa',
    done: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    attachedTo: { start: null, end: null },
  }
}

function saveBody(baseVersion: number, items: unknown[], saveId = randomUUID()) {
  return { baseVersion, saveId, editedBy: 'Noa', tabId: 'tab-a', canvas: { schemaVersion: 1, items } }
}

describe('text Postgres cannot store', () => {
  it('a save holding a NUL or a lone surrogate lands with clean text, never a 500', async () => {
    const { makeGuest, makeLayout, layoutRow, seatRows } = await import('@/server/repo/test-fixtures')
    const one = await import('./route')
    const w = await makeWedding(await db())
    const ann = await makeGuest(await db(), w, 'Ann')
    const id = await makeLayout(await db(), w)

    const nul = await call(one, 'PUT', id, saveBody(1, [note('n1', 'a\u0000b')]))
    expect(nul).toMatchObject({ status: 200, body: { status: 'saved', version: 2 } })
    expect((await layoutRow(await db(), id)).canvas.items[0]).toMatchObject({ text: 'ab' })

    const lone = await call(one, 'PUT', id, saveBody(2, [note('n1', 'cake \ud83c')]))
    expect(lone).toMatchObject({ status: 200, body: { status: 'saved', version: 3 } })
    expect((await layoutRow(await db(), id)).canvas.items[0]).toMatchObject({ text: 'cake \ufffd' })

    // A table name reaches layout_seats.item_label, a text column.
    const named = { ...table('t1', 1, [ann]), name: 'Fam\u0000ily \udc00' }
    const tableSave = await call(one, 'PUT', id, saveBody(3, [named]))
    expect(tableSave).toMatchObject({ status: 200, body: { status: 'saved', version: 4 } })
    expect((await layoutRow(await db(), id)).canvas.items[0]).toMatchObject({ name: 'Family \ufffd' })
    expect((await seatRows(await db(), id)).map((s) => s.itemLabel)).toEqual(['Family \ufffd (table 1)'])

    // Names too: rename, and a copy sent with its canvas.
    expect((await call(one, 'PATCH', id, { name: 'Din\u0000ner \ud83c' })).body).toMatchObject({ name: 'Dinner \ufffd' })
    const duplicate = await import('./duplicate/route')
    const copy = await call(duplicate, 'POST', id, {
      name: 'Mine\u0000',
      editedBy: 'Noa',
      canvas: { schemaVersion: 1, items: [note('n2', '\u0000\ud800x')] },
    })
    expect(copy).toMatchObject({ status: 201, body: { name: 'Mine', canvas: { items: [{ text: '\ufffdx' }] } } })
  })

  it('an item id with a NUL is refused with 422, not stored and not a 500', async () => {
    const { makeLayout, layoutRow } = await import('@/server/repo/test-fixtures')
    const one = await import('./route')
    const w = await makeWedding(await db())
    const id = await makeLayout(await db(), w)
    const res = await call(one, 'PUT', id, saveBody(1, [note('n\u00001', 'x')]))
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('invalid')
    expect((await layoutRow(await db(), id)).version).toBe(1)
  })
})

describe('POST /api/layouts/[id]/duplicate', () => {
  it('saves a copy of a deleted layout when the canvas comes with it, and 404s without one', async () => {
    const { makeGuest, makeLayout } = await import('@/server/repo/test-fixtures')
    const { softDeleteLayout } = await import('@/server/repo/layouts')
    const { softDeleteWedding } = await import('@/server/repo/weddings')
    const one = await import('./route')
    const duplicate = await import('./duplicate/route')
    const w = await makeWedding(await db())
    const ann = await makeGuest(await db(), w, 'Ann')
    const id = await makeLayout(await db(), w, undefined, { name: 'Dinner' })
    expect(await softDeleteLayout(await db(), w, id)).toBe(true)

    // The tab's save now answers 410, and the editor offers "Save as a copy".
    expect((await call(one, 'PUT', id, saveBody(1, []))).status).toBe(410)
    const mine = { schemaVersion: 1, items: [table('t1', 1, [ann, null])] }
    const copy = await call(duplicate, 'POST', id, { name: "Dinner (Noa's copy)", canvas: mine, editedBy: 'Noa' })
    expect(copy.status).toBe(201)
    expect(copy.body).toMatchObject({ weddingId: w, name: "Dinner (Noa's copy)", version: 1, canvas: mine, recentSaveIds: [] })
    expect((await call(one, 'GET', copy.body.id)).status).toBe(200)

    // A plain duplicate of a deleted layout has nothing to copy.
    expect((await call(duplicate, 'POST', id, { editedBy: 'Noa' })).status).toBe(404)

    // Once the wedding is deleted, nothing can be copied into it.
    await softDeleteWedding(await db(), w)
    expect((await call(duplicate, 'POST', id, { canvas: mine, editedBy: 'Noa' })).status).toBe(404)
  })
})

describe('recent save ids', () => {
  it('a retry of an older save after another save answers already-saved with that save\'s version', async () => {
    const { makeLayout } = await import('@/server/repo/test-fixtures')
    const one = await import('./route')
    const version = await import('./version/route')
    const w = await makeWedding(await db())
    const id = await makeLayout(await db(), w)

    const first = saveBody(1, [table('t1', 1, [null])])
    expect((await call(one, 'PUT', id, first)).body).toMatchObject({ status: 'saved', version: 2 })
    const second = { ...saveBody(2, [table('t2', 2, [null])]), editedBy: 'Aiden' }
    expect((await call(one, 'PUT', id, second)).body).toMatchObject({ status: 'saved', version: 3 })

    // The first save's reply was lost; its retry must not claim version 3.
    const retry = await call(one, 'PUT', id, first)
    expect(retry).toMatchObject({ status: 200, body: { status: 'already-saved', version: 2, editedBy: 'Pat', editedById: me } })
    // So the tab's next save starts from 2 and meets Aiden's save as a conflict.
    const next = await call(one, 'PUT', id, saveBody(2, [table('t3', 3, [null])]))
    expect(next.status).toBe(409)
    expect((next.body as SaveLayoutConflict).recentSaveIds).toEqual([second.saveId, first.saveId])

    const info = (await call(version, 'GET', id)).body as LayoutVersionInfo
    expect(info).toMatchObject({ version: 3, editedBy: 'Pat', editedById: me, lastSaveId: second.saveId })
    expect(info.recentSaveIds).toEqual([second.saveId, first.saveId])
    const detail = (await call(one, 'GET', id)).body as LayoutDetail
    expect(detail.recentSaveIds).toEqual([second.saveId, first.saveId])
  })
})
