import 'server-only'
import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import { writeCanvas } from '../canvas-write'
import { guests, layoutSeats, layouts, weddings } from '../db/schema'
import { weddingLock, type Db } from '../locks'

/** A seat emptied because its guest was removed. */
export type ClearedSeat = { layoutId: string; layoutName: string; itemLabel: string; guestId: string }

export type RemoveGuestsResult = {
  /** Guests marked deleted by this call. Unknown and already removed ids are skipped. */
  removed: string[]
  /** Seats emptied in live layouts. Deleted layouts are rewritten too, but not listed. */
  clearedSeats: ClearedSeat[]
}

/**
 * Removes guests from a wedding (PLAN change 7 and section 5, "Removing a
 * guest"), all in one transaction:
 *  - takes the wedding lock exclusive, so no save runs halfway through;
 *  - locks the guests and their partners in id order, so two removals never deadlock;
 *  - marks the guests deleted;
 *  - clears the partner link on both sides and turns the couple rule switch
 *    back on for each former partner (PLAN change 8);
 *  - empties their seats in every layout that seats them, deleted layouts
 *    too (so restoring one never brings a seat back), through writeCanvas's
 *    rewrite mode, which keeps each layout's version, so an editor with the
 *    layout open can still save. Only seats in live layouts are reported;
 *    nobody can see a deleted layout, so naming it would only confuse;
 *  - deletes their layout_seats rows.
 * Their group and rule links stay, hidden, so undoing the delete in the
 * database brings those back.
 *
 * Null when the wedding is missing or deleted.
 */
export async function removeGuests(
  db: Db,
  weddingId: string,
  guestIds: readonly string[],
): Promise<RemoveGuestsResult | null> {
  const wanted = [...new Set(guestIds)]
  return db.transaction(async (tx) => {
    await weddingLock(tx, weddingId, 'exclusive')

    const [wedding] = await tx
      .select({ id: weddings.id })
      .from(weddings)
      .where(and(eq(weddings.id, weddingId), isNull(weddings.deletedAt)))
    if (!wedding) return null
    if (wanted.length === 0) return { removed: [], clearedSeats: [] }

    // Who goes, and everyone linked to them as a partner either way.
    const targets = await tx
      .select({ id: guests.id, partnerId: guests.partnerId })
      .from(guests)
      .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, wanted), isNull(guests.deletedAt)))
    const removed = targets.map((t) => t.id).sort()
    if (removed.length === 0) return { removed: [], clearedSeats: [] }
    const removedSet = new Set(removed)
    const linkedBack = await tx
      .select({ id: guests.id })
      .from(guests)
      .where(and(eq(guests.weddingId, weddingId), inArray(guests.partnerId, removed)))
    const partners = new Set<string>()
    for (const t of targets) if (t.partnerId && !removedSet.has(t.partnerId)) partners.add(t.partnerId)
    for (const r of linkedBack) if (!removedSet.has(r.id)) partners.add(r.id)

    await tx
      .select({ id: guests.id })
      .from(guests)
      .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, [...removed, ...partners])))
      .orderBy(asc(guests.id))
      .for('update')

    await tx
      .update(guests)
      .set({ deletedAt: sql`now()`, partnerId: null })
      .where(and(eq(guests.weddingId, weddingId), inArray(guests.id, removed)))
    await tx
      .update(guests)
      .set({ partnerId: null, coupleRuleEnabled: true })
      .where(
        and(eq(guests.weddingId, weddingId), inArray(guests.partnerId, removed), notInArray(guests.id, removed)),
      )

    // Every layout that seats them, deleted layouts too, locked in id order.
    const seated = await tx
      .selectDistinct({ layoutId: layoutSeats.layoutId })
      .from(layoutSeats)
      .where(and(eq(layoutSeats.weddingId, weddingId), inArray(layoutSeats.guestId, removed)))
    const clearedSeats: ClearedSeat[] = []
    if (seated.length > 0) {
      const affected = await tx
        .select({ id: layouts.id, name: layouts.name, canvas: layouts.canvas, deletedAt: layouts.deletedAt })
        .from(layouts)
        .where(
          and(
            eq(layouts.weddingId, weddingId),
            inArray(
              layouts.id,
              seated.map((s) => s.layoutId),
            ),
          ),
        )
        .orderBy(asc(layouts.id))
        .for('update')
      for (const layout of affected) {
        const result = await writeCanvas(tx, { mode: 'rewrite', weddingId, layoutId: layout.id, canvas: layout.canvas })
        if (result.status !== 'rewritten') {
          throw new Error(`Could not clear seats in layout ${layout.id}: ${result.status}`)
        }
        if (layout.deletedAt !== null) continue
        for (const d of result.dropped) {
          if (removedSet.has(d.guestId)) {
            clearedSeats.push({ layoutId: layout.id, layoutName: layout.name, itemLabel: d.itemLabel, guestId: d.guestId })
          }
        }
      }
    }
    await tx
      .delete(layoutSeats)
      .where(and(eq(layoutSeats.weddingId, weddingId), inArray(layoutSeats.guestId, removed)))

    return { removed, clearedSeats }
  })
}
