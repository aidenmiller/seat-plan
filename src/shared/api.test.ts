import { describe, expect, it } from 'vitest'
import { createLayoutBody, createWeddingBody, duplicateLayoutBody, updateLayoutBody, updateWeddingBody } from './api'

describe('names in request bodies', () => {
  it('drop NUL, mend lone surrogates, then trim', () => {
    expect(createWeddingBody.parse({ name: '  Noa\u0000 & Aiden \ud83c ' }).name).toBe('Noa & Aiden �')
    expect(updateWeddingBody.parse({ name: 'A\u0000' }).name).toBe('A')
    const layout = createLayoutBody.parse({ name: 'Din\u0000ner', kind: 'reception', venueTemplateId: null, editedBy: 'Noa' })
    expect(layout.name).toBe('Dinner')
    expect(updateLayoutBody.parse({ name: '\udc00 Plan' }).name).toBe('� Plan')
    expect(duplicateLayoutBody.parse({ name: 'Copy\u0000', editedBy: 'Aiden' }).name).toBe('Copy')
  })

  it('a name of only NULs and spaces is empty, so it is refused', () => {
    expect(createWeddingBody.safeParse({ name: ' \u0000\u0000 ' }).success).toBe(false)
  })
})
