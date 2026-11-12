/**
 * The guest CSV import and export routes against the test database: the
 * sample file imported twice gives no duplicates (acceptance check 13),
 * needs-review rows block the commit until picked, partner picks, removing
 * guests missing from the file clears their seats in the layouts the summary
 * names, and an exported file re-imports with no changes.
 *
 * Rows are built the way the browser builds them: parseCsv, guessMapping,
 * applyMapping.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../../../../test/db'
import { makeUser, makeWeddingFor, sessionCookie } from '../../../../../../../test/auth'
import type { Db } from '@/server/locks'
import { applyMapping, guessMapping, type ImportRow } from '@/domain/csv/columns'
import { CSV_BOM, EXPORT_COLUMNS } from '@/domain/csv/export'
import { MAX_IMPORT_ROWS, parseCsv } from '@/domain/csv/parse'
import { SAMPLE_CSV_FILE } from '@/domain/csv/sample'
import { GROUP_COLORS } from '@/domain/group-colors'
import type { PartnerNames } from '@/domain/partners'
import { MAX_GUEST_ROWS, type Guest, type ImportCommitResult, type ImportPreview } from '@/shared/api'

/** The cookie of the user every test acts as: the owner of each wedding it makes. */
let signedIn = ''
let me = ''

/** A wedding the signed-in user owns (routes answer 404 to anyone who is not a member). */
const makeWedding = (database: Db, name?: string) => makeWeddingFor(database, me, name)

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'import-route-test-secret-32-chars-plus')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  const database = await db()
  me = (await makeUser(database)).id
  signedIn = await sessionCookie(database, me)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>

async function send(mod: Record<string, unknown>, method: string, id: string, body?: unknown) {
  const headers: Record<string, string> = { cookie: signedIn }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const req = new NextRequest('https://seat.example/api/x', {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  return (mod[method] as Handler)(req, { params: Promise.resolve({ id }) })
}

async function call(mod: Record<string, unknown>, method: string, id: string, body?: unknown) {
  const res = await send(mod, method, id, body)
  const text = await res.text()
  return { status: res.status, cache: res.headers.get('cache-control'), body: text ? JSON.parse(text) : null }
}

async function db() {
  return (await import('@/server/db/client')).getDb()
}

const routes = async () => ({
  preview: await import('./preview/route'),
  commit: await import('./commit/route'),
  exporter: await import('../export/route'),
  guests: await import('../route'),
  groups: await import('../../groups/route'),
  guest: await import('../../../../guests/[id]/route'),
})

const NOA_AIDEN: PartnerNames = { partner1: 'Noa', partner2: 'Aiden' }

/** What the browser sends after the column matching step, reading sides with the wedding's names. */
function rowsOf(text: string, partners: PartnerNames = NOA_AIDEN): ImportRow[] {
  const parsed = parseCsv(text)
  expect(parsed.errors).toEqual([])
  const mapped = applyMapping(parsed.rows, guessMapping(parsed.headers), partners, parsed.rowNumbers)
  expect(mapped.errors).toEqual([])
  return mapped.rows
}

async function preview(weddingId: string, body: Record<string, unknown>): Promise<ImportPreview> {
  const { preview } = await routes()
  const res = await call(preview, 'POST', weddingId, body)
  expect(res.status).toBe(200)
  expect(res.cache).toBe('no-store')
  return res.body
}

async function commit(weddingId: string, body: Record<string, unknown>): Promise<ImportCommitResult> {
  const { commit } = await routes()
  const res = await call(commit, 'POST', weddingId, { removeMissing: false, ...body })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body
}

async function guestList(weddingId: string): Promise<Guest[]> {
  const { guests } = await routes()
  return (await call(guests, 'GET', weddingId)).body
}

const byName = (list: Guest[], first: string, last?: string) =>
  list.find((g) => g.firstName === first && (last === undefined || g.lastName === last))!

describe('guest CSV import', () => {
  it('imports the sample file, and importing it again gives 0 new and 0 changed (check 13)', async () => {
    const { groups } = await routes()
    const w = await makeWedding(await db())
    const rows = rowsOf(SAMPLE_CSV_FILE)
    expect(rows).toHaveLength(10)

    const first = await preview(w, { rows })
    expect(first.plan.counts).toEqual({ new: 10, changed: 0, unchanged: 0, needsReview: 0, missing: 0 })
    expect(first.plan.groupsToCreate).toEqual([
      'Partner 1 family',
      'Partner 1 cousins',
      'College friends',
      'Book Club',
      'Work Friends',
      'Partner 2 family',
      'Partner 1 college',
      'Partner 2 cousins',
    ])
    expect(first.plan.partnerLinks.map((l) => [l.aName, l.bName])).toEqual([
      ['Zoë Kowalczyk', 'Łukasz Kowalczyk'],
      ["Daniel O'Connor", 'Priya Raman'],
    ])
    expect(first.plan.partnerProblems).toEqual([])
    expect(first.missingSeats).toEqual([])
    // A preview saves nothing.
    expect(await guestList(w)).toEqual([])

    const done = await commit(w, { rows })
    expect(done).toEqual({
      created: 10,
      updated: 0,
      unchanged: 0,
      groupsCreated: 8,
      membershipsAdded: 13,
      partnersLinked: 2,
      removed: 0,
      clearedSeats: [],
    })

    const list = await guestList(w)
    expect(list).toHaveLength(10)
    const [zoe, lukasz, mia] = [byName(list, 'Zoë'), byName(list, 'Łukasz'), byName(list, 'Mia')]
    expect(zoe.partnerId).toBe(lukasz.id)
    expect(lukasz.partnerId).toBe(zoe.id)
    expect(zoe.coupleRuleEnabled && lukasz.coupleRuleEnabled).toBe(true)
    expect(zoe).toMatchObject({
      side: 'partner1',
      rsvp: 'yes',
      meal: 'Fish',
      household: 'Kowalczyk',
      notes: 'Allergic to nuts\nTable wish: Near the dance floor',
    })
    expect(zoe.groupIds).toHaveLength(2)
    expect(mia).toMatchObject({ isChild: true, partnerId: null })
    expect(byName(list, 'Priya').partnerId).toBe(byName(list, 'Daniel').id)
    const groupList = (await call(groups, 'GET', w)).body as { name: string; color: string; memberIds: string[] }[]
    expect(groupList).toHaveLength(8)
    expect(new Set(groupList.map((g) => g.color))).toEqual(new Set(GROUP_COLORS))
    expect(groupList.find((g) => g.name === 'Partner 1 family')!.memberIds).toHaveLength(3)

    // The same file again: nothing new, nothing changed, nobody missing.
    const second = await preview(w, { rows: rowsOf(SAMPLE_CSV_FILE) })
    expect(second.plan.counts).toEqual({ new: 0, changed: 0, unchanged: 10, needsReview: 0, missing: 0 })
    expect(second.plan.groupsToCreate).toEqual([])
    expect(second.plan.partnerLinks).toEqual([])
    const again = await commit(w, { rows: rowsOf(SAMPLE_CSV_FILE) })
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 10, groupsCreated: 0, membershipsAdded: 0, partnersLinked: 0 })
    expect(await guestList(w)).toEqual(list)
  })

  it('blocks the commit while a needs-review row has no pick, then applies the pick', async () => {
    const { makeGuest } = await import('@/server/repo/test-fixtures')
    const { commit: commitRoute } = await routes()
    const d = await db()
    const w = await makeWedding(d)
    const [samA, samB] = [await makeGuest(d, w, 'Sam', 'Lee'), await makeGuest(d, w, 'Sam', 'Lee')]
    const rows = rowsOf(SAMPLE_CSV_FILE)

    const p = await preview(w, { rows })
    expect(p.plan.needsReview.map((r) => r.rowNumber)).toEqual([10])
    expect(p.plan.needsReview[0]!.candidates.map((c) => c.guestId).sort()).toEqual([samA, samB].sort())

    const blocked = await call(commitRoute, 'POST', w, { rows, removeMissing: false })
    expect(blocked.status).toBe(422)
    expect(blocked.body.error).toBe('needs_review')
    expect(blocked.body.rowNumbers).toEqual([10])
    expect(blocked.body.issues[0]).toMatch(/^Row 10: /)
    // Nothing was saved.
    expect((await guestList(w)).map((g) => g.id).sort()).toEqual([samA, samB].sort())
    // A pick that names no guest of this wedding still blocks.
    const badPick = await call(commitRoute, 'POST', w, { rows, removeMissing: false, reviewPicks: { '10': randomUUID() } })
    expect(badPick.status).toBe(422)

    const done = await commit(w, { rows, reviewPicks: { '10': samA } })
    expect(done).toMatchObject({ created: 9, updated: 1, unchanged: 0 })
    const list = await guestList(w)
    expect(list).toHaveLength(11)
    expect(list.find((g) => g.id === samA)).toMatchObject({ side: 'partner2', rsvp: 'yes', meal: 'Fish', groupIds: expect.any(Array) })
    expect(list.find((g) => g.id === samA)!.groupIds).toHaveLength(2)
    expect(list.find((g) => g.id === samB)).toMatchObject({ side: 'both', rsvp: 'pending', meal: null, groupIds: [] })

    // 'new' adds the row as another guest.
    const w2 = await makeWedding(d)
    await makeGuest(d, w2, 'Sam', 'Lee')
    await makeGuest(d, w2, 'Sam', 'Lee')
    expect(await commit(w2, { rows, reviewPicks: { '10': 'new' } })).toMatchObject({ created: 10, updated: 0 })
    expect((await guestList(w2)).filter((g) => g.firstName === 'Sam')).toHaveLength(3)
  })

  it('links an unmatched partner through a pick', async () => {
    const { makeGuest } = await import('@/server/repo/test-fixtures')
    const d = await db()
    const w = await makeWedding(d)
    const bob = await makeGuest(d, w, 'Bob', 'Stone')
    const rows: ImportRow[] = [
      { rowNumber: 2, firstName: 'Ann', lastName: 'Gray', partnerName: 'Robert Stone', groups: [], extraNotes: [] },
      // An id that is not one of ours (edited by hand, say) falls back to the name.
      { rowNumber: 3, guestId: '00000000-0000-0000-0000-000000000000', firstName: 'Cy', lastName: 'Gray', groups: ['Family'], extraNotes: [] },
    ]
    const p = await preview(w, { rows })
    expect(p.plan.partnerProblems.map((m) => [m.rowNumber, m.status])).toEqual([[2, 'unmatched']])
    expect(p.plan.missing.map((m) => m.guestId)).toEqual([bob])

    const done = await commit(w, { rows, partnerPicks: { '2': { guestId: bob } } })
    expect(done).toMatchObject({ created: 2, partnersLinked: 1, groupsCreated: 1, membershipsAdded: 1, removed: 0 })
    const list = await guestList(w)
    expect(byName(list, 'Ann').partnerId).toBe(bob)
    expect(byName(list, 'Bob').partnerId).toBe(byName(list, 'Ann').id)
  })

  it('links many couples at once: earlier partners unlinked, couple rule back on for all (review finding)', async () => {
    const { makeGuest } = await import('@/server/repo/test-fixtures')
    const { guest: guestRoute } = await routes()
    const d = await db()
    const w = await makeWedding(d)
    const [ann, ben, cy] = [await makeGuest(d, w, 'Ann', 'Gray'), await makeGuest(d, w, 'Ben', 'Gray'), await makeGuest(d, w, 'Cy', 'Gray')]
    await call(guestRoute, 'PATCH', ann, { partnerId: ben })
    await call(guestRoute, 'PATCH', ann, { coupleRuleEnabled: false })
    const rows: ImportRow[] = [
      // Ann leaves Ben for Cy, who is already a guest; Dee and Eli are new and name each other.
      { rowNumber: 2, firstName: 'Ann', lastName: 'Gray', partnerName: 'Cy Gray', groups: [], extraNotes: [] },
      { rowNumber: 3, firstName: 'Dee', lastName: 'Fox', partnerName: 'Eli Fox', groups: [], extraNotes: [] },
      { rowNumber: 4, firstName: 'Eli', lastName: 'Fox', partnerName: 'Dee Fox', groups: [], extraNotes: [] },
    ]
    const done = await commit(w, { rows })
    expect(done).toMatchObject({ created: 2, updated: 1, partnersLinked: 2 })
    const list = await guestList(w)
    const [dee, eli] = [byName(list, 'Dee'), byName(list, 'Eli')]
    expect(list.find((g) => g.id === ann)).toMatchObject({ partnerId: cy, coupleRuleEnabled: true })
    expect(list.find((g) => g.id === cy)).toMatchObject({ partnerId: ann, coupleRuleEnabled: true })
    expect(list.find((g) => g.id === ben)).toMatchObject({ partnerId: null, coupleRuleEnabled: true })
    expect(dee).toMatchObject({ partnerId: eli.id, coupleRuleEnabled: true })
    expect(eli).toMatchObject({ partnerId: dee.id, coupleRuleEnabled: true })
  })

  it('removes guests missing from the file only when asked, clearing the seats the summary names', async () => {
    const { makeLayout, canvasOf, roundTable, chairRow, layoutRow, canvasSeats } = await import(
      '@/server/repo/test-fixtures'
    )
    const { layouts, guests } = await import('@/server/db/schema')
    const { guests: guestsRoute, guest: guestRoute, commit: commitRoute } = await routes()
    const d = await db()
    const w = await makeWedding(d)
    await commit(w, { rows: rowsOf(SAMPLE_CSV_FILE) })
    const extra = (await call(guestsRoute, 'POST', w, { firstName: 'Extra', lastName: 'Person' })).body as Guest
    const mia = byName(await guestList(w), 'Mia')
    const zoe = byName(await guestList(w), 'Zoë')
    await call(guestRoute, 'PATCH', extra.id, { partnerId: mia.id })

    const dinner = await makeLayout(d, w, canvasOf(roundTable('t1', 1, [zoe.id]), roundTable('t2', 2, [extra.id, mia.id])), {
      name: 'Dinner',
    })
    const ceremony = await makeLayout(d, w, canvasOf(chairRow('r1', 1, [extra.id], 'Left')), { name: 'Ceremony', kind: 'ceremony' })
    const old = await makeLayout(d, w, canvasOf(roundTable('t1', 9, [extra.id])), { name: 'Old idea' })
    await d.update(layouts).set({ deletedAt: new Date() }).where(eq(layouts.id, old))

    const rows = rowsOf(SAMPLE_CSV_FILE)
    const p = await preview(w, { rows })
    expect(p.plan.counts).toMatchObject({ new: 0, changed: 0, missing: 1 })
    expect(p.plan.missing).toEqual([{ guestId: extra.id, firstName: 'Extra', lastName: 'Person' }])
    expect(p.missingSeats).toEqual([
      { guestId: extra.id, layoutId: ceremony, layoutName: 'Ceremony', itemLabel: 'Left, Row 1' },
      { guestId: extra.id, layoutId: dinner, layoutName: 'Dinner', itemLabel: 'Table 2' },
    ])

    // Not asked: the guest stays.
    expect(await commit(w, { rows })).toMatchObject({ removed: 0, clearedSeats: [] })
    expect((await guestList(w)).some((g) => g.id === extra.id)).toBe(true)

    // The summary showed someone else as missing: refused, nothing changes.
    const stale = await call(commitRoute, 'POST', w, { rows, removeMissing: true, missingGuestIds: [] })
    expect(stale.status).toBe(409)
    expect(stale.body).toEqual({
      error: 'stale',
      message: 'The guest list changed since this summary was made. Check the summary again.',
    })
    expect((await guestList(w)).some((g) => g.id === extra.id)).toBe(true)

    const before = await layoutRow(d, dinner)
    const done = await commit(w, { rows, removeMissing: true, missingGuestIds: [extra.id] })
    expect(done).toMatchObject({ created: 0, updated: 0, removed: 1 })
    expect(done.clearedSeats).toEqual(p.missingSeats)

    const after = await layoutRow(d, dinner)
    expect(after.version).toBe(before.version)
    expect(canvasSeats(after.canvas)).toEqual([
      { guestId: zoe.id, itemId: 't1', seatIndex: 0 },
      { guestId: mia.id, itemId: 't2', seatIndex: 1 },
    ])
    expect(canvasSeats((await layoutRow(d, ceremony)).canvas)).toEqual([])
    expect(canvasSeats((await layoutRow(d, old)).canvas)).toEqual([])
    const [extraRow] = await d.select().from(guests).where(eq(guests.id, extra.id))
    expect(extraRow!.deletedAt).not.toBeNull()
    expect(byName(await guestList(w), 'Mia')).toMatchObject({ partnerId: null, coupleRuleEnabled: true })
    const live = await d.select().from(guests).where(and(eq(guests.weddingId, w), isNull(guests.deletedAt)))
    expect(live).toHaveLength(10)
  })

  it('exports CSV that re-imports with 0 new and 0 changed', async () => {
    const { weddings } = await import('@/server/db/schema')
    const { exporter, guests: guestsRoute, guest: guestRoute, groups: groupsRoute } = await routes()
    const d = await db()
    const w = await makeWedding(d, 'Noa & Aiden: Zoë’s "list"')
    // Another couple's wedding: the file names sides after them, and reads back with their names.
    const samAlex: PartnerNames = { partner1: 'Sam', partner2: 'Alex' }
    await d.update(weddings).set({ partner1Name: 'Sam', partner2Name: 'Alex' }).where(eq(weddings.id, w))
    await commit(w, { rows: rowsOf(SAMPLE_CSV_FILE, samAlex) })
    const list = await guestList(w)
    // Hand edits the CSV has to carry: formula-looking cells, commas, quotes,
    // line breaks, a second guest with the same name, a partner set by hand.
    await call(guestRoute, 'PATCH', byName(list, 'José').id, {
      meal: '=SUM(A1)',
      household: 'García, Smith',
      notes: '- likes jazz\n"Quoted" line; with semicolon',
      nickname: 'Pepe',
    })
    const sam2 = (await call(guestsRoute, 'POST', w, { firstName: 'Sam', lastName: 'Lee', rsvp: 'no', notes: '@home' }))
      .body as Guest
    await call(guestRoute, 'PATCH', sam2.id, { partnerId: byName(list, 'Renée').id })
    // Review findings: a lone group whose name holds a comma, a value that
    // already starts with an apostrophe and "=", a linked couple named with an
    // honorific and a comma, and a name typed in decomposed form (NFD).
    await call(guestRoute, 'PATCH', byName(list, 'Mia').id, { notes: "'=already quoted" })
    const jane = (await call(guestsRoute, 'POST', w, { firstName: 'Dr. Jane', lastName: 'Smith' })).body as Guest
    const bob = (await call(guestsRoute, 'POST', w, { firstName: 'Bob', lastName: 'Smith, Jr' })).body as Guest
    const momSide = await call(groupsRoute, 'POST', w, { name: 'Mom side, cousins', guestIds: [jane.id] })
    expect(momSide.status).toBe(201)
    await call(guestRoute, 'PATCH', jane.id, { partnerId: bob.id })
    const nfd = (await call(guestsRoute, 'POST', w, { firstName: 'Zoe\u0308', lastName: 'Nowak', household: 'Cafe\u0301' }))
      .body as Guest
    expect(nfd).toMatchObject({ firstName: 'Zo\u00eb', household: 'Caf\u00e9' })

    const res = await send(exporter, 'GET', w)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const disposition = res.headers.get('content-disposition')!
    expect(disposition).toMatch(/^attachment; filename="Noa & Aiden Zoes list guests \d{4}-\d{2}-\d{2}\.csv"; filename\*=UTF-8''/)
    expect(decodeURIComponent(disposition.split("UTF-8''")[1]!)).toMatch(/^Noa & Aiden Zoë’s list guests \d{4}-\d{2}-\d{2}\.csv$/)
    // The bytes start with a byte order mark, so Excel reads the accents.
    const bytes = Buffer.from(await res.arrayBuffer())
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    const text = bytes.toString('utf8')
    expect(text.startsWith(CSV_BOM)).toBe(true)
    expect(text.slice(1).split('\r\n')[0]).toBe(EXPORT_COLUMNS.join(','))
    expect(text).toContain("'=SUM(A1)")

    expect(text).toContain(',"Mom side, cousins;",')
    expect(text).toContain("''=already quoted")
    expect(text).toContain('Zoë,Kowalczyk,Łukasz Kowalczyk,Kowalczyk,Sam,')
    expect(text).toContain("Daniel,O'Connor,Priya Raman,O'Connor and Raman,Alex,")
    expect(text).toContain('José,García,,"García, Smith",Both,')

    const rows = rowsOf(text, samAlex)
    expect(rows).toHaveLength(14)
    expect(rows.every((r) => r.guestId)).toBe(true)
    expect(byName(list, 'José').id).toBe(rows.find((r) => r.nickname === 'Pepe')!.guestId)
    const p = await preview(w, { rows })
    expect(p.plan.counts).toEqual({ new: 0, changed: 0, unchanged: 14, needsReview: 0, missing: 0 })
    expect(p.plan.partnerLinks).toEqual([])
    expect(p.plan.partnerProblems).toEqual([])
    expect(p.plan.groupsToCreate).toEqual([])
    const before = await guestList(w)
    expect(await commit(w, { rows, removeMissing: true, missingGuestIds: [] })).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 14,
      groupsCreated: 0,
      membershipsAdded: 0,
      removed: 0,
    })
    expect(await guestList(w)).toEqual(before)

    await d.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, w))
    expect((await send(exporter, 'GET', w)).status).toBe(404)
    expect((await send(exporter, 'GET', 'nope')).status).toBe(404)
  })

  it('refuses bad bodies: 400, 404, 413 over 5,000 rows, 422', async () => {
    const { preview: previewRoute, commit: commitRoute } = await routes()
    const w = await makeWedding(await db())
    expect(MAX_GUEST_ROWS).toBe(MAX_IMPORT_ROWS)

    const row = (n: number) => ({ rowNumber: n, firstName: `A${n}`, lastName: 'B', groups: [], extraNotes: [] })
    const tooMany = Array.from({ length: MAX_GUEST_ROWS + 1 }, (_, i) => row(i + 2))
    for (const route of [previewRoute, commitRoute]) {
      const big = await call(route, 'POST', w, { rows: tooMany, removeMissing: false })
      expect(big.status).toBe(413)
      expect(big.body.error).toBe('too_large')
      expect((await call(route, 'POST', w, 'nope')).status).toBe(400)
      const twice = await call(route, 'POST', w, { rows: [row(2), row(2)], removeMissing: false })
      expect(twice.status).toBe(422)
      expect(twice.body.issues).toContain('rows.1.rowNumber: Row 2 is sent twice')
      expect((await call(route, 'POST', w, { rows: [], removeMissing: false })).status).toBe(422)
      expect((await call(route, 'POST', 'nope', { rows: [row(2)], removeMissing: false })).status).toBe(404)
      expect((await call(route, 'POST', randomUUID(), { rows: [row(2)], removeMissing: false })).status).toBe(404)
    }
    expect((await call(commitRoute, 'POST', w, { rows: [row(2)] })).status).toBe(422)
    // Removing without the list the summary showed is refused: nothing to check it against (review finding).
    const unchecked = await call(commitRoute, 'POST', w, { rows: [row(2)], removeMissing: true })
    expect(unchecked).toMatchObject({ status: 422, body: { issues: ['missingGuestIds: List the missing guests the summary showed'] } })
    expect(await guestList(w)).toEqual([])

    // The largest file allowed goes through in one transaction. Varied names,
    // as in a real list: thousands of guests sharing one last name would make
    // the duplicate check compare every pair.
    let seed = 7
    const letter = () => String.fromCharCode(97 + ((seed = (seed * 1103515245 + 12345) % 2147483648) % 26))
    const word = (n: number) => Array.from({ length: n }, letter).join('')
    const full = Array.from({ length: MAX_GUEST_ROWS }, (_, i) => ({
      ...row(i + 2),
      firstName: `Q${word(4 + (i % 4))}`,
      lastName: `Z${word(5 + (i % 5))}`,
    }))
    expect(await commit(w, { rows: full })).toMatchObject({ created: MAX_GUEST_ROWS })
    expect(await guestList(w)).toHaveLength(MAX_GUEST_ROWS)
  }, 60_000)
})
