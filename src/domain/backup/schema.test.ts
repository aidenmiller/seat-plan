import { describe, expect, it } from 'vitest'
import { emptyCanvas } from '../canvas-schema'
import { backupLayoutSchema } from './schema'

const layout = {
  id: '0b9f6a3e-6c1d-4c8e-9f57-2a1d6f1e7a10',
  name: 'Reception plan',
  kind: 'reception',
  venueTemplateId: null,
  editedBy: 'Noa',
  canvas: emptyCanvas(),
}

describe('backup layouts', () => {
  it('keeps any editor name up to 200 characters, or null', () => {
    for (const editedBy of ['Noa', 'Aiden', 'Dayna K.', '🎂 Dayna', 'x'.repeat(200), null]) {
      expect(backupLayoutSchema.safeParse({ ...layout, editedBy }).success).toBe(true)
    }
  })

  it('refuses a name over 200 characters or a value that is not text', () => {
    expect(backupLayoutSchema.safeParse({ ...layout, editedBy: 'x'.repeat(201) }).success).toBe(false)
    expect(backupLayoutSchema.safeParse({ ...layout, editedBy: 5 }).success).toBe(false)
    expect(backupLayoutSchema.safeParse({ ...layout, editedBy: undefined }).success).toBe(false)
  })
})
