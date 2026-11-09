/**
 * Demo data so every feature can be tried without real guests (spec section 12).
 * Made-up names only, and the same content on every run. Safe to run twice:
 * it skips anything that already exists, matching by name.
 *
 * So far it makes the demo wedding with three reception layouts: "Reception
 * plan A" on a blank canvas with three round tables, "Canvas tour" on a
 * blank canvas with one of every table preset and fixture from the shape
 * panel (milestone 3), and "Beach Club reception" on the Toronto Beach Club
 * template (empty until the floor plan import fills the template). Each
 * milestone adds what it needs: guests,
 * groups, couples and rules (4 onward), ceremony rows (8) and notes (9). The
 * Toronto Beach Club template itself comes from a migration, so production
 * has it too.
 *
 * Run it with `npm run seed`, which starts tsx with the react-server
 * condition. That is how a server build resolves `import 'server-only'` (to
 * the package's empty file), so the seed writes layouts through the app's own
 * writeCanvas(), like every other canvas write (PLAN section 5). Plain
 * `tsx scripts/seed.ts` stops at the first server module; main() says how to
 * run it instead.
 */
import { randomUUID } from 'node:crypto'
import { loadEnvConfig } from '@next/env'
import { and, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { emptyCanvas, type Author, type Canvas, type Item } from '../src/domain/canvas-schema'
import { makeItem, type PresetId } from '../src/domain/presets'
import { addRoundTable } from '../src/domain/round-table'
import { createPool, requireDatabaseUrl } from '../src/server/db/connection'
import * as schema from '../src/server/db/schema'

export const DEMO_WEDDING_NAME = 'Demo wedding'
export const BLANK_LAYOUT_NAME = 'Reception plan A'
export const TOUR_LAYOUT_NAME = 'Canvas tour'
export const BEACH_LAYOUT_NAME = 'Beach Club reception'
export const BEACH_TEMPLATE_NAME = 'Toronto Beach Club'

/** Three Round preset tables (60 in, 8 seats), numbered 1 to 3 and set in a row, every seat empty. */
export function threeRoundTables(): Canvas {
  let canvas = emptyCanvas()
  for (let i = 0; i < 3; i++) canvas = addRoundTable(canvas, randomUUID())
  return canvas
}

/**
 * One of every table preset and fixture, set out like a small reception (cm,
 * centers): the head table seated along its back edge facing the dance
 * floor, the sweetheart table beside it, round, square and rectangle tables
 * around the floor, and the fixtures at the edges. Tables are numbered in the
 * order they are placed, every seat empty.
 */
export function canvasTour(): Canvas {
  const placed: [PresetId, number, number, number?][] = [
    ['stage', 0, -820],
    ['dj', 520, -820],
    ['head', 0, -470],
    ['sweetheart', -560, -470],
    ['danceFloor', 0, 0],
    ['round', -620, 0],
    ['round', 620, 0],
    ['square', -620, 480],
    ['rect', 620, 480],
    ['bar', -1060, 0, 90],
    ['food', 1060, 0, 90],
    ['cake', -300, 520],
    ['gifts', 0, 700],
    ['photoBooth', 1060, 560],
    ['text', 0, 1000],
  ]
  let canvas = emptyCanvas()
  for (const [preset, x, y, rotation = 0] of placed) {
    let item: Item = { ...makeItem(preset, { x, y }, randomUUID(), canvas), rotation }
    if (item.kind === 'shape' && item.type === 'text') item = { ...item, text: 'Entrance', width: 240 }
    canvas = { ...canvas, items: [...canvas.items, item] }
  }
  return canvas
}

/** The server modules, loaded after the condition check so a wrong start gets a plain hint. */
async function loadServerModules() {
  try {
    const [{ writeCanvas }, { listLayouts }, { listVenues }, { createWedding }] = await Promise.all([
      import('../src/server/canvas-write'),
      import('../src/server/repo/layouts'),
      import('../src/server/repo/venues'),
      import('../src/server/repo/weddings'),
    ])
    return { writeCanvas, listLayouts, listVenues, createWedding }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Server Component')) {
      throw new Error('Run the seed with `npm run seed`: it needs tsx --conditions=react-server to load the server modules.')
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
    // The wedding.
    const [existing] = await db
      .select({ id: schema.weddings.id })
      .from(schema.weddings)
      .where(and(eq(schema.weddings.name, DEMO_WEDDING_NAME), isNull(schema.weddings.deletedAt)))
    let weddingId: string
    if (existing) {
      weddingId = existing.id
      console.log(`"${DEMO_WEDDING_NAME}" already exists.`)
    } else {
      const made = await server.createWedding(db, { name: DEMO_WEDDING_NAME, date: '2027-06-19', unit: 'ft' })
      if (made.status !== 'created') throw new Error(`Could not make "${DEMO_WEDDING_NAME}": ${made.status}`)
      weddingId = made.wedding.id
      console.log(`Made "${DEMO_WEDDING_NAME}".`)
    }

    // Its layouts, each written by writeCanvas() in its own transaction.
    const names = new Set((await server.listLayouts(db, weddingId))?.map((l) => l.name) ?? [])
    const addLayout = async (layout: {
      name: string
      canvas: Canvas
      venueTemplateId: string | null
      editedBy: Author
    }) => {
      if (names.has(layout.name)) {
        console.log(`"${layout.name}" already exists.`)
        return
      }
      const result = await db.transaction((tx) =>
        server.writeCanvas(tx, { mode: 'insert', weddingId, layoutId: randomUUID(), kind: 'reception', ...layout }),
      )
      if (result.status !== 'created') {
        const detail = result.status === 'invalid' ? `: ${result.issues.join('; ')}` : ''
        throw new Error(`Could not make "${layout.name}": ${result.status}${detail}`)
      }
      const tables = layout.canvas.items.filter((item) => item.kind === 'table').length
      console.log(tables === 0 ? `Made "${layout.name}".` : `Made "${layout.name}" with ${tables} tables.`)
    }

    await addLayout({ name: BLANK_LAYOUT_NAME, canvas: threeRoundTables(), venueTemplateId: null, editedBy: 'Noa' })
    await addLayout({ name: TOUR_LAYOUT_NAME, canvas: canvasTour(), venueTemplateId: null, editedBy: 'Noa' })

    const beach = (await server.listVenues(db)).find((v) => v.name === BEACH_TEMPLATE_NAME)
    if (beach) {
      await addLayout({ name: BEACH_LAYOUT_NAME, canvas: emptyCanvas(), venueTemplateId: beach.id, editedBy: 'Aiden' })
    } else {
      console.log(`No "${BEACH_TEMPLATE_NAME}" template, so no "${BEACH_LAYOUT_NAME}". Run npm run db:migrate first.`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
