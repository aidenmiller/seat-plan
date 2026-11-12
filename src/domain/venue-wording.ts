/**
 * Plain sentences for the Venues tab and the template editor. Pure.
 */
import type { VenueDeleteSummary, VenueRevision } from '@/shared/api'
import { isOwnEdit, plural, type EditorRef } from './wording'

/** "Used by 3 layouts" or "Not used yet". */
export function venueUsedBy(count: number): string {
  return count === 0 ? 'Not used yet' : `Used by ${plural(count, 'layout')}`
}

/** "12 items" on the plan, or "Empty". */
export function venueItemCount(count: number): string {
  return count === 0 ? 'Empty' : plural(count, 'item')
}

/**
 * What the delete dialog says. Layouts that still use the venue block the
 * delete (spec section 5), those in weddings you are not part of too: those
 * are only counted, never named.
 */
export function venueDeleteMessage(s: VenueDeleteSummary): string {
  const others =
    s.hiddenLayouts > 0
      ? `${s.hiddenLayouts === 1 ? 'One layout' : `${s.hiddenLayouts} layouts`} in weddings you are not part of ${s.hiddenLayouts === 1 ? 'uses' : 'use'} it too, so it cannot be deleted for now.`
      : ''
  if (s.layouts.length > 0) {
    const n = s.layouts.length
    const mine = `${n === 1 ? 'One layout still uses' : `${n} layouts still use`} “${s.name}”. Pick another venue for ${n === 1 ? 'it' : 'them'} before you delete this one.`
    return others ? `${mine} ${others}` : mine
  }
  if (s.hiddenLayouts > 0) {
    return `${s.hiddenLayouts === 1 ? 'One layout' : `${s.hiddenLayouts} layouts`} in weddings you are not part of ${s.hiddenLayouts === 1 ? 'uses' : 'use'} “${s.name}”, so it cannot be deleted for now.`
  }
  const parts = [plural(s.revisions, 'saved version'), plural(s.images, 'floor plan image')]
  return `This deletes “${s.name}” with its ${parts.join(' and ')}. No layout uses it.`
}

/** "Import" or "Save", for the Revisions list. */
export function revisionTitle(r: Pick<VenueRevision, 'reason'>): string {
  return r.reason === 'import' ? 'Import' : 'Save'
}

/** "14 items, with the floor plan image". */
export function revisionDetail(r: Pick<VenueRevision, 'fixedItemCount' | 'referenceImageId'>): string {
  const items = r.fixedItemCount === 0 ? 'No items' : plural(r.fixedItemCount, 'item')
  return r.referenceImageId ? `${items}, with the floor plan image` : items
}

/** Who saved the venue (account id and name), or null when nobody is named. */
type Who = EditorRef | null

/** "Loaded Dayna’s changes.", after this tab took a newer save of the venue; your own from another tab say so. */
export function loadedChangesText(who: Who, meId: string | null): string {
  if (!who) return 'Loaded the latest version of this venue.'
  return isOwnEdit(who, meId) ? 'Loaded your changes from another tab or device.' : `Loaded ${who.name}’s changes.`
}

/** Shown over an import draft when someone saved the venue after this tab opened it. Accept then goes over their save. */
export function acceptOverText(who: Who, meId: string | null): string {
  if (isOwnEdit(who, meId)) return 'You changed this venue in another tab or on another device after you opened it. Accept your draft over it?'
  return `${who?.name ?? 'Someone'} changed this venue after you opened it. Accept your draft over it?`
}

/** The template conflict banner's first sentence: who saved the venue after this tab opened it. */
export function venueConflictText(who: Who, meId: string | null): string {
  if (!who) return 'This venue was saved somewhere else after you opened it.'
  if (isOwnEdit(who, meId)) return 'You saved this venue in another tab or on another device after you opened it.'
  return `${who.name} saved this venue after you opened it.`
}

/** After Undo import (or Put back) met someone else's save: their version is loaded, and the person tries again. */
export function restoreReloadedText(who: Who, meId: string | null, undoImport: boolean): string {
  return `${loadedChangesText(who, meId)} Try ${undoImport ? 'Undo import' : 'Put back'} again.`
}
