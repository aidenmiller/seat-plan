/**
 * What a venue share link shows (spec section 2, PLAN change 24). The server
 * builds this from the layout and the link's switches, so nothing hidden ever
 * reaches the viewer's browser:
 *
 *  - tables, fixtures, chair rows and plain shapes (shapes lose their text, and
 *    text shapes are left out, since either may hold a private comment);
 *  - the venue layer (the template's fixed items, without the import's notes);
 *  - notes only when the link shows notes;
 *  - for each seated guest only their meal and child flag, plus their name
 *    when the link shows names. Seats point at short keys ("g1"), not guest ids.
 *
 * Never sent: guest notes, nicknames, sides, RSVPs, groups, rules, other
 * layouts and the original floor plan image.
 */
import type { Canvas, Item } from './canvas-schema'
import type { FixedItem } from './venue-schema'

export type ShareGuest = {
  /** The key seats use for this guest in this reply. */
  key: string
  /** Only when the link shows names. */
  name?: string
  meal: string | null
  isChild: boolean
}

export type ShareView = {
  layoutName: string
  kind: 'reception' | 'ceremony'
  unit: 'ft' | 'm'
  /** When the layout was last saved (the link shows the latest save, DECISIONS 26). */
  updatedAt: string
  showNames: boolean
  showNotes: boolean
  venue: FixedItem[]
  items: Item[]
  guests: ShareGuest[]
}

export type ShareViewInput = {
  layoutName: string
  kind: 'reception' | 'ceremony'
  unit: 'ft' | 'm'
  updatedAt: string
  canvas: Canvas
  /** The live template's fixed items, or none. */
  venue: readonly FixedItem[]
  /** At least the guests seated in this layout. */
  guests: readonly { id: string; firstName: string; lastName: string; meal: string | null; isChild: boolean }[]
  showNames: boolean
  showNotes: boolean
}

export function buildShareView(input: ShareViewInput): ShareView {
  const byId = new Map(input.guests.map((g) => [g.id, g]))
  const keys = new Map<string, string>()
  const shared: ShareGuest[] = []

  function keyFor(guestId: string | null): string | null {
    if (guestId === null) return null
    const known = keys.get(guestId)
    if (known) return known
    const guest = byId.get(guestId)
    if (!guest) return null
    const key = `g${keys.size + 1}`
    keys.set(guestId, key)
    shared.push({
      key,
      ...(input.showNames ? { name: `${guest.firstName} ${guest.lastName}` } : {}),
      meal: guest.meal,
      isChild: guest.isChild,
    })
    return key
  }

  const items: Item[] = []
  for (const item of input.canvas.items) {
    switch (item.kind) {
      case 'table':
      case 'chairRow':
        items.push({ ...item, seats: item.seats.map((seat) => ({ index: seat.index, guestId: keyFor(seat.guestId) })) })
        break
      case 'fixture':
        items.push(item)
        break
      case 'shape':
        if (item.type !== 'text') {
          const copy = { ...item }
          delete copy.text
          items.push(copy)
        }
        break
      case 'note':
        if (input.showNotes) items.push(item)
        break
    }
  }

  return {
    layoutName: input.layoutName,
    kind: input.kind,
    unit: input.unit,
    updatedAt: input.updatedAt,
    showNames: input.showNames,
    showNotes: input.showNotes,
    venue: input.venue.map((v) => ({ ...v, unsure: false, unsureNote: '' })),
    items,
    guests: shared,
  }
}
