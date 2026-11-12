import { describe, expect, it } from 'vitest'
import { acceptOverText, loadedChangesText, restoreReloadedText, revisionDetail, revisionTitle, venueDeleteMessage, venueItemCount, venueUsedBy } from './venue-wording'

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
      'One layout in weddings you are not part of uses “Loft”, so it cannot be deleted for now.',
    )
    expect(venueDeleteMessage({ kind: 'venue', name: 'Loft', layouts: [use], hiddenLayouts: 2, images: 0, revisions: 1 })).toBe(
      'One layout still uses “Loft”. Pick another venue for it before you delete this one. 2 layouts in weddings you are not part of use it too, so it cannot be deleted for now.',
    )
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

  it('says whose save met an Accept or a restore', () => {
    expect(loadedChangesText('Aiden')).toBe('Loaded Aiden’s changes.')
    expect(loadedChangesText(null)).toBe('Loaded the latest version of this venue.')
    expect(acceptOverText('Aiden')).toBe('Aiden changed this venue after you opened it. Accept your draft over it?')
    expect(acceptOverText(null)).toBe('Someone changed this venue after you opened it. Accept your draft over it?')
    expect(restoreReloadedText('Noa', true)).toBe('Loaded Noa’s changes. Try Undo import again.')
    expect(restoreReloadedText(null, false)).toBe('Loaded the latest version of this venue. Try Put back again.')
    expect(loadedChangesText('Dayna K.')).toBe('Loaded Dayna K.’s changes.')
    expect(acceptOverText('Dayna K.')).toBe('Dayna K. changed this venue after you opened it. Accept your draft over it?')
    expect(restoreReloadedText('Dayna K.', true)).toBe('Loaded Dayna K.’s changes. Try Undo import again.')
  })
})
