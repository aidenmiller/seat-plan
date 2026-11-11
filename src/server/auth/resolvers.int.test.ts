/**
 * The wedding resolvers against the test database: each finds its row's
 * wedding, deleted rows included, and anything else resolves to null.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { makeUser } from '../../../test/auth'
import { restoredWeddingId } from '../backup'
import { groups, guests, layouts, rules, shareLinks, weddings } from '../db/schema'
import { createInvite } from '../repo/invites'
import { makeGuest, makeLayout, makeWedding } from '../repo/test-fixtures'
import {
  byCouplePair,
  byGroupId,
  byGuestId,
  byInviteId,
  byLayoutId,
  byRestoreJob,
  byRuleId,
  byShareLinkId,
  byTemplateId,
  byWeddingId,
} from './resolvers'

const { pool, db } = makeTestDb()

afterAll(async () => {
  await pool.end()
})

const req = new NextRequest('https://seat.example/api/x')
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) })
const MISSING = '00000000-0000-4000-8000-000000000000'

let weddingId = ''
const ids: Record<string, string> = {}

beforeAll(async () => {
  await truncateAll(pool)
  weddingId = await makeWedding(db)
  const user = await makeUser(db, { isAdmin: true })
  ids.layout = await makeLayout(db, weddingId)
  ids.deletedLayout = await makeLayout(db, weddingId)
  await db.update(layouts).set({ deletedAt: new Date() }).where(eq(layouts.id, ids.deletedLayout))
  ids.guest = await makeGuest(db, weddingId)
  ids.deletedGuest = await makeGuest(db, weddingId, 'Gone', 'Guest')
  await db.update(guests).set({ deletedAt: new Date() }).where(eq(guests.id, ids.deletedGuest))
  const [group] = await db.insert(groups).values({ weddingId, name: 'Family', color: '#aabbcc' }).returning({ id: groups.id })
  ids.group = group!.id
  const [rule] = await db.insert(rules).values({ weddingId, kind: 'together' }).returning({ id: rules.id })
  ids.rule = rule!.id
  const [link] = await db
    .insert(shareLinks)
    .values({ weddingId, layoutId: ids.layout, token: 't'.repeat(43), passwordHash: 'x' })
    .returning({ id: shareLinks.id })
  ids.link = link!.id
  ids.invite = (await createInvite(db, { weddingId, role: 'editor', invitedBy: user.id })).invite.id
  ids.plannerInvite = (await createInvite(db, { invitedBy: user.id })).invite.id
})

describe('resolvers that look up a row', () => {
  const cases = [
    { resolver: byLayoutId, row: 'layout' },
    { resolver: byLayoutId, row: 'deletedLayout' },
    { resolver: byGuestId, row: 'guest' },
    { resolver: byGuestId, row: 'deletedGuest' },
    { resolver: byGroupId, row: 'group' },
    { resolver: byRuleId, row: 'rule' },
    { resolver: byShareLinkId, row: 'link' },
    { resolver: byInviteId, row: 'invite' },
  ]
  for (const { resolver, row } of cases) {
    it(`${resolver.name} finds the wedding of a ${row}`, async () => {
      expect(await resolver.resolve(req, idCtx(ids[row]!), db)).toBe(weddingId)
      expect(await resolver.resolve(req, idCtx(ids[row]!.toUpperCase()), db)).toBe(weddingId)
    })
  }

  for (const resolver of [byLayoutId, byGuestId, byGroupId, byRuleId, byShareLinkId, byInviteId]) {
    it(`${resolver.name} resolves an unknown id or a non-uuid to null`, async () => {
      expect(await resolver.resolve(req, idCtx(MISSING), db)).toBeNull()
      expect(await resolver.resolve(req, idCtx('not-a-uuid'), db)).toBeNull()
      expect(await resolver.resolve(req, idCtx("1' or '1'='1"), db)).toBeNull()
    })
  }

  it('byInviteId resolves a planner invite (no wedding) to null', async () => {
    expect(await byInviteId.resolve(req, idCtx(ids.plannerInvite!), db)).toBeNull()
  })

  it('still resolves rows of a deleted wedding: weddingAccess turns those away', async () => {
    const other = await makeWedding(db)
    const layout = await makeLayout(db, other)
    await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, other))
    expect(await byLayoutId.resolve(req, idCtx(layout), db)).toBe(other)
  })
})

describe('resolvers that need no lookup', () => {
  it('byWeddingId takes the id itself, lower-cased', async () => {
    expect(await byWeddingId.resolve(req, idCtx(weddingId.toUpperCase()), db)).toBe(weddingId)
    expect(await byWeddingId.resolve(req, idCtx('nope'), db)).toBeNull()
  })

  it('byRestoreJob works the wedding id out from the job id, as backup.ts does', async () => {
    const jobId = randomUUID()
    const ctx = { params: Promise.resolve({ jobId: jobId.toUpperCase() }) }
    expect(await byRestoreJob.resolve(req, ctx, db)).toBe(restoredWeddingId(jobId))
    expect(await byRestoreJob.resolve(req, { params: Promise.resolve({ jobId: 'nope' }) }, db)).toBeNull()
  })

  it('byTemplateId takes the template id', async () => {
    expect(await byTemplateId.resolve(req, idCtx(MISSING.toUpperCase()))).toBe(MISSING)
    expect(await byTemplateId.resolve(req, idCtx('nope'))).toBeNull()
  })
})

describe('byCouplePair', () => {
  function couple(body: string) {
    return new NextRequest('https://seat.example/api/rules/couple', { method: 'PATCH', body, headers: { 'content-type': 'application/json' } })
  }

  it("finds the first guest's wedding and leaves the body for the handler", async () => {
    const request = couple(JSON.stringify({ guestIds: [ids.guest, randomUUID()], enabled: true }))
    expect(await byCouplePair.resolve(request, undefined, db)).toBe(weddingId)
    expect(await request.json()).toMatchObject({ enabled: true })
  })

  it('resolves to null for a body it cannot use', async () => {
    for (const body of ['not json', '{}', '{"guestIds": []}', '{"guestIds": ["nope"]}', `{"guestIds": ["${MISSING}"]}`, 'null', '[1]']) {
      expect(await byCouplePair.resolve(couple(body), undefined, db), body).toBeNull()
    }
  })
})
