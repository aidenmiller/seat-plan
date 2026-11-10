/**
 * Restore rewrites a backup under new ids (spec section 11: "restore from that
 * file as a new wedding"). One old-to-new id map, `newId`, is used for every
 * guest, group, rule and layout id, so a guest id is rewritten the same way in
 * seats, partner links, group members and rule guests.
 *
 * Links that point outside the backup are dropped rather than kept: a partner
 * link that does not point both ways, a group member or rule guest whose group,
 * rule or guest is not in the file. A seat keeps its (rewritten) guest id
 * either way; the server's canvas writer empties seats held by guests the new
 * wedding does not have.
 */
import type { Canvas } from '../canvas-schema'
import type { FixedItem } from '../venue-schema'
import type { BackupGroup, BackupGuest, BackupRule, RestoreStart } from './schema'

/** The old-to-new id map. Pure and stable: the same old id always gives the same new one. */
export type NewId = (oldId: string) => string

export type RestoredRows = {
  guests: BackupGuest[]
  groups: BackupGroup[]
  groupMembers: { groupId: string; guestId: string }[]
  rules: BackupRule[]
  ruleGuests: { ruleId: string; guestId: string }[]
}

/** The wedding's rows under new ids, with every link between them rewritten through `newId`. */
export function remapWeddingRows(rows: Omit<RestoreStart, 'format' | 'version' | 'jobId' | 'wedding'>, newId: NewId): RestoredRows {
  const partnerOf = new Map(rows.guests.map((g) => [g.id, g.partnerId]))
  const ruleOn = new Map(rows.guests.map((g) => [g.id, g.coupleRuleEnabled]))
  const guests = rows.guests.map((g): BackupGuest => {
    const partner = g.partnerId
    const mutual = partner !== null && partner !== g.id && partnerOf.get(partner) === g.id
    return {
      ...g,
      id: newId(g.id),
      partnerId: mutual ? newId(partner) : null,
      // The couple rule switch is the same on both partners (PLAN change 8); a guest without a partner keeps the default.
      coupleRuleEnabled: mutual ? g.coupleRuleEnabled && ruleOn.get(partner) !== false : true,
    }
  })

  const guestIds = new Set(rows.guests.map((g) => g.id))
  const groupIds = new Set(rows.groups.map((g) => g.id))
  const ruleIds = new Set(rows.rules.map((r) => r.id))

  return {
    guests,
    groups: rows.groups.map((g) => ({ ...g, id: newId(g.id) })),
    groupMembers: uniquePairs(
      rows.groupMembers.filter((m) => groupIds.has(m.groupId) && guestIds.has(m.guestId)),
      (m) => `${m.groupId}|${m.guestId}`,
    ).map((m) => ({ groupId: newId(m.groupId), guestId: newId(m.guestId) })),
    rules: rows.rules.map((r) => ({ ...r, id: newId(r.id) })),
    ruleGuests: uniquePairs(
      rows.ruleGuests.filter((r) => ruleIds.has(r.ruleId) && guestIds.has(r.guestId)),
      (r) => `${r.ruleId}|${r.guestId}`,
    ).map((r) => ({ ruleId: newId(r.ruleId), guestId: newId(r.guestId) })),
  }
}

function uniquePairs<T>(list: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return list.filter((item) => {
    const k = key(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Pairs of guests linked as partners both ways, each pair once, as [first, second] in list order. */
export function partnerPairs(guests: readonly { id: string; partnerId: string | null }[]): [string, string][] {
  const order = new Map(guests.map((g, i) => [g.id, i]))
  const pairs: [string, string][] = []
  for (const g of guests) {
    if (g.partnerId === null) continue
    const other = order.get(g.partnerId)
    if (other !== undefined && other > order.get(g.id)!) pairs.push([g.id, g.partnerId])
  }
  return pairs
}

/** The canvas with every seated guest id rewritten. Nothing else changes: item ids live inside the layout. */
export function remapCanvas(canvas: Canvas, newId: NewId): Canvas {
  return {
    ...canvas,
    items: canvas.items.map((item) =>
      item.kind === 'table' || item.kind === 'chairRow'
        ? { ...item, seats: item.seats.map((seat) => (seat.guestId === null ? seat : { ...seat, guestId: newId(seat.guestId) })) }
        : item,
    ),
  }
}

/** A wall's geometry as text, rounded to 0.001 cm, without its id or name. */
function wallKey(item: Extract<FixedItem, { type: 'wall' }>): string {
  const r = (n: number) => Math.round(n * 1000) / 1000
  return JSON.stringify([r(item.thickness), item.points.map((p) => [r(p.x), r(p.y)])])
}

/**
 * True when two templates have the same walls (PLAN change 5: a restore reuses
 * a template that still exists with the walls the backup holds). Compares wall
 * geometry only, in any order; ids, names and other items do not count.
 */
export function sameWalls(a: readonly FixedItem[], b: readonly FixedItem[]): boolean {
  const keys = (items: readonly FixedItem[]) =>
    items
      .filter((i): i is Extract<FixedItem, { type: 'wall' }> => i.type === 'wall')
      .map(wallKey)
      .sort()
  const ka = keys(a)
  const kb = keys(b)
  return ka.length === kb.length && ka.every((k, i) => k === kb[i])
}

const RESTORED = ' (restored)'

/** "Name (restored)", kept within `max` characters. */
export function restoredName(name: string, max = 200): string {
  return `${name.slice(0, max - RESTORED.length).trimEnd()}${RESTORED}`
}
