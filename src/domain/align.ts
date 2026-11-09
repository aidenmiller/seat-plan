/**
 * Align and distribute for a multi-selection (spec section 4). Items line up
 * by their axis-aligned footprint boxes, the same boxes the guides use, so a
 * table's chairs count. Locked items never move, but they still count when
 * working out where the others go.
 */
import type { Item } from './canvas-schema'
import { boxCenter, footprintBox, unionBoxes, type Box } from './geometry'

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export type DistributeAxis = 'horizontal' | 'vertical'
export type Delta = { dx: number; dy: number }
export type Entry = { box: Box; locked: boolean }

/** How far each entry moves to line up. Fewer than two entries move nothing. */
export function alignDeltas(entries: readonly Entry[], mode: AlignMode): Delta[] {
  const none = entries.map(() => ({ dx: 0, dy: 0 }))
  if (entries.length < 2) return none
  const all = unionBoxes(entries.map((e) => e.box)) as Box
  const mid = boxCenter(all)
  return entries.map(({ box, locked }) => {
    if (locked) return { dx: 0, dy: 0 }
    const c = boxCenter(box)
    switch (mode) {
      case 'left':
        return { dx: all.minX - box.minX, dy: 0 }
      case 'center':
        return { dx: mid.x - c.x, dy: 0 }
      case 'right':
        return { dx: all.maxX - box.maxX, dy: 0 }
      case 'top':
        return { dx: 0, dy: all.minY - box.minY }
      case 'middle':
        return { dx: 0, dy: mid.y - c.y }
      case 'bottom':
        return { dx: 0, dy: all.maxY - box.maxY }
    }
  })
}

/**
 * How far each entry moves to leave equal gaps between neighbors along the
 * axis, in order of their centers. The first and last stay put. Fewer than
 * three entries move nothing.
 */
export function distributeDeltas(entries: readonly Entry[], axis: DistributeAxis): Delta[] {
  const deltas = entries.map(() => ({ dx: 0, dy: 0 }))
  if (entries.length < 3) return deltas
  const h = axis === 'horizontal'
  const lo = (b: Box) => (h ? b.minX : b.minY)
  const hi = (b: Box) => (h ? b.maxX : b.maxY)
  const order = entries
    .map((e, i) => ({ i, e, c: (lo(e.box) + hi(e.box)) / 2 }))
    .sort((a, b) => a.c - b.c || a.i - b.i)
  const first = order[0].e.box
  const last = order[order.length - 1].e.box
  const sizes = order.reduce((sum, o) => sum + (hi(o.e.box) - lo(o.e.box)), 0)
  const gap = (hi(last) - lo(first) - sizes) / (order.length - 1)
  let at = lo(first)
  for (const o of order) {
    const size = hi(o.e.box) - lo(o.e.box)
    const move = at - lo(o.e.box)
    if (!o.e.locked && o !== order[0] && o !== order[order.length - 1]) deltas[o.i] = h ? { dx: move, dy: 0 } : { dx: 0, dy: move }
    at += size + gap
  }
  return deltas
}

function moveBy<T extends Item>(items: readonly T[], deltas: readonly Delta[]): T[] {
  return items.map((item, i) => {
    const { dx, dy } = deltas[i]
    return dx === 0 && dy === 0 ? item : { ...item, x: item.x + dx, y: item.y + dy }
  })
}

function entriesOf(items: readonly Item[], boxOf: (item: Item) => Box): Entry[] {
  return items.map((item) => ({ box: boxOf(item), locked: item.locked }))
}

/** The selection lined up. Items that do not move come back as the same objects. */
export function alignItems<T extends Item>(items: readonly T[], mode: AlignMode, boxOf: (item: Item) => Box = footprintBox): T[] {
  return moveBy(items, alignDeltas(entriesOf(items, boxOf), mode))
}

/** The selection spread out with equal gaps. Items that do not move come back as the same objects. */
export function distributeItems<T extends Item>(items: readonly T[], axis: DistributeAxis, boxOf: (item: Item) => Box = footprintBox): T[] {
  return moveBy(items, distributeDeltas(entriesOf(items, boxOf), axis))
}
