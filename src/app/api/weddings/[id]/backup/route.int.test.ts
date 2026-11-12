/**
 * The live download (GET /api/weddings/:id/backup) after the backups
 * refactor: its rows are now read in one transaction (backups/build.ts) and
 * written by the shared stream (backups/assemble.ts). The file must be the
 * same bytes as before (apart from exportedAt), so this test keeps a copy of
 * the old writer and compares, then restores the new file through the
 * browser's steps.
 */
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../../../test/db'
import { makeUser, sessionCookie } from '../../../../../../test/auth'
import { BACKUP_FORMAT, BACKUP_VERSION, backupFileSchema } from '@/domain/backup/schema'
import { legacySide } from '@/domain/partners'
import { fixedItemsSchema } from '@/domain/venue-schema'
import { editorName } from '@/server/editor-name'
import {
  groupMembers,
  groups,
  guests,
  layouts,
  ruleGuests,
  rules,
  users,
  venueImages,
  venueTemplates,
  weddingMembers,
  weddings,
} from '@/server/db/schema'
import type { Db } from '@/server/locks'
import { makeBackupWedding } from '@/server/backups/test-wedding'
import type { RestoredLayout, RestoredTemplate, RestoreStarted } from '@/shared/api'

let me = ''
let cookie = ''

beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'backup-route-int-test-secret-32-chars-plus')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  const db = await getDb()
  me = (await makeUser(db)).id
  cookie = await sessionCookie(db, me)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

async function getDb(): Promise<Db> {
  return (await import('@/server/db/client')).getDb()
}

/** The writer as it was before the refactor (src/server/backup.ts at multi-user), kept here as the reference. */
async function legacyBackupText(db: Db, weddingId: string, exportedAt: string): Promise<string> {
  const [wedding] = await db
    .select({
      id: weddings.id,
      name: weddings.name,
      date: weddings.date,
      unit: weddings.unit,
      minGapCm: weddings.minGapCm,
      partner1Name: weddings.partner1Name,
      partner2Name: weddings.partner2Name,
    })
    .from(weddings)
    .where(and(eq(weddings.id, weddingId), isNull(weddings.deletedAt)))
  const liveGuest = and(eq(guests.weddingId, weddingId), isNull(guests.deletedAt))
  const guestRows = await db
    .select({
      id: guests.id,
      firstName: guests.firstName,
      lastName: guests.lastName,
      nickname: guests.nickname,
      partnerId: guests.partnerId,
      coupleRuleEnabled: guests.coupleRuleEnabled,
      household: guests.household,
      side: guests.side,
      rsvp: guests.rsvp,
      meal: guests.meal,
      isChild: guests.isChild,
      notes: guests.notes,
    })
    .from(guests)
    .where(liveGuest)
    .orderBy(asc(guests.createdAt), asc(guests.id))
  const groupRows = await db
    .select({ id: groups.id, name: groups.name, color: groups.color })
    .from(groups)
    .where(eq(groups.weddingId, weddingId))
    .orderBy(asc(groups.createdAt), asc(groups.id))
  const memberRows = await db
    .select({ groupId: groupMembers.groupId, guestId: groupMembers.guestId })
    .from(groupMembers)
    .innerJoin(guests, eq(guests.id, groupMembers.guestId))
    .where(and(eq(groupMembers.weddingId, weddingId), liveGuest))
    .orderBy(asc(groupMembers.groupId), asc(groupMembers.createdAt), asc(groupMembers.guestId))
  const ruleRows = await db
    .select({ id: rules.id, kind: rules.kind, nextToEachOther: rules.nextToEachOther, appliesTo: rules.appliesTo, enabled: rules.enabled, note: rules.note })
    .from(rules)
    .where(eq(rules.weddingId, weddingId))
    .orderBy(asc(rules.createdAt), asc(rules.id))
  const ruleGuestRows = await db
    .select({ ruleId: ruleGuests.ruleId, guestId: ruleGuests.guestId })
    .from(ruleGuests)
    .innerJoin(guests, eq(guests.id, ruleGuests.guestId))
    .where(and(eq(ruleGuests.weddingId, weddingId), liveGuest))
    .orderBy(asc(ruleGuests.ruleId), asc(ruleGuests.guestId))
  const layoutRows = await db
    .select({ id: layouts.id, name: layouts.name, kind: layouts.kind, venueTemplateId: layouts.venueTemplateId, editedBy: editorName(layouts), canvas: layouts.canvas })
    .from(layouts)
    .where(and(eq(layouts.weddingId, weddingId), isNull(layouts.deletedAt)))
    .orderBy(asc(layouts.createdAt), asc(layouts.id))
  const weddingMemberRows = await db
    .select({ userId: weddingMembers.userId, email: users.email, displayName: users.displayName, role: weddingMembers.role })
    .from(weddingMembers)
    .innerJoin(users, eq(users.id, weddingMembers.userId))
    .where(eq(weddingMembers.weddingId, weddingId))
    .orderBy(asc(weddingMembers.createdAt), asc(weddingMembers.userId))
  const templateIds = [...new Set(layoutRows.flatMap((l) => (l.venueTemplateId ? [l.venueTemplateId] : [])))]
  const templateRows =
    templateIds.length === 0
      ? []
      : await db
          .select({
            id: venueTemplates.id,
            name: venueTemplates.name,
            fixedItems: venueTemplates.fixedItems,
            reference: venueTemplates.reference,
            importedBy: venueTemplates.importedBy,
            imageId: venueTemplates.referenceImageId,
          })
          .from(venueTemplates)
          .where(inArray(venueTemplates.id, templateIds))
          .orderBy(asc(venueTemplates.createdAt), asc(venueTemplates.id))
  const templates = templateRows.map((t) => {
    const items = fixedItemsSchema.safeParse(t.fixedItems)
    return { ...t, fixedItems: items.success ? items.data : [], reference: t.reference ?? null }
  })
  const head = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    wedding,
    guests: guestRows.map((g) => ({ ...g, side: legacySide(g.side) ?? 'both' })),
    members: weddingMemberRows,
    groups: groupRows,
    groupMembers: memberRows,
    rules: ruleRows,
    ruleGuests: ruleGuestRows,
    layouts: layoutRows,
    templates,
  }
  let text = `${JSON.stringify(head).slice(0, -1)},"images":[`
  let written = 0
  for (const t of templates) {
    if (!t.imageId) continue
    const [row] = await db
      .select({
        id: venueImages.id,
        templateId: venueImages.templateId,
        contentType: venueImages.contentType,
        width: venueImages.width,
        height: venueImages.height,
        sha256: venueImages.sha256,
        bytes: venueImages.bytes,
      })
      .from(venueImages)
      .where(and(eq(venueImages.id, t.imageId), eq(venueImages.templateId, t.id)))
    if (!row) continue
    const { bytes, ...meta } = row
    text += `${written++ > 0 ? ',' : ''}${JSON.stringify({ ...meta, data: Buffer.from(bytes).toString('base64') })}`
  }
  return `${text}]}`
}

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>

async function call(mod: Record<string, unknown>, method: string, params: Record<string, string>, body?: unknown, raw?: Uint8Array) {
  const headers: Record<string, string> = { cookie }
  let init: BodyInit | undefined = raw ? new Uint8Array(raw) : undefined
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init = JSON.stringify(body)
  }
  return (mod[method] as Handler)(new NextRequest('https://seat.example/api/x', { method, headers, body: init }), { params: Promise.resolve(params) })
}

describe('GET /api/weddings/:id/backup', () => {
  it('writes the same bytes as before the refactor, apart from exportedAt', async () => {
    const db = await getDb()
    const w = await makeBackupWedding(db, me)
    // A second template with its own image, used by the ceremony: two images in the file.
    const second = await makeBackupWedding(db, me)
    await db.update(layouts).set({ venueTemplateId: second.templateId }).where(eq(layouts.id, w.ceremonyId))

    const route = await import('./route')
    const res = await call(route, 'GET', { id: w.weddingId })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="Backup wedding [0-9a-f]{8} backup \d{4}-\d{2}-\d{2}\.json"/)
    const text = await res.text()
    const exportedAt = (JSON.parse(text) as { exportedAt: string }).exportedAt
    expect(text).toBe(await legacyBackupText(db, w.weddingId, exportedAt))
    const file = backupFileSchema.parse(JSON.parse(text))
    expect(file.images.map((i) => i.templateId).sort()).toEqual([w.templateId, second.templateId].sort())
  })

  it('still restores through the browser’s steps into the same wedding', async () => {
    const db = await getDb()
    const w = await makeBackupWedding(db, me)
    const backup = await import('./route')
    const file = backupFileSchema.parse(JSON.parse(await (await call(backup, 'GET', { id: w.weddingId })).text()))

    const start = await import('../../restore/route')
    const templateStep = await import('../../restore/[jobId]/templates/route')
    const imageStep = await import('../../restore/[jobId]/templates/[templateId]/image/route')
    const layoutStep = await import('../../restore/[jobId]/layouts/route')
    const jobId = randomUUID()
    const started = (await (
      await call(start, 'POST', {}, {
        format: file.format,
        version: file.version,
        jobId,
        wedding: file.wedding,
        guests: file.guests,
        groups: file.groups,
        groupMembers: file.groupMembers,
        rules: file.rules,
        ruleGuests: file.ruleGuests,
      })
    ).json()) as RestoreStarted
    // Walls changed since: the restore makes a copy and needs the image.
    await db.update(venueTemplates).set({ fixedItems: [] }).where(eq(venueTemplates.id, w.templateId))
    for (const template of file.templates) {
      const step = (await (await call(templateStep, 'POST', { jobId }, template)).json()) as RestoredTemplate
      expect(step.needsImage).toBe(true)
      const image = file.images.find((i) => i.id === template.imageId)!
      expect((await call(imageStep, 'PUT', { jobId, templateId: template.id }, undefined, Buffer.from(image.data, 'base64'))).status).toBe(200)
    }
    for (const layout of file.layouts) {
      const res = await call(layoutStep, 'POST', { jobId }, layout)
      expect(res.status).toBe(201)
      expect(((await res.json()) as RestoredLayout).droppedSeats).toBe(0)
    }
    const restoredGuests = await db
      .select({ firstName: guests.firstName })
      .from(guests)
      .where(eq(guests.weddingId, started.weddingId))
    expect(restoredGuests.map((g) => g.firstName).sort()).toEqual(['Ann', 'Ben', 'Cat', 'Dan'])
    const [copy] = await db
      .select({ imageId: venueTemplates.referenceImageId })
      .from(layouts)
      .innerJoin(venueTemplates, eq(venueTemplates.id, layouts.venueTemplateId))
      .where(and(eq(layouts.weddingId, started.weddingId), eq(layouts.name, 'Dinner')))
    const [image] = await db.select({ sha256: venueImages.sha256 }).from(venueImages).where(eq(venueImages.id, copy!.imageId!))
    expect(image!.sha256).toBe(file.images[0]!.sha256)
  })
})
