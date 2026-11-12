/**
 * Venue template rights against the test database: every cell of the table
 * in venue-access.ts, for a planner, an admin and a template's owner.
 */
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { makeMember, makeUser } from '../../../test/auth'
import { layouts, venueTemplates, weddings } from '../db/schema'
import { makeLayout, makeWedding } from '../repo/test-fixtures'
import { canUseTemplateInWedding, readableTemplateSql, requireTemplate, templateAccess, type Viewer } from './venue-access'

const { pool, db } = makeTestDb()

afterAll(async () => {
  await pool.end()
})

const T: Record<string, string> = {}
let me: Viewer
let admin: Viewer
let other: Viewer
let W = ''

async function template(name: string, opts: { owner?: string | null; library?: boolean; deleted?: boolean } = {}) {
  const [row] = await db
    .insert(venueTemplates)
    .values({
      name,
      ownerUserId: opts.owner ?? null,
      isLibrary: opts.library ?? false,
      deletedAt: opts.deleted ? new Date() : null,
    })
    .returning({ id: venueTemplates.id })
  T[name] = row!.id
  return row!.id
}

beforeAll(async () => {
  await truncateAll(pool)
  const [meUser, otherUser, adminUser] = [
    await makeUser(db, { displayName: 'Me' }),
    await makeUser(db, { displayName: 'Other' }),
    await makeUser(db, { isAdmin: true }),
  ]
  me = { userId: meUser.id, isAdmin: false }
  other = { userId: otherUser.id, isAdmin: false }
  admin = { userId: adminUser.id, isAdmin: true }

  W = await makeWedding(db, 'W')
  const W2 = await makeWedding(db, 'W2')
  const X = await makeWedding(db, 'X')
  const gone = await makeWedding(db, 'Gone')
  await makeMember(db, W, me.userId, 'editor')
  await makeMember(db, W2, me.userId, 'owner')
  await makeMember(db, X, other.userId, 'owner')
  await makeMember(db, gone, me.userId, 'owner')

  const [tbc] = await db.select({ id: venueTemplates.id }).from(venueTemplates).where(eq(venueTemplates.name, 'Toronto Beach Club'))
  T.TBC = tbc!.id
  await template('Library', { owner: other.userId, library: true })
  await template('Mine', { owner: me.userId })
  await template('OthersUsedInW', { owner: other.userId })
  await template('OthersUsedInW2', { owner: other.userId })
  await template('OthersUsedInX', { owner: other.userId })
  await template('OthersOnDeletedLayout', { owner: other.userId })
  await template('OthersInDeletedWedding', { owner: other.userId })
  await template('OwnerlessUsedInW')
  await template('OwnerlessUnused')
  await template('MineDeleted', { owner: me.userId, deleted: true })

  await makeLayout(db, W, undefined, { venueTemplateId: T.OthersUsedInW })
  await makeLayout(db, W2, undefined, { venueTemplateId: T.OthersUsedInW2 })
  await makeLayout(db, X, undefined, { venueTemplateId: T.OthersUsedInX })
  await makeLayout(db, W, undefined, { venueTemplateId: T.OwnerlessUsedInW })
  const deletedLayout = await makeLayout(db, W, undefined, { venueTemplateId: T.OthersOnDeletedLayout })
  await db.update(layouts).set({ deletedAt: new Date() }).where(eq(layouts.id, deletedLayout))
  await makeLayout(db, gone, undefined, { venueTemplateId: T.OthersInDeletedWedding })
  await db.update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, gone))
})

async function listed(viewer: Viewer, weddingId?: string): Promise<string[]> {
  const rows = await db
    .select({ name: venueTemplates.name })
    .from(venueTemplates)
    .where(readableTemplateSql(viewer, weddingId))
    .orderBy(asc(venueTemplates.name))
  return rows.map((r) => r.name)
}

/** What requireTemplate answers: 'ok', or the status code. */
async function answer(viewer: Viewer, name: string, need: 'read' | 'edit'): Promise<'ok' | number> {
  const result = await requireTemplate(db, viewer, T[name]!, need)
  return result.ok ? 'ok' : result.response.status
}

// name -> [listed for W, listed with no wedding, read, change, attach in W] for "me", a planner.
const PLANNER: Record<string, [boolean, boolean, 'ok' | 404, 'ok' | 403 | 404, boolean]> = {
  TBC: [true, true, 'ok', 403, true],
  Library: [true, true, 'ok', 403, true],
  Mine: [true, true, 'ok', 'ok', true],
  OthersUsedInW: [true, true, 'ok', 403, true],
  OthersUsedInW2: [false, true, 'ok', 403, false],
  OthersUsedInX: [false, false, 404, 404, false],
  OthersOnDeletedLayout: [false, false, 404, 404, false],
  OthersInDeletedWedding: [false, false, 404, 404, false],
  OwnerlessUsedInW: [true, true, 'ok', 403, true],
  OwnerlessUnused: [false, false, 404, 404, false],
  MineDeleted: [false, false, 404, 404, false],
}

describe('a planner', () => {
  for (const [name, [inW, inAll, read, edit, attach]] of Object.entries(PLANNER)) {
    it(`${name}: listed for W ${inW}, listed ${inAll}, read ${read}, change ${edit}, attach in W ${attach}`, async () => {
      const shownAs = name === 'TBC' ? 'Toronto Beach Club' : name
      expect((await listed(me, W)).includes(shownAs)).toBe(inW)
      expect((await listed(me)).includes(shownAs)).toBe(inAll)
      expect(await answer(me, name, 'read')).toBe(read)
      expect(await answer(me, name, 'edit')).toBe(edit)
      expect(await canUseTemplateInWedding(db, me, T[name]!, W)).toBe(attach)
    })
  }

  it('gets the owner and library flag with the access', async () => {
    expect(await templateAccess(db, me, T.OthersUsedInW!)).toEqual({
      read: true,
      edit: false,
      library: false,
      ownerUserId: other.userId,
      ownerName: 'Other',
    })
    expect(await templateAccess(db, me, T.TBC!)).toEqual({ read: true, edit: false, library: true, ownerUserId: null, ownerName: null })
    expect(await templateAccess(db, me, T.MineDeleted!)).toBeNull()
    expect(await templateAccess(db, me, 'not-a-uuid')).toBeNull()
  })

  it('sees the lists exactly', async () => {
    expect(await listed(me, W)).toEqual(['Library', 'Mine', 'OthersUsedInW', 'OwnerlessUsedInW', 'Toronto Beach Club'])
    expect(await listed(me)).toEqual(['Library', 'Mine', 'OthersUsedInW', 'OthersUsedInW2', 'OwnerlessUsedInW', 'Toronto Beach Club'])
  })
})

describe('an admin', () => {
  it('may read and change any live template', async () => {
    for (const name of Object.keys(PLANNER)) {
      const expected = name === 'MineDeleted' ? 404 : 'ok'
      expect(await answer(admin, name, 'read'), name).toBe(expected)
      expect(await answer(admin, name, 'edit'), name).toBe(expected)
    }
  })

  it('gets no extras in lists or when attaching', async () => {
    // Not a member of W, owns nothing: the library and what W already uses.
    expect(await listed(admin, W)).toEqual(['Library', 'OthersUsedInW', 'OwnerlessUsedInW', 'Toronto Beach Club'])
    expect(await listed(admin)).toEqual(['Library', 'Toronto Beach Club'])
    expect(await canUseTemplateInWedding(db, admin, T.OthersUsedInW!, W)).toBe(true)
    expect(await canUseTemplateInWedding(db, admin, T.OthersUsedInX!, W)).toBe(false)
    expect(await canUseTemplateInWedding(db, admin, T.Mine!, W)).toBe(false)
  })
})

describe("a template's owner who is not in the wedding", () => {
  it('sees their own and the library, but not what W uses', async () => {
    expect(await listed(other, W)).toEqual([
      'Library',
      'OthersInDeletedWedding',
      'OthersOnDeletedLayout',
      'OthersUsedInW',
      'OthersUsedInW2',
      'OthersUsedInX',
      'Toronto Beach Club',
    ])
    expect(await canUseTemplateInWedding(db, other, T.OwnerlessUsedInW!, W)).toBe(false)
    expect(await answer(other, 'OthersUsedInX', 'edit')).toBe('ok')
    expect(await answer(other, 'Mine', 'read')).toBe(404)
    expect(await answer(other, 'Library', 'edit')).toBe(403)
  })

  it('cannot attach to a wedding that is not a uuid', async () => {
    expect(await canUseTemplateInWedding(db, other, T.Library!, 'nope')).toBe(false)
  })
})
