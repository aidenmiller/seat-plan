/**
 * The guest route handlers against the test database, signed in with a
 * made-up password: create, list, edit in place, partner links (two-way,
 * clash, relink, unlink, couple rule), pasted names, the delete summary and
 * delete (seats cleared in every layout, partner unlinked).
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../../../test/db'
import { SITE_COOKIE, createSiteToken } from '@/server/auth/tokens'
import type { Guest, GuestDeleteSummary, UpdateGuestReply } from '@/shared/api'

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'guests-route-test-secret-32-chars-plus')
  vi.stubEnv('SITE_PASSWORD', 'guests-route-made-up-password')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>

async function call(mod: Record<string, unknown>, method: string, params: Record<string, string>, body?: unknown) {
  const headers: Record<string, string> = { cookie: `${SITE_COOKIE}=${createSiteToken()}` }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const req = new NextRequest(`https://seat.example/api/x/${params.id ?? ''}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const res = await (mod[method] as Handler)(req, { params: Promise.resolve(params) })
  const text = await res.text()
  return { status: res.status, cache: res.headers.get('cache-control'), body: text ? JSON.parse(text) : null }
}

async function db() {
  return (await import('@/server/db/client')).getDb()
}

const routes = async () => ({
  list: await import('./route'),
  bulk: await import('./bulk/route'),
  seats: await import('./seats/route'),
  one: await import('../../../guests/[id]/route'),
  summary: await import('../../../guests/[id]/delete-summary/route'),
})

async function add(weddingId: string, firstName: string, lastName = 'Lee', extra: Record<string, unknown> = {}): Promise<Guest> {
  const { list } = await routes()
  const res = await call(list, 'POST', { id: weddingId }, { firstName, lastName, ...extra })
  expect(res.status).toBe(201)
  return res.body
}

async function guestRow(id: string) {
  const { guests } = await import('@/server/db/schema')
  const [row] = await (await db()).select().from(guests).where(eq(guests.id, id))
  return row!
}

async function patch(id: string, body: unknown) {
  const { one } = await routes()
  return call(one, 'PATCH', { id }, body)
}

describe('/api/weddings/[id]/guests', () => {
  it('creates guests with defaults and cleaned text, lists them, and takes a retried create', async () => {
    const { makeWedding } = await import('@/server/repo/test-fixtures')
    const { list } = await routes()
    const w = await makeWedding(await db())

    expect((await call(list, 'POST', { id: w }, 'not json')).status).toBe(400)
    const blank = await call(list, 'POST', { id: w }, { firstName: ' ', lastName: 'Lee' })
    expect(blank.status).toBe(422)
    expect(blank.body.issues[0]).toMatch(/^firstName: /)
    expect((await call(list, 'POST', { id: w }, { firstName: 'A', lastName: 'B', side: 'Bride' })).status).toBe(422)
    // Sides are codes; the old names are no longer taken (migration 0007).
    expect((await call(list, 'POST', { id: w }, { firstName: 'A', lastName: 'B', side: 'Noa' })).status).toBe(422)

    const id = randomUUID()
    const made = await call(list, 'POST', { id: w }, {
      id,
      firstName: '  Zo\u0000ë  ',
      lastName: 'Kowal  czyk',
      household: '   ',
      notes: 'Line one  \r\n\r\n\r\n  Line two ',
    })
    expect(made.status).toBe(201)
    expect(made.cache).toBe('no-store')
    expect(made.body).toMatchObject({
      id,
      weddingId: w,
      firstName: 'Zoë',
      lastName: 'Kowal czyk',
      nickname: null,
      household: null,
      side: 'both',
      rsvp: 'pending',
      meal: null,
      isChild: false,
      notes: 'Line one\n\nLine two',
      partnerId: null,
      coupleRuleEnabled: true,
      groupIds: [],
    })
    expect((await guestRow(id)).nameKey).toBe('zoe|kowal czyk')

    // The same id again is a retry: same guest, no second row.
    const again = await call(list, 'POST', { id: w }, { id, firstName: 'Other', lastName: 'Name' })
    expect(again.status).toBe(201)
    expect(again.body.firstName).toBe('Zoë')
    // The id of a guest in another wedding is refused.
    const other = await makeWedding(await db())
    expect((await call(list, 'POST', { id: other }, { id, firstName: 'X', lastName: 'Y' })).status).toBe(409)

    await add(w, 'Ann', 'Adams')
    const all = await call(list, 'GET', { id: w })
    expect(all.status).toBe(200)
    expect(all.cache).toBe('no-store')
    expect(all.body.map((g: Guest) => g.firstName)).toEqual(['Ann', 'Zoë'])

    expect((await call(list, 'GET', { id: 'nope' })).status).toBe(404)
    expect((await call(list, 'GET', { id: randomUUID() })).status).toBe(404)
    expect((await call(list, 'POST', { id: randomUUID() }, { firstName: 'A', lastName: 'B' })).status).toBe(404)
  })

  it('edits in place: only the fields sent, name_key follows the name', async () => {
    const { makeWedding } = await import('@/server/repo/test-fixtures')
    const w = await makeWedding(await db())
    const ann = await add(w, 'Ann', 'Lee', { meal: 'Fish', household: 'Lee' })

    expect((await patch(ann.id, {})).status).toBe(422)
    expect((await patch(ann.id, { expectedPartners: {} })).status).toBe(422)
    expect((await patch(ann.id, { rsvp: 'maybe' })).status).toBe(422)

    const renamed = await patch(ann.id, { lastName: '  Łee ', rsvp: 'yes', household: '' })
    expect(renamed.status).toBe(200)
    const reply = renamed.body as UpdateGuestReply
    expect(reply.alsoChanged).toEqual([])
    expect(reply.guest).toMatchObject({ firstName: 'Ann', lastName: 'Łee', rsvp: 'yes', meal: 'Fish', household: null })
    expect((await guestRow(ann.id)).nameKey).toBe('ann|lee')

    const nick = await patch(ann.id, { nickname: 'Annie', isChild: true, side: 'partner1', notes: null })
    expect(nick.body.guest).toMatchObject({ nickname: 'Annie', isChild: true, side: 'partner1', notes: null, lastName: 'Łee' })

    expect((await patch('nope', { rsvp: 'yes' })).status).toBe(404)
    expect((await patch(randomUUID(), { rsvp: 'yes' })).status).toBe(404)
  })

  it('reads the old side words an older deployment may still write during a build as codes', async () => {
    const { makeWedding } = await import('@/server/repo/test-fixtures')
    const { sql } = await import('drizzle-orm')
    const { list } = await routes()
    const w = await makeWedding(await db())
    const [ann, ben, cy] = [await add(w, 'Ann'), await add(w, 'Ben'), await add(w, 'Cy')]
    // The widened check still takes them for one release.
    await (await db()).execute(sql`update guests set side = case id when ${ann.id}::uuid then 'Noa' when ${ben.id}::uuid then 'Aiden' else 'Both' end where id in (${ann.id}::uuid, ${ben.id}::uuid, ${cy.id}::uuid)`)
    expect((await guestRow(ann.id)).side).toBe('Noa')
    const all = (await call(list, 'GET', { id: w })).body as Guest[]
    expect(Object.fromEntries(all.map((g) => [g.firstName, g.side]))).toEqual({ Ann: 'partner1', Ben: 'partner2', Cy: 'both' })
    // A save writes the code back.
    expect((await patch(ann.id, { side: 'partner2' })).body.guest.side).toBe('partner2')
    expect((await guestRow(ann.id)).side).toBe('partner2')
  })

  it('links partners both ways, relinks, unlinks, and keeps the couple rule switch the same on both', async () => {
    const { makeWedding } = await import('@/server/repo/test-fixtures')
    const w = await makeWedding(await db())
    const [ann, ben, cy, dee] = [await add(w, 'Ann'), await add(w, 'Ben'), await add(w, 'Cy'), await add(w, 'Dee')]

    expect((await patch(ann.id, { partnerId: ann.id })).status).toBe(422)

    const linked = await patch(ann.id, { partnerId: ben.id, expectedPartners: { [ann.id]: null, [ben.id]: null } })
    expect(linked.status).toBe(200)
    expect(linked.body.guest.partnerId).toBe(ben.id)
    expect(linked.body.alsoChanged.map((g: Guest) => [g.id, g.partnerId])).toEqual([[ben.id, ann.id]])
    expect((await guestRow(ben.id)).partnerId).toBe(ann.id)

    // Switching the couple rule off flips it on both people.
    const off = await patch(ben.id, { coupleRuleEnabled: false })
    expect(off.body.guest.coupleRuleEnabled).toBe(false)
    expect(off.body.alsoChanged.map((g: Guest) => [g.id, g.coupleRuleEnabled])).toEqual([[ann.id, false]])

    await patch(cy.id, { partnerId: dee.id })
    // Linking Ann to Cy clears Ben and Dee, and turns the switch on for all four.
    const relinked = await patch(ann.id, { partnerId: cy.id })
    expect(relinked.status).toBe(200)
    const after = await Promise.all([ann, ben, cy, dee].map((g) => guestRow(g.id)))
    expect(after.map((g) => g.partnerId)).toEqual([cy.id, null, ann.id, null])
    expect(after.every((g) => g.coupleRuleEnabled)).toBe(true)
    expect(relinked.body.alsoChanged.map((g: Guest) => g.id).sort()).toEqual([ben.id, cy.id, dee.id].sort())

    // Linking the same pair again changes nothing.
    await patch(cy.id, { coupleRuleEnabled: false })
    const same = await patch(cy.id, { partnerId: ann.id })
    expect(same.body.alsoChanged).toEqual([])
    expect((await guestRow(ann.id)).coupleRuleEnabled).toBe(false)

    const unlinked = await patch(cy.id, { partnerId: null })
    expect(unlinked.body.guest.partnerId).toBeNull()
    expect(unlinked.body.alsoChanged.map((g: Guest) => [g.id, g.partnerId, g.coupleRuleEnabled])).toEqual([[ann.id, null, true]])
  })

  it('answers 409 with a plain message when a link changed since the browser saw it, and saves nothing', async () => {
    const { makeWedding } = await import('@/server/repo/test-fixtures')
    const { removeGuests } = await import('@/server/repo/guests')
    const w = await makeWedding(await db())
    const [ann, ben, cy] = [await add(w, 'Ann'), await add(w, 'Ben'), await add(w, 'Cy')]

    // Noa saw Ben single; Aiden linked Ben to Cy a moment ago.
    await patch(ben.id, { partnerId: cy.id })
    const clash = await patch(ann.id, {
      partnerId: ben.id,
      meal: 'Beef',
      expectedPartners: { [ann.id]: null, [ben.id]: null },
    })
    expect(clash.status).toBe(409)
    expect(clash.body.error).toBe('conflict')
    expect(clash.body.message).toBe('Someone else just changed this partner link. Check it and try again.')
    expect(clash.body.guests.map((g: Guest) => [g.id, g.partnerId])).toEqual(
      expect.arrayContaining([
        [ann.id, null],
        [ben.id, cy.id],
      ]),
    )
    const annRow = await guestRow(ann.id)
    expect(annRow.partnerId).toBeNull()
    expect(annRow.meal).toBeNull()
    expect((await guestRow(cy.id)).partnerId).toBe(ben.id)

    // A partner removed a moment ago is a clash too.
    await removeGuests(await db(), w, [cy.id])
    const gone = await patch(ann.id, { partnerId: cy.id })
    expect(gone.status).toBe(409)
    expect(gone.body.message).toBe('That guest is no longer on the guest list.')
    // A guest of another wedding is never linked.
    const other = await makeWedding(await db())
    const stranger = await add(other, 'Stranger')
    expect((await patch(ann.id, { partnerId: stranger.id })).status).toBe(409)
    expect((await guestRow(stranger.id)).partnerId).toBeNull()
  })

  it('adds pasted names in one transaction, in order, and refuses more than 5,000', async () => {
    const { makeWedding } = await import('@/server/repo/test-fixtures')
    const { bulk, list } = await routes()
    const w = await makeWedding(await db())
    const names = Array.from({ length: 10 }, (_, i) => ({ firstName: `Guest${i}`, lastName: 'van der Berg' }))
    const made = await call(bulk, 'POST', { id: w }, { guests: names })
    expect(made.status).toBe(201)
    expect(made.body.map((g: Guest) => g.firstName)).toEqual(names.map((n) => n.firstName))
    expect((await call(list, 'GET', { id: w })).body).toHaveLength(10)

    // One bad row refuses them all.
    const bad = await call(bulk, 'POST', { id: w }, { guests: [{ firstName: 'Ok', lastName: 'Row' }, { firstName: '', lastName: 'X' }] })
    expect(bad.status).toBe(422)
    expect(bad.body.issues[0]).toMatch(/^guests\.1\.firstName: /)
    const twice = randomUUID()
    expect(
      (
        await call(bulk, 'POST', { id: w }, {
          guests: [
            { id: twice, firstName: 'A', lastName: 'B' },
            { id: twice, firstName: 'C', lastName: 'D' },
          ],
        })
      ).status,
    ).toBe(422)
    // An id taken in another wedding rolls back the rows before it too.
    const other = await makeWedding(await db())
    const taken = await add(other, 'Taken')
    const rolled = await call(bulk, 'POST', { id: w }, {
      guests: [
        { firstName: 'Before', lastName: 'Taken' },
        { id: taken.id, firstName: 'X', lastName: 'Y' },
      ],
    })
    expect(rolled.status).toBe(409)
    expect((await call(list, 'GET', { id: w })).body).toHaveLength(10)

    const tooMany = Array.from({ length: 5001 }, () => ({ firstName: 'A', lastName: 'B' }))
    const big = await call(bulk, 'POST', { id: w }, { guests: tooMany })
    expect(big.status).toBe(413)
    expect(big.body).toEqual({ error: 'too_large', message: 'Send at most 5,000 rows at a time.' })
    expect((await call(bulk, 'POST', { id: w }, '{')).status).toBe(400)
    expect((await call(bulk, 'POST', { id: randomUUID() }, { guests: names })).status).toBe(404)
  })

  it('summarises and deletes a guest: seats cleared in every layout, partner unlinked, versions kept', async () => {
    const { makeWedding, makeLayout, canvasOf, roundTable, chairRow, layoutRow, canvasSeats } = await import(
      '@/server/repo/test-fixtures'
    )
    const { groupMembers, groups, ruleGuests, rules, layouts } = await import('@/server/db/schema')
    const { one, summary, list } = await routes()
    const d = await db()
    const w = await makeWedding(d)
    const [ann, ben, cy] = [await add(w, 'Ann'), await add(w, 'Ben'), await add(w, 'Cy')]
    await patch(ann.id, { partnerId: ben.id })
    const dinner = await makeLayout(d, w, canvasOf(roundTable('t1', 1, [cy.id, ann.id]), roundTable('t2', 2, [null])), {
      name: 'Dinner',
    })
    const ceremony = await makeLayout(d, w, canvasOf(chairRow('r1', 1, [ann.id], 'Left')), { name: 'Ceremony', kind: 'ceremony' })
    const old = await makeLayout(d, w, canvasOf(roundTable('t1', 4, [ann.id], 'Head')), { name: 'Old idea' })
    await d.update(layouts).set({ deletedAt: new Date() }).where(eq(layouts.id, old))
    const [group] = await d.insert(groups).values({ weddingId: w, name: 'Book Club', color: '#2563EB' }).returning()
    await d.insert(groupMembers).values({ weddingId: w, groupId: group!.id, guestId: ann.id })
    const [rule] = await d.insert(rules).values({ weddingId: w, kind: 'apart' }).returning()
    await d.insert(ruleGuests).values([
      { weddingId: w, ruleId: rule!.id, guestId: ann.id },
      { weddingId: w, ruleId: rule!.id, guestId: cy.id },
    ])

    const s = await call(summary, 'GET', { id: ann.id })
    expect(s.status).toBe(200)
    expect(s.cache).toBe('no-store')
    expect(s.body as GuestDeleteSummary).toEqual({
      kind: 'guest',
      name: 'Ann Lee',
      seats: [
        { guestId: ann.id, layoutId: ceremony, layoutName: 'Ceremony', itemLabel: 'Left, Row 1' },
        { guestId: ann.id, layoutId: dinner, layoutName: 'Dinner', itemLabel: 'Table 1' },
      ],
      partnerName: 'Ben Lee',
      groups: 1,
      rules: 1,
    })
    const before = await Promise.all([dinner, ceremony].map((id) => layoutRow(d, id)))

    const removed = await call(one, 'DELETE', { id: ann.id })
    expect(removed.status).toBe(200)
    expect(removed.body).toEqual({ ok: true, clearedSeats: s.body.seats })
    const after = await Promise.all([dinner, ceremony].map((id) => layoutRow(d, id)))
    after.forEach((row, i) => {
      expect(row.version).toBe(before[i]!.version)
      expect(canvasSeats(row.canvas).map((x) => x.guestId)).not.toContain(ann.id)
    })
    expect(canvasSeats(after[0]!.canvas)).toEqual([{ guestId: cy.id, itemId: 't1', seatIndex: 0 }])
    expect((await guestRow(ben.id)).partnerId).toBeNull()
    expect((await call(list, 'GET', { id: w })).body.map((g: Guest) => g.id).sort()).toEqual([ben.id, cy.id].sort())

    // Gone now: every guest route answers 404.
    expect((await call(one, 'DELETE', { id: ann.id })).status).toBe(404)
    expect((await call(summary, 'GET', { id: ann.id })).status).toBe(404)
    expect((await patch(ann.id, { meal: 'Fish' })).status).toBe(404)
    expect((await call(one, 'DELETE', { id: 'nope' })).status).toBe(404)
    expect((await call(summary, 'GET', { id: 'nope' })).status).toBe(404)
  })

  it('lists where every live guest sits, for the Guests page after a browser Back (review finding)', async () => {
    const { makeWedding, makeLayout, canvasOf, roundTable, chairRow } = await import('@/server/repo/test-fixtures')
    const { layouts, weddings } = await import('@/server/db/schema')
    const { seats, one } = await routes()
    const d = await db()
    const w = await makeWedding(d)
    const [ann, ben, cy] = [await add(w, 'Ann'), await add(w, 'Ben'), await add(w, 'Cy')]
    const dinner = await makeLayout(d, w, canvasOf(roundTable('t1', 1, [ann.id, ben.id]), roundTable('t2', 2, [cy.id])), { name: 'Dinner' })
    const ceremony = await makeLayout(d, w, canvasOf(chairRow('r1', 1, [ann.id], 'Left')), { name: 'Ceremony', kind: 'ceremony' })
    const old = await makeLayout(d, w, canvasOf(roundTable('t1', 4, [cy.id])), { name: 'Old idea' })
    await d.update(layouts).set({ deletedAt: new Date() }).where(eq(layouts.id, old))
    expect((await call(one, 'DELETE', { id: ben.id })).status).toBe(200)

    const res = await call(seats, 'GET', { id: w })
    expect(res.status).toBe(200)
    expect(res.cache).toBe('no-store')
    // Live layouts only, removed guests left out, by layout name then table.
    expect(res.body).toEqual([
      { guestId: ann.id, layoutId: ceremony, layoutName: 'Ceremony', itemLabel: 'Left, Row 1' },
      { guestId: ann.id, layoutId: dinner, layoutName: 'Dinner', itemLabel: 'Table 1' },
      { guestId: cy.id, layoutId: dinner, layoutName: 'Dinner', itemLabel: 'Table 2' },
    ])
    expect((await call(seats, 'GET', { id: 'nope' })).status).toBe(404)
    expect((await call(seats, 'GET', { id: randomUUID() })).status).toBe(404)
    await d.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, w))
    expect((await call(seats, 'GET', { id: w })).status).toBe(404)
  })
})
