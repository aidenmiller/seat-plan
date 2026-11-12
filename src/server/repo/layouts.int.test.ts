/**
 * Layouts, weddings and venues repositories against the test database:
 * create, duplicate, rename, delete (acceptance check 17), delete summaries,
 * and what a deleted wedding hides. Also: a wedding's creator is its owner,
 * every layout call is held to the wedding the route resolved, and a layout
 * may only use a venue its wedding may use.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeTestDb } from '../../../test/db'
import { makeMember, makeUser } from '../../../test/auth'
import { createWeddingBody } from '@/shared/api'
import type { Viewer } from '../auth/venue-access'
import type { Editor } from '../editor-name'
import { activityEvents, groups, layouts, rules, shareLinks, users, venueTemplates, weddingMembers } from '../db/schema'
import { removeGuests } from './guests'
import {
  copyName,
  createLayout,
  duplicateLayout,
  getLayoutDetail,
  layoutDeleteSummary,
  layoutVersion,
  listLayouts,
  saveLayout,
  softDeleteLayout,
  updateLayout,
} from './layouts'
import { listVenues } from './venues'
import {
  createWedding,
  getWedding,
  listWeddings,
  listWeddingsForUser,
  softDeleteWedding,
  updateWedding,
  weddingDeleteSummary,
} from './weddings'
import {
  canvasOf,
  canvasSeats,
  layoutRow,
  makeGuest,
  makeLayout as makeLayoutRow,
  makeTemplate,
  makeWedding as makeWeddingRow,
  roundTable,
  seatRows,
} from './test-fixtures'

const { pool, db } = makeTestDb()
afterAll(async () => {
  await pool.end()
})

/** The planner this file acts as: the owner of every wedding it makes. */
let me: Viewer
/** Two signed-in people who save, as a route passes them (editorOf). */
let NOA: Editor
let AIDEN: Editor
beforeAll(async () => {
  me = { userId: (await makeUser(db, { displayName: 'Me' })).id, isAdmin: false }
  NOA = { userId: (await makeUser(db, { displayName: 'Noa' })).id, name: 'Noa' }
  AIDEN = { userId: (await makeUser(db, { displayName: 'Aiden' })).id, name: 'Aiden' }
})

/** Every wedding this file makes, and the wedding of each layout, for the checks below. */
const mine: string[] = []
const weddingOf = new Map<string, string>()
async function makeWedding(database: typeof db, name?: string) {
  const id = await makeWeddingRow(database, name)
  await makeMember(database, id, me.userId, 'owner')
  mine.push(id)
  return id
}

/** makeLayout, remembering the layout's wedding. */
async function makeLayout(...args: Parameters<typeof makeLayoutRow>): Promise<string> {
  const id = await makeLayoutRow(...args)
  weddingOf.set(id, args[1])
  return id
}

/** The wedding a layout this file made belongs to, as a route's guard resolves it. */
function w8(layoutId: string): string {
  const id = weddingOf.get(layoutId)
  if (!id) throw new Error(`no wedding known for layout ${layoutId}`)
  return id
}

/** A template `me` owns, so layouts in my weddings may use it. */
async function myTemplate(name?: string): Promise<string> {
  const id = await makeTemplate(db, name)
  await db.update(venueTemplates).set({ ownerUserId: me.userId }).where(eq(venueTemplates.id, id))
  return id
}

function save(layoutId: string, baseVersion: number, canvas: ReturnType<typeof canvasOf>) {
  return saveLayout(db, w8(layoutId), layoutId, { baseVersion, saveId: randomUUID(), tabId: 'tab', canvas }, NOA)
}

const note = {
  id: 'n1',
  kind: 'note' as const,
  type: 'sticky' as const,
  x: 0,
  y: 0,
  rotation: 0,
  locked: false,
  width: 100,
  height: 100,
  text: 'Ask about the cake',
  color: 'yellow' as const,
  author: 'Noa' as const,
  done: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  attachedTo: { start: null, end: null },
}

describe('weddings', () => {
  it('creates, lists with live counts, updates and deletes', async () => {
    const created = await createWedding(db, createWeddingBody.parse({ name: '  Noa & Aiden ', date: '2027-06-12', unit: 'm' }), me.userId)
    if (created.status !== 'created') throw new Error('expected created')
    const w = created.wedding
    expect(w).toMatchObject({ name: 'Noa & Aiden', date: '2027-06-12', unit: 'm', minGapCm: 152.4, guestCount: 0, layoutCount: 0 })

    await makeGuest(db, w.id, 'Ann')
    const gone = await makeGuest(db, w.id, 'Gone')
    await removeGuests(db, w.id, [gone])
    await makeLayout(db, w.id)
    const deletedLayout = await makeLayout(db, w.id)
    await softDeleteLayout(db, w.id, deletedLayout)

    const listed = (await listWeddings(db)).find((x) => x.id === w.id)
    expect(listed).toMatchObject({ guestCount: 1, layoutCount: 1 })

    const updated = await updateWedding(db, w.id, { name: 'N & A', minGapCm: 120, date: null })
    expect(updated).toMatchObject({ name: 'N & A', minGapCm: 120, date: null, unit: 'm' })

    expect(await softDeleteWedding(db, w.id)).toBe(true)
    expect(await softDeleteWedding(db, w.id)).toBe(false)
    expect(await getWedding(db, w.id)).toBeNull()
    expect((await listWeddings(db)).some((x) => x.id === w.id)).toBe(false)
    expect(await updateWedding(db, w.id, { name: 'Again' })).toBeNull()
  })

  it('a retried create with the same id gives the same wedding; a deleted one is id-taken', async () => {
    const id = randomUUID()
    const a = await createWedding(db, { id, name: 'First' }, me.userId)
    const b = await createWedding(db, { id, name: 'Second' }, me.userId)
    expect(a).toMatchObject({ status: 'created', existed: false, wedding: { id, name: 'First' } })
    expect(b).toMatchObject({ status: 'created', existed: true, wedding: { id, name: 'First' } })
    await softDeleteWedding(db, id)
    expect(await createWedding(db, { id, name: 'Third' }, me.userId)).toEqual({ status: 'id-taken' })
  })

  it('makes its creator the owner and logs it; the same id from anyone else is id-taken, with nothing about the wedding', async () => {
    const id = randomUUID()
    const created = await createWedding(db, { id, name: 'Owned' }, me.userId)
    expect(created.status).toBe('created')
    expect(await db.select({ userId: weddingMembers.userId, role: weddingMembers.role }).from(weddingMembers).where(eq(weddingMembers.weddingId, id))).toEqual([
      { userId: me.userId, role: 'owner' },
    ])
    const events = await db
      .select({ kind: activityEvents.kind, userId: activityEvents.userId })
      .from(activityEvents)
      .where(and(eq(activityEvents.weddingId, id), eq(activityEvents.kind, 'wedding_created')))
    expect(events).toEqual([{ kind: 'wedding_created', userId: me.userId }])

    const stranger = await makeUser(db)
    expect(await createWedding(db, { id, name: 'Mine now' }, stranger.id)).toEqual({ status: 'id-taken' })
    // Nobody was added, and the wedding kept its name.
    expect(await db.select({ userId: weddingMembers.userId }).from(weddingMembers).where(eq(weddingMembers.weddingId, id))).toHaveLength(1)
    expect(await getWedding(db, id)).toMatchObject({ name: 'Owned' })
    // An editor retrying gets it back (they belong to it).
    await makeMember(db, id, stranger.id, 'editor')
    expect(await createWedding(db, { id, name: 'Again' }, stranger.id)).toMatchObject({ status: 'created', existed: true, wedding: { name: 'Owned' } })
  })

  it('lists only the weddings a user belongs to, live ones, oldest first', async () => {
    const someone = await makeUser(db)
    const first = await makeWeddingRow(db, 'First of mine')
    const second = await makeWeddingRow(db, 'Second of mine')
    const gone = await makeWeddingRow(db, 'Deleted of mine')
    const notMine = await makeWeddingRow(db, 'Not mine')
    await makeMember(db, first, someone.id, 'owner')
    await makeMember(db, second, someone.id, 'editor')
    await makeMember(db, gone, someone.id, 'owner')
    await softDeleteWedding(db, gone)
    const listed = await listWeddingsForUser(db, someone.id)
    expect(listed.map((w) => w.id)).toEqual([first, second])
    expect(listed.map((w) => w.id)).not.toContain(notMine)
    expect(listed[0]).toMatchObject({ name: 'First of mine', guestCount: 0, layoutCount: 0 })
  })

  it('delete summary counts live layouts, live guests, groups and rules', async () => {
    const w = await makeWedding(db, 'Counted')
    await makeGuest(db, w, 'A')
    await makeGuest(db, w, 'B')
    await makeGuest(db, w, 'C')
    const gone = await makeGuest(db, w, 'D')
    await removeGuests(db, w, [gone])
    await makeLayout(db, w)
    await makeLayout(db, w)
    await softDeleteLayout(db, w, await makeLayout(db, w))
    await db.insert(groups).values([
      { weddingId: w, name: 'Family', color: '#112233' },
      { weddingId: w, name: 'Friends', color: '#445566' },
    ])
    await db.insert(rules).values({ weddingId: w, kind: 'apart' })

    expect(await weddingDeleteSummary(db, w)).toEqual({
      kind: 'wedding',
      name: 'Counted',
      layouts: 2,
      guests: 3,
      groups: 2,
      rules: 1,
    })
  })

  it('a deleted wedding hides its layouts and its summary', async () => {
    const w = await makeWedding(db)
    const layoutId = await makeLayout(db, w)
    await softDeleteWedding(db, w)
    expect(await listLayouts(db, w)).toBeNull()
    expect(await getLayoutDetail(db, w, layoutId)).toBeNull()
    expect(await layoutVersion(db, w, layoutId)).toBeNull()
    expect(await layoutDeleteSummary(db, w, layoutId)).toBeNull()
    expect(await weddingDeleteSummary(db, w)).toBeNull()
    expect(await softDeleteLayout(db, w, layoutId)).toBe(false)
    expect(await updateLayout(db, w, layoutId, { name: 'X' }, me)).toEqual({ status: 'not-found' })
    expect(await duplicateLayout(db, w, layoutId, {}, NOA)).toEqual({ status: 'not-found' })
    expect(await createLayout(db, w, { name: 'New', kind: 'reception', venueTemplateId: null }, me, NOA)).toEqual({
      status: 'not-found',
    })
    expect((await save(layoutId, 1, canvasOf())).status).toBe('gone')
    // Only the wedding row was marked.
    expect((await layoutRow(db, layoutId)).deletedAt).toBeNull()
  })
})

describe('layouts', () => {
  it('creates an empty layout on a live template, and refuses a deleted one', async () => {
    const w = await makeWedding(db)
    const t = await myTemplate('Beach Club')
    const created = await createLayout(db, w, { name: 'Dinner', kind: 'reception', venueTemplateId: t }, me, AIDEN)
    if (created.status !== 'created') throw new Error(created.status)
    expect(created.layout).toMatchObject({
      weddingId: w,
      name: 'Dinner',
      kind: 'reception',
      venueTemplateId: t,
      venueName: 'Beach Club',
      version: 1,
      editedBy: 'Aiden',
      canvas: { schemaVersion: 1, items: [] },
      lastSaveId: null,
      template: { id: t, name: 'Beach Club', version: 1, deleted: false },
    })
    expect(created.layout.template!.fixedItems).toHaveLength(1)
    // The thumbnail shows the template's wall.
    expect(created.layout.thumbSvg).toContain('<polyline')

    await db.update(venueTemplates).set({ deletedAt: new Date() }).where(eq(venueTemplates.id, t))
    expect(await createLayout(db, w, { name: 'X', kind: 'reception', venueTemplateId: t }, me, NOA)).toEqual({
      status: 'bad-template',
    })
    // The layout that chose it still opens, with the template flagged as deleted.
    const detail = await getLayoutDetail(db, w, created.layout.id)
    expect(detail!.template).toMatchObject({ id: t, deleted: true })
    expect(detail!.venueName).toBe('Beach Club')
  })

  it('a create retried with the same id gives back the same layout', async () => {
    const w = await makeWedding(db)
    const id = randomUUID()
    const body = { id, name: 'Dinner', kind: 'reception' as const, venueTemplateId: null }
    const a = await createLayout(db, w, body, me, NOA)
    const b = await createLayout(db, w, body, me, NOA)
    expect(a.status).toBe('created')
    expect(b).toEqual(a)
    expect((await listLayouts(db, w))!.map((l) => l.id)).toEqual([id])
  })

  it('renames and changes the template without raising the version', async () => {
    const w = await makeWedding(db)
    const t = await myTemplate()
    const layoutId = await makeLayout(db, w, canvasOf(roundTable('t1', 1, [null])))
    await save(layoutId, 1, canvasOf(roundTable('t1', 1, [null])))
    const before = await layoutRow(db, layoutId)

    const renamed = await updateLayout(db, w, layoutId, { name: 'Plan B' }, me)
    expect(renamed).toMatchObject({ status: 'updated', layout: { name: 'Plan B', version: 2 } })
    const moved = await updateLayout(db, w, layoutId, { venueTemplateId: t }, me)
    expect(moved).toMatchObject({ status: 'updated', layout: { venueTemplateId: t, version: 2 } })
    const after = await layoutRow(db, layoutId)
    expect(after.version).toBe(2)
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
    expect(after.thumbSvg).not.toBe(before.thumbSvg)
    expect(after.thumbSvg).toContain('<polyline')

    expect(await updateLayout(db, w, layoutId, { venueTemplateId: randomUUID() }, me)).toEqual({ status: 'bad-template' })
    expect((await updateLayout(db, w, layoutId, { venueTemplateId: null }, me)).status).toBe('updated')
    expect((await layoutRow(db, layoutId)).venueTemplateId).toBeNull()
  })

  it('duplicate keeps tables, seats and notes, named "<name> copy"', async () => {
    const w = await makeWedding(db)
    const [ann, ben] = [await makeGuest(db, w, 'Ann'), await makeGuest(db, w, 'Ben')]
    const canvas = canvasOf(roundTable('t1', 1, [ann, null]), roundTable('t2', 2, [ben], 'Family'), note)
    const source = await makeLayout(db, w, canvas, { name: 'Dinner', kind: 'ceremony' })

    const copy = await duplicateLayout(db, w, source, {}, AIDEN)
    if (copy.status !== 'created') throw new Error(copy.status)
    expect(copy.layout).toMatchObject({ name: 'Dinner copy', kind: 'ceremony', version: 1, editedBy: 'Aiden', canvas })
    expect(copy.layout.id).not.toBe(source)
    expect(await seatRows(db, copy.layout.id)).toEqual(await seatRows(db, source))
    expect((await seatRows(db, copy.layout.id)).map((s) => s.itemLabel)).toEqual(['Table 1', 'Family (table 2)'])
    // The source is untouched.
    expect((await layoutRow(db, source)).version).toBe(1)
  })

  it('"keep mine" copies a deleted layout when the canvas is sent; a plain duplicate of it is not found', async () => {
    const w = await makeWedding(db)
    const t = await makeTemplate(db)
    const source = await makeLayout(db, w, canvasOf(), { name: 'Dinner', kind: 'ceremony', venueTemplateId: t })
    expect(await softDeleteLayout(db, w, source)).toBe(true)
    const mine = canvasOf(roundTable('t1', 1, [null]))

    const copy = await duplicateLayout(db, w, source, { canvas: mine, name: 'Dinner (Noa\'s copy)' }, NOA)
    if (copy.status !== 'created') throw new Error(copy.status)
    expect(copy.layout).toMatchObject({ name: "Dinner (Noa's copy)", kind: 'ceremony', venueTemplateId: t, canvas: mine })
    expect(await duplicateLayout(db, w, source, {}, NOA)).toEqual({ status: 'not-found' })
    // Without a name, the copy takes the deleted layout's name.
    const unnamed = await duplicateLayout(db, w, source, { canvas: mine }, AIDEN)
    expect(unnamed).toMatchObject({ status: 'created', layout: { name: 'Dinner copy' } })
    expect((await layoutRow(db, source)).deletedAt).not.toBeNull()
  })

  it('"keep mine" stores the sent canvas under the sent name, dropping a removed guest', async () => {
    const w = await makeWedding(db)
    const [ann, ben] = [await makeGuest(db, w, 'Ann'), await makeGuest(db, w, 'Ben')]
    const source = await makeLayout(db, w, canvasOf(), { name: 'Dinner' })
    await removeGuests(db, w, [ben])
    const mine = canvasOf(roundTable('t1', 1, [ann, ben]))
    const copy = await duplicateLayout(db, w, source, { canvas: mine, name: "Dinner (Noa's copy)" }, NOA)
    if (copy.status !== 'created') throw new Error(copy.status)
    expect(copy.layout.name).toBe("Dinner (Noa's copy)")
    expect(canvasSeats(copy.layout.canvas)).toEqual([{ guestId: ann, itemId: 't1', seatIndex: 0 }])
  })

  it('copyName keeps names within 200 characters', () => {
    expect(copyName('Dinner')).toBe('Dinner copy')
    expect(copyName('x'.repeat(200))).toHaveLength(200)
  })

  it('deleting one layout leaves the other layouts exactly as they were (acceptance check 17)', async () => {
    const w = await makeWedding(db)
    const [ann, ben] = [await makeGuest(db, w, 'Ann'), await makeGuest(db, w, 'Ben')]
    const a = await makeLayout(db, w, canvasOf(roundTable('t1', 1, [ann, ben])), { name: 'A' })
    const b = await makeLayout(db, w, canvasOf(roundTable('t1', 1, [ben, ann])), { name: 'B' })
    const c = await makeLayout(db, w, canvasOf(roundTable('t1', 1, [ann])), { name: 'C' })
    await save(a, 1, canvasOf(roundTable('t1', 1, [ann, ben]), note))
    const snapshot = async (id: string) => {
      const row = await layoutRow(db, id)
      return { version: row.version, canvas: row.canvas, updatedAt: row.updatedAt.getTime(), seats: await seatRows(db, id) }
    }
    const before = { a: await snapshot(a), c: await snapshot(c) }

    expect(await softDeleteLayout(db, w, b)).toBe(true)
    expect({ a: await snapshot(a), c: await snapshot(c) }).toEqual(before)
    expect((await listLayouts(db, w))!.map((l) => l.name).sort()).toEqual(['A', 'C'])
    expect(await getLayoutDetail(db, w, b)).toBeNull()
    // Its rows stay, so guest removal still finds it and undoing the delete brings it back whole.
    expect((await seatRows(db, b)).length).toBe(2)
    expect(await softDeleteLayout(db, w, b)).toBe(false)
  })

  it('delete summary counts tables, seated guests, notes and live share links', async () => {
    const w = await makeWedding(db)
    const [ann, ben] = [await makeGuest(db, w, 'Ann'), await makeGuest(db, w, 'Ben')]
    const layoutId = await makeLayout(
      db,
      w,
      canvasOf(roundTable('t1', 1, [ann, null]), roundTable('t2', 2, [ben]), roundTable('t3', 3, []), note),
      { name: 'Dinner' },
    )
    const token = () => randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
    await db.insert(shareLinks).values([
      { weddingId: w, layoutId, label: 'Caterer', token: token(), passwordHash: 'x' },
      { weddingId: w, layoutId, label: 'DJ', token: token(), passwordHash: 'x', revokedAt: new Date() },
    ])
    expect(await layoutDeleteSummary(db, w, layoutId)).toEqual({
      kind: 'layout',
      name: 'Dinner',
      tables: 3,
      seatedGuests: 2,
      notes: 1,
      shareLinks: 1,
    })
  })

  it('lists live layouts with venue names, last edited first, and reports versions', async () => {
    const w = await makeWedding(db)
    const t = await makeTemplate(db, 'Garden')
    const first = await makeLayout(db, w, canvasOf(), { name: 'First', venueTemplateId: t })
    const second = await makeLayout(db, w, canvasOf(), { name: 'Second' })
    const saved = await save(first, 1, canvasOf(roundTable('t1', 1, [null])))
    const list = await listLayouts(db, w)
    expect(list!.map((l) => [l.name, l.venueName, l.venueDeleted, l.version])).toEqual([
      ['First', 'Garden', false, 2],
      ['Second', null, false, 1],
    ])
    expect(list![0]!.thumbSvg).toMatch(/^<svg /)
    const lastSaveId = (await layoutRow(db, first)).lastSaveId
    expect(await layoutVersion(db, w, first)).toEqual({
      version: 2,
      updatedAt: saved.status === 'saved' ? saved.updatedAt.toISOString() : '',
      editedBy: 'Noa',
      editedById: NOA.userId,
      lastSaveId,
      recentSaveIds: [lastSaveId],
    })
    expect(await layoutVersion(db, w, second)).toEqual(expect.objectContaining({ version: 1, lastSaveId: null, recentSaveIds: [] }))
  })

  it('flags a layout whose venue template was deleted, keeping the old venue name', async () => {
    const w = await makeWedding(db)
    const t = await makeTemplate(db, 'Old Barn')
    const layoutId = await makeLayout(db, w, canvasOf(), { name: 'Dinner', venueTemplateId: t })
    const blank = await makeLayout(db, w, canvasOf(), { name: 'Blank' })
    await db.update(venueTemplates).set({ deletedAt: new Date() }).where(eq(venueTemplates.id, t))

    const list = await listLayouts(db, w)
    const byId = new Map(list!.map((l) => [l.id, l]))
    expect(byId.get(layoutId)).toMatchObject({ venueTemplateId: t, venueName: 'Old Barn', venueDeleted: true })
    expect(byId.get(blank)).toMatchObject({ venueTemplateId: null, venueName: null, venueDeleted: false })
    const detail = await getLayoutDetail(db, w, layoutId)
    expect(detail).toMatchObject({ venueName: 'Old Barn', venueDeleted: true, template: { id: t, deleted: true } })
    expect((await getLayoutDetail(db, w, blank))!.venueDeleted).toBe(false)
  })

  it('treats a layout of another wedding as missing, in every call that takes a layout id', async () => {
    const w = await makeWedding(db)
    const elsewhere = await makeWedding(db)
    const layoutId = await makeLayout(db, elsewhere, canvasOf(roundTable('t1', 1, [null])), { name: 'Theirs' })
    const before = await layoutRow(db, layoutId)

    expect(await getLayoutDetail(db, w, layoutId)).toBeNull()
    expect(await layoutVersion(db, w, layoutId)).toBeNull()
    expect(await layoutDeleteSummary(db, w, layoutId)).toBeNull()
    expect(await updateLayout(db, w, layoutId, { name: 'Taken' }, me)).toEqual({ status: 'not-found' })
    expect(await duplicateLayout(db, w, layoutId, {}, NOA)).toEqual({ status: 'not-found' })
    expect(await duplicateLayout(db, w, layoutId, { canvas: canvasOf() }, NOA)).toEqual({ status: 'not-found' })
    expect(await softDeleteLayout(db, w, layoutId)).toBe(false)
    const saved = await saveLayout(db, w, layoutId, { baseVersion: 1, saveId: randomUUID(), tabId: 'tab', canvas: canvasOf() }, NOA)
    expect(saved.status).toBe('gone')
    // Nothing changed, and nothing was added to either wedding.
    expect(await layoutRow(db, layoutId)).toEqual(before)
    expect(await listLayouts(db, w)).toEqual([])
  })

  it('only lets a layout use a venue its wedding may use: the library, the viewer own, or one the wedding uses', async () => {
    const w = await makeWedding(db)
    const someone = { userId: (await makeUser(db)).id, isAdmin: false }
    const theirs = await makeTemplate(db, 'Their private hall')
    await db.update(venueTemplates).set({ ownerUserId: someone.userId }).where(eq(venueTemplates.id, theirs))
    const [library] = await db
      .select({ id: venueTemplates.id })
      .from(venueTemplates)
      .where(and(eq(venueTemplates.isLibrary, true), isNull(venueTemplates.deletedAt)))
    const layoutId = await makeLayout(db, w, canvasOf(), { name: 'Dinner' })

    // Someone else's private template reads as missing, on create and on change.
    expect(await createLayout(db, w, { name: 'X', kind: 'reception', venueTemplateId: theirs }, me, NOA)).toEqual({ status: 'bad-template' })
    expect(await updateLayout(db, w, layoutId, { venueTemplateId: theirs }, me)).toEqual({ status: 'bad-template' })
    expect((await layoutRow(db, layoutId)).venueTemplateId).toBeNull()
    // An admin gets no extra here either.
    const admin = { userId: (await makeUser(db, { isAdmin: true })).id, isAdmin: true }
    expect(await updateLayout(db, w, layoutId, { venueTemplateId: theirs }, admin)).toEqual({ status: 'bad-template' })
    // The library is open to everyone.
    expect(await updateLayout(db, w, layoutId, { venueTemplateId: library!.id }, me)).toMatchObject({ status: 'updated' })

    // Once the wedding uses it (a co-planner attached their own), anyone in the wedding may use it there, and only there.
    await makeMember(db, w, someone.userId, 'editor')
    const attached = await createLayout(db, w, { name: 'Theirs here', kind: 'reception', venueTemplateId: theirs }, someone, AIDEN)
    expect(attached.status).toBe('created')
    expect(await updateLayout(db, w, layoutId, { venueTemplateId: theirs }, me)).toMatchObject({ status: 'updated' })
    const otherWedding = await makeWedding(db)
    expect(await createLayout(db, otherWedding, { name: 'Y', kind: 'reception', venueTemplateId: theirs }, me, NOA)).toEqual({
      status: 'bad-template',
    })
  })
})

describe('who edited a layout', () => {
  it('a save records the signed-in user (id and name), never writes the old column, and replies with both', async () => {
    const w = await makeWedding(db)
    const layoutId = await makeLayout(db, w, canvasOf())
    // A row with an old Noa / Aiden value, as written before accounts.
    await db.update(layouts).set({ editedBy: 'Noa', editedByName: 'Noa' }).where(eq(layouts.id, layoutId))

    const saved = await saveLayout(db, w, layoutId, { baseVersion: 1, saveId: randomUUID(), tabId: 'tab', canvas: canvasOf() }, AIDEN)
    expect(saved).toMatchObject({ status: 'saved', editedBy: 'Aiden', editedById: AIDEN.userId })
    expect(await layoutRow(db, layoutId)).toMatchObject({ editedBy: null, editedByName: 'Aiden', editedByUserId: AIDEN.userId })

    const copy = await duplicateLayout(db, w, layoutId, { id: randomUUID() }, NOA)
    expect(copy.status).toBe('created')
    if (copy.status === 'created') {
      expect(await layoutRow(db, copy.layout.id)).toMatchObject({ editedBy: null, editedByName: 'Noa', editedByUserId: NOA.userId })
      expect(copy.layout).toMatchObject({ editedBy: 'Noa', editedById: NOA.userId })
    }

    const made = await createLayout(db, w, { name: 'New', kind: 'reception', venueTemplateId: null }, me, AIDEN)
    if (made.status !== 'created') throw new Error(made.status)
    expect(await layoutRow(db, made.layout.id)).toMatchObject({ editedBy: null, editedByName: 'Aiden', editedByUserId: AIDEN.userId })
  })

  it('a retry of a save that landed before someone else saved answers with this editor', async () => {
    const w = await makeWedding(db)
    const layoutId = await makeLayout(db, w, canvasOf())
    const saveId = randomUUID()
    const body = { baseVersion: 1, saveId, tabId: 'tab', canvas: canvasOf() }
    expect(await saveLayout(db, w, layoutId, body, NOA)).toMatchObject({ status: 'saved', version: 2 })
    expect(await saveLayout(db, w, layoutId, { ...body, baseVersion: 2, saveId: randomUUID() }, AIDEN)).toMatchObject({ status: 'saved', version: 3 })
    expect(await saveLayout(db, w, layoutId, body, NOA)).toMatchObject({ status: 'already-saved', version: 2, editedBy: 'Noa', editedById: NOA.userId })
  })

  it('reads the name from edited_by_name when edited_by is null, in every reply', async () => {
    const w = await makeWedding(db)
    const layoutId = await makeLayout(db, w, canvasOf())
    await db.update(layouts).set({ editedBy: null, editedByName: 'Dayna K.' }).where(eq(layouts.id, layoutId))

    expect(await layoutVersion(db, w, layoutId)).toMatchObject({ editedBy: 'Dayna K.', editedById: null })
    expect((await listLayouts(db, w))![0]).toMatchObject({ editedBy: 'Dayna K.', editedById: null })
    expect(await getLayoutDetail(db, w, layoutId)).toMatchObject({ editedBy: 'Dayna K.', editedById: null })
    // A stale save meets a conflict that names her.
    expect(await save(layoutId, 0, canvasOf())).toMatchObject({ status: 'conflict', editedBy: 'Dayna K.', editedById: null })
  })

  it('falls back to edited_by for a row written before edited_by_name existed', async () => {
    const w = await makeWedding(db)
    const layoutId = await makeLayout(db, w, canvasOf())
    await db.update(layouts).set({ editedBy: 'Aiden', editedByName: null }).where(eq(layouts.id, layoutId))
    expect(await layoutVersion(db, w, layoutId)).toMatchObject({ editedBy: 'Aiden', editedById: null })
  })

  it('reads edited_by_user_id back as the id, and the next save puts its own editor in its place', async () => {
    const w = await makeWedding(db)
    const layoutId = await makeLayout(db, w, canvasOf())
    const [user] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: 'Dayna K.', passwordHash: 'x' })
      .returning({ id: users.id })
    await db.update(layouts).set({ editedBy: null, editedByName: 'Dayna K.', editedByUserId: user!.id }).where(eq(layouts.id, layoutId))

    expect(await layoutVersion(db, w, layoutId)).toMatchObject({ editedBy: 'Dayna K.', editedById: user!.id })
    expect((await listLayouts(db, w))![0]).toMatchObject({ editedBy: 'Dayna K.', editedById: user!.id })
    expect(await getLayoutDetail(db, w, layoutId)).toMatchObject({ editedById: user!.id })
    expect(await save(layoutId, 0, canvasOf())).toMatchObject({ status: 'conflict', editedById: user!.id })

    expect(await save(layoutId, 1, canvasOf())).toMatchObject({ status: 'saved', editedBy: 'Noa', editedById: NOA.userId })
    expect(await layoutRow(db, layoutId)).toMatchObject({ editedBy: null, editedByName: 'Noa', editedByUserId: NOA.userId })
    await db.delete(users).where(eq(users.id, user!.id))
  })
})

describe('venues', () => {
  it('lists live templates with the live layouts in live weddings that use them', async () => {
    const t = await myTemplate(`Venue ${randomUUID()}`)
    const deletedTemplate = await myTemplate(`Deleted ${randomUUID()}`)
    await db.update(venueTemplates).set({ deletedAt: new Date() }).where(eq(venueTemplates.id, deletedTemplate))
    const w = await makeWedding(db)
    const goneWedding = await makeWedding(db)
    await makeLayout(db, w, canvasOf(), { venueTemplateId: t })
    await softDeleteLayout(db, w, await makeLayout(db, w, canvasOf(), { venueTemplateId: t }))
    await makeLayout(db, goneWedding, canvasOf(), { venueTemplateId: t })
    await softDeleteWedding(db, goneWedding)

    const venues = await listVenues(db, me)
    expect(venues.find((v) => v.id === t)).toMatchObject({ usedBy: 1 })
    expect(venues.some((v) => v.id === deletedTemplate)).toBe(false)
  })
})

describe('layout_seats', () => {
  it('holds exactly the seats in every canvas this file wrote, deleted layouts included', async () => {
    const rows = await db.select({ id: layouts.id, canvas: layouts.canvas }).from(layouts).where(inArray(layouts.weddingId, mine))
    expect(rows.length).toBeGreaterThan(10)
    for (const row of rows) {
      const fromTable = (await seatRows(db, row.id)).map(({ guestId, itemId, seatIndex }) => ({ guestId, itemId, seatIndex }))
      expect(fromTable, row.id).toEqual(canvasSeats(row.canvas))
    }
  })
})
