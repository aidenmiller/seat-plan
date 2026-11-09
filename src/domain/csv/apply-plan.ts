/**
 * What a wedding's guest list looks like after an import plan is applied, in
 * memory. The server applies the same plan to the database in one
 * transaction; this is the reference for what that must produce, and the
 * tests use it to check that importing twice changes nothing.
 */
import type { ExistingGuest, ImportPlan } from './import-diff'
import type { PartnerRef } from './partner-match'

export type ApplyPlanOptions = {
  /** The id a new row's guest gets. */
  newId: (rowNumber: number) => string
  /** Remove the guests missing from the file (a separate choice in the summary). */
  removeMissing?: boolean
  /** Group names that exist before the import. */
  existingGroupNames?: readonly string[]
}

export type AppliedImport = { guests: ExistingGuest[]; groupNames: string[] }

export function applyPlan(
  plan: ImportPlan,
  guests: readonly ExistingGuest[],
  options: ApplyPlanOptions,
): AppliedImport {
  const byId = new Map(guests.map((g) => [g.id, { ...g, groups: [...g.groups] }]))
  const rowIds = new Map<number, string>()

  for (const c of plan.changed) {
    const g = byId.get(c.guestId)
    if (!g) throw new Error(`Changed guest ${c.guestId} is missing`)
    Object.assign(g, c.patch)
    for (const name of c.addGroups) if (!g.groups.some((x) => x.toLowerCase() === name.toLowerCase())) g.groups.push(name)
    rowIds.set(c.rowNumber, c.guestId)
  }
  for (const u of plan.unchanged) rowIds.set(u.rowNumber, u.guestId)
  for (const n of plan.newGuests) {
    const id = options.newId(n.rowNumber)
    byId.set(id, { id, partnerId: null, ...n.guest, groups: [...n.groups] })
    rowIds.set(n.rowNumber, id)
  }

  const idOf = (ref: PartnerRef): string => {
    const id = ref.guestId ?? (ref.rowNumber !== null ? rowIds.get(ref.rowNumber) : undefined)
    if (!id || !byId.has(id)) throw new Error(`Partner link names an unknown person: ${JSON.stringify(ref)}`)
    return id
  }
  const unlink = (id: string) => {
    const g = byId.get(id)!
    if (g.partnerId && byId.has(g.partnerId)) byId.get(g.partnerId)!.partnerId = null
    g.partnerId = null
  }
  // PLAN change 8: linking A to B clears any earlier partner of either.
  for (const link of plan.partnerLinks) {
    const a = idOf(link.a)
    const b = idOf(link.b)
    unlink(a)
    unlink(b)
    byId.get(a)!.partnerId = b
    byId.get(b)!.partnerId = a
  }

  if (options.removeMissing) {
    for (const m of plan.missing) {
      if (!byId.has(m.guestId)) continue
      unlink(m.guestId)
      byId.delete(m.guestId)
    }
  }

  const groupNames = [...(options.existingGroupNames ?? guests.flatMap((g) => g.groups))]
  for (const name of plan.groupsToCreate) {
    if (!groupNames.some((x) => x.toLowerCase() === name.toLowerCase())) groupNames.push(name)
  }
  return { guests: [...byId.values()], groupNames: [...new Set(groupNames)] }
}
