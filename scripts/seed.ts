/**
 * Demo data so every feature can be tried without real guests (spec section 12).
 * Made-up names only, and the same content on every run. Safe to run twice:
 * it skips anything that already exists, matching by name.
 *
 * It makes the demo wedding with three reception layouts: "Reception plan A"
 * on a blank canvas with five round tables, "Canvas tour" on a blank canvas
 * with one of every table preset and fixture from the shape panel (milestone
 * 3), and "Beach Club reception" on the Toronto Beach Club template (empty
 * until the floor plan import fills the template). Milestone 4 adds the guest
 * list from scripts/demo-guests.ts: about 120 guests, 8 groups with their
 * members, 20 couples linked as partners and 5 rules, and seats about 80 of
 * them at the tables of "Reception plan A" and "Canvas tour" (the sweetheart
 * table stays free for Noa and Aiden). Milestone 9 adds a few notes to
 * "Canvas tour" (scripts/demo-notes.ts), among them an arrow attached to the
 * bar and table 3. Ceremony rows come with milestone 8. The Toronto Beach Club
 * template itself comes from a migration, so production has it too.
 *
 * On a second run: guests are matched by name (ignoring case and accents)
 * and only missing ones are added; a group that exists keeps its members; a
 * couple is linked only while neither has a partner; a rule is added only
 * when no rule has its note; a layout that already seats anyone is left as
 * it is, and so is one that already holds notes.
 *
 * Run it with `npm run seed`, which starts tsx with the react-server
 * condition. That is how a server build resolves `import 'server-only'` (to
 * the package's empty file), so the seed writes guests and layouts through
 * the app's own server code and writeCanvas(), like every other write (PLAN
 * section 5). Plain `tsx scripts/seed.ts` stops at the first server module;
 * main() says how to run it instead.
 */
import { randomUUID } from 'node:crypto'
import { loadEnvConfig } from '@next/env'
import { and, eq, isNull } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { emptyCanvas, type Author, type Canvas, type Item } from '../src/domain/canvas-schema'
import { nameKey } from '../src/domain/names'
import { createPool, requireDatabaseUrl } from '../src/server/db/connection'
import * as schema from '../src/server/db/schema'
import { demoPlan, type DemoPlan } from './demo-guests'
import { canvasTour, receptionPlanA } from './demo-layouts'
import { addDemoNotes } from './demo-notes'

export const DEMO_WEDDING_NAME = 'Demo wedding'
export const BLANK_LAYOUT_NAME = 'Reception plan A'
export const TOUR_LAYOUT_NAME = 'Canvas tour'
export const BEACH_LAYOUT_NAME = 'Beach Club reception'
export const BEACH_TEMPLATE_NAME = 'Toronto Beach Club'

/** The server modules, loaded after the condition check so a wrong start gets a plain hint. */
async function loadServerModules() {
  try {
    const [{ writeCanvas }, { getLayoutDetail, listLayouts }, { listVenues }, { createWedding }, { addGuestsBulk, updateGuest }, { createGroup, listGroups }] =
      await Promise.all([
        import('../src/server/canvas-write'),
        import('../src/server/repo/layouts'),
        import('../src/server/repo/venues'),
        import('../src/server/repo/weddings'),
        import('../src/server/repo/guests'),
        import('../src/server/repo/groups'),
      ])
    return { writeCanvas, getLayoutDetail, listLayouts, listVenues, createWedding, addGuestsBulk, updateGuest, createGroup, listGroups }
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

    await addLayout({ name: BLANK_LAYOUT_NAME, canvas: receptionPlanA(), venueTemplateId: null, editedBy: 'Noa' })
    await addLayout({ name: TOUR_LAYOUT_NAME, canvas: canvasTour(), venueTemplateId: null, editedBy: 'Noa' })

    const beach = (await server.listVenues(db)).find((v) => v.name === BEACH_TEMPLATE_NAME)
    if (beach) {
      await addLayout({ name: BEACH_LAYOUT_NAME, canvas: emptyCanvas(), venueTemplateId: beach.id, editedBy: 'Aiden' })
    } else {
      console.log(`No "${BEACH_TEMPLATE_NAME}" template, so no "${BEACH_LAYOUT_NAME}". Run npm run db:migrate first.`)
    }

    // The guest list (milestone 4).
    await seedGuestList(db, server, weddingId, demoPlan({ tour: TOUR_LAYOUT_NAME, planA: BLANK_LAYOUT_NAME }))

    // Notes (milestone 9).
    await seedNotes(db, server, weddingId, TOUR_LAYOUT_NAME)
  } finally {
    await pool.end()
  }
}

type Db = NodePgDatabase<typeof schema>
type Server = Awaited<ReturnType<typeof loadServerModules>>

/** Guests, groups, couples, rules and seats, each step skipping what is already there. */
async function seedGuestList(db: Db, server: Server, weddingId: string, plan: DemoPlan) {
  // Guests, matched by name; the missing ones are added in one transaction.
  const live = async () =>
    db
      .select({ id: schema.guests.id, nameKey: schema.guests.nameKey, partnerId: schema.guests.partnerId })
      .from(schema.guests)
      .where(and(eq(schema.guests.weddingId, weddingId), isNull(schema.guests.deletedAt)))
  const byKey = new Map((await live()).map((g) => [g.nameKey, g.id]))
  const missing = plan.guests.filter((g) => !byKey.has(nameKey(g.firstName, g.lastName)))
  if (missing.length > 0) {
    const made = await server.addGuestsBulk(
      db,
      weddingId,
      missing.map((g) => ({
        id: randomUUID(),
        firstName: g.firstName,
        lastName: g.lastName,
        nickname: g.nickname,
        household: g.household,
        side: g.side,
        rsvp: g.rsvp,
        meal: g.meal,
        isChild: g.isChild,
        notes: g.notes,
      })),
    )
    if (made.status !== 'created') throw new Error(`Could not add the demo guests: ${made.status}`)
    for (const g of made.guests) byKey.set(nameKey(g.firstName, g.lastName), g.id)
  }
  console.log(missing.length === 0 ? `All ${plan.guests.length} demo guests are there already.` : `Added ${missing.length} guests.`)
  const ids = plan.guests.map((g) => byKey.get(nameKey(g.firstName, g.lastName))!)

  // Groups, with their members when first made.
  const existingGroups = new Set(((await server.listGroups(db, weddingId)) ?? []).map((g) => g.name.toLowerCase()))
  let groupsMade = 0
  for (const name of plan.groups) {
    if (existingGroups.has(name.toLowerCase())) continue
    const guestIds = plan.guests.flatMap((g, i) => (g.groups.includes(name) ? [ids[i]!] : []))
    const made = await server.createGroup(db, weddingId, { id: randomUUID(), name, guestIds })
    if (made.status !== 'created') throw new Error(`Could not make the group "${name}": ${made.status}`)
    groupsMade++
  }
  console.log(groupsMade === 0 ? 'The demo groups are there already.' : `Made ${groupsMade} groups.`)

  // Couples, linked while neither has a partner.
  const partnerOf = new Map((await live()).map((g) => [g.id, g.partnerId]))
  let linked = 0
  for (const [a, b] of plan.couples) {
    const [idA, idB] = [ids[a]!, ids[b]!]
    if (partnerOf.get(idA) !== null || partnerOf.get(idB) !== null) continue
    const result = await server.updateGuest(db, idA, { partnerId: idB })
    if (result.status !== 'updated') throw new Error(`Could not link a demo couple: ${result.status}`)
    partnerOf.set(idA, idB)
    partnerOf.set(idB, idA)
    linked++
  }
  console.log(linked === 0 ? 'The demo couples are linked already.' : `Linked ${linked} couples.`)

  // Rules, written straight to their tables (the rules routes come with milestone 6).
  const notes = new Set(
    (await db.select({ note: schema.rules.note }).from(schema.rules).where(eq(schema.rules.weddingId, weddingId))).map((r) => r.note),
  )
  const newRules = plan.rules.filter((r) => !notes.has(r.note))
  if (newRules.length > 0) {
    await db.transaction(async (tx) => {
      for (const rule of newRules) {
        const ruleId = randomUUID()
        await tx.insert(schema.rules).values({
          id: ruleId,
          weddingId,
          kind: rule.kind,
          nextToEachOther: rule.nextToEachOther,
          appliesTo: rule.appliesTo,
          note: rule.note,
        })
        await tx.insert(schema.ruleGuests).values(rule.guests.map((i) => ({ weddingId, ruleId, guestId: ids[i]! })))
      }
    })
  }
  console.log(newRules.length === 0 ? 'The demo rules are there already.' : `Added ${newRules.length} rules.`)

  // Seats, through writeCanvas(), in layouts nobody is seated in yet.
  const layouts = (await server.listLayouts(db, weddingId)) ?? []
  for (const [layoutName, tables] of Object.entries(plan.seating)) {
    const summary = layouts.find((l) => l.name === layoutName)
    const layout = summary ? await server.getLayoutDetail(db, summary.id) : null
    if (!layout) {
      console.log(`No "${layoutName}", so no seats there.`)
      continue
    }
    const seated = (item: Item) => (item.kind === 'table' || item.kind === 'chairRow') && item.seats.some((seat) => seat.guestId)
    if (layout.canvas.items.some(seated)) {
      console.log(`"${layoutName}" already seats guests.`)
      continue
    }
    let count = 0
    const canvas: Canvas = {
      ...layout.canvas,
      items: layout.canvas.items.map((item) => {
        if (item.kind !== 'table') return item
        const wanted = tables.find((t) => t.number === item.number)?.guests ?? []
        return {
          ...item,
          seats: item.seats.map((seat, i) => {
            const guestId = wanted[i] === undefined ? undefined : ids[wanted[i]]
            if (!guestId) return seat
            count++
            return { ...seat, guestId }
          }),
        }
      }),
    }
    const result = await db.transaction((tx) =>
      server.writeCanvas(tx, {
        mode: 'save',
        weddingId,
        layoutId: layout.id,
        canvas,
        baseVersion: layout.version,
        saveId: randomUUID(),
        editedBy: 'Noa',
      }),
    )
    if (result.status !== 'saved') {
      const detail = result.status === 'invalid' ? `: ${result.issues.join('; ')}` : ''
      throw new Error(`Could not seat guests in "${layoutName}": ${result.status}${detail}`)
    }
    console.log(`Seated ${count - result.dropped.length} guests in "${layoutName}".`)
  }
}

/** The demo notes, through writeCanvas(), in a layout that has no notes yet. */
async function seedNotes(db: Db, server: Server, weddingId: string, layoutName: string) {
  const summary = ((await server.listLayouts(db, weddingId)) ?? []).find((l) => l.name === layoutName)
  const layout = summary ? await server.getLayoutDetail(db, summary.id) : null
  if (!layout) {
    console.log(`No "${layoutName}", so no notes.`)
    return
  }
  if (layout.canvas.items.some((item) => item.kind === 'note')) {
    console.log(`"${layoutName}" already has notes.`)
    return
  }
  const canvas = addDemoNotes(layout.canvas, randomUUID, Date.now())
  const added = canvas.items.length - layout.canvas.items.length
  const result = await db.transaction((tx) =>
    server.writeCanvas(tx, {
      mode: 'save',
      weddingId,
      layoutId: layout.id,
      canvas,
      baseVersion: layout.version,
      saveId: randomUUID(),
      editedBy: 'Aiden',
    }),
  )
  if (result.status !== 'saved') {
    const detail = result.status === 'invalid' ? `: ${result.issues.join('; ')}` : ''
    throw new Error(`Could not add notes to "${layoutName}": ${result.status}${detail}`)
  }
  console.log(`Added ${added} notes to "${layoutName}".`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
