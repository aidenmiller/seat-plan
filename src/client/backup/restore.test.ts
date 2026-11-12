import { describe, expect, it } from 'vitest'
import type { BackupFile } from '@/domain/backup/schema'
import { readBackupFile, runRestore, type RestoreProgress, type RestoreSteps } from './restore'

const T1 = '00000000-0000-4000-8000-0000000000a1'
const T2 = '00000000-0000-4000-8000-0000000000a2'
const IMG = '00000000-0000-4000-8000-0000000000b1'

function file(): BackupFile {
  return {
    format: 'seat-plan-backup',
    version: 2,
    exportedAt: '2026-11-10T12:00:00.000Z',
    wedding: { id: '00000000-0000-4000-8000-000000000001', name: 'Noa & Aiden', date: null, unit: 'ft', minGapCm: 152.4, partner1Name: 'Noa', partner2Name: 'Aiden' },
    guests: [],
    members: [{ userId: '00000000-0000-4000-8000-0000000000d1', email: 'noa@example.com', displayName: 'Noa', role: 'owner' }],
    groups: [],
    groupMembers: [],
    rules: [],
    ruleGuests: [],
    layouts: [
      { id: '00000000-0000-4000-8000-0000000000c1', name: 'Dinner', kind: 'reception', venueTemplateId: T1, editedBy: 'Noa', canvas: { schemaVersion: 1, items: [] } },
      { id: '00000000-0000-4000-8000-0000000000c2', name: 'Ceremony', kind: 'ceremony', venueTemplateId: null, editedBy: null, canvas: { schemaVersion: 1, items: [] } },
    ],
    templates: [
      { id: T1, name: 'Hall', fixedItems: [], reference: null, importedBy: 'hand', imageId: IMG },
      { id: T2, name: 'Garden', fixedItems: [], reference: null, importedBy: 'hand', imageId: null },
    ],
    images: [{ id: IMG, templateId: T1, contentType: 'image/png', width: 1, height: 1, sha256: '0'.repeat(64), data: btoa('png!') }],
  }
}

function fakeSteps(needsImage: boolean) {
  const calls: string[] = []
  const steps: RestoreSteps = {
    start: async (body) => {
      calls.push(`start ${body.jobId}`)
      return { jobId: body.jobId!, weddingId: 'w2', weddingName: 'Noa & Aiden (restored)' }
    },
    template: async (_jobId, body) => {
      calls.push(`template ${body.name}`)
      return { templateId: body.id, reused: !needsImage, needsImage: needsImage && body.imageId !== null }
    },
    image: async (_jobId, templateId, blob) => {
      calls.push(`image ${templateId} ${await blob.text()} ${blob.type}`)
      return { ok: true }
    },
    layout: async (_jobId, body) => {
      calls.push(`layout ${body.name}`)
      return { layoutId: body.id, droppedSeats: 1 }
    },
  }
  return { calls, steps }
}

describe('runRestore', () => {
  it('sends the rows, then each template and the image it needs, then each layout, reporting each step', async () => {
    const { calls, steps } = fakeSteps(true)
    const progress: RestoreProgress[] = []
    const result = await runRestore(file(), 'job-1', (p) => progress.push(p), steps)
    expect(calls).toEqual(['start job-1', 'template Hall', `image ${T1} png! image/png`, 'template Garden', 'layout Dinner', 'layout Ceremony'])
    expect(result).toEqual({ jobId: 'job-1', weddingId: 'w2', weddingName: 'Noa & Aiden (restored)', droppedSeats: 2 })
    expect(progress.map((p) => p.label)).toEqual([
      'Guests, groups and rules',
      'Venue 1 of 2',
      'Floor plan for Hall',
      'Venue 2 of 2',
      'Layout 1 of 2',
      'Layout 2 of 2',
      'Done',
    ])
    expect(progress.at(-1)).toEqual({ label: 'Done', done: 6, total: 6 })
  })

  it('sends version 2 with the partner names, and never the members', async () => {
    const bodies: unknown[] = []
    const { steps } = fakeSteps(false)
    await runRestore(file(), 'job-1', () => {}, {
      ...steps,
      start: async (body) => {
        bodies.push(body)
        return steps.start(body)
      },
    })
    expect(bodies[0]).toMatchObject({ format: 'seat-plan-backup', version: 2, wedding: { partner1Name: 'Noa', partner2Name: 'Aiden' } })
    expect(bodies[0]).not.toHaveProperty('members')
  })

  it('skips the image when the template was reused', async () => {
    const { calls, steps } = fakeSteps(false)
    await runRestore(file(), 'job-1', () => {}, steps)
    expect(calls.some((c) => c.startsWith('image'))).toBe(false)
  })
})

describe('readBackupFile', () => {
  it('says plainly when a file is not a backup', async () => {
    expect(await readBackupFile(new Blob(['not json']))).toEqual({ ok: false, message: 'This file is not a backup from Something Blueprint.' })
    expect(await readBackupFile(new Blob(['{"format":"other"}']))).toEqual({ ok: false, message: 'This file is not a backup from Something Blueprint.' })
    const broken = await readBackupFile(new Blob([JSON.stringify({ ...file(), guests: [{ id: 'x' }] })]))
    expect(broken.ok).toBe(false)
    expect(!broken.ok && broken.message).toMatch(/^This backup file has a problem at guests\.0\./)
  })

  it('reads a good file', async () => {
    const read = await readBackupFile(new Blob([JSON.stringify(file())]))
    expect(read.ok && read.backup.layouts.map((l) => l.name)).toEqual(['Dinner', 'Ceremony'])
  })

  it('reads a version 1 file as version 2: Noa and Aiden, sides by place, no members', async () => {
    const guest = { firstName: 'Zoë', lastName: 'Levi', nickname: null, partnerId: null, coupleRuleEnabled: true, household: null, rsvp: 'yes', meal: null, isChild: false, notes: null }
    const { wedding } = file()
    const v1: Record<string, unknown> = {
      ...file(),
      version: 1,
      wedding: { id: wedding.id, name: wedding.name, date: wedding.date, unit: wedding.unit, minGapCm: wedding.minGapCm },
      guests: [
        { ...guest, id: '00000000-0000-4000-8000-0000000000e1', side: 'Noa' },
        { ...guest, id: '00000000-0000-4000-8000-0000000000e2', side: 'Aiden' },
        { ...guest, id: '00000000-0000-4000-8000-0000000000e3', side: 'Both' },
      ],
    }
    delete v1.members
    const read = await readBackupFile(new Blob([JSON.stringify(v1)]))
    if (!read.ok) throw new Error(read.message)
    expect(read.backup.version).toBe(2)
    expect(read.backup.wedding).toMatchObject({ partner1Name: 'Noa', partner2Name: 'Aiden' })
    expect(read.backup.guests.map((g) => g.side)).toEqual(['partner1', 'partner2', 'both'])
    expect(read.backup.members).toEqual([])
  })

  it('says plainly when a file is from a newer version', async () => {
    const read = await readBackupFile(new Blob([JSON.stringify({ ...file(), version: 3 })]))
    expect(read.ok).toBe(false)
    expect(!read.ok && read.message).toMatch(/^This backup file has a problem at version: /)
  })
})
