/**
 * Backup, then restore as a new wedding, through the route handlers against
 * the test database (spec section 11): the restored wedding has the same
 * guests, partners, groups, rules and seats under new ids. Also: every step
 * can be sent again without making anything twice, and a template follows
 * PLAN change 5 (reused with the same walls, else "Name (restored)" with its
 * floor plan image). Who restores: the restorer is the new wedding's only
 * member (its owner), the later steps are theirs alone, and a template is
 * reused only when it is the library's or the restorer's own; anyone else's
 * comes back as the restorer's private copy, and a file naming someone
 * else's template never attaches it.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../../test/db'
import { makeMember, makeUser, sessionCookie } from '../../../../../test/auth'
import { backupFileSchema, type BackupFile } from '@/domain/backup/schema'
import type { Canvas, Note } from '@/domain/canvas-schema'
import { DEFAULT_LEFT_LABEL, generateSeatingBlock } from '@/domain/ceremony'
import { makeGridPng } from '@/domain/floorplan/__fixtures__/plans'
import type { FixedItem } from '@/domain/venue-schema'
import {
  activityEvents,
  groupMembers,
  groups,
  guests,
  layouts,
  layoutSeats,
  ruleGuests,
  rules,
  shareLinks,
  users,
  venueImages,
  venueTemplates,
  weddingMembers,
  weddings,
} from '@/server/db/schema'
import { addTemplateImage } from '@/server/repo/venues'
import { canvasOf, chairRow, makeGuest, makeLayout, makeTemplate, makeWedding, roundTable } from '@/server/repo/test-fixtures'
import type { RestoredLayout, RestoredTemplate, RestoreStarted } from '@/shared/api'

/** The cookie of the user every test acts as: the owner of each wedding it makes. */
let signedIn = ''
let me = ''

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'restore-int-test-secret-of-32-chars-plus')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  const database = await db()
  me = (await makeUser(database)).id
  signedIn = await sessionCookie(database, me)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

async function db() {
  return (await import('@/server/db/client')).getDb()
}

type Params = Record<string, string>
type Handler = (req: NextRequest, ctx: { params: Promise<Params> }) => Promise<Response>

type SendOptions = { body?: unknown; raw?: Uint8Array; cookie?: string }

async function send(mod: Record<string, unknown>, method: string, params: Params, opts: SendOptions = {}) {
  const headers: Record<string, string> = { cookie: opts.cookie ?? signedIn }
  let body: BodyInit | undefined = opts.raw ? new Uint8Array(opts.raw) : undefined
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await (mod[method] as Handler)(new NextRequest('https://seat.example/api/weddings/restore', { method, headers, body }), {
    params: Promise.resolve(params),
  })
  return res
}

async function call(mod: Record<string, unknown>, method: string, params: Params, opts: SendOptions = {}) {
  const res = await send(mod, method, params, opts)
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
}

const routes = async () => ({
  backup: await import('../[id]/backup/route'),
  start: await import('./route'),
  template: await import('./[jobId]/templates/route'),
  image: await import('./[jobId]/templates/[templateId]/image/route'),
  layout: await import('./[jobId]/layouts/route'),
})

/**
 * A wedding the signed-in user owns, with partners, groups, rules, a removed
 * guest, a template of theirs with a floor plan image, a reception layout
 * with seats and a note, and a ceremony layout with a named chair.
 */
async function makeSource() {
  const database = await db()
  const weddingId = await makeWedding(database, 'Noa & Aiden')
  await makeMember(database, weddingId, me, 'owner')
  await database
    .update(weddings)
    .set({ unit: 'm', minGapCm: 120, date: '2027-06-12', partner1Name: 'Noa', partner2Name: 'Aiden' })
    .where(eq(weddings.id, weddingId))
  const ann = await makeGuest(database, weddingId, 'Ann', 'Lee')
  const ben = await makeGuest(database, weddingId, 'Ben', 'Lee')
  const cat = await makeGuest(database, weddingId, 'Cat', 'Ray')
  const dan = await makeGuest(database, weddingId, 'Dan', 'Ray')
  const eve = await makeGuest(database, weddingId, 'Eve', 'Gone')
  await database.update(guests).set({ partnerId: ben, coupleRuleEnabled: false }).where(eq(guests.id, ann))
  await database.update(guests).set({ partnerId: ann, coupleRuleEnabled: false }).where(eq(guests.id, ben))
  await database.update(guests).set({ isChild: true, meal: 'Kids pasta', notes: 'Needs a high chair', side: 'partner2', rsvp: 'yes' }).where(eq(guests.id, dan))

  const [friends] = await database.insert(groups).values({ weddingId, name: 'Friends', color: '#2563EB' }).returning({ id: groups.id })
  const [family] = await database.insert(groups).values({ weddingId, name: 'Family', color: '#C2410C' }).returning({ id: groups.id })
  await database.insert(groupMembers).values([
    { weddingId, groupId: friends!.id, guestId: ann },
    { weddingId, groupId: friends!.id, guestId: cat },
    { weddingId, groupId: family!.id, guestId: ben },
    { weddingId, groupId: family!.id, guestId: eve },
  ])
  const [apart] = await database.insert(rules).values({ weddingId, kind: 'apart', note: 'Old feud' }).returning({ id: rules.id })
  const [together] = await database
    .insert(rules)
    .values({ weddingId, kind: 'together', nextToEachOther: true, appliesTo: 'reception', enabled: false })
    .returning({ id: rules.id })
  await database.insert(ruleGuests).values([
    { weddingId, ruleId: apart!.id, guestId: ann },
    { weddingId, ruleId: apart!.id, guestId: dan },
    { weddingId, ruleId: together!.id, guestId: cat },
    { weddingId, ruleId: together!.id, guestId: dan },
    { weddingId, ruleId: together!.id, guestId: eve },
  ])

  const templateId = await makeTemplate(database, `Hall ${randomUUID().slice(0, 8)}`)
  await database.update(venueTemplates).set({ ownerUserId: me }).where(eq(venueTemplates.id, templateId))
  const png = makeGridPng(120, 80)
  const image = await addTemplateImage(database, templateId, png)
  if (image.status !== 'created') throw new Error(image.status)
  await database.update(venueTemplates).set({ referenceImageId: image.image.id }).where(eq(venueTemplates.id, templateId))

  const note: Note = {
    id: 'n1',
    kind: 'note',
    x: 10,
    y: 20,
    rotation: 0,
    locked: false,
    type: 'arrow',
    width: 100,
    height: 10,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    text: '',
    color: 'blue',
    author: 'Aiden',
    done: false,
    createdAt: '2026-11-10T10:00:00.000Z',
    attachedTo: { start: 't1', end: null },
  }
  const dinner = await makeLayout(
    database,
    weddingId,
    canvasOf(roundTable('t1', 1, [ann, ben, eve, null]), roundTable('t2', 2, [cat, dan], 'Family'), note),
    { name: 'Dinner', venueTemplateId: templateId },
  )
  // A ceremony made with the seating block tool: two rows a side, the front row on Noa's side reserved, Dan on a chair behind it.
  let rowId = 0
  const block = generateSeatingBlock({ rows: 2, chairsPerRow: 3, origin: { x: 0, y: 0 } }, () => `row-${++rowId}`)
  const ceremonyRows = block.map((row) =>
    row.rowNumber === 1 && row.blockLabel === DEFAULT_LEFT_LABEL
      ? { ...row, reservedFor: 'Family, row 1' }
      : row.rowNumber === 2 && row.blockLabel === DEFAULT_LEFT_LABEL
        ? { ...row, seats: row.seats.map((seat) => (seat.index === 1 ? { ...seat, guestId: dan } : seat)) }
        : row,
  )
  const ceremony = await makeLayout(database, weddingId, canvasOf(chairRow('r1', 1, [null, null], 'Single'), ...ceremonyRows), {
    name: 'Ceremony',
    kind: 'ceremony',
  })
  const shareToken = randomBytes(32).toString('base64url')
  await database.insert(shareLinks).values({ weddingId, layoutId: dinner, token: shareToken, passwordHash: 'x' })

  // Removed after it was seated: the backup leaves Eve out, with her seat, group and rule links.
  const { removeGuests } = await import('@/server/repo/guests')
  await removeGuests(database, weddingId, [eve])
  return { weddingId, templateId, png, shareToken, ids: { ann, ben, cat, dan, eve }, layoutIds: [dinner, ceremony] }
}

/** Everything the restored wedding should share with the original, by names rather than ids. */
async function snapshot(weddingId: string) {
  const database = await db()
  const guestRows = await database
    .select()
    .from(guests)
    .where(and(eq(guests.weddingId, weddingId), isNull(guests.deletedAt)))
  const nameOf = new Map(guestRows.map((g) => [g.id, `${g.firstName} ${g.lastName}`]))
  const groupRows = await database.select().from(groups).where(eq(groups.weddingId, weddingId))
  const memberRows = await database.select().from(groupMembers).where(eq(groupMembers.weddingId, weddingId))
  const ruleRows = await database.select().from(rules).where(eq(rules.weddingId, weddingId))
  const ruleGuestRows = await database.select().from(ruleGuests).where(eq(ruleGuests.weddingId, weddingId))
  const layoutRows = await database
    .select()
    .from(layouts)
    .where(and(eq(layouts.weddingId, weddingId), isNull(layouts.deletedAt)))
  const seatRows = await database.select().from(layoutSeats).where(eq(layoutSeats.weddingId, weddingId))
  const layoutName = new Map(layoutRows.map((l) => [l.id, l.name]))

  return {
    guests: guestRows
      .map((g) => ({
        name: nameOf.get(g.id),
        partner: g.partnerId ? nameOf.get(g.partnerId) : null,
        coupleRuleEnabled: g.coupleRuleEnabled,
        side: g.side,
        rsvp: g.rsvp,
        meal: g.meal,
        isChild: g.isChild,
        notes: g.notes,
        nameKey: g.nameKey,
      }))
      .sort((a, b) => a.name!.localeCompare(b.name!)),
    groups: groupRows
      .map((g) => ({
        name: g.name,
        color: g.color,
        members: memberRows
          // A removed guest's links stay in the database, hidden (PLAN section 5).
          .filter((m) => m.groupId === g.id && nameOf.has(m.guestId))
          .map((m) => nameOf.get(m.guestId))
          .sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    rules: ruleRows
      .map((r) => ({
        kind: r.kind,
        nextToEachOther: r.nextToEachOther,
        appliesTo: r.appliesTo,
        enabled: r.enabled,
        note: r.note,
        guests: ruleGuestRows
          .filter((x) => x.ruleId === r.id && nameOf.has(x.guestId))
          .map((x) => nameOf.get(x.guestId))
          .sort(),
      }))
      .sort((a, b) => a.kind.localeCompare(b.kind)),
    seats: seatRows
      .map((s) => `${layoutName.get(s.layoutId)} ${s.itemLabel} seat ${s.seatIndex}: ${nameOf.get(s.guestId)}`)
      .sort(),
    layouts: layoutRows
      .map((l) => ({ name: l.name, kind: l.kind, editedBy: l.editedBy, items: l.canvas.items.map((i) => i.id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    ids: [...guestRows.map((g) => g.id), ...groupRows.map((g) => g.id), ...ruleRows.map((r) => r.id), ...layoutRows.map((l) => l.id)],
    templateIds: [...new Set(layoutRows.map((l) => l.venueTemplateId))],
  }
}

/** A live guest's id in a wedding, by first name. */
async function guestIdByName(weddingId: string, firstName: string): Promise<string> {
  const [row] = await (await db())
    .select({ id: guests.id })
    .from(guests)
    .where(and(eq(guests.weddingId, weddingId), eq(guests.firstName, firstName), isNull(guests.deletedAt)))
  return row!.id
}

async function downloadBackup(weddingId: string): Promise<BackupFile> {
  const r = await routes()
  const res = await send(r.backup, 'GET', { id: weddingId })
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
  expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="Noa & Aiden backup \d{4}-\d{2}-\d{2}\.json"/)
  return backupFileSchema.parse(JSON.parse(await res.text()))
}

/** The browser's steps, in order (src/client/backup/restore.ts), as the signed-in user unless `cookie` says otherwise. */
async function restore(file: BackupFile, jobId = randomUUID(), cookie = signedIn) {
  const r = await routes()
  const start = await call(r.start, 'POST', {}, {
    cookie,
    body: {
      format: file.format,
      version: file.version,
      jobId,
      wedding: file.wedding,
      guests: file.guests,
      groups: file.groups,
      groupMembers: file.groupMembers,
      rules: file.rules,
      ruleGuests: file.ruleGuests,
    },
  })
  expect(start.status).toBe(201)
  const started = start.body as RestoreStarted
  const templates: RestoredTemplate[] = []
  for (const template of file.templates) {
    const res = await call(r.template, 'POST', { jobId }, { cookie, body: template })
    expect(res.status).toBe(200)
    templates.push(res.body)
    const image = file.images.find((i) => i.id === template.imageId)
    if (res.body.needsImage && image) {
      const put = await call(r.image, 'PUT', { jobId, templateId: template.id }, { cookie, raw: Buffer.from(image.data, 'base64') })
      expect(put.status).toBe(200)
    }
  }
  const layoutReplies: RestoredLayout[] = []
  for (const layout of file.layouts) {
    const res = await call(r.layout, 'POST', { jobId }, { cookie, body: layout })
    expect(res.status).toBe(201)
    layoutReplies.push(res.body)
  }
  return { jobId, started, templates, layouts: layoutReplies }
}

describe('backup and restore', () => {
  it('restores the same guests, seats and rules under new ids', async () => {
    const source = await makeSource()
    const file = await downloadBackup(source.weddingId)

    // The file holds the live wedding only, with the template and its image, and no share links.
    expect(file.guests.map((g) => g.firstName).sort()).toEqual(['Ann', 'Ben', 'Cat', 'Dan'])
    expect(file.layouts.map((l) => l.name)).toEqual(['Dinner', 'Ceremony'])
    expect(file.templates.map((t) => t.id)).toEqual([source.templateId])
    expect(file.images).toHaveLength(1)
    expect(Buffer.from(file.images[0]!.data, 'base64').equals(Buffer.from(source.png))).toBe(true)
    expect(JSON.stringify(file)).not.toContain(source.shareToken)

    const restored = await restore(file)
    expect(restored.started.weddingName).toBe('Noa & Aiden (restored)')
    expect(restored.started.weddingId).not.toBe(source.weddingId)
    // The template still has the walls the backup holds, so the restored layouts use it.
    expect(restored.templates).toEqual([{ templateId: source.templateId, reused: true, needsImage: false }])
    expect(restored.layouts.map((l) => l.droppedSeats)).toEqual([0, 0])

    const before = await snapshot(source.weddingId)
    const after = await snapshot(restored.started.weddingId)
    expect(after.guests).toEqual(before.guests)
    expect(after.groups).toEqual(before.groups)
    expect(after.rules).toEqual(before.rules)
    expect(after.seats).toEqual(before.seats)
    expect(after.seats).toContain('Dinner Table 1 seat 1: Ben Lee')
    expect(after.seats.filter((s) => s.startsWith('Ceremony'))).toHaveLength(1)

    // The ceremony's chair rows come back whole (block, side labels, aisle ends, the reserved row), with Dan on his chair under his new id.
    const ceremonyOf = async (weddingId: string): Promise<Canvas> => {
      const [row] = await (await db())
        .select({ canvas: layouts.canvas })
        .from(layouts)
        .where(and(eq(layouts.weddingId, weddingId), eq(layouts.name, 'Ceremony')))
      return row!.canvas
    }
    const rowsBefore = (await ceremonyOf(source.weddingId)).items
    const rowsAfter = (await ceremonyOf(restored.started.weddingId)).items
    const newDan = await guestIdByName(restored.started.weddingId, 'Dan')
    expect(rowsAfter).toEqual(
      rowsBefore.map((item) =>
        item.kind === 'chairRow'
          ? { ...item, seats: item.seats.map((seat) => (seat.guestId === source.ids.dan ? { ...seat, guestId: newDan } : seat)) }
          : item,
      ),
    )
    expect(rowsAfter.filter((i) => i.kind === 'chairRow' && i.aisleEnd !== undefined)).toHaveLength(4)
    expect(rowsAfter.filter((i) => i.kind === 'chairRow' && i.reservedFor === 'Family, row 1')).toHaveLength(1)
    expect(after.layouts).toEqual(before.layouts)
    expect(after.templateIds.sort()).toEqual([null, source.templateId].sort())
    // Every id is new.
    const old = new Set([...before.ids, ...Object.values(source.ids)])
    expect(after.ids.filter((id) => old.has(id))).toEqual([])

    const [wedding] = await (await db()).select().from(weddings).where(eq(weddings.id, restored.started.weddingId))
    expect(wedding).toMatchObject({ name: 'Noa & Aiden (restored)', unit: 'm', minGapCm: 120, date: '2027-06-12', partner1Name: 'Noa', partner2Name: 'Aiden' })
    const links = await (await db()).select().from(shareLinks).where(eq(shareLinks.weddingId, restored.started.weddingId))
    expect(links).toEqual([])
  })

  it("writes version 2: the partners' names, sides as codes, and the members", async () => {
    const source = await makeSource()
    const database = await db()
    const [owner] = await database
      .insert(users)
      .values({ email: `owner-${randomUUID().slice(0, 8)}@example.com`, displayName: 'Noa', passwordHash: 'x' })
      .returning({ id: users.id, email: users.email })
    await database.insert(weddingMembers).values({ weddingId: source.weddingId, userId: owner!.id, role: 'owner' })
    const file = await downloadBackup(source.weddingId)
    expect(file.version).toBe(2)
    expect(file.wedding).toMatchObject({ partner1Name: 'Noa', partner2Name: 'Aiden' })
    expect(Object.fromEntries(file.guests.map((g) => [g.firstName, g.side]))).toEqual({ Ann: 'both', Ben: 'both', Cat: 'both', Dan: 'partner2' })
    expect(file.members).toEqual([
      { userId: me, email: expect.any(String), displayName: 'Pat', role: 'owner' },
      { userId: owner!.id, email: owner!.email, displayName: 'Noa', role: 'owner' },
    ])

    // A restore never trusts the members: only the restorer is added, as the owner, even when the step names someone.
    const restored = await restore(file)
    const r = await routes()
    const forged = await call(r.start, 'POST', {}, {
      body: { ...file, jobId: randomUUID(), layouts: undefined, templates: undefined, images: undefined, exportedAt: undefined },
    })
    expect(forged.status).toBe(201)
    for (const weddingId of [restored.started.weddingId, forged.body.weddingId as string]) {
      expect(await database.select({ userId: weddingMembers.userId, role: weddingMembers.role }).from(weddingMembers).where(eq(weddingMembers.weddingId, weddingId))).toEqual([
        { userId: me, role: 'owner' },
      ])
      const logged = await database.select({ kind: activityEvents.kind, userId: activityEvents.userId }).from(activityEvents).where(eq(activityEvents.weddingId, weddingId))
      expect(logged).toEqual([{ kind: 'wedding_restored', userId: me }])
    }
  })

  it('restores a version 1 file as Noa and Aiden, with sides by place', async () => {
    const source = await makeSource()
    const v2 = await downloadBackup(source.weddingId)
    // The same file as version 1 wrote it: no partner names, sides as names, no members.
    const words = { partner1: 'Noa', partner2: 'Aiden', both: 'Both' } as const
    const wedding = { id: v2.wedding.id, name: v2.wedding.name, date: v2.wedding.date, unit: v2.wedding.unit, minGapCm: v2.wedding.minGapCm }
    const oldGuests = v2.guests.map((g) => ({ ...g, side: words[g.side] }))
    const v1: Record<string, unknown> = { ...v2, version: 1, wedding, guests: oldGuests }
    delete v1.members

    // A browser still running the page from before version 2 sends its first step as version 1.
    const r = await routes()
    const jobId = randomUUID()
    const start = await call(r.start, 'POST', {}, {
      body: { format: v2.format, version: 1, jobId, wedding, guests: oldGuests, groups: v2.groups, groupMembers: v2.groupMembers, rules: v2.rules, ruleGuests: v2.ruleGuests },
    })
    expect(start.status).toBe(201)
    const database = await db()
    const [old] = await database.select().from(weddings).where(eq(weddings.id, start.body.weddingId))
    expect(old).toMatchObject({ partner1Name: 'Noa', partner2Name: 'Aiden' })
    expect((await snapshot(start.body.weddingId)).guests).toEqual((await snapshot(source.weddingId)).guests)

    // A version 1 file read by today's page restores the same way.
    const restored = await restore(backupFileSchema.parse(v1))
    const [wed] = await database.select().from(weddings).where(eq(weddings.id, restored.started.weddingId))
    expect(wed).toMatchObject({ partner1Name: 'Noa', partner2Name: 'Aiden' })
    const after = await snapshot(restored.started.weddingId)
    expect(after.guests.map((g) => [g.name, g.side])).toEqual([
      ['Ann Lee', 'both'],
      ['Ben Lee', 'both'],
      ['Cat Ray', 'both'],
      ['Dan Ray', 'partner2'],
    ])
    expect(after.seats).toEqual((await snapshot(source.weddingId)).seats)
  })

  it('exports the editor name and restores another person’s name into edited_by_name only', async () => {
    const source = await makeSource()
    const database = await db()
    // A layout last saved by someone besides Noa and Aiden: only the new column holds the name.
    await database
      .update(layouts)
      .set({ editedBy: null, editedByName: 'Dayna K.' })
      .where(and(eq(layouts.weddingId, source.weddingId), eq(layouts.name, 'Ceremony')))
    const file = await downloadBackup(source.weddingId)
    expect(file.layouts.map((l) => [l.name, l.editedBy])).toEqual([
      ['Dinner', 'Noa'],
      ['Ceremony', 'Dayna K.'],
    ])

    const restored = await restore(file)
    const rows = await database
      .select({ name: layouts.name, editedBy: layouts.editedBy, editedByName: layouts.editedByName, editedByUserId: layouts.editedByUserId })
      .from(layouts)
      .where(eq(layouts.weddingId, restored.started.weddingId))
    expect(rows.sort((x, y) => x.name.localeCompare(y.name))).toEqual([
      { name: 'Ceremony', editedBy: null, editedByName: 'Dayna K.', editedByUserId: null },
      // The old Noa / Aiden column is no longer written; the name the file gives goes into edited_by_name.
      { name: 'Dinner', editedBy: null, editedByName: 'Noa', editedByUserId: null },
    ])
  })

  it('can send every step again without making anything twice', async () => {
    const source = await makeSource()
    const file = await downloadBackup(source.weddingId)
    const restored = await restore(file)
    const r = await routes()
    const again = await call(r.start, 'POST', {}, { body: { ...file, jobId: restored.jobId, layouts: undefined, templates: undefined, images: undefined, exportedAt: undefined } })
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ weddingId: restored.started.weddingId })
    const layoutAgain = await call(r.layout, 'POST', { jobId: restored.jobId }, { body: file.layouts[0] })
    expect(layoutAgain.status).toBe(200)
    expect(layoutAgain.body.layoutId).toBe(restored.layouts[0]!.layoutId)
    const counts = await snapshot(restored.started.weddingId)
    expect(counts.guests).toHaveLength(4)
    expect(counts.layouts).toHaveLength(2)

    // A job id that never started has nowhere to put a layout.
    expect((await call(r.layout, 'POST', { jobId: randomUUID() }, { body: file.layouts[0] })).status).toBe(404)
    expect((await call(r.template, 'POST', { jobId: randomUUID() }, { body: file.templates[0] })).status).toBe(404)
  })

  it('copies a template whose walls changed as "Name (restored)", with its floor plan image', async () => {
    const source = await makeSource()
    const file = await downloadBackup(source.weddingId)
    const moved: FixedItem[] = [
      { id: 'w1', type: 'wall', unsure: false, unsureNote: '', thickness: 20, points: [{ x: -1000, y: -700 }, { x: 1000, y: -700 }] },
    ]
    const database = await db()
    await database.update(venueTemplates).set({ fixedItems: moved }).where(eq(venueTemplates.id, source.templateId))

    const restored = await restore(file)
    const [copy] = restored.templates
    expect(copy).toMatchObject({ reused: false, needsImage: true })
    expect(copy!.templateId).not.toBe(source.templateId)

    const [template] = await database.select().from(venueTemplates).where(eq(venueTemplates.id, copy!.templateId))
    expect(template!.name).toBe(`${file.templates[0]!.name} (restored)`)
    expect(template!.fixedItems).toEqual(file.templates[0]!.fixedItems)
    const [image] = await database.select().from(venueImages).where(eq(venueImages.id, template!.referenceImageId!))
    expect(image!.sha256).toBe(file.images[0]!.sha256)

    // The restored reception layout uses the copy; the original template is untouched.
    const restoredLayouts = await database
      .select({ name: layouts.name, venueTemplateId: layouts.venueTemplateId })
      .from(layouts)
      .where(inArray(layouts.id, restored.layouts.map((l) => l.layoutId)))
    expect(restoredLayouts.find((l) => l.name === 'Dinner')!.venueTemplateId).toBe(copy!.templateId)
    const [original] = await database.select().from(venueTemplates).where(eq(venueTemplates.id, source.templateId))
    expect(original!.fixedItems).toEqual(moved)

    // Sent again, the template step finds its copy and its image.
    const r = await routes()
    const again = await call(r.template, 'POST', { jobId: restored.jobId }, { body: file.templates[0] })
    expect(again.body).toEqual({ templateId: copy!.templateId, reused: false, needsImage: false })
  })

  it('makes someone else restoring the file a private copy of a template that is not theirs, and keeps every step of a job to its own restorer', async () => {
    const source = await makeSource()
    const file = await downloadBackup(source.weddingId)
    const database = await db()
    const bea = await makeUser(database, { displayName: 'Bea' })
    const beaCookie = await sessionCookie(database, bea.id)

    // The walls still match, but the template is not Bea's (nor the library's): she gets her own copy.
    const restored = await restore(file, randomUUID(), beaCookie)
    const [copy] = restored.templates
    expect(copy).toMatchObject({ reused: false, needsImage: true })
    expect(copy!.templateId).not.toBe(source.templateId)
    const [row] = await database.select().from(venueTemplates).where(eq(venueTemplates.id, copy!.templateId))
    expect(row).toMatchObject({ ownerUserId: bea.id, isLibrary: false, referenceImageId: expect.any(String) })
    const restoredLayouts = await database
      .select({ venueTemplateId: layouts.venueTemplateId })
      .from(layouts)
      .where(eq(layouts.weddingId, restored.started.weddingId))
    expect(restoredLayouts.map((l) => l.venueTemplateId)).not.toContain(source.templateId)
    expect(await database.select({ userId: weddingMembers.userId }).from(weddingMembers).where(eq(weddingMembers.weddingId, restored.started.weddingId))).toEqual([
      { userId: bea.id },
    ])

    // Her job is hers: every later step of it is 404 to me, and its id cannot start a wedding for me.
    const r = await routes()
    expect((await call(r.template, 'POST', { jobId: restored.jobId }, { body: file.templates[0] })).status).toBe(404)
    expect((await call(r.image, 'PUT', { jobId: restored.jobId, templateId: file.templates[0]!.id }, { raw: Buffer.from(file.images[0]!.data, 'base64') })).status).toBe(404)
    expect((await call(r.layout, 'POST', { jobId: restored.jobId }, { body: file.layouts[0] })).status).toBe(404)
    const again = await call(r.start, 'POST', {}, { body: { ...file, jobId: restored.jobId, layouts: undefined, templates: undefined, images: undefined, exportedAt: undefined } })
    expect(again).toMatchObject({ status: 409, body: { error: 'id_taken' } })
    expect(JSON.stringify(again.body)).not.toContain(restored.started.weddingId)
    expect(await database.select({ userId: weddingMembers.userId }).from(weddingMembers).where(eq(weddingMembers.weddingId, restored.started.weddingId))).toEqual([
      { userId: bea.id },
    ])
  })

  it('never attaches someone else’s private template named in a crafted file: the layout gets a blank canvas', async () => {
    const source = await makeSource()
    const file = await downloadBackup(source.weddingId)
    const database = await db()
    const bea = await makeUser(database)
    const beaCookie = await sessionCookie(database, bea.id)
    const r = await routes()
    const jobId = randomUUID()
    const start = await call(r.start, 'POST', {}, {
      cookie: beaCookie,
      body: { ...file, jobId, layouts: undefined, templates: undefined, images: undefined, exportedAt: undefined },
    })
    expect(start.status).toBe(201)
    // Bea skips the template step and sends a layout naming my template (and one naming a made-up id).
    const dinner = file.layouts.find((l) => l.name === 'Dinner')!
    expect(dinner.venueTemplateId).toBe(source.templateId)
    const sent = await call(r.layout, 'POST', { jobId }, { cookie: beaCookie, body: dinner })
    expect(sent.status).toBe(201)
    const [layout] = await database.select({ venueTemplateId: layouts.venueTemplateId }).from(layouts).where(eq(layouts.id, sent.body.layoutId))
    expect(layout!.venueTemplateId).toBeNull()
    // Nor does a template step that names it with walls that match: she gets her own copy.
    const step = await call(r.template, 'POST', { jobId }, { cookie: beaCookie, body: file.templates[0] })
    expect(step.body).toMatchObject({ reused: false })
    expect(step.body.templateId).not.toBe(source.templateId)
  })

  it('refuses a file that does not fit, and a deleted wedding', async () => {
    const r = await routes()
    const bad = await call(r.start, 'POST', {}, { body: { format: 'something-else', version: 1 } })
    expect(bad.status).toBe(422)
    const source = await makeSource()
    await (await db()).update(weddings).set({ deletedAt: new Date() }).where(eq(weddings.id, source.weddingId))
    expect((await send(r.backup, 'GET', { id: source.weddingId })).status).toBe(404)
  })
})
