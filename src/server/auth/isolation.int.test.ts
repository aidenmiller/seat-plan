/**
 * The guarantee behind accounts: one planner can never reach another
 * planner's weddings through the API, whatever ids they send.
 *
 * Planner A owns wedding W_A (guests, a group with a member, a rule, layouts,
 * share links, a private venue template of A's that a layout uses, a second
 * editor, invites) and a restore job; E is an editor of both; B owns W_B; an
 * admin belongs to nothing. This test walks every route file under src/app,
 * as route-auth.test.ts does, and calls every handler with a request built
 * from A's ids (ROWS below: a route or method without a row fails the test).
 *
 *  - As B, every wedding route answers 404, every route about A's private
 *    template 404, nothing of A's changes, and no reply names anything of
 *    A's. B's own routes (the list, a create with A's id, a restore with A's
 *    job id) leak nothing either, and replies about who uses a venue B may
 *    read only count A's layouts. Every admin route answers 404 and changes
 *    nothing; the account routes act only on B; a made-up invite or reset
 *    link, or a real invite locked to someone else's email, gets B nothing.
 *  - As E, owner-only routes answer 403 and change nothing; the rest work.
 *    E may see who belongs to W_A and leave it, but remove nobody else; the
 *    admin routes answer 404.
 *  - As the admin, every route works, and each wedding opened is logged.
 * Signed out is route-auth.test.ts's job.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL, makeTestDb, truncateAll } from '../../../test/db'
import { makeMember, makeUser, makeWeddingFor, sessionCookie, type TestUser } from '../../../test/auth'
import { freshAddress, sessionCookieFrom } from '../../../test/routes'
import { restoreStartSchema } from '@/domain/backup/schema'
import { makeGridPng } from '@/domain/floorplan/__fixtures__/plans'
import { createGroupBody, createRuleBody } from '@/shared/api'
import { restoredId, restoredWeddingId, startRestore } from '../backup'
import {
  activityEvents,
  backups,
  groupMembers,
  groups,
  guests,
  invites,
  layoutSeats,
  layouts,
  passwordResets,
  ruleGuests,
  rules,
  sessions,
  shareLinks,
  users,
  venueImages,
  venueTemplateRevisions,
  venueTemplates,
  weddingMembers,
  weddings,
} from '../db/schema'
import { addGroupMembers, createGroup, deleteGroup, removeGroupMember, updateGroup } from '../repo/groups'
import { deleteGuest, guestDeleteSummary, updateGuest } from '../repo/guests'
import { createInvite } from '../repo/invites'
import { createRule, deleteRule, setCoupleRule, updateRule } from '../repo/rules'
import { lookupSession } from '../repo/sessions'
import { createShareLink, deleteShareLink, listLayoutShareLinks, updateShareLink } from '../repo/share-links'
import { canvasOf, makeGuest, makeLayout, makeWedding, roundTable } from '../repo/test-fixtures'
import { addTemplateImage, createTemplate } from '../repo/venues'
import { policyOf } from './guards'
// ---- Stored backups (mu-p9-backups)
import { backupOneWedding } from '../backups/runner'
import { getBackupStore } from '../backups/store'
// ---- End of stored backups

// As in the invite and reset route tests: a made-up token is answered at once, not after about a second.
vi.mock('@/server/auth/throttle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/auth/throttle')>()),
  wrongGuessDelay: async () => {},
}))

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
  /** A second editor of W_A, for removing. */
  spareMember: string
  /** A pending owner invite to W_A, locked to an email none of the actors has. */
  lockedInvite: string
  lockedToken: string
  /** A pending editor invite to W_A, for cancelling. */
  spareInvite: string
  /** A pending planner invite (no wedding) an admin sent. */
  plannerInvite: string
  /** A wedding nobody belongs to, for an admin to claim. */
  ownerless: string
  // ---- Stored backups (mu-p9-backups): a stored backup of W_A and one of W_B.
  backupA: string
  backupB: string
  // ---- End of stored backups
  /** Strings no reply to B may hold. */
  secrets: string[]
}

let userA: TestUser
let userE: TestUser
let userB: TestUser
let admin: TestUser
const cookies: Record<Actor | 'owner', string> = { outsider: '', editor: '', admin: '', owner: '' }
let tbc = ''
// ---- Stored backups (mu-p9-backups): a folder backup store for this file, and a cron secret that no request here sends.
const backupDir = mkdtempSync(path.join(os.tmpdir(), 'isolation-backups-'))
// ---- End of stored backups

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'isolation-int-test-secret-of-32-chars-plus')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  // The floor plan import answers 503 after its checks: no model call is made here.
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  // ---- Stored backups (mu-p9-backups)
  vi.stubEnv('BACKUP_STORE_DIR', backupDir)
  vi.stubEnv('CRON_SECRET', 'isolationcronsecret0123456789abcdefXYZ')
  // ---- End of stored backups
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
  rmSync(backupDir, { recursive: true, force: true })
})
// The invite, reset and password routes count tries per address: each call here comes from a fresh one, and each test starts from zero.
beforeEach(async () => {
  await pool.query('delete from login_attempts')
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

  const spare = await makeUser(db, { displayName: 'Sid' })
  await makeMember(db, weddingA, spare.id, 'editor')
  const lockedEmail = `someone-else-${tag}@example.com`
  const locked = await createInvite(db, { weddingId: weddingA, role: 'owner', email: lockedEmail, invitedBy: userA.id })
  const spareInvite = await createInvite(db, { weddingId: weddingA, role: 'editor', invitedBy: userA.id })
  const plannerInvite = await createInvite(db, { invitedBy: admin.id })
  const ownerless = await makeWedding(db, `Ownerless ${tag}`)

  // ---- Stored backups (mu-p9-backups): nightly ones, so the owner's "Back up now" is not held back by the 5-minute rule.
  const store = getBackupStore()!
  const storedA = await backupOneWedding(db, store, weddingA, { kind: 'nightly' })
  const storedB = await backupOneWedding(db, store, weddingB, { kind: 'nightly' })
  if (storedA.status === 'not-found' || storedB.status === 'not-found') throw new Error('makeWorld: a backup was not made')
  // ---- End of stored backups

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
    spareMember: spare.id,
    lockedInvite: locked.invite.id,
    lockedToken: locked.token,
    spareInvite: spareInvite.invite.id,
    plannerInvite: plannerInvite.invite.id,
    ownerless,
    backupA: storedA.backup.id,
    backupB: storedB.backup.id,
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
      // Who belongs to W_A, and its invites.
      userA.email,
      userE.email,
      spare.email,
      lockedEmail,
      locked.invite.id,
      locked.token,
      spareInvite.invite.id,
      spareInvite.token,
      plannerInvite.invite.id,
      plannerInvite.token,
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
    invites: await db.select().from(invites).where(inArray(invites.weddingId, ids)).orderBy(asc(invites.id)),
    template: await db.select().from(venueTemplates).where(eq(venueTemplates.id, w.template)),
    images: await db.select({ id: venueImages.id }).from(venueImages).where(eq(venueImages.templateId, w.template)).orderBy(asc(venueImages.id)),
    revisions: await db
      .select({ id: venueTemplateRevisions.id })
      .from(venueTemplateRevisions)
      .where(eq(venueTemplateRevisions.templateId, w.template))
      .orderBy(asc(venueTemplateRevisions.id)),
    // The copy of A's template a restore step of A's job would make.
    jobTemplates: await db.select({ id: venueTemplates.id }).from(venueTemplates).where(eq(venueTemplates.id, restoredId(w.jobId, w.template))),
    // ---- Stored backups (mu-p9-backups): A's stored backups, checked_at included (a run that finds W_A unchanged moves it).
    storedBackups: await db.select().from(backups).where(inArray(backups.weddingId, ids)).orderBy(asc(backups.id)),
    // ---- End of stored backups
  }
}

/**
 * Everyone's account rows, row by row: who exists and can sign in, who is
 * signed in where, who belongs to which wedding, and every invite and reset
 * link. Compared around one call, so nothing else runs in between.
 */
async function accountState() {
  return {
    users: await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        passwordHash: users.passwordHash,
        isAdmin: users.isAdmin,
        disabledAt: users.disabledAt,
      })
      .from(users)
      .orderBy(asc(users.id)),
    sessions: await db.select({ id: sessions.id, userId: sessions.userId }).from(sessions).orderBy(asc(sessions.id)),
    members: await db.select().from(weddingMembers).orderBy(asc(weddingMembers.weddingId), asc(weddingMembers.userId)),
    invites: await db.select().from(invites).orderBy(asc(invites.id)),
    resets: await db.select().from(passwordResets).orderBy(asc(passwordResets.id)),
  }
}

/** The accountState users, but for one. */
async function usersExcept(userId: string) {
  return (await accountState()).users.filter((u) => u.id !== userId)
}

async function roleIn(weddingId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: weddingMembers.role })
    .from(weddingMembers)
    .where(and(eq(weddingMembers.weddingId, weddingId), eq(weddingMembers.userId, userId)))
  return row?.role ?? null
}

const cookieValue = (cookie: string) => cookie.slice(cookie.indexOf('=') + 1)
const signedIn = async (cookie: string) => (await lookupSession(db, cookieValue(cookie))) !== null
const sessionIdOf = async (cookie: string) => (await lookupSession(db, cookieValue(cookie)))!.sessionId
/** A well-formed invite or reset token that matches nothing. */
const madeUpToken = () => randomBytes(32).toString('base64url')

// ---------------------------------------------------------------- calling routes

/** `ip` is sent as x-real-ip, the address the throttle counts by. */
type Req = { params: Record<string, string>; body?: unknown; raw?: Uint8Array; query?: string; cookie?: string; ip?: string }
type Reply = { status: number; text: string; body: unknown; headers: Headers }

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
  if (req.ip) headers['x-real-ip'] = req.ip
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
  return { status: res.status, text, body: parsed, headers: res.headers }
}

/** A custom check: calls the route as the actor and checks what came back. */
type Check = (w: World, call: (req: Req) => Promise<Reply>) => Promise<void>

const userOf = (actor: Actor): TestUser => ({ outsider: userB, editor: userE, admin })[actor]

/** The same check for every actor, for routes that act only on the caller or on a token, never on an id of A's. */
function everyActor(check: (actor: Actor) => Check): Record<Actor, Check> {
  return { outsider: check('outsider'), editor: check('editor'), admin: check('admin') }
}

/**
 * An admin route. Anyone else signed in (B, and E, who is not an admin) gets
 * the guard's 404, as if the route did not exist, for each of `refused`'s
 * requests, and nothing changes: no account, session, membership, invite or
 * reset link, and nothing of A's. `admin` checks what the admin gets.
 */
function adminOnly(refused: (w: World) => Req[], adminCheck: Check): Row {
  const refuse: Check = async (w, call) => {
    for (const req of refused(w)) {
      const before = { accounts: await accountState(), a: await snapshot(w) }
      const res = await call(req)
      expect(res, `refused ${JSON.stringify(req.params)}: ${res.text.slice(0, 300)}`).toMatchObject({ status: 404, body: { error: 'not_found' } })
      expect({ accounts: await accountState(), a: await snapshot(w) }).toEqual(before)
    }
  }
  return { checks: { outsider: refuse, editor: refuse, admin: adminCheck } }
}

/**
 * A public route called with a made-up token: 404 and nothing else (no name,
 * email or wedding), whoever calls, and no account, session, membership,
 * invite or reset link changes. Each call comes from a fresh address.
 */
function madeUpTokenRow(bodies: () => Record<string, unknown>[]): Row {
  return {
    checks: everyActor((actor) => async (w, call) => {
      for (const body of bodies()) {
        const before = { accounts: await accountState(), a: await snapshot(w) }
        const res = await call({ params: {}, body, ip: freshAddress() })
        expect(res.status, `${Object.keys(body).join(', ')} as ${actor}: ${res.text.slice(0, 300)}`).toBe(404)
        expect(res.body).toEqual({ error: 'not_found' })
        expect({ accounts: await accountState(), a: await snapshot(w) }).toEqual(before)
      }
    }),
  }
}

/**
 * How each route is called with A's ids. `req` builds the request; what each
 * actor should get follows from the route's policy (see expectFor), unless
 * `checks` says so for a route that is not about one wedding or template
 * (the account, admin and invite-link routes), or whose answer depends on
 * more than the caller's role (removing a member: anyone may leave).
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
  'api/weddings/[id]/members/route.ts': { GET: { req: (w) => id(w.weddingA) } },
  'api/weddings/[id]/members/[userId]/route.ts': {
    // E trying to make themselves an owner.
    PATCH: { req: (w) => ({ params: { id: w.weddingA, userId: userE.id }, body: { role: 'owner' } }) },
    // The guard lets any member in, so they can leave; removing someone else needs an owner.
    DELETE: {
      checks: {
        outsider: async (w, call) => {
          const before = await snapshot(w)
          // Taking anyone out, B included (as if leaving a wedding B never joined).
          for (const userId of [userA.id, userE.id, w.spareMember, userB.id]) {
            const res = await call({ params: { id: w.weddingA, userId } })
            expect(res.status, `remove ${userId} as outsider: ${res.text.slice(0, 300)}`).toBe(404)
          }
          expect(await snapshot(w)).toEqual(before)
        },
        editor: async (w, call) => {
          const before = await snapshot(w)
          for (const userId of [userA.id, w.spareMember]) {
            expect(await call({ params: { id: w.weddingA, userId } }), `remove ${userId} as editor`).toMatchObject({ status: 403, body: { error: 'forbidden' } })
          }
          expect(await snapshot(w)).toEqual(before)
          // Leaving is E's own business.
          expect(await call({ params: { id: w.weddingA, userId: userE.id } })).toMatchObject({ status: 200, body: { ok: true } })
          expect(await roleIn(w.weddingA, userE.id)).toBeNull()
          expect(await roleIn(w.weddingA, userA.id)).toBe('owner')
          // Back in, so whatever runs after this still finds E there.
          await makeMember(db, w.weddingA, userE.id, 'editor')
        },
        admin: async (w, call) => {
          expect(await call({ params: { id: w.weddingA, userId: w.spareMember } })).toMatchObject({ status: 200, body: { ok: true } })
          expect(await roleIn(w.weddingA, w.spareMember)).toBeNull()
        },
      },
    },
  },
  'api/weddings/[id]/invites/route.ts': {
    GET: { req: (w) => id(w.weddingA) },
    POST: { req: (w) => ({ ...id(w.weddingA), body: { role: 'owner' } }) },
  },
  'api/invites/[id]/route.ts': { DELETE: { req: (w) => id(w.spareInvite), late: 3 } },
  'api/invites/accept/route.ts': {
    POST: {
      // A working link lets its holder in: that is the feature. A made-up one, or one locked to another email, never does.
      checks: everyActor((actor) => async (w, call) => {
        const before = { accounts: await accountState(), a: await snapshot(w) }
        expect(await call({ params: {}, body: { token: madeUpToken() } }), `made-up token as ${actor}`).toMatchObject({ status: 404, body: { error: 'not_found' } })
        expect(await call({ params: {}, body: { token: w.lockedToken } }), `locked invite as ${actor}`).toMatchObject({
          status: 409,
          body: { error: 'invite_unusable', reason: 'email-mismatch' },
        })
        expect({ accounts: await accountState(), a: await snapshot(w) }).toEqual(before)
      }),
    },
  },
  'api/invites/lookup/route.ts': { POST: madeUpTokenRow(() => [{ token: madeUpToken() }]) },
  // With A's email: a made-up link must not say whether that email has an account.
  'api/invites/register/route.ts': {
    POST: madeUpTokenRow(() => [{ token: madeUpToken(), email: userA.email, displayName: 'Nova', password: 'a brand new password' }]),
  },
  // Looking a link up, and setting a password with it.
  'api/auth/reset/route.ts': { POST: madeUpTokenRow(() => [{ token: madeUpToken() }, { token: madeUpToken(), password: 'a brand new password' }]) },

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

  // The account routes act on the caller only, whatever ids come with the request.
  'api/account/route.ts': {
    PATCH: {
      checks: everyActor((actor) => async (w, call) => {
        const me = userOf(actor)
        const others = await usersExcept(me.id)
        const res = await call({ params: { id: userA.id }, body: { displayName: `Renamed ${w.tag}` } })
        expect(res).toMatchObject({ status: 200, body: { id: me.id, email: me.email, displayName: `Renamed ${w.tag}` } })
        expect(await usersExcept(me.id)).toEqual(others)
        // Back as it was.
        expect((await call({ params: {}, body: { displayName: me.displayName } })).status).toBe(200)
      }),
    },
  },
  'api/account/password/route.ts': {
    POST: {
      // Ends the caller's sessions (this browser gets a new one), and nobody else's.
      checks: everyActor((actor) => async (_w, call) => {
        const me = userOf(actor)
        const others = await usersExcept(me.id)
        const old = cookies[actor]
        const changed = await call({ params: { id: userA.id }, body: { current: me.password, next: 'another isolation password' }, ip: freshAddress() })
        expect(changed.status, changed.text).toBe(200)
        const fresh = sessionCookieFrom(changed)!
        expect(await signedIn(old)).toBe(false)
        expect(await signedIn(fresh)).toBe(true)
        expect(await signedIn(cookies.owner)).toBe(true)
        expect(await usersExcept(me.id)).toEqual(others)
        // Back to the old password, so the rest of the file signs in as before.
        const back = await call({ params: {}, body: { current: 'another isolation password', next: me.password }, ip: freshAddress(), cookie: fresh })
        expect(back.status, back.text).toBe(200)
        cookies[actor] = sessionCookieFrom(back)!
        expect(await signedIn(cookies[actor])).toBe(true)
        expect(await signedIn(cookies.owner)).toBe(true)
      }),
    },
  },
  'api/account/sessions/route.ts': {
    GET: {
      checks: everyActor((actor) => async (_w, call) => {
        const res = await call({ params: { id: userA.id } })
        expect(res.status).toBe(200)
        const listed = (res.body as { id: string }[]).map((s) => s.id)
        expect(listed).toContain(await sessionIdOf(cookies[actor]))
        const owners = await db.select({ userId: sessions.userId }).from(sessions).where(inArray(sessions.id, listed))
        expect(new Set(owners.map((o) => o.userId))).toEqual(new Set([userOf(actor).id]))
        expect(res.text).not.toContain(await sessionIdOf(cookies.owner))
      }),
    },
  },
  'api/account/sessions/[id]/route.ts': {
    DELETE: {
      checks: everyActor((actor) => async (_w, call) => {
        // A's session: as if there were none, and A stays signed in.
        expect(await call(id(await sessionIdOf(cookies.owner)))).toMatchObject({ status: 404, body: { error: 'not_found' } })
        expect(await signedIn(cookies.owner)).toBe(true)
        // One of the caller's own ends.
        const mine = await sessionCookie(db, userOf(actor).id)
        expect(await call(id(await sessionIdOf(mine)))).toMatchObject({ status: 200, body: { ok: true } })
        expect(await signedIn(mine)).toBe(false)
        expect(await signedIn(cookies[actor])).toBe(true)
      }),
    },
  },
  'api/account/sessions/revoke-others/route.ts': {
    POST: {
      checks: everyActor((actor) => async (_w, call) => {
        const mine = await sessionCookie(db, userOf(actor).id)
        const aSecond = await sessionCookie(db, userA.id)
        const res = await call({ params: { id: userA.id } })
        expect(res.status).toBe(200)
        expect((res.body as { ended: number }).ended).toBeGreaterThanOrEqual(1)
        expect(await signedIn(mine)).toBe(false)
        expect(await signedIn(cookies[actor])).toBe(true)
        expect(await signedIn(cookies.owner)).toBe(true)
        expect(await signedIn(aSecond)).toBe(true)
      }),
    },
  },

  // Admins only: everyone else gets 404 and changes nothing (adminOnly).
  'api/admin/users/route.ts': {
    GET: adminOnly(
      () => [{ params: {} }],
      async (_w, call) => expect(idsIn(await call({ params: {} }))).toEqual(expect.arrayContaining([userA.id, userB.id, userE.id])),
    ),
  },
  'api/admin/users/[id]/route.ts': {
    PATCH: adminOnly(
      () => [{ ...id(userA.id), body: { disabled: true } }],
      async (_w, call) => {
        const someone = await makeUser(db, { displayName: 'Temp' })
        expect(await call({ ...id(someone.id), body: { disabled: true } })).toMatchObject({ status: 200, body: { id: someone.id, disabled: true } })
      },
    ),
  },
  'api/admin/users/[id]/reset-link/route.ts': {
    POST: adminOnly(
      () => [id(userA.id), id(userB.id)],
      async (_w, call) => {
        const someone = await makeUser(db, { displayName: 'Temp' })
        expect((await call(id(someone.id))).status).toBe(201)
        expect(await db.select().from(passwordResets).where(eq(passwordResets.userId, someone.id))).toHaveLength(1)
      },
    ),
  },
  'api/admin/users/[id]/sign-out/route.ts': {
    POST: adminOnly(
      () => [id(userA.id)],
      async (_w, call) => {
        const someone = await makeUser(db, { displayName: 'Temp' })
        const theirs = await sessionCookie(db, someone.id)
        expect(await call(id(someone.id))).toMatchObject({ status: 200, body: { ended: 1 } })
        expect(await signedIn(theirs)).toBe(false)
        expect(await signedIn(cookies.owner)).toBe(true)
      },
    ),
  },
  'api/admin/invites/route.ts': {
    GET: adminOnly(
      () => [{ params: {} }],
      async (w, call) => expect(idsIn(await call({ params: {} }))).toContain(w.plannerInvite),
    ),
    POST: adminOnly(
      () => [{ params: {}, body: {} }],
      async (_w, call) => expect((await call({ params: {}, body: {} })).status).toBe(201),
    ),
  },
  'api/admin/invites/[id]/route.ts': {
    DELETE: adminOnly(
      (w) => [id(w.plannerInvite)],
      async (_w, call) => {
        const { invite } = await createInvite(db, { invitedBy: admin.id })
        expect(await call(id(invite.id))).toMatchObject({ status: 200, body: { ok: true } })
      },
    ),
  },
  'api/admin/weddings/route.ts': {
    GET: adminOnly(
      () => [{ params: {} }],
      async (w, call) => expect(idsIn(await call({ params: {} }))).toEqual(expect.arrayContaining([w.weddingA, w.ownerless])),
    ),
  },
  'api/admin/weddings/[id]/claim/route.ts': {
    POST: adminOnly(
      (w) => [id(w.weddingA), id(w.ownerless)],
      async (w, call) => {
        // Refused while the wedding has an owner: an admin can open it anyway, and does not become a member.
        expect(await call(id(w.weddingA))).toMatchObject({ status: 409, body: { error: 'has_owner' } })
        expect(await roleIn(w.weddingA, admin.id)).toBeNull()
        expect(await call(id(w.ownerless))).toMatchObject({ status: 200, body: { id: w.ownerless, members: [{ userId: admin.id, role: 'owner' }] } })
      },
    ),
  },

  // ---- Stored backups (mu-p9-backups). The wedding's backup routes follow their
  // policy (owner: B 404, E 403, the admin through); the cron route lets no
  // session in without its bearer secret; the admin's backup routes answer
  // 404 to anyone but an admin and change nothing (adminOnly).
  'api/cron/backups/route.ts': { GET: { checks: cronRefusesSessions('GET') }, POST: { checks: cronRefusesSessions('POST') } },
  'api/weddings/[id]/backups/route.ts': {
    GET: { req: (w) => id(w.weddingA) },
    // The admin's "Back up now": 201, or 200 when nothing changed since the nightly backup.
    POST: { req: (w) => id(w.weddingA) },
  },
  'api/weddings/[id]/backups/[backupId]/route.ts': { GET: { req: (w) => ({ params: { id: w.weddingA, backupId: w.backupA } }) } },
  'api/weddings/[id]/backups/[backupId]/restore/route.ts': {
    POST: { req: (w) => ({ params: { id: w.weddingA, backupId: w.backupA }, body: { jobId: randomUUID() } }) },
  },
  'api/admin/backups/route.ts': {
    GET: adminOnly(
      () => [{ params: {} }],
      async (w, call) => {
        const res = await call({ params: {} })
        expect(res.status).toBe(200)
        expect((res.body as { backups: { id: string }[] }).backups.map((b) => b.id)).toContain(w.backupA)
      },
    ),
  },
  'api/admin/backups/run/route.ts': {
    POST: adminOnly(
      () => [{ params: {} }],
      async (_w, call) => expect((await call({ params: {} })).status).toBe(200),
    ),
  },
  'api/admin/backups/[backupId]/route.ts': {
    GET: adminOnly(
      (w) => [{ params: { backupId: w.backupA } }],
      async (w, call) => expect((await call({ params: { backupId: w.backupA } })).status).toBe(200),
    ),
  },
  'api/admin/backups/[backupId]/restore/route.ts': {
    POST: adminOnly(
      (w) => [{ params: { backupId: w.backupA }, body: { jobId: randomUUID() } }],
      async (w, call) => expect((await call({ params: { backupId: w.backupA }, body: { jobId: randomUUID() } })).status).toBe(201),
    ),
  },
  // ---- End of stored backups
}

// ---- Stored backups (mu-p9-backups)
/** The cron route with each actor's valid session cookie and no bearer secret: 401, before anything runs. */
function cronRefusesSessions(method: string): Record<Actor, Check> {
  const check: Check = async (_w, call) => {
    const res = await call({ params: {} })
    expect(res, `${method} /api/cron/backups with a session cookie`).toMatchObject({ status: 401, body: { error: 'unauthorized' } })
  }
  return { outsider: check, editor: check, admin: check }
}
// ---- End of stored backups

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
    // Only the sign-in, setup and share-password routes are left uncalled; the invite and reset links are tried with made-up tokens.
    const notCalled = Object.entries(ROWS).flatMap(([file, methods]) => Object.values(methods).filter((r) => r.notCalled).map(() => file))
    expect(notCalled.sort()).toEqual(['api/auth/login/route.ts', 'api/setup/route.ts', 'share/[token]/login/route.ts'])
  })
})

describe('a planner outside the wedding (B)', () => {
  it('gets 404 from every wedding route, every route about A’s private venue and every admin route, changes nothing, and learns nothing', async () => {
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

// ---- Stored backups (mu-p9-backups)
describe('a planner outside the wedding (B), with the id of A’s stored backup', () => {
  it('cannot list, download or restore it through B’s own wedding, nor through any admin route', async () => {
    const w = await makeWorld()
    const before = await snapshot(w)
    const call = async (file: string, method: Method, req: Req) => {
      const handler = (await handlersOf(file)).find(([m]) => m === method)![1]
      return send(handler, file, method, req, cookies.outsider)
    }
    const jobId = randomUUID()
    const replies = [
      // B's own wedding id with A's backup id: the backup must be the wedding's, so it reads as missing.
      await call('api/weddings/[id]/backups/[backupId]/route.ts', 'GET', { params: { id: w.weddingB, backupId: w.backupA } }),
      await call('api/weddings/[id]/backups/[backupId]/restore/route.ts', 'POST', { params: { id: w.weddingB, backupId: w.backupA }, body: { jobId } }),
      // A's wedding id with A's backup id: not B's wedding.
      await call('api/weddings/[id]/backups/[backupId]/route.ts', 'GET', { params: { id: w.weddingA, backupId: w.backupA } }),
      await call('api/weddings/[id]/backups/[backupId]/restore/route.ts', 'POST', { params: { id: w.weddingA, backupId: w.backupA }, body: { jobId } }),
      // The admin's routes, which take any backup id.
      await call('api/admin/backups/[backupId]/route.ts', 'GET', { params: { backupId: w.backupA } }),
      await call('api/admin/backups/[backupId]/restore/route.ts', 'POST', { params: { backupId: w.backupA }, body: { jobId } }),
      await call('api/admin/backups/route.ts', 'GET', { params: {} }),
      await call('api/admin/backups/run/route.ts', 'POST', { params: {} }),
    ]
    expect(replies.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404, 404, 404])
    // B's own list holds only B's backup.
    const list = await call('api/weddings/[id]/backups/route.ts', 'GET', id(w.weddingB))
    expect((list.body as { backups: { id: string }[] }).backups.map((b) => b.id)).toEqual([w.backupB])
    replies.push(list)
    // B's own backup works, so the refusals above are the wedding check, not a broken route.
    const own = await call('api/weddings/[id]/backups/[backupId]/route.ts', 'GET', { params: { id: w.weddingB, backupId: w.backupB } })
    expect(own.status).toBe(200)
    expect(await db.select().from(weddings).where(eq(weddings.id, restoredWeddingId(jobId)))).toEqual([])
    expect(await snapshot(w)).toEqual(before)
    expectNoSecrets(w, replies)
  })
})
// ---- End of stored backups

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
  it('gets 403 from every owner-only route and 404 from every admin route, changing nothing, and gets through every other route', async () => {
    const w = await makeWorld()
    const before = await snapshot(w)
    await runAll('editor', w, (expected) => expected === 403)
    expect(await snapshot(w)).toEqual(before)
    await runAll('editor', w, (expected) => expected === 'ok')
    // The custom checks too (lists, creates, the share page, leaving, the account and admin routes).
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
    // Each change to W_A's members and invites was logged on its own (reads are logged once a day, so only changes are counted here).
    const changes = await db
      .select({ detail: activityEvents.detail })
      .from(activityEvents)
      .where(and(eq(activityEvents.kind, 'admin_access'), eq(activityEvents.userId, admin.id), eq(activityEvents.weddingId, w.weddingA)))
    const written = changes.map((e) => e.detail as { method: string; path: string; write: boolean }).filter((d) => d.write)
    expect(written.map((d) => `${d.method} ${d.path}`)).toEqual(
      expect.arrayContaining([
        'PATCH /api/weddings/[id]/members/[userId]',
        'DELETE /api/weddings/[id]/members/[userId]',
        'POST /api/weddings/[id]/invites',
        'DELETE /api/invites/[id]',
      ]),
    )
    // Using the power never made them a member.
    expect(await db.select().from(weddingMembers).where(and(eq(weddingMembers.userId, admin.id), inArray(weddingMembers.weddingId, [w.weddingA, w.restoredWedding])))).toEqual([])
    // The last call deleted A's wedding.
    const [row] = await db.select({ deletedAt: weddings.deletedAt }).from(weddings).where(eq(weddings.id, w.weddingA))
    expect(row!.deletedAt).not.toBeNull()
  })
})
