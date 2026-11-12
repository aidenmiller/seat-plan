/**
 * The AI floor plan import cap against the test database: imports started
 * at once cannot go past it, admins are never capped, only the last 30 days
 * count, and the import route answers 429 before any model call. The model
 * call itself is replaced here (it is tested in floorplan-import.test.ts).
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL, makeTestDb } from '../../../test/db'
import { makeUser, sessionCookie } from '../../../test/auth'
import { callRoute } from '../../../test/routes'
import { makeGridPng } from '@/domain/floorplan/__fixtures__/plans'
import { activityEvents } from '../db/schema'
import { addTemplateImage, createTemplate } from '../repo/venues'
import { floorplanImportStream } from './floorplan-import'
import { reserveAiImport } from './import-quota'

vi.mock('./floorplan-import', () => ({
  importConfigured: () => true,
  floorplanImportStream: vi.fn(
    () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ type: 'error', code: 'failed', message: 'stand-in' })}\n`))
          controller.close()
        },
      }),
  ),
}))

const { pool, db } = makeTestDb()

beforeAll(() => {
  vi.stubEnv('AUTH_SECRET', 'import-quota-test-secret-32-chars-plus')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  vi.stubEnv('AI_IMPORT_MONTHLY_LIMIT', '10')
})
afterAll(async () => {
  vi.unstubAllEnvs()
  await pool.end()
})
beforeEach(() => {
  vi.mocked(floorplanImportStream).mockClear()
})

async function importsBy(userId: string): Promise<number> {
  const rows = await db
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .where(and(eq(activityEvents.kind, 'venue.ai_import'), eq(activityEvents.userId, userId)))
  return rows.length
}

async function pastImports(userId: string, count: number, daysAgo: number): Promise<void> {
  const occurredAt = new Date(Date.now() - daysAgo * 86_400_000)
  await db.insert(activityEvents).values(Array.from({ length: count }, () => ({ kind: 'venue.ai_import', userId, occurredAt })))
}

describe('reserveAiImport', () => {
  it('lets exactly as many through as the limit when many start at once', async () => {
    const user = await makeUser(db)
    const viewer = { userId: user.id, isAdmin: false }
    const results = await Promise.all(Array.from({ length: 12 }, () => reserveAiImport(db, viewer, randomUUID(), 10)))
    expect(results.filter((r) => r.ok)).toHaveLength(10)
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, used: 10, limit: 10 },
      { ok: false, used: 10, limit: 10 },
    ])
    expect(await importsBy(user.id)).toBe(10)
  })

  it('counts only the last 30 days, and only that person', async () => {
    const user = await makeUser(db)
    const other = await makeUser(db)
    await pastImports(user.id, 9, 29)
    await pastImports(user.id, 20, 31)
    await pastImports(other.id, 20, 1)
    const viewer = { userId: user.id, isAdmin: false }
    expect(await reserveAiImport(db, viewer, randomUUID(), 10)).toEqual({ ok: true })
    expect(await reserveAiImport(db, viewer, randomUUID(), 10)).toEqual({ ok: false, used: 10, limit: 10 })
  })

  it('never caps an admin, but logs their imports too; a limit of 0 lets only admins import', async () => {
    const admin = await makeUser(db, { isAdmin: true })
    const planner = await makeUser(db)
    const results = await Promise.all(Array.from({ length: 12 }, () => reserveAiImport(db, { userId: admin.id, isAdmin: true }, randomUUID(), 0)))
    expect(results.every((r) => r.ok)).toBe(true)
    expect(await importsBy(admin.id)).toBe(12)
    expect(await reserveAiImport(db, { userId: planner.id, isAdmin: false }, randomUUID(), 0)).toEqual({ ok: false, used: 0, limit: 0 })
    expect(await importsBy(planner.id)).toBe(0)
  })
})

describe('the import route', () => {
  const route = async () => (await import('@/app/api/venues/[id]/import/route')) as Record<string, unknown>

  async function plannerWithPlan() {
    const user = await makeUser(db)
    const made = await createTemplate(db, { name: 'Hall' }, { userId: user.id, isAdmin: false }, { userId: user.id, name: 'Pat' })
    if (made.status !== 'created') throw new Error(made.status)
    const image = await addTemplateImage(db, made.venue.id, makeGridPng(40, 30))
    if (image.status !== 'created') throw new Error(image.status)
    return { user, cookie: await sessionCookie(db, user.id), templateId: made.venue.id, imageId: image.image.id }
  }

  it('takes one import from the allowance for each call that starts, and answers 429 once it is used up, before any model call', async () => {
    const { user, cookie, templateId, imageId } = await plannerWithPlan()
    await pastImports(user.id, 9, 5)
    const mod = await route()
    const call = (body: unknown) => callRoute(mod, 'POST', { cookie, params: { id: templateId }, body })
    const body = { imageId, imageWidth: 40, imageHeight: 30 }

    // A request that fails its checks costs nothing.
    expect((await call({ ...body, imageWidth: 41 })).status).toBe(422)
    expect(await importsBy(user.id)).toBe(9)

    const tenth = await call(body)
    expect(tenth.status).toBe(200)
    expect(floorplanImportStream).toHaveBeenCalledTimes(1)
    expect(await importsBy(user.id)).toBe(10)

    const refused = await call(body)
    expect(refused).toMatchObject({ status: 429, body: { error: 'import_limit', used: 10, limit: 10 } })
    expect((refused.body as { message: string }).message).toContain('10 AI floor plan imports for the last 30 days')
    expect(floorplanImportStream).toHaveBeenCalledTimes(1)
    expect(await importsBy(user.id)).toBe(10)
  })
})
