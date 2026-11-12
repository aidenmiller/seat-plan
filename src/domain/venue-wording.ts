/**
 * Plain sentences for the Venues tab and the template editor. Pure.
 */
import type { VenueDeleteSummary, VenueRevision } from '@/shared/api'
import { plural } from './wording'

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

type Who = string | null

/** "Loaded Aiden's changes.", after this tab took a newer save of the venue. */
export function loadedChangesText(who: Who): string {
  return who ? `Loaded ${who}’s changes.` : 'Loaded the latest version of this venue.'
}

/** Shown over an import draft when someone saved the venue after this tab opened it. Accept then goes over their save. */
export function acceptOverText(who: Who): string {
  return `${who ?? 'Someone'} changed this venue after you opened it. Accept your draft over it?`
}

/** After Undo import (or Put back) met someone else's save: their version is loaded, and the person tries again. */
export function restoreReloadedText(who: Who, undoImport: boolean): string {
  return `${loadedChangesText(who)} Try ${undoImport ? 'Undo import' : 'Put back'} again.`
}
