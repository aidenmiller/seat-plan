/**
 * The speed test's layout, for trying pan and zoom by hand on a real phone
 * and laptop (acceptance check 27, "You: try on your phones"): a wedding
 * named "Speed test" with 400 made-up guests and one layout, "40 tables",
 * holding 40 round tables of 10 seats, every seat taken, and 100 other
 * shapes. The same layout e2e/perf.spec.ts measures.
 *
 * Safe to run twice: it skips the wedding, the guests and the layout when
 * they already exist. Run it with `npm run seed:perf` (tsx with the
 * react-server condition, like `npm run seed`, so the layout goes through
 * the app's own writeCanvas()).
 */
import { randomUUID } from 'node:crypto'
import { loadEnvConfig } from '@next/env'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { perfCanvas, perfGuestNames } from '../e2e/perf-layout'
import { createPool, requireDatabaseUrl } from '../src/server/db/connection'
import * as schema from '../src/server/db/schema'

export const PERF_WEDDING_NAME = 'Speed test'
export const PERF_LAYOUT_NAME = '40 tables'

async function loadServerModules() {
  try {
    const [{ writeCanvas }, { listLayouts }, { createWedding }] = await Promise.all([
      import('../src/server/canvas-write'),
      import('../src/server/repo/layouts'),
      import('../src/server/repo/weddings'),
    ])
    return { writeCanvas, listLayouts, createWedding }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Server Component')) {
      throw new Error('Run this with `npm run seed:perf`: it needs tsx --conditions=react-server to load the server modules.')
    }
    throw err
  }
}

async function main() {
  loadEnvConfig(process.cwd())
  const server = await loadServerModules()
  const pool = createPool(requireDatabaseUrl('direct'), { max: 1 })
  const db = drizzle({ client: pool, schema, casing: 'snake_case' })
  try {
    const [existing] = await db
      .select({ id: schema.weddings.id })
      .from(schema.weddings)
      .where(and(eq(schema.weddings.name, PERF_WEDDING_NAME), isNull(schema.weddings.deletedAt)))
    let weddingId: string
    if (existing) {
      weddingId = existing.id
      console.log(`"${PERF_WEDDING_NAME}" already exists.`)
    } else {
      const made = await server.createWedding(db, { name: PERF_WEDDING_NAME, date: '2027-06-19', unit: 'ft' })
      if (made.status !== 'created') throw new Error(`Could not make "${PERF_WEDDING_NAME}": ${made.status}`)
      weddingId = made.wedding.id
      console.log(`Made "${PERF_WEDDING_NAME}".`)
    }

    const live = and(eq(schema.guests.weddingId, weddingId), isNull(schema.guests.deletedAt))
    let guests = await db.select({ id: schema.guests.id }).from(schema.guests).where(live).orderBy(asc(schema.guests.createdAt), asc(schema.guests.id))
    if (guests.length === 0) {
      const rows = perfGuestNames().map(([firstName, lastName]) => ({
        id: randomUUID(),
        weddingId,
        firstName,
        lastName,
        nameKey: `${firstName}|${lastName}`.toLowerCase(),
      }))
      await db.insert(schema.guests).values(rows)
      guests = rows.map((r) => ({ id: r.id }))
      console.log(`Added ${rows.length} guests.`)
    } else {
      console.log(`"${PERF_WEDDING_NAME}" already has ${guests.length} guests.`)
    }

    const layouts = (await server.listLayouts(db, weddingId)) ?? []
    if (layouts.some((l) => l.name === PERF_LAYOUT_NAME)) {
      console.log(`"${PERF_LAYOUT_NAME}" already exists.`)
      return
    }
    const canvas = perfCanvas(randomUUID, guests.map((g) => g.id))
    const result = await db.transaction((tx) =>
      server.writeCanvas(tx, {
        mode: 'insert',
        weddingId,
        layoutId: randomUUID(),
        kind: 'reception',
        name: PERF_LAYOUT_NAME,
        canvas,
        venueTemplateId: null,
        editedBy: 'Noa',
      }),
    )
    if (result.status !== 'created') {
      const detail = result.status === 'invalid' ? `: ${result.issues.join('; ')}` : ''
      throw new Error(`Could not make "${PERF_LAYOUT_NAME}": ${result.status}${detail}`)
    }
    console.log(`Made "${PERF_LAYOUT_NAME}" with 40 tables, 400 seated guests and 100 shapes.`)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
