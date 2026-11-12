import { describe, expect, it } from 'vitest'
import { backupFileSchema, backupFileV1Schema, restoreStartSchema, type BackupFileV1, type RestoreStartV1 } from './schema'
import { upgradeRestoreStartV1, upgradeV1 } from './upgrade'

const W = '00000000-0000-4000-8000-000000000001'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const guest = (n: number, side: 'Noa' | 'Aiden' | 'Both') => ({
  id: id(n),
  firstName: `F${n}`,
  lastName: 'L',
  nickname: null,
  partnerId: null,
  coupleRuleEnabled: true,
  household: null,
  side,
  rsvp: 'pending' as const,
  meal: null,
  isChild: false,
  notes: null,
})

/** The first restore step as a version 1 browser sends it. */
function v1Rows(): RestoreStartV1 {
  return {
    format: 'seat-plan-backup',
    version: 1,
    wedding: { id: W, name: 'Noa & Aiden', date: '2027-06-19', unit: 'ft', minGapCm: 152.4 },
    guests: [guest(11, 'Noa'), guest(12, 'Aiden'), guest(13, 'Both')],
    groups: [{ id: id(21), name: 'Family', color: '#2563EB' }],
    groupMembers: [{ groupId: id(21), guestId: id(11) }],
    rules: [],
    ruleGuests: [],
  }
}

/** A version 1 file, as the app wrote it before partner names. */
function v1File(): BackupFileV1 {
  return { ...v1Rows(), exportedAt: '2026-11-10T12:00:00.000Z', layouts: [], templates: [], images: [] }
}

describe('upgradeV1', () => {
  it('names the partners Noa and Aiden, sides by place, and no members', () => {
    const file = upgradeV1(v1File())
    expect(file.version).toBe(2)
    expect(file.wedding).toEqual({ id: W, name: 'Noa & Aiden', date: '2027-06-19', unit: 'ft', minGapCm: 152.4, partner1Name: 'Noa', partner2Name: 'Aiden' })
    expect(file.guests.map((g) => g.side)).toEqual(['partner1', 'partner2', 'both'])
    expect(file.members).toEqual([])
  })

  it('keeps everything else as it was', () => {
    const before = v1File()
    const file = upgradeV1(before)
    expect(file.guests.map((g) => ({ ...g, side: null }))).toEqual(before.guests.map((g) => ({ ...g, side: null })))
    expect(file.groups).toEqual(before.groups)
    expect(file.groupMembers).toEqual(before.groupMembers)
    expect(file.exportedAt).toBe(before.exportedAt)
  })

  it('upgrades the first restore step the same way, without members', () => {
    const start = upgradeRestoreStartV1({ ...v1Rows(), jobId: id(99) })
    expect(start).toMatchObject({ version: 2, jobId: id(99), wedding: { partner1Name: 'Noa', partner2Name: 'Aiden' } })
    expect(start.guests.map((g) => g.side)).toEqual(['partner1', 'partner2', 'both'])
    expect(start).not.toHaveProperty('members')
  })
})

describe('the schemas read version 1 as version 2', () => {
  it('backupFileSchema upgrades a version 1 file', () => {
    expect(backupFileV1Schema.safeParse(v1File()).success).toBe(true)
    const file = backupFileSchema.parse(v1File())
    expect(file).toMatchObject({ version: 2, wedding: { partner1Name: 'Noa', partner2Name: 'Aiden' }, members: [] })
    expect(file.guests.map((g) => g.side)).toEqual(['partner1', 'partner2', 'both'])
  })

  it('restoreStartSchema upgrades the first step an older browser sends', () => {
    const start = restoreStartSchema.parse(v1Rows())
    expect(start).toMatchObject({ version: 2, wedding: { partner1Name: 'Noa', partner2Name: 'Aiden' } })
    expect(start.guests.map((g) => g.side)).toEqual(['partner1', 'partner2', 'both'])
  })

  it('refuses new side codes in a version 1 file, and old side words in a version 2 one', () => {
    const v1 = v1File()
    expect(backupFileSchema.safeParse({ ...v1, guests: [{ ...v1.guests[0]!, side: 'partner1' }] }).success).toBe(false)
    const v2 = upgradeV1(v1File())
    expect(backupFileSchema.safeParse(v2).success).toBe(true)
    expect(backupFileSchema.safeParse({ ...v2, guests: [{ ...v2.guests[0]!, side: 'Noa' }] }).success).toBe(false)
  })
})
