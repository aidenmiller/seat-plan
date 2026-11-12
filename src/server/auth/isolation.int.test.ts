/**
 * The guarantee behind accounts: one planner can never reach another
 * planner's weddings through the API, whatever ids they send.
 *
 * Planner A owns wedding W_A (guests, a group with a member, a rule, layouts,
 * share links, a private venue template of A's that a layout uses) and a
 * restore job; E is an editor of both; B owns W_B; an admin belongs to
 * nothing. This test walks every route file under src/app, as route-auth.test.ts
 * does, and calls every handler with a request built from A's ids (ROWS below:
 * a route or method without a row fails the test).
 *
 *  - As B, every wedding route answers 404, every route about A's private
 *    template 404, nothing of A's changes, and no reply names anything of
 *    A's. B's own routes (the list, a create with A's id, a restore with A's
 *    job id) leak nothing either, and replies about who uses a venue B may
 *    read only count A's layouts.
 *  - As E, owner-only routes answer 403 and change nothing; the rest work.
 *  - As the admin, every route works, and each wedding opened is logged.
 * Signed out is route-auth.test.ts's job.
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL, makeTestDb, truncateAll } from '../../../test/db'
import { makeMember, makeUser, makeWeddingFor, sessionCookie, type TestUser } from '../../../test/auth'
import { restoreStartSchema } from '@/domain/backup/schema'
import { makeGridPng } from '@/domain/floorplan/__fixtures__/plans'
import { createGroupBody, createRuleBody } from '@/shared/api'
import { restoredId, restoredWeddingId, startRestore } from '../backup'
import {
  activityEvents,
  groupMembers,
  groups,
  guests,
  layoutSeats,
  layouts,
  ruleGuests,
  rules,
  shareLinks,
  venueImages,
  venueTemplateRevisions,
  venueTemplates,
  weddingMembers,
  weddings,
} from '../db/schema'
import { addGroupMembers, createGroup, deleteGroup, removeGroupMember, updateGroup } from '../repo/groups'
import { deleteGuest, guestDeleteSummary, updateGuest } from '../repo/guests'
import { createRule, deleteRule, setCoupleRule, updateRule } from '../repo/rules'
import { createShareLink, deleteShareLink, listLayoutShareLinks, updateShareLink } from '../repo/share-links'
import { canvasOf, makeGuest, makeLayout, roundTable } from '../repo/test-fixtures'
import { addTemplateImage, createTemplate } from '../repo/venues'
import { policyOf } from './guards'

const APP_DIR = path.resolve(__dirname, '../../app')
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
type Method = (typeof METHODS)[number]

const { pool, db } = makeTestDb()
const PNG = makeGridPng(40, 30)

type Actor = 'outsider' | 'editor' | 'admin'

/** A's wedding and everything in it, and the ids B and the others are handed. */
type World = {
  tag: string
  weddingA: string
  weddingName: string
  restoredWedding: string
  jobId: string
  ann: string
  ben: string
  cat: string
  spareGuest: string
  group: string
  spareGroup: string
  rule: string
  spareRule: string
  layout: string
  layoutName: string
  spareLayout: string
  tbcLayout: string
  bTemplateLayout: string
  template: string
  templateName: string
  image: string
  link: string
  linkToken: string
  spareLink: string
  weddingB: string
  bGuest: string
  bLayout: string
  bTemplate: string
  /** Strings no reply to B may hold. */
  secrets: string[]
}

let userA: TestUser
let userE: TestUser
let userB: TestUser
let admin: TestUser
const cookies: Record<Actor | 'owner', string> = { outsider: '', editor: '', admin: '', owner: '' }
let tbc = ''

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'isolation-int-test-secret-of-32-chars-plus')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  // The floor plan import answers 503 after its checks: no model call is made here.
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  await truncateAll(pool)
  userA = await makeUser(db, { displayName: 'Ada' })
  userE = await makeUser(db, { displayName: 'Eli' })
  userB = await makeUser(db, { displayName: 'Bo' })
  admin = await makeUser(db, { displayName: 'Root', isAdmin: true })
  cookies.owner = await sessionCookie(db, userA.id)
  cookies.editor = await sessionCookie(db, userE.id)
  cookies.outsider = await sessionCookie(db, userB.id)
  cookies.admin = await sessionCookie(db, admin.id)
  const [row] = await db
    .select({ id: venueTemplates.id })
    .from(venueTemplates)
    .where(and(eq(venueTemplates.name, 'Toronto Beach Club'), eq(venueTemplates.isLibrary, true)))
  tbc = row!.id
})
afterAll(async () => {
  vi.unstubAllEnvs()
  await pool.end()
})

/** A fresh W_A (owned by A, E an editor), A's restore job, and W_B (owned by B). */
async function makeWorld(): Promise<World> {
  const tag = randomUUID().slice(0, 8)
  const weddingName = `Secret wedding ${tag}`
  const weddingA = await makeWeddingFor(db, userA.id, weddingName)
  await makeMember(db, weddingA, userE.id, 'editor')
  const ann = await makeGuest(db, weddingA, 'Annabel', `Secretson${tag}`)
  const ben = await makeGuest(db, weddingA, 'Benedict', `Secretson${tag}`)
  await db.update(guests).set({ partnerId: ben }).where(eq(guests.id, ann))
  await db.update(guests).set({ partnerId: ann }).where(eq(guests.id, ben))
  const cat = await makeGuest(db, weddingA, 'Catriona', `Hiddenly${tag}`)
  const spareGuest = await makeGuest(db, weddingA, 'Spare', `Guest${tag}`)

  const group = await createGroup(db, weddingA, createGroupBody.parse({ name: `Secret group ${tag}`, guestIds: [ann] }))
  const spareGroup = await createGroup(db, weddingA, createGroupBody.parse({ name: `Spare group ${tag}` }))
  const rule = await createRule(db, weddingA, createRuleBody.parse({ kind: 'together', guestIds: [ann, cat], note: `Secret rule ${tag}` }))
  const spareRule = await createRule(db, weddingA, createRuleBody.parse({ kind: 'apart', guestIds: [ben, cat] }))
  if (group.status !== 'created' || spareGroup.status !== 'created' || rule.status !== 'created' || spareRule.status !== 'created') {
    throw new Error('makeWorld: a group or rule was not made')
  }

  const templateName = `Secret hall ${tag}`
  const made = await createTemplate(db, { name: templateName }, { userId: userA.id, isAdmin: false }, { userId: userA.id, name: 'Ada' })
  if (made.status !== 'created') throw new Error(made.status)
  const template = made.venue.id
  const image = await addTemplateImage(db, template, PNG)
  if (image.status !== 'created') throw new Error(image.status)
  const bMade = await createTemplate(db, { name: `Bo hall ${tag}` }, { userId: userB.id, isAdmin: false }, { userId: userB.id, name: 'Bo' })
  if (bMade.status !== 'created') throw new Error(bMade.status)

  const layoutName = `Secret layout ${tag}`
  const layout = await makeLayout(db, weddingA, canvasOf(roundTable('t1', 1, [ann, null], `Secret table ${tag}`)), {
    name: layoutName,
    venueTemplateId: template,
  })
  const spareLayout = await makeLayout(db, weddingA, canvasOf(), { name: `Spare layout ${tag}` })
  const tbcLayout = await makeLayout(db, weddingA, canvasOf(), { name: `Secret beach layout ${tag}`, venueTemplateId: tbc })
  // B once belonged here and put up a venue of theirs: it stays used by A's wedding after B left.
  const bTemplateLayout = await makeLayout(db, weddingA, canvasOf(), { name: `Secret old layout ${tag}`, venueTemplateId: bMade.venue.id })

  const link = await createShareLink(db, weddingA, layout, { password: 'secret-password', label: `Secret link ${tag}` })
  const spareLink = await createShareLink(db, weddingA, layout, { password: 'spare-password' })
  if (link.status !== 'created' || spareLink.status !== 'created') throw new Error('makeWorld: a share link was not made')
  const [token] = await db.select({ token: shareLinks.token }).from(shareLinks).where(eq(shareLinks.id, link.link.id))

  const jobId = randomUUID()
  const started = await startRestore(db, restoreStart(jobId, `Secret restored ${tag}`), jobId, userA.id)
  if (started.status !== 'created') throw new Error(started.status)
  await makeMember(db, started.weddingId, userE.id, 'editor')

  const weddingB = await makeWeddingFor(db, userB.id, `Bo wedding ${tag}`)
  const bGuest = await makeGuest(db, weddingB, 'Bo', `Guest${tag}`)
  const bLayout = await makeLayout(db, weddingB, canvasOf(), { name: 'Bo layout' })

  return {
    tag,
    weddingA,
    weddingName,
    restoredWedding: started.weddingId,
    jobId,
    ann,
    ben,
    cat,
    spareGuest,
    group: group.group.id,
    spareGroup: spareGroup.group.id,
    rule: rule.rule.id,
    spareRule: spareRule.rule.id,
    layout,
    layoutName,
    spareLayout,
    tbcLayout,
    bTemplateLayout,
    template,
    templateName,
    image: image.image.id,
    link: link.link.id,
    linkToken: token!.token,
    spareLink: spareLink.link.id,
    weddingB,
    bGuest,
    bLayout,
    bTemplate: bMade.venue.id,
    secrets: [
      weddingA,
      weddingName,
      started.weddingId,
      `Secret restored ${tag}`,
      layout,
      layoutName,
      tbcLayout,
      bTemplateLayout,
      `Secret beach layout ${tag}`,
      `Secret old layout ${tag}`,
      `Secret table ${tag}`,
      ann,
      `Secretson${tag}`,
      `Hiddenly${tag}`,
      template,
      templateName,
      group.group.id,
      `Secret group ${tag}`,
      `Secret rule ${tag}`,
      `Secret link ${tag}`,
      token!.token,
    ],
  }
}

/** A first restore step with no guests: enough for a job. */
function restoreStart(jobId: string, name: string) {
  return restoreStartSchema.parse({
    format: 'seat-plan-backup',
    version: 2,
    jobId,
    wedding: { id: randomUUID(), name, date: null, unit: 'ft', minGapCm: 152.4, partner1Name: null, partner2Name: null },
    guests: [],
    groups: [],
    groupMembers: [],
    rules: [],
    ruleGuests: [],
  })
}

async function layoutVersion(id: string): Promise<number> {
  const [row] = await db.select({ version: layouts.version }).from(layouts).where(eq(layouts.id, id))
  return row!.version
}

async function templateVersion(id: string): Promise<number> {
  const [row] = await db.select({ version: venueTemplates.version }).from(venueTemplates).where(eq(venueTemplates.id, id))
  return row!.version
}

async function firstRevision(templateId: string): Promise<string> {
  const [row] = await db
    .select({ id: venueTemplateRevisions.id })
    .from(venueTemplateRevisions)
    .where(eq(venueTemplateRevisions.templateId, templateId))
    .orderBy(asc(venueTemplateRevisions.createdAt), asc(venueTemplateRevisions.id))
    .limit(1)
  return row!.id
}

/** Everything of A's a request could change: W_A, the restored wedding, and A's template, row by row. */
async function snapshot(w: World) {
  const ids = [w.weddingA, w.restoredWedding]
  return {
    weddings: await db.select().from(weddings).where(inArray(weddings.id, ids)).orderBy(asc(weddings.id)),
    members: await db
      .select()
      .from(weddingMembers)
      .where(inArray(weddingMembers.weddingId, ids))
      .orderBy(asc(weddingMembers.weddingId), asc(weddingMembers.userId)),
    layouts: await db.select().from(layouts).where(inArray(layouts.weddingId, ids)).orderBy(asc(layouts.id)),
    seats: await db
      .select()
      .from(layoutSeats)
      .where(inArray(layoutSeats.weddingId, ids))
      .orderBy(asc(layoutSeats.layoutId), asc(layoutSeats.itemId), asc(layoutSeats.seatIndex)),
    guests: await db.select().from(guests).where(inArray(guests.weddingId, ids)).orderBy(asc(guests.id)),
    groups: await db.select().from(groups).where(inArray(groups.weddingId, ids)).orderBy(asc(groups.id)),
    groupMembers: await db
      .select()
      .from(groupMembers)
      .where(inArray(groupMembers.weddingId, ids))
      .orderBy(asc(groupMembers.groupId), asc(groupMembers.guestId)),
    rules: await db.select().from(rules).where(inArray(rules.weddingId, ids)).orderBy(asc(rules.id)),
    ruleGuests: await db
      .select()
      .from(ruleGuests)
      .where(inArray(ruleGuests.weddingId, ids))
      .orderBy(asc(ruleGuests.ruleId), asc(ruleGuests.guestId)),
    shareLinks: await db.select().from(shareLinks).where(inArray(shareLinks.weddingId, ids)).orderBy(asc(shareLinks.id)),
    template: await db.select().from(venueTemplates).where(eq(venueTemplates.id, w.template)),
    images: await db.select({ id: venueImages.id }).from(venueImages).where(eq(venueImages.templateId, w.template)).orderBy(asc(venueImages.id)),
    revisions: await db
      .select({ id: venueTemplateRevisions.id })
      .from(venueTemplateRevisions)
      .where(eq(venueTemplateRevisions.templateId, w.template))
      .orderBy(asc(venueTemplateRevisions.id)),
    // The copy of A's template a restore step of A's job would make.
    jobTemplates: await db.select({ id: venueTemplates.id }).from(venueTemplates).where(eq(venueTemplates.id, restoredId(w.jobId, w.template))),
  }
}

// ---------------------------------------------------------------- calling routes

type Req = { params: Record<string, string>; body?: unknown; raw?: Uint8Array; query?: string; cookie?: string }
type Reply = { status: number; text: string; body: unknown }

function routeFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...routeFiles(full))
    else if (name === 'route.ts' || name === 'route.tsx') out.push(full)
  }
  return out
}

const files = routeFiles(APP_DIR).map((f) => path.relative(APP_DIR, f).split(path.sep).join('/'))

type Handler = (req: NextRequest, ctx: unknown) => Promise<Response>

async function handlersOf(file: string): Promise<[Method, Handler][]> {
  const mod = (await import(path.join(APP_DIR, file))) as Record<string, unknown>
  return METHODS.filter((m) => typeof mod[m] === 'function').map((m) => [m, mod[m] as Handler])
}

async function send(handler: Handler, file: string, method: string, req: Req, cookie: string): Promise<Reply> {
  const headers: Record<string, string> = { cookie: req.cookie ?? cookie }
  let body: BodyInit | undefined
  if (req.raw) body = new Uint8Array(req.raw)
  if (req.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(req.body)
  }
  const url = `https://seat.example/${file.replace(/\/route\.tsx?$/, '')}${req.query ?? ''}`
  const res = await handler(new NextRequest(url, { method, headers, body }), { params: Promise.resolve(req.params) })
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }
  return { status: res.status, text, body: parsed }
}

/** A custom check: calls the route as the actor and checks what came back. */
type Check = (w: World, call: (req: Req) => Promise<Reply>) => Promise<void>

/**
 * How each route is called with A's ids. `req` builds the request; what each
 * actor should get follows from the route's policy (see expectFor), unless
 * `checks` says so for a route that is not about one wedding or template.
 * `ok` lists the statuses that mean "let in and done" when that is not 200
 * or 201. `late` runs a change that would spoil the calls after it last.
 */
type Row = { req?: (w: World) => Req | Promise<Req>; ok?: number[]; checks?: Record<Actor, Check>; late?: number; notCalled?: string }

const id = (value: string) => ({ params: { id: value } })
const save = async (w: World) => ({
  ...id(w.layout),
  body: { baseVersion: await layoutVersion(w.layout), saveId: randomUUID(), editedBy: 'Noa', tabId: 'tab', canvas: canvasOf() },
})
const venueSave = async (w: World) => ({
  ...id(w.template),
  body: { baseVersion: await templateVersion(w.template), saveId: randomUUID(), editedBy: 'Noa', fixedItems: [], reference: null },
})
const reference = { scaleCmPerPx: 2, offsetX: 0, offsetY: 0, rotation: 0, opacity: 0.5 }
const importRow = { rowNumber: 2, firstName: 'Newly', lastName: 'Imported', groups: [], extraNotes: [] }
const backupTemplate = (w: World) => ({ id: w.template, name: w.templateName, fixedItems: [], reference: null, importedBy: 'hand', imageId: w.image })
const backupLayout = (w: World) => ({ id: w.layout, name: 'From the file', kind: 'reception', venueTemplateId: w.template, editedBy: 'Noa', canvas: canvasOf() })

/** Ids of the weddings or templates a list reply holds. */
const idsIn = (reply: Reply) => (reply.body as { id: string }[]).map((x) => x.id)

const ROWS: Record<string, Partial<Record<Method, Row>>> = {
  'api/auth/login/route.ts': { POST: { notCalled: 'public: signing in, covered by its own tests and route-auth.test.ts' } },
  'api/setup/route.ts': { POST: { notCalled: 'public: first-run setup, 404 once an account exists' } },
  'share/[token]/login/route.ts': { POST: { notCalled: "public: a share link's own password, covered by share-links.int.test.ts" } },
  'api/auth/logout/route.ts': {
    POST: {
      // Signs out a second session of the same person: nothing of anyone else's is touched.
      checks: Object.fromEntries(
        (['outsider', 'editor', 'admin'] as const).map((actor) => [
          actor,
          async (_w, call) => {
            const userId = { outsider: userB.id, editor: userE.id, admin: admin.id }[actor]
            const res = await call({ params: {}, cookie: await sessionCookie(db, userId) })
            expect(res.status, `logout as ${actor}`).toBe(200)
          },
        ]),
      ) as Record<Actor, Check>,
    },
  },
  'share/[token]/data/route.ts': {
    GET: {
      checks: {
        outsider: async (w, call) => expect((await call({ params: { token: w.linkToken } })).status).toBe(401),
        editor: async (w, call) => expect((await call({ params: { token: w.linkToken } })).status).toBe(200),
        admin: async (w, call) => expect((await call({ params: { token: w.linkToken } })).status).toBe(200),
      },
    },
  },

  'api/weddings/route.ts': {
    GET: {
      checks: {
        outsider: async (w, call) => {
          const listed = idsIn(await call({ params: {} }))
          expect(listed).toContain(w.weddingB)
          expect(listed).not.toContain(w.weddingA)
          expect(listed).not.toContain(w.restoredWedding)
        },
        editor: async (w, call) => expect(idsIn(await call({ params: {} }))).toEqual(expect.arrayContaining([w.weddingA, w.restoredWedding])),
        // An admin's own list holds only their memberships: none.
        admin: async (w, call) => expect(idsIn(await call({ params: {} }))).not.toContain(w.weddingA),
      },
    },
    POST: {
      checks: {
        outsider: async (w, call) => expect(await call({ params: {}, body: { id: w.weddingA, name: 'Mine now' } })).toMatchObject({ status: 409, body: { error: 'id_taken' } }),
        // A member's retry of the create gives the wedding back, unchanged.
        editor: async (w, call) =>
          expect(await call({ params: {}, body: { id: w.weddingA, name: 'Mine now' } })).toMatchObject({ status: 201, body: { id: w.weddingA, name: w.weddingName } }),
        admin: async (w, call) => expect(await call({ params: {}, body: { id: w.weddingA, name: 'Mine now' } })).toMatchObject({ status: 409, body: { error: 'id_taken' } }),
      },
    },
  },
  'api/weddings/[id]/route.ts': {
    GET: { req: (w) => id(w.weddingA) },
    PATCH: { req: (w) => ({ ...id(w.weddingA), body: { name: 'Renamed' } }) },
    DELETE: { req: (w) => ({ ...id(w.weddingA), body: { confirm: 'delete' } }), late: 9 },
  },
  'api/weddings/[id]/delete-summary/route.ts': { GET: { req: (w) => id(w.weddingA) } },
  'api/weddings/[id]/backup/route.ts': { GET: { req: (w) => id(w.weddingA) } },
  'api/weddings/[id]/layouts/route.ts': {
    GET: { req: (w) => id(w.weddingA) },
    POST: { req: (w) => ({ ...id(w.weddingA), body: { name: 'New layout', kind: 'reception', venueTemplateId: null, editedBy: 'Noa' } }) },
  },
  'api/weddings/[id]/guests/route.ts': {
    GET: { req: (w) => id(w.weddingA) },
    POST: { req: (w) => ({ ...id(w.weddingA), body: { firstName: 'New', lastName: 'Guest' } }) },
  },
  'api/weddings/[id]/guests/bulk/route.ts': { POST: { req: (w) => ({ ...id(w.weddingA), body: { guests: [{ firstName: 'Pasted', lastName: 'Guest' }] } }) } },
  'api/weddings/[id]/guests/import/preview/route.ts': { POST: { req: (w) => ({ ...id(w.weddingA), body: { rows: [importRow] } }) } },
  'api/weddings/[id]/guests/import/commit/route.ts': { POST: { req: (w) => ({ ...id(w.weddingA), body: { rows: [importRow], removeMissing: false } }) } },
  'api/weddings/[id]/guests/export/route.ts': { GET: { req: (w) => id(w.weddingA) } },
  'api/weddings/[id]/guests/seats/route.ts': { GET: { req: (w) => id(w.weddingA) } },
  'api/weddings/[id]/groups/route.ts': {
    GET: { req: (w) => id(w.weddingA) },
    POST: { req: (w) => ({ ...id(w.weddingA), body: { name: 'New group' } }) },
  },
  'api/weddings/[id]/rules/route.ts': {
    GET: { req: (w) => id(w.weddingA) },
    POST: { req: (w) => ({ ...id(w.weddingA), body: { kind: 'apart', guestIds: [w.ann, w.cat] } }) },
  },
  'api/weddings/[id]/share-links/route.ts': { GET: { req: (w) => id(w.weddingA) } },

  'api/weddings/restore/route.ts': {
    POST: {
      checks: {
        outsider: async (w, call) => {
          const res = await call({ params: {}, body: restoreStart(w.jobId, 'Mine now') })
          expect(res).toMatchObject({ status: 409, body: { error: 'id_taken' } })
        },
        editor: async (w, call) => expect((await call({ params: {}, body: restoreStart(w.jobId, 'Again') })).status).toBe(200),
        admin: async (w, call) => expect((await call({ params: {}, body: restoreStart(w.jobId, 'Mine now') })).status).toBe(409),
      },
    },
  },
  // In this order: the template step makes the copy the image step fills, and the layout step uses it.
  'api/weddings/restore/[jobId]/templates/route.ts': { POST: { req: (w) => ({ params: { jobId: w.jobId }, body: backupTemplate(w) }) } },
  'api/weddings/restore/[jobId]/templates/[templateId]/image/route.ts': {
    PUT: { req: (w) => ({ params: { jobId: w.jobId, templateId: w.template }, raw: PNG }), late: 1 },
  },
  'api/weddings/restore/[jobId]/layouts/route.ts': { POST: { req: (w) => ({ params: { jobId: w.jobId }, body: backupLayout(w) }), late: 2 } },

  'api/layouts/[id]/route.ts': {
    GET: { req: (w) => id(w.layout) },
    PUT: { req: save },
    PATCH: { req: (w) => ({ ...id(w.layout), body: { name: 'Renamed layout' } }) },
    DELETE: { req: (w) => ({ ...id(w.spareLayout), body: { confirm: 'delete' } }), late: 3 },
  },
  'api/layouts/[id]/version/route.ts': { GET: { req: (w) => id(w.layout) } },
  'api/layouts/[id]/duplicate/route.ts': { POST: { req: (w) => ({ ...id(w.layout), body: { editedBy: 'Noa' } }) } },
  'api/layouts/[id]/delete-summary/route.ts': { GET: { req: (w) => id(w.layout) } },
  'api/layouts/[id]/share-links/route.ts': {
    GET: { req: (w) => id(w.layout) },
    POST: { req: (w) => ({ ...id(w.layout), body: { password: 'another-password', label: 'New link' } }) },
  },
  'api/share-links/[id]/route.ts': {
    PATCH: { req: (w) => ({ ...id(w.link), body: { label: 'Renamed link' } }) },
    DELETE: { req: (w) => id(w.spareLink), late: 3 },
  },

  'api/guests/[id]/route.ts': {
    PATCH: { req: (w) => ({ ...id(w.ann), body: { notes: 'Changed' } }) },
    DELETE: { req: (w) => id(w.spareGuest), late: 3 },
  },
  'api/guests/[id]/delete-summary/route.ts': { GET: { req: (w) => id(w.ann) } },
  'api/groups/[id]/route.ts': {
    PATCH: { req: (w) => ({ ...id(w.group), body: { name: 'Renamed group' } }) },
    DELETE: { req: (w) => id(w.spareGroup), late: 3 },
  },
  'api/groups/[id]/members/route.ts': { POST: { req: (w) => ({ ...id(w.group), body: { guestIds: [w.cat] } }) } },
  'api/groups/[id]/members/[guestId]/route.ts': { DELETE: { req: (w) => ({ params: { id: w.group, guestId: w.ann } }) } },
  'api/rules/[id]/route.ts': {
    PATCH: { req: (w) => ({ ...id(w.rule), body: { note: 'Changed' } }) },
    DELETE: { req: (w) => id(w.spareRule), late: 3 },
  },
  'api/rules/couple/route.ts': { PATCH: { req: (w) => ({ params: {}, body: { guestIds: [w.ann, w.ben], enabled: false } }) } },

  'api/venues/route.ts': {
    GET: {
      checks: {
        outsider: async (w, call) => {
          expect(idsIn(await call({ params: {} }))).not.toContain(w.template)
          expect(await call({ params: {}, query: `?weddingId=${w.weddingA}` })).toMatchObject({ status: 404, body: { error: 'not_found' } })
        },
        editor: async (w, call) => {
          expect(idsIn(await call({ params: {} }))).toContain(w.template)
          expect(idsIn(await call({ params: {}, query: `?weddingId=${w.weddingA}` }))).toContain(w.template)
        },
        // No extras without a wedding; with one, what that wedding uses.
        admin: async (w, call) => {
          expect(idsIn(await call({ params: {} }))).not.toContain(w.template)
          expect(idsIn(await call({ params: {}, query: `?weddingId=${w.weddingA}` }))).toContain(w.template)
        },
      },
    },
    POST: {
      // Making a venue is everyone's own business: it belongs to its maker.
      checks: Object.fromEntries(
        (['outsider', 'editor', 'admin'] as const).map((actor) => [
          actor,
          async (_w, call) => expect(await call({ params: {}, body: { name: 'My own hall' } })).toMatchObject({ status: 201, body: { access: 'mine' } }),
        ]),
      ) as Record<Actor, Check>,
    },
  },
  'api/venues/[id]/route.ts': {
    GET: { req: (w) => id(w.template) },
    PUT: { req: venueSave },
    PATCH: { req: (w) => ({ ...id(w.template), body: { name: 'Renamed hall' } }) },
    // Still used by A's layout: refused with 409 even for an admin.
    DELETE: { req: (w) => ({ ...id(w.template), body: { confirm: 'delete' } }), ok: [409], late: 3 },
  },
  'api/venues/[id]/delete-summary/route.ts': { GET: { req: (w) => id(w.template) } },
  'api/venues/[id]/wall-check/route.ts': { GET: { req: (w) => id(w.template) } },
  'api/venues/[id]/revisions/route.ts': { GET: { req: (w) => id(w.template) } },
  'api/venues/[id]/revisions/[revisionId]/restore/route.ts': {
    POST: {
      req: async (w) => ({
        params: { id: w.template, revisionId: await firstRevision(w.template) },
        body: { baseVersion: await templateVersion(w.template), saveId: randomUUID(), editedBy: 'Noa' },
      }),
    },
  },
  'api/venues/[id]/images/route.ts': { POST: { req: (w) => ({ ...id(w.template), raw: PNG }) } },
  'api/venues/[id]/images/[imageId]/route.ts': { GET: { req: (w) => ({ params: { id: w.template, imageId: w.image } }) } },
  // No ANTHROPIC_API_KEY here: past its checks the import answers 503.
  'api/venues/[id]/import/route.ts': { POST: { req: (w) => ({ ...id(w.template), body: { imageId: w.image, imageWidth: 40, imageHeight: 30 } }), ok: [503] } },
  'api/venues/[id]/accept-import/route.ts': {
    POST: {
      req: async (w) => ({
        ...id(w.template),
        body: {
          baseVersion: await templateVersion(w.template),
          saveId: randomUUID(),
          editedBy: 'Noa',
          fixedItems: [],
          imageId: w.image,
          reference,
          importedBy: 'ai',
        },
      }),
    },
  },
  'api/venues/[id]/duplicate/route.ts': { POST: { req: (w) => ({ ...id(w.template), body: { name: 'A copy' } }) } },
}

/** Every handler with its row, in the table's order with late ones last; fails for a handler without a row. */
async function plan(): Promise<{ file: string; method: Method; handler: Handler; row: Row }[]> {
  const out: { file: string; method: Method; handler: Handler; row: Row; order: number }[] = []
  let order = 0
  for (const file of files) {
    for (const [method, handler] of await handlersOf(file)) {
      const row = ROWS[file]?.[method]
      if (!row) throw new Error(`${method} ${file} has no row in ROWS: say how this test calls it`)
      out.push({ file, method, handler, row, order: order++ })
    }
  }
  const tableOrder = Object.entries(ROWS).flatMap(([file, methods]) => Object.keys(methods).map((m) => `${m} ${file}`))
  const rank = (x: { file: string; method: string }) => tableOrder.indexOf(`${x.method} ${x.file}`)
  return out.sort((a, b) => (a.row.late ?? 0) - (b.row.late ?? 0) || rank(a) - rank(b))
}

/** What the actor should get from a route the policy guards: 'ok', or a status. */
function expectFor(actor: Actor, handler: Handler): 'ok' | 403 | 404 {
  const policy = policyOf(handler)
  if (policy?.kind === 'wedding') {
    if (actor === 'outsider') return 404
    if (actor === 'editor') return policy.minRole === 'owner' ? 403 : 'ok'
    return 'ok'
  }
  if (policy?.kind === 'venue' && (policy.mode === 'read' || policy.mode === 'write')) {
    // A's template is private: B cannot read it; E reads it through W_A, which uses it, but may not change it.
    if (actor === 'outsider') return 404
    if (actor === 'editor') return policy.mode === 'write' ? 403 : 'ok'
    return 'ok'
  }
  throw new Error(`no expectation for a ${policy?.kind ?? 'missing'} policy: give the row its own checks`)
}

async function runAll(actor: Actor, w: World, only?: (expected: 'ok' | 403 | 404) => boolean): Promise<Reply[]> {
  const replies: Reply[] = []
  for (const { file, method, handler, row } of await plan()) {
    if (row.notCalled) continue
    const call = async (req: Req) => {
      const reply = await send(handler, file, method, req, cookies[actor])
      replies.push(reply)
      return reply
    }
    if (row.checks) {
      if (!only) await row.checks[actor](w, call)
      continue
    }
    const expected = expectFor(actor, handler)
    if (only && !only(expected)) continue
    const res = await call(await row.req!(w))
    const what = `${method} ${file} as ${actor}`
    if (expected === 'ok') expect(row.ok ?? [200, 201], `${what} answered ${res.status}: ${res.text.slice(0, 300)}`).toContain(res.status)
    else expect(res.status, `${what}: ${res.text.slice(0, 300)}`).toBe(expected)
  }
  return replies
}

function expectNoSecrets(w: World, replies: Reply[]) {
  for (const reply of replies) {
    for (const secret of w.secrets) expect(reply.text, `a reply to B holds "${secret}"`).not.toContain(secret)
  }
}

// ---------------------------------------------------------------- the tests

describe('every route is in this test', () => {
  it('has a row for every route file and method, and none for routes that are gone', async () => {
    const handled = new Set<string>()
    for (const file of files) for (const [method] of await handlersOf(file)) handled.add(`${method} ${file}`)
    const rows = new Set(Object.entries(ROWS).flatMap(([file, methods]) => Object.keys(methods).map((m) => `${m} ${file}`)))
    expect([...handled].filter((x) => !rows.has(x)), 'routes with no row').toEqual([])
    expect([...rows].filter((x) => !handled.has(x)), 'rows for routes that do not exist').toEqual([])
    // Only the public routes are left uncalled.
    const notCalled = Object.entries(ROWS).flatMap(([file, methods]) => Object.values(methods).filter((r) => r.notCalled).map(() => file))
    expect(notCalled.sort()).toEqual(['api/auth/login/route.ts', 'api/setup/route.ts', 'share/[token]/login/route.ts'])
  })
})

describe('a planner outside the wedding (B)', () => {
  it('gets 404 from every wedding route and every route about A’s private venue, changes nothing, and learns nothing', async () => {
    const w = await makeWorld()
    const before = await snapshot(w)
    const replies = await runAll('outsider', w)
    expect(await snapshot(w)).toEqual(before)
    expectNoSecrets(w, replies)
  })

  it('reads only counts of A’s layouts in replies about a venue B may read', async () => {
    const w = await makeWorld()
    const before = await snapshot(w)
    const call = async (file: string, method: Method, req: Req) => {
      const handler = (await handlersOf(file)).find(([m]) => m === method)![1]
      return send(handler, file, method, req, cookies.outsider)
    }
    const replies: Reply[] = []
    const keep = async (reply: Promise<Reply>) => {
      const r = await reply
      replies.push(r)
      return r
    }
    // B's own venue, still used by a layout in A's wedding.
    expect((await keep(call('api/venues/[id]/delete-summary/route.ts', 'GET', id(w.bTemplate)))).body).toMatchObject({ layouts: [], hiddenLayouts: 1 })
    expect((await keep(call('api/venues/[id]/wall-check/route.ts', 'GET', id(w.bTemplate)))).body).toMatchObject({ layouts: [], hiddenLayouts: 1 })
    expect(await keep(call('api/venues/[id]/route.ts', 'DELETE', { ...id(w.bTemplate), body: { confirm: 'delete' } }))).toMatchObject({
      status: 409,
      body: { error: 'in_use', layouts: [], hiddenLayouts: 1 },
    })
    expect((await keep(call('api/venues/[id]/route.ts', 'GET', id(w.bTemplate)))).body).toMatchObject({ access: 'mine', usedBy: 0 })
    // The library venue A's wedding uses.
    expect((await keep(call('api/venues/[id]/delete-summary/route.ts', 'GET', id(tbc)))).body).toMatchObject({ layouts: [], hiddenLayouts: expect.any(Number) })
    expect(((await keep(call('api/venues/[id]/delete-summary/route.ts', 'GET', id(tbc)))).body as { hiddenLayouts: number }).hiddenLayouts).toBeGreaterThan(0)
    expect((await keep(call('api/venues/[id]/wall-check/route.ts', 'GET', id(tbc)))).body).toMatchObject({ layouts: [] })
    const list = (await keep(call('api/venues/route.ts', 'GET', { params: {} }))).body as { id: string; usedBy: number }[]
    expect(list.find((v) => v.id === tbc)?.usedBy).toBe(0)
    expect(list.find((v) => v.id === w.bTemplate)?.usedBy).toBe(0)

    expect(await snapshot(w)).toEqual(before)
    expectNoSecrets(w, replies)
  })

  it('cannot reach A’s guests or venue from B’s own wedding either', async () => {
    const w = await makeWorld()
    const before = await snapshot(w)
    const call = async (file: string, method: Method, req: Req) => {
      const handler = (await handlersOf(file)).find(([m]) => m === method)![1]
      return send(handler, file, method, req, cookies.outsider)
    }
    const replies = [
      // The couple rule, with B's guest first (so the guard finds B's wedding) and A's second.
      await call('api/rules/couple/route.ts', 'PATCH', { params: {}, body: { guestIds: [w.bGuest, w.ann], enabled: false } }),
      // A rule, a group and a partner in B's wedding naming A's guest.
      await call('api/weddings/[id]/rules/route.ts', 'POST', { ...id(w.weddingB), body: { kind: 'together', guestIds: [w.bGuest, w.ann] } }),
      await call('api/weddings/[id]/groups/route.ts', 'POST', { ...id(w.weddingB), body: { name: 'Bo group', guestIds: [w.ann] } }),
      await call('api/guests/[id]/route.ts', 'PATCH', { ...id(w.bGuest), body: { partnerId: w.ann } }),
      // A layout in B's wedding on A's private venue, and one seating A's guest.
      await call('api/weddings/[id]/layouts/route.ts', 'POST', {
        ...id(w.weddingB),
        body: { name: 'On A hall', kind: 'reception', venueTemplateId: w.template, editedBy: 'Noa' },
      }),
      await call('api/layouts/[id]/route.ts', 'PATCH', { ...id(w.bLayout), body: { venueTemplateId: w.template } }),
    ]
    expect(replies.map((r) => r.status)).toEqual([404, 422, 422, 409, 422, 422])
    // A save seating A's guest: the seat is dropped as for an id nobody has (the reply only echoes the id B sent).
    const seated = await call('api/layouts/[id]/route.ts', 'PUT', {
      ...id(w.bLayout),
      body: { baseVersion: 1, saveId: randomUUID(), editedBy: 'Noa', tabId: 'tab', canvas: canvasOf(roundTable('t1', 1, [w.ann])) },
    })
    expect(seated).toMatchObject({ status: 200, body: { droppedSeats: [{ guestId: w.ann, reason: 'unknown-guest' }] } })
    const [bLayoutRow] = await db.select().from(layouts).where(eq(layouts.id, w.bLayout))
    expect(bLayoutRow!.venueTemplateId).toBeNull()
    expect(JSON.stringify(bLayoutRow!.canvas)).not.toContain(w.ann)
    expect(await db.select().from(layoutSeats).where(eq(layoutSeats.layoutId, w.bLayout))).toEqual([])
    expect(await snapshot(w)).toEqual(before)
    expectNoSecrets(w, replies)
  })

  it('cannot attach A’s private venue through a crafted restore of B’s own', async () => {
    const w = await makeWorld()
    const before = await snapshot(w)
    const start = (await handlersOf('api/weddings/restore/route.ts'))[0]![1]
    const layoutStep = (await handlersOf('api/weddings/restore/[jobId]/layouts/route.ts'))[0]![1]
    const templateStep = (await handlersOf('api/weddings/restore/[jobId]/templates/route.ts'))[0]![1]
    const jobId = randomUUID()
    expect((await send(start, 'api/weddings/restore/route.ts', 'POST', { params: {}, body: restoreStart(jobId, 'Bo restored') }, cookies.outsider)).status).toBe(201)
    // The layout step naming A's template straight away: a blank canvas.
    const sent = await send(layoutStep, 'x', 'POST', { params: { jobId }, body: { ...backupLayout(w), id: randomUUID() } }, cookies.outsider)
    expect(sent.status).toBe(201)
    const [made] = await db.select({ venueTemplateId: layouts.venueTemplateId }).from(layouts).where(eq(layouts.id, (sent.body as { layoutId: string }).layoutId))
    expect(made!.venueTemplateId).toBeNull()
    // The template step naming it: B's own copy of the file's walls, never A's template.
    const step = await send(templateStep, 'x', 'POST', { params: { jobId }, body: backupTemplate(w) }, cookies.outsider)
    expect(step.body).toMatchObject({ reused: false })
    expect((step.body as { templateId: string }).templateId).not.toBe(w.template)
    expect(await snapshot(w)).toEqual(before)
    expect(await db.select({ userId: weddingMembers.userId }).from(weddingMembers).where(eq(weddingMembers.weddingId, restoredWeddingId(jobId)))).toEqual([
      { userId: userB.id },
    ])
  })
})

describe('the calls behind the child-id routes', () => {
  it('hold to the wedding the guard resolved: a row of another wedding reads as missing and nothing changes', async () => {
    const w = await makeWorld()
    const before = await snapshot(w)
    // B's wedding, as if a guard had resolved it, with A's rows.
    const other = w.weddingB
    expect(await updateGuest(db, other, w.ann, { notes: 'x' })).toEqual({ status: 'not-found' })
    expect(await updateGuest(db, other, w.ann, { partnerId: w.bGuest })).toEqual({ status: 'not-found' })
    expect(await guestDeleteSummary(db, other, w.ann)).toBeNull()
    expect(await deleteGuest(db, other, w.ann)).toBeNull()
    expect(await updateGroup(db, other, w.group, { name: 'Taken' })).toEqual({ status: 'not-found' })
    expect(await addGroupMembers(db, other, w.group, [w.bGuest])).toEqual({ status: 'not-found' })
    expect(await removeGroupMember(db, other, w.group, w.ann)).toBeNull()
    expect(await deleteGroup(db, other, w.group)).toBe(false)
    expect(await updateRule(db, other, w.rule, { note: 'Taken' })).toEqual({ status: 'not-found' })
    expect(await deleteRule(db, other, w.rule)).toBe(false)
    expect(await setCoupleRule(db, other, [w.ann, w.ben], false)).toEqual({ status: 'not-found' })
    expect(await setCoupleRule(db, w.weddingA, [w.ann, w.bGuest], false)).toEqual({ status: 'not-found' })
    expect(await listLayoutShareLinks(db, other, w.layout)).toBeNull()
    expect(await createShareLink(db, other, w.layout, { password: 'taken-password' })).toEqual({ status: 'not-found' })
    expect(await updateShareLink(db, other, w.link, { label: 'Taken' })).toBeNull()
    expect(await deleteShareLink(db, other, w.link)).toBe(false)
    expect(await snapshot(w)).toEqual(before)
  })
})

describe('an editor of the wedding (E)', () => {
  it('gets 403 from every owner-only route, changing nothing, and gets through every other route', async () => {
    const w = await makeWorld()
    const before = await snapshot(w)
    await runAll('editor', w, (expected) => expected === 403)
    expect(await snapshot(w)).toEqual(before)
    await runAll('editor', w, (expected) => expected === 'ok')
    // The custom checks too (lists, creates, the share page).
    for (const { file, method, handler, row } of await plan()) {
      if (row.checks) await row.checks.editor(w, (req) => send(handler, file, method, req, cookies.editor))
    }
  })
})

describe('an admin who belongs to nothing', () => {
  it('gets through every route, and each wedding they open is logged as admin_access', async () => {
    const w = await makeWorld()
    await runAll('admin', w)
    const logged = await db
      .select({ weddingId: activityEvents.weddingId })
      .from(activityEvents)
      .where(and(eq(activityEvents.kind, 'admin_access'), eq(activityEvents.userId, admin.id), inArray(activityEvents.weddingId, [w.weddingA, w.restoredWedding])))
    expect(new Set(logged.map((e) => e.weddingId))).toEqual(new Set([w.weddingA, w.restoredWedding]))
    // Using the power never made them a member.
    expect(await db.select().from(weddingMembers).where(and(eq(weddingMembers.userId, admin.id), inArray(weddingMembers.weddingId, [w.weddingA, w.restoredWedding])))).toEqual([])
    // The last call deleted A's wedding.
    const [row] = await db.select({ deletedAt: weddings.deletedAt }).from(weddings).where(eq(weddings.id, w.weddingA))
    expect(row!.deletedAt).not.toBeNull()
  })
})
