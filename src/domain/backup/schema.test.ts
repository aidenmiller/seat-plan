import { describe, expect, it } from 'vitest'
import { emptyCanvas } from '../canvas-schema'
import { BACKUP_VERSION, backupFileSchema, backupLayoutSchema, backupWeddingSchema, restoreStartSchema } from './schema'

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

const wedding = { id: '0b9f6a3e-6c1d-4c8e-9f57-2a1d6f1e7a11', name: 'Sam & Alex', date: null, unit: 'ft', minGapCm: 152.4, partner1Name: 'Sam', partner2Name: 'Alex' }
/** The first restore step, and the whole file around it. */
const rows = { format: 'seat-plan-backup', version: 2, wedding, guests: [], groups: [], groupMembers: [], rules: [], ruleGuests: [] }
const file = { ...rows, exportedAt: '2026-11-10T12:00:00.000Z', layouts: [], templates: [], images: [] }

describe('version 2', () => {
  it('is the version backups are written in', () => {
    expect(BACKUP_VERSION).toBe(2)
  })

  it("keeps the partners' names, trimmed, blank as null, up to 60 characters", () => {
    expect(backupWeddingSchema.parse({ ...wedding, partner1Name: '  Sam ', partner2Name: '' })).toMatchObject({ partner1Name: 'Sam', partner2Name: null })
    expect(backupWeddingSchema.safeParse({ ...wedding, partner2Name: null }).success).toBe(true)
    expect(backupWeddingSchema.safeParse({ ...wedding, partner2Name: 'x'.repeat(61) }).success).toBe(false)
    expect(backupWeddingSchema.safeParse({ ...wedding, partner2Name: undefined }).success).toBe(false)
  })

  it('lists members for reading, and an empty list when they are left out', () => {
    expect(backupFileSchema.parse(file).members).toEqual([])
    const member = { userId: '0b9f6a3e-6c1d-4c8e-9f57-2a1d6f1e7a12', email: 'sam@example.com', displayName: 'Sam', role: 'owner' }
    expect(backupFileSchema.parse({ ...file, members: [member] }).members).toEqual([member])
    expect(backupFileSchema.safeParse({ ...file, members: [{ ...member, role: 'admin' }] }).success).toBe(false)
    expect(backupFileSchema.safeParse({ ...file, members: [{ ...member, userId: 'nope' }] }).success).toBe(false)
  })

  it('takes the first restore step without members, and refuses a version it does not know', () => {
    expect(restoreStartSchema.parse(rows)).toMatchObject({ version: 2, wedding: { partner1Name: 'Sam', partner2Name: 'Alex' } })
    const three = restoreStartSchema.safeParse({ ...rows, version: 3 })
    expect(three.success).toBe(false)
    expect(three.error?.issues[0]?.path).toEqual(['version'])
  })
})
