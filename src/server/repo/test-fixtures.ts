/**
 * Test-only builders for the integration tests (*.int.test.ts). Nothing in
 * the app imports this file.
 *
 * Each test makes its own weddings, so the tests never depend on what other
 * rows sit in the test database.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Canvas, ChairRow, Item, Table } from '@/domain/canvas-schema'
import { writeCanvas } from '../canvas-write'
import { guests, layoutSeats, layouts, venueTemplates, weddings } from '../db/schema'
import type { Db } from '../locks'

export async function makeWedding(db: Db, name = 'Noa & Aiden'): Promise<string> {
  const [row] = await db.insert(weddings).values({ name }).returning({ id: weddings.id })
  return row!.id
}

export async function makeGuest(db: Db, weddingId: string, first = 'Ann', last = 'Lee'): Promise<string> {
  const [row] = await db
    .insert(guests)
    .values({ weddingId, firstName: first, lastName: last, nameKey: `${first}|${last}`.toLowerCase() })
    .returning({ id: guests.id })
  return row!.id
}

export async function makeTemplate(db: Db, name = 'Hall'): Promise<string> {
  const [row] = await db
    .insert(venueTemplates)
    .values({
      name,
      fixedItems: [
        {
          id: 'w1',
          type: 'wall',
          unsure: false,
          unsureNote: '',
          thickness: 20,
          points: [
            { x: -1000, y: -600 },
            { x: 1000, y: -600 },
          ],
        },
      ],
    })
    .returning({ id: venueTemplates.id })
  return row!.id
}

export function roundTable(id: string, number: number, seated: (string | null)[], name = `Table ${number}`): Table {
  return {
    id,
    kind: 'table',
    x: number * 300,
    y: 0,
    rotation: 0,
    locked: false,
    shape: 'round',
    width: 152.4,
    height: 152.4,
    number,
    name,
    seatCount: seated.length,
    seatSides: 'all',
    seats: seated.map((guestId, index) => ({ index, guestId })),
  }
}

export function chairRow(id: string, rowNumber: number, seated: (string | null)[], blockLabel: string | null = null): ChairRow {
  return {
    id,
    kind: 'chairRow',
    x: 0,
    y: rowNumber * 100,
    rotation: 0,
    locked: false,
    chairCount: seated.length,
    spacing: 50.8,
    blockId: blockLabel ? 'block-1' : null,
    blockLabel,
    rowNumber,
    rowLabel: `Row ${rowNumber}`,
    reservedFor: null,
    seats: seated.map((guestId, index) => ({ index, guestId })),
  }
}

export function canvasOf(...items: Item[]): Canvas {
  return { schemaVersion: 1, items }
}

/** A layout holding this canvas, written through writeCanvas like any other. Version 1. */
export async function makeLayout(
  db: Db,
  weddingId: string,
  canvas: Canvas = canvasOf(),
  opts: { name?: string; venueTemplateId?: string | null; kind?: 'reception' | 'ceremony' } = {},
): Promise<string> {
  const layoutId = randomUUID()
  const result = await db.transaction((tx) =>
    writeCanvas(tx, {
      mode: 'insert',
      weddingId,
      layoutId,
      canvas,
      name: opts.name ?? 'Reception',
      kind: opts.kind ?? 'reception',
      venueTemplateId: opts.venueTemplateId ?? null,
      editor: { userId: null, name: 'Noa' },
    }),
  )
  if (result.status !== 'created') throw new Error(`makeLayout: ${result.status}`)
  return layoutId
}

export async function layoutRow(db: Db, layoutId: string) {
  const [row] = await db.select().from(layouts).where(eq(layouts.id, layoutId))
  return row!
}

/** layout_seats for one layout, sorted, without the wedding id. */
export async function seatRows(db: Db, layoutId: string) {
  const rows = await db
    .select({ guestId: layoutSeats.guestId, itemId: layoutSeats.itemId, itemLabel: layoutSeats.itemLabel, seatIndex: layoutSeats.seatIndex })
    .from(layoutSeats)
    .where(eq(layoutSeats.layoutId, layoutId))
  return rows.sort((a, b) => a.itemId.localeCompare(b.itemId) || a.seatIndex - b.seatIndex)
}

/** The seats a canvas holds, in the same shape as seatRows (labels left out). */
export function canvasSeats(canvas: Canvas) {
  const out: { guestId: string; itemId: string; seatIndex: number }[] = []
  for (const item of canvas.items) {
    if (item.kind !== 'table' && item.kind !== 'chairRow') continue
    for (const seat of item.seats) if (seat.guestId) out.push({ guestId: seat.guestId, itemId: item.id, seatIndex: seat.index })
  }
  return out.sort((a, b) => a.itemId.localeCompare(b.itemId) || a.seatIndex - b.seatIndex)
}
