import { describe, expect, it } from 'vitest'
import {
  acceptImportBody,
  createGuestBody,
  createLayoutBody,
  createVenueBody,
  createWeddingBody,
  duplicateLayoutBody,
  duplicateVenueBody,
  restoreRevisionBody,
  saveLayoutBody,
  saveVenueBody,
  updateGuestBody,
  updateLayoutBody,
  updateWeddingBody,
} from './api'

const SAVE_ID = '11111111-1111-4111-8111-111111111111'
const IMAGE_ID = '22222222-2222-4222-8222-222222222222'
const reference = { scaleCmPerPx: 2, offsetX: 0, offsetY: 0, rotation: 0, opacity: 0.5 }

describe('who made a change', () => {
  it('is never read from a body: a tab open from before still sends editedBy, which parses and is dropped', () => {
    const old = { editedBy: 'Noa' }
    const bodies = [
      createLayoutBody.parse({ name: 'Dinner', kind: 'reception', venueTemplateId: null, ...old }),
      saveLayoutBody.parse({ baseVersion: 1, saveId: SAVE_ID, tabId: 'tab', canvas: { schemaVersion: 1, items: [] }, ...old }),
      duplicateLayoutBody.parse({ ...old }),
      createVenueBody.parse({ name: 'Hall', ...old }),
      duplicateVenueBody.parse({ ...old }),
      saveVenueBody.parse({ baseVersion: 1, saveId: SAVE_ID, fixedItems: [], reference: null, ...old }),
      acceptImportBody.parse({ baseVersion: 1, saveId: SAVE_ID, fixedItems: [], imageId: IMAGE_ID, reference, importedBy: 'ai', ...old }),
      restoreRevisionBody.parse({ baseVersion: 1, saveId: SAVE_ID, ...old }),
    ]
    for (const body of bodies) expect(body).not.toHaveProperty('editedBy')
    // Any value at all: it is not looked at.
    expect(saveLayoutBody.safeParse({ baseVersion: 1, saveId: SAVE_ID, tabId: 'tab', canvas: { schemaVersion: 1, items: [] }, editedBy: 'Dayna' }).success).toBe(true)
  })
})

describe('names in request bodies', () => {
  it('drop NUL, mend lone surrogates, then trim', () => {
    expect(createWeddingBody.parse({ name: '  Noa\u0000 & Aiden \ud83c ' }).name).toBe('Noa & Aiden �')
    expect(updateWeddingBody.parse({ name: 'A\u0000' }).name).toBe('A')
    const layout = createLayoutBody.parse({ name: 'Din\u0000ner', kind: 'reception', venueTemplateId: null })
    expect(layout.name).toBe('Dinner')
    expect(updateLayoutBody.parse({ name: '\udc00 Plan' }).name).toBe('� Plan')
    expect(duplicateLayoutBody.parse({ name: 'Copy\u0000' }).name).toBe('Copy')
  })

  it('a name of only NULs and spaces is empty, so it is refused', () => {
    expect(createWeddingBody.safeParse({ name: ' \u0000\u0000 ' }).success).toBe(false)
  })
})

describe('partner names', () => {
  it('are optional, trimmed to one line, and blank becomes null', () => {
    expect(createWeddingBody.parse({ name: 'W' })).not.toHaveProperty('partner1Name')
    const made = createWeddingBody.parse({ name: 'W', partner1Name: '  Sam \n Rivera ', partner2Name: '   ' })
    expect(made).toMatchObject({ partner1Name: 'Sam Rivera', partner2Name: null })
    expect(updateWeddingBody.parse({ partner2Name: null })).toEqual({ partner2Name: null })
    expect(updateWeddingBody.parse({ partner1Name: '' })).toEqual({ partner1Name: null })
  })

  it('take at most 60 characters', () => {
    expect(updateWeddingBody.safeParse({ partner1Name: 'x'.repeat(60) }).success).toBe(true)
    expect(updateWeddingBody.safeParse({ partner1Name: 'x'.repeat(61) }).success).toBe(false)
    expect(createWeddingBody.safeParse({ name: 'W', partner2Name: 5 }).success).toBe(false)
  })
})

describe('guest sides', () => {
  it("are the codes partner1, partner2 and both, never a partner's name", () => {
    for (const side of ['partner1', 'partner2', 'both']) {
      expect(createGuestBody.safeParse({ firstName: 'A', lastName: 'B', side }).success).toBe(true)
    }
    for (const side of ['Noa', 'Aiden', 'Both', 'Sam']) {
      expect(updateGuestBody.safeParse({ side }).success).toBe(false)
    }
  })
})
