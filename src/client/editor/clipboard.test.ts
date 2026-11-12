import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Table } from '@/domain/canvas-schema'
import { makeItem } from '@/domain/presets'
import { CLIPBOARD_KEY, createClipboard, type ClipboardData } from './clipboard'
import type { StorageLike } from './state/device-view'

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }
}

function freshMemory() {
  return { data: null as ClipboardData | null, pastes: new Map<string, number>() }
}

const seated = (): Table => {
  const t = makeItem('round', { x: 0, y: 0 }, 't1', emptyCanvas()) as Table
  return { ...t, seats: t.seats.map((s, i) => (i === 0 ? { ...s, guestId: '00000000-0000-4000-8000-000000000001' } : s)) }
}

describe('the clipboard', () => {
  it('copies with every seat empty and reads it back', () => {
    const clip = createClipboard({ storage: memoryStorage(), memory: freshMemory() })
    clip.write([seated()], 'L1')
    const data = clip.read()!
    expect(data.layoutId).toBe('L1')
    expect((data.items[0] as Table).seats.every((s) => s.guestId === null)).toBe(true)
  })

  it('pastes into another tab of this device through storage', () => {
    const storage = memoryStorage()
    let t = 1000
    const tabA = createClipboard({ storage, memory: freshMemory(), now: () => t })
    const tabB = createClipboard({ storage, memory: freshMemory(), now: () => t })
    tabA.write([seated()], 'L1')
    expect(tabB.read()?.layoutId).toBe('L1')
    t = 2000
    tabB.write([makeItem('bar', { x: 0, y: 0 }, 'b', emptyCanvas())], 'L2')
    expect(tabA.read()?.layoutId).toBe('L2')
  })

  it('keeps working in this tab when storage is blocked or holds junk', () => {
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => undefined,
    }
    const clip = createClipboard({ storage: blocked, memory: freshMemory() })
    clip.write([seated()], 'L1')
    expect(clip.read()?.items).toHaveLength(1)

    const junk = memoryStorage()
    junk.data.set(CLIPBOARD_KEY, JSON.stringify({ copyId: 'x', layoutId: 'L', copiedAt: 9e15, items: [{ kind: 'nope' }] }))
    expect(createClipboard({ storage: junk, memory: freshMemory() }).read()).toBeNull()
  })

  it('counts pastes of one copy', () => {
    const clip = createClipboard({ memory: freshMemory() })
    clip.write([seated()], 'L1')
    const { copyId } = clip.read()!
    expect(clip.pasteCount(copyId)).toBe(0)
    clip.notePaste(copyId)
    clip.notePaste(copyId)
    expect(clip.pasteCount(copyId)).toBe(2)
  })

  it('ignores an empty copy', () => {
    const clip = createClipboard({ memory: freshMemory() })
    clip.write([], 'L1')
    expect(clip.read()).toBeNull()
  })
})

describe('the clipboard on a shared device', () => {
  const AVERY = '11111111-1111-4111-8111-111111111111'
  const BLAKE = '22222222-2222-4222-8222-222222222222'
  const note = () => makeItem('bar', { x: 0, y: 0 }, 'b', emptyCanvas())

  it('pastes in another tab of the same person', () => {
    const storage = memoryStorage()
    createClipboard({ storage, memory: freshMemory(), userId: () => AVERY }).write([note()], 'L1')
    expect(createClipboard({ storage, memory: freshMemory(), userId: () => AVERY }).read()?.layoutId).toBe('L1')
  })

  it('never hands one person’s copy to someone else signed in after them, and clears it', () => {
    const storage = memoryStorage()
    // Avery copies; Blake signs in over Avery's session (Avery never signed out) and opens a layout.
    createClipboard({ storage, memory: freshMemory(), userId: () => AVERY }).write([seated()], 'L1')
    const blakes = createClipboard({ storage, memory: freshMemory(), userId: () => BLAKE })
    expect(blakes.read()).toBeNull()
    expect(storage.data.has(CLIPBOARD_KEY)).toBe(false)
    // Blake's own copy works as before.
    blakes.write([note()], 'L2')
    expect(blakes.read()?.layoutId).toBe('L2')
  })

  it('ignores, and clears, a copy stored without a person (from before this change)', () => {
    const storage = memoryStorage()
    storage.data.set(CLIPBOARD_KEY, JSON.stringify({ copyId: 'x', layoutId: 'L', copiedAt: 1, items: [note()] }))
    expect(createClipboard({ storage, memory: freshMemory(), userId: () => AVERY }).read()).toBeNull()
    expect(storage.data.has(CLIPBOARD_KEY)).toBe(false)
  })

  it('never hands this tab’s copy to someone else either', () => {
    const memory = freshMemory()
    createClipboard({ memory, userId: () => AVERY }).write([note()], 'L1')
    expect(createClipboard({ memory, userId: () => BLAKE }).read()).toBeNull()
  })
})
