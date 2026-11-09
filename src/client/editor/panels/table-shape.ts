/**
 * The Properties panel's Shape choice for a table: round, square or
 * rectangle. Pure: a Canvas -> Canvas recipe for actions.run().
 *
 *  - Round tables stay round, so a table turned round takes one size: the
 *    mean of its two sides.
 *  - A round table turned square keeps its width; turned into a rectangle
 *    it keeps its length and halves its depth.
 *  - The seat count stays; guests move to the nearest new seat
 *    (remapSeats), so nobody is unseated.
 *  - A table turned round is seated all the way round (seatSides 'all'):
 *    a head table's one side would otherwise put every seat on the back arc.
 *    A 2-seat round table still seats side by side on the back arc, by the
 *    rule for 2 seats (isBackArc; DECISIONS 6). Square and rectangle tables
 *    keep their sides.
 *  - Sizes never go under the 24 in minimum. Locked tables do not change,
 *    nor does a table with more seats than the new shape holds (30 on round
 *    and square tables).
 */
import { MIN_TABLE_CM, type Canvas, type Table } from '@/domain/canvas-schema'
import { maxSeats, remapSeats } from '@/domain/seats'

function clean(v: number): number {
  return Math.round(Math.max(MIN_TABLE_CM, v) * 1e6) / 1e6
}

/** False when the table is locked, already that shape, or has more seats than that shape holds. */
export function canTakeShape(table: Pick<Table, 'locked' | 'shape' | 'seatCount'>, shape: Table['shape']): boolean {
  return !table.locked && table.shape !== shape && table.seatCount <= maxSeats(shape)
}

/** The table as `shape`, or the same table when nothing changes. */
export function withTableShape(table: Table, shape: Table['shape']): Table {
  if (!canTakeShape(table, shape)) return table
  let width = table.width
  let height = table.height
  if (shape === 'round') {
    width = height = (table.width + table.height) / 2
  } else if (table.shape === 'round') {
    height = shape === 'rect' ? table.width / 2 : table.width
  } else if (shape === 'square') {
    width = height = (table.width + table.height) / 2
  } else if (Math.abs(width - height) < 0.01) {
    // A square turned into a rectangle: twice as long as it is deep.
    width = table.width * 1.5
    height = table.width * 0.75
  }
  const seatSides: Table['seatSides'] = shape === 'round' ? 'all' : table.seatSides
  const next: Table = { ...table, shape, width: clean(width), height: clean(height), seatSides }
  return { ...next, seats: remapSeats(table, next).canvasSeats }
}

export function changeTableShape(canvas: Canvas, id: string, shape: Table['shape']): Canvas {
  let changed = false
  const items = canvas.items.map((item) => {
    if (item.id !== id || item.kind !== 'table') return item
    const next = withTableShape(item, shape)
    if (next !== item) changed = true
    return next
  })
  return changed ? { ...canvas, items } : canvas
}
