import { describe, expect, it } from 'vitest'
import {
  acceptOverText,
  loadedChangesText,
  restoreReloadedText,
  revisionDetail,
  revisionTitle,
  venueBadge,
  venueConflictText,
  venueDeleteMessage,
  venueItemCount,
  venueReadOnlyText,
  venueUsedBy,
} from './venue-wording'

describe('venue wording', () => {
  it('says how many layouts use a venue', () => {
    expect(venueUsedBy(0)).toBe('Not used yet')
    expect(venueUsedBy(1)).toBe('Used by 1 layout')
    expect(venueUsedBy(3)).toBe('Used by 3 layouts')
    expect(venueItemCount(0)).toBe('Empty')
    expect(venueItemCount(2)).toBe('2 items')
  })

  it('blocks a delete while layouts use the venue', () => {
    const use = { weddingId: 'w', weddingName: 'Noa and Aiden', layoutId: 'l', layoutName: 'Reception' }
    expect(venueDeleteMessage({ kind: 'venue', name: 'Toronto Beach Club', layouts: [use], hiddenLayouts: 0, images: 0, revisions: 1 })).toBe(
      'One layout still uses “Toronto Beach Club”. Pick another venue for it before you delete this one.',
    )
    expect(venueDeleteMessage({ kind: 'venue', name: 'Loft', layouts: [use, use], hiddenLayouts: 0, images: 0, revisions: 1 })).toContain('2 layouts still use')
  })

  it('counts layouts in other weddings without naming them, and they block the delete too', () => {
    const use = { weddingId: 'w', weddingName: 'Noa and Aiden', layoutId: 'l', layoutName: 'Reception' }
    expect(venueDeleteMessage({ kind: 'venue', name: 'Loft', layouts: [], hiddenLayouts: 1, images: 0, revisions: 1 })).toBe(
      '“Loft” is used by 1 layout in weddings you are not part of, so it cannot be deleted for now.',
    )
    expect(venueDeleteMessage({ kind: 'venue', name: 'Loft', layouts: [use], hiddenLayouts: 2, images: 0, revisions: 1 })).toBe(
      'One layout still uses “Loft”. Pick another venue for it before you delete this one. Also used by 2 layouts in weddings you are not part of.',
    )
  })

  it('labels each venue by who it belongs to', () => {
    expect(venueBadge({ access: 'library', ownerName: null }, false)).toBe('Library')
    expect(venueBadge({ access: 'mine', ownerName: 'Noa' }, false)).toBe('Yours')
    expect(venueBadge({ access: 'shared', ownerName: 'Dayna' }, false)).toBe('Shared by Dayna')
    expect(venueBadge({ access: 'unowned', ownerName: null }, true)).toBe('No owner')
    expect(venueBadge({ access: 'unowned', ownerName: null }, false)).toBe('Shared')
  })

  it('words the banner over a venue you cannot change', () => {
    expect(venueReadOnlyText({ access: 'library', ownerName: null })).toBe('This is a library venue. Only the admin can change it.')
    expect(venueReadOnlyText({ access: 'shared', ownerName: 'Dayna' })).toBe('This venue belongs to Dayna. You can view it.')
  })

  it('names what goes with a venue nobody uses', () => {
    expect(venueDeleteMessage({ kind: 'venue', name: 'Loft', layouts: [], hiddenLayouts: 0, images: 1, revisions: 3 })).toBe(
      'This deletes “Loft” with its 3 saved versions and 1 floor plan image. No layout uses it.',
    )
  })

  it('labels revisions', () => {
    expect(revisionTitle({ reason: 'import' })).toBe('Import')
    expect(revisionTitle({ reason: 'save' })).toBe('Save')
    expect(revisionDetail({ fixedItemCount: 14, referenceImageId: 'i' })).toBe('14 items, with the floor plan image')
    expect(revisionDetail({ fixedItemCount: 0, referenceImageId: null })).toBe('No items')
  })

  it('says whose save met an Accept or a restore, telling people apart by account', () => {
    const ME = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a'
    const aiden = { id: '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b', name: 'Aiden' }
    const me = { id: ME, name: 'Noa' }
    expect(loadedChangesText(aiden, ME)).toBe('Loaded Aiden’s changes.')
    expect(loadedChangesText(me, ME)).toBe('Loaded your changes from another tab or device.')
    expect(loadedChangesText(null, ME)).toBe('Loaded the latest version of this venue.')
    expect(acceptOverText(aiden, ME)).toBe('Aiden changed this venue after you opened it. Accept your draft over it?')
    expect(acceptOverText(me, ME)).toBe('You changed this venue in another tab or on another device after you opened it. Accept your draft over it?')
    expect(acceptOverText(null, ME)).toBe('Someone changed this venue after you opened it. Accept your draft over it?')
    expect(restoreReloadedText({ id: null, name: 'Noa' }, ME, true)).toBe('Loaded Noa’s changes. Try Undo import again.')
    expect(restoreReloadedText(null, ME, false)).toBe('Loaded the latest version of this venue. Try Put back again.')
    expect(venueConflictText(aiden, ME)).toBe('Aiden saved this venue after you opened it.')
    expect(venueConflictText(me, ME)).toBe('You saved this venue in another tab or on another device after you opened it.')
    expect(venueConflictText(null, ME)).toBe('This venue was saved somewhere else after you opened it.')
  })
})
