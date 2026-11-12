/**
 * The admin pages' numbers against the test database: the overview's
 * totals, edits and sign-ins by day in Toronto time, each person's edits and
 * AI imports, each wedding's last edit and share links, and a wedding's
 * recent activity. Every number is checked against rows made here.
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { makeMember, makeUser, makeWeddingFor, type TestUser } from '../../../test/auth'
import { activityEvents, guests, layouts, shareLinks, venueTemplates, weddings } from '../db/schema'
import { countWrite } from './activity'
import { activityByDay, adminOverview, adminPicks, personStats, weddingActivity, weddingStats } from './admin-stats'
import { createShareLink } from './share-links'
import { canvasOf, makeGuest, makeLayout, makeTemplate, makeWedding } from './test-fixtures'

const { pool, db } = makeTestDb()

/** Noon in Toronto (EST, UTC-5) on Wednesday, Nov 11. */
const NOW = new Date('2026-11-11T17:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000)

let admin: TestUser
let ann: TestUser
let ben: TestUser
let cat: TestUser
let owl: TestUser
let w1 = ''
let w2 = ''
let w3 = ''
let late = ''
let empty = ''

beforeAll(async () => {
  await truncateAll(pool)
  admin = await makeUser(db, { displayName: 'Root', isAdmin: true })
  ann = await makeUser(db, { displayName: 'Ann' })
  ben = await makeUser(db, { displayName: 'Ben', disabled: true })
  cat = await makeUser(db, { displayName: 'Cat' })
  owl = await makeUser(db, { displayName: 'Owl' })

  // W1: Ann owns it, Cat edits it. Two live guests and one deleted; one live layout and one deleted; a link on and one off.
  w1 = await makeWeddingFor(db, ann.id, 'One')
  await makeMember(db, w1, cat.id, 'editor')
  await makeGuest(db, w1, 'Gus', 'One')
  await makeGuest(db, w1, 'Gia', 'One')
  const goneGuest = await makeGuest(db, w1, 'Gone', 'One')
  await db.update(guests).set({ deletedAt: new Date() }).where(eq(guests.id, goneGuest))
  const layout1 = await makeLayout(db, w1, canvasOf(), { name: 'Reception' })
  const goneLayout = await makeLayout(db, w1, canvasOf(), { name: 'Old' })
  await db.update(layouts).set({ deletedAt: new Date() }).where(eq(layouts.id, goneLayout))
  const on = await createShareLink(db, w1, layout1, { password: 'venue-password' })
  const off = await createShareLink(db, w1, layout1, { password: 'other-password' })
  if (on.status !== 'created' || off.status !== 'created') throw new Error('share link')
  await db.update(shareLinks).set({ lastOpenedAt: new Date('2026-11-10T20:00:00Z') }).where(eq(shareLinks.id, on.link.id))
  await db.update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.id, off.link.id))

  // W2: Cat owns it; a layout saved, but no change counted yet.
  w2 = await makeWeddingFor(db, cat.id, 'Two')
  await makeLayout(db, w2, canvasOf(), { name: 'Ceremony', kind: 'ceremony' })

  // W3: Ann's, deleted, with a guest, a layout and a link that are not counted.
  w3 = await makeWeddingFor(db, ann.id, 'Three')
  await makeGuest(db, w3, 'Hid', 'Den')
  const layout3 = await makeLayout(db, w3, canvasOf())
  await createShareLink(db, w3, layout3, { password: 'hidden-password' })
  await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, w3))

  late = await makeWeddingFor(db, owl.id, 'Late')
  empty = await makeWedding(db, 'Nobody’s')

  // Venues: the library's Toronto Beach Club (truncateAll), one of Ann's, one with no owner, one deleted.
  const annHall = await makeTemplate(db, 'Ann hall')
  await db.update(venueTemplates).set({ ownerUserId: ann.id }).where(eq(venueTemplates.id, annHall))
  await makeTemplate(db, 'Old hall')
  const goneHall = await makeTemplate(db, 'Gone hall')
  await db.update(venueTemplates).set({ deletedAt: new Date() }).where(eq(venueTemplates.id, goneHall))

  // Edits in W1: Ann 4 about two days ago (Monday), 6 twenty days ago, 100 forty days ago; Cat 3 a day ago (Tuesday), the newest.
  await countWrite(db, { userId: ann.id, weddingId: w1, kind: 'write.guests', at: daysAgo(2.01) })
  for (let i = 0; i < 3; i++) await countWrite(db, { userId: ann.id, weddingId: w1, kind: 'write.layout', at: daysAgo(2) })
  for (let i = 0; i < 6; i++) await countWrite(db, { userId: ann.id, weddingId: w1, kind: 'write.layout', at: daysAgo(20) })
  await db.insert(activityEvents).values({ kind: 'write.layout', userId: ann.id, weddingId: w1, detail: { count: 100 }, occurredAt: daysAgo(40) })
  for (let i = 0; i < 3; i++) await countWrite(db, { userId: cat.id, weddingId: w1, kind: 'write.rules', at: daysAgo(1) })
  // Ann's AI imports: two in the last 30 days, one before.
  for (const at of [daysAgo(3), daysAgo(29), daysAgo(31)]) await db.insert(activityEvents).values({ kind: 'venue.ai_import', userId: ann.id, occurredAt: at })
  // An admin's look at W1, then a change through the admin's power.
  await db.insert(activityEvents).values({ kind: 'admin_access', userId: admin.id, weddingId: w1, detail: { write: false }, occurredAt: daysAgo(0.5) })
  await db.insert(activityEvents).values({ kind: 'admin_access', userId: admin.id, weddingId: w1, detail: { write: true }, occurredAt: daysAgo(0.25) })
})
afterAll(async () => {
  await pool.end()
})

describe('adminOverview', () => {
  it('counts people, live and deleted weddings, what is in the live ones, venues by where they are, and share links that work', async () => {
    const { totals, days } = await adminOverview(db, NOW)
    expect(totals).toEqual({
      people: { active: 4, off: 1, admins: 1 },
      weddings: { live: 4, deleted: 1 },
      guests: 2,
      layouts: 2,
      venues: { library: 1, private: 1, noOwner: 1 },
      shareLinks: 1,
    })
    expect(days).toHaveLength(30)
  })
})

describe('activityByDay', () => {
  it('puts edits and sign-ins on their Toronto day, either side of a UTC midnight, newest day first', async () => {
    // 23:30 and 23:40 on Tuesday in Toronto, already Wednesday in UTC; a sign-in at 22:00.
    await countWrite(db, { userId: owl.id, weddingId: late, kind: 'write.layout', at: new Date('2026-11-11T04:30:00Z') })
    await countWrite(db, { userId: owl.id, weddingId: late, kind: 'write.layout', at: new Date('2026-11-11T04:40:00Z') })
    await db.insert(activityEvents).values({ kind: 'login', userId: owl.id, occurredAt: new Date('2026-11-11T03:00:00Z') })
    // 00:30 on Wednesday in Toronto, and a sign-in at 00:10.
    for (let i = 0; i < 5; i++) await countWrite(db, { userId: owl.id, weddingId: late, kind: 'write.guests', at: new Date('2026-11-11T05:30:00Z') })
    await db.insert(activityEvents).values({ kind: 'login', userId: owl.id, occurredAt: new Date('2026-11-11T05:10:00Z') })

    const days = await activityByDay(db, NOW, 30)
    expect(days.map((d) => d.day).slice(0, 3)).toEqual(['2026-11-11', '2026-11-10', '2026-11-09'])
    expect(days[29]!.day).toBe('2026-10-13')
    const byDay = Object.fromEntries(days.map((d) => [d.day, d]))
    expect(byDay['2026-11-11']).toEqual({ day: '2026-11-11', edits: 5, signIns: 1 })
    // Owl's 2 late on Tuesday night, and Cat's 3 at Tuesday noon.
    expect(byDay['2026-11-10']).toEqual({ day: '2026-11-10', edits: 2 + 3, signIns: 1 })
    expect(byDay['2026-11-09']).toEqual({ day: '2026-11-09', edits: 4, signIns: 0 })
    expect(byDay['2026-10-22']).toEqual({ day: '2026-10-22', edits: 6, signIns: 0 })
    // Forty days ago is outside the 30.
    expect(days.reduce((sum, d) => sum + d.edits, 0)).toBe(5 + 5 + 4 + 6)
    expect(days.filter((d) => d.edits === 0 && d.signIns === 0)).toHaveLength(26)

    // Gone again, so the tests below count only the rows beforeAll made.
    await pool.query('delete from activity_events where user_id = $1', [owl.id])
  })
})

describe('personStats', () => {
  it('counts the live weddings each person owns and edits, their edits in 7 and 30 days, and their AI imports in 30', async () => {
    const stats = await personStats(db, NOW)
    // Ann owns W1; W3 is deleted.
    expect(stats[ann.id]).toEqual({ owned: 1, editing: 0, edits7: 4, edits30: 10, aiImports30: 2 })
    expect(stats[cat.id]).toEqual({ owned: 1, editing: 1, edits7: 3, edits30: 3, aiImports30: 0 })
    expect(stats[ben.id]).toEqual({ owned: 0, editing: 0, edits7: 0, edits30: 0, aiImports30: 0 })
    expect(Object.keys(stats).sort()).toEqual([admin.id, ann.id, ben.id, cat.id, owl.id].sort())
  })
})

describe('weddingStats', () => {
  it('names the last edit from the counters, falls back to the newest layout save, and counts edits and links that work', async () => {
    const stats = await weddingStats(db, NOW)
    expect(stats[w1]).toEqual({
      lastEdited: { at: daysAgo(1).toISOString(), by: 'Cat', source: 'activity' },
      edits30: 13,
      shareLinks: { active: 1, lastOpenedAt: '2026-11-10T20:00:00.000Z' },
    })
    expect(stats[w2]!.lastEdited).toMatchObject({ by: 'Noa', source: 'layout' })
    expect(stats[w2]!.edits30).toBe(0)
    // A deleted wedding's links stay on (they open nothing until it is undeleted).
    expect(stats[w3]!.shareLinks.active).toBe(1)
    expect(stats[empty]).toEqual({ lastEdited: null, edits30: 0, shareLinks: { active: 0, lastOpenedAt: null } })
    // One wedding only.
    expect(Object.keys(await weddingStats(db, NOW, w2))).toEqual([w2])
  })
})

describe('weddingActivity', () => {
  it('lists the wedding’s events newest first, with who, counts for edits, and whether an admin changed something', async () => {
    const events = await weddingActivity(db, w1)
    expect(events.map((e) => [e.kind, e.userName, e.count, e.write])).toEqual([
      ['admin_access', 'Root', null, true],
      ['admin_access', 'Root', null, false],
      ['write.rules', 'Cat', 3, false],
      ['write.layout', 'Ann', 3, false],
      ['write.guests', 'Ann', 1, false],
      ['write.layout', 'Ann', 6, false],
      ['write.layout', 'Ann', 100, false],
    ])
    expect(await weddingActivity(db, w1, 2)).toHaveLength(2)
    expect(await weddingActivity(db, empty)).toEqual([])
  })
})

describe('adminPicks', () => {
  it('lists everyone by name, with whether their account is off', async () => {
    const picks = await adminPicks(db)
    expect(picks.map((p) => p.displayName)).toEqual(['Ann', 'Ben', 'Cat', 'Owl', 'Root'])
    expect(picks.find((p) => p.id === ben.id)).toMatchObject({ disabled: true, email: ben.email })
  })
})
