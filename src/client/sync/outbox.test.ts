import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Canvas } from '@/domain/canvas-schema'
import { createDraftStore, draftKey, isDraftSnapshot, onStorageError } from './outbox'
import type { DraftSnapshot } from './types'

const L1 = '6f1c2b9e-3d4a-4c5b-8e7f-0a1b2c3d4e5f'
const L2 = '7a2d3c0f-4e5b-4d6c-9f80-1b2c3d4e5f60'

function canvasN(n: number): Canvas {
  return {
    schemaVersion: 1,
    items: [{ id: 'f1', kind: 'fixture', type: 'bar', x: n, y: 0, rotation: 0, locked: false, width: 100, height: 50, label: 'Bar' }],
  }
}

function draft(layoutId: string, tabId: string, over: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    layoutId,
    tabId,
    baseVersion: 2,
    canvas: canvasN(1),
    editedBy: 'Aiden',
    inFlight: null,
    dirty: true,
    updatedAt: '2026-11-09T12:00:00.000Z',
    ...over,
  }
}

let n = 0
const freshStore = (onError?: (e: unknown, op: string) => void) =>
  createDraftStore({ dbName: `outbox-test-${++n}`, onError })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('outbox', () => {
  it('keys drafts by layout and tab', () => {
    expect(draftKey(L1, 'tab-1')).toBe(`layout:${L1}:tab-1`)
  })

  it('stores, reads and deletes a draft', async () => {
    const store = freshStore()
    const d = draft(L1, 'tab-1', {
      inFlight: { saveId: '11111111-1111-4111-8111-111111111111', baseVersion: 2, canvas: canvasN(0) },
    })
    expect(await store.putDraft(d)).toBe(true)
    expect(await store.getDraft(L1, 'tab-1')).toEqual(d)
    expect(await store.getDraft(L1, 'tab-2')).toBeNull()
    expect(await store.deleteDraft(L1, 'tab-1')).toBe(true)
    expect(await store.getDraft(L1, 'tab-1')).toBeNull()
  })

  it('lists one layout’s drafts, newest first', async () => {
    const store = freshStore()
    await store.putDraft(draft(L1, 'a', { updatedAt: '2026-11-09T12:00:01.000Z' }))
    await store.putDraft(draft(L1, 'b', { updatedAt: '2026-11-09T12:00:03.000Z' }))
    await store.putDraft(draft(L1, 'c', { updatedAt: '2026-11-09T12:00:02.000Z' }))
    await store.putDraft(draft(L2, 'a'))
    const list = await store.listDrafts(L1)
    expect(list.map((d) => d.tabId)).toEqual(['b', 'c', 'a'])
    expect(await store.listDrafts('nothing')).toEqual([])
  })

  it('skips and reports a stored value that is not a usable draft', async () => {
    const errors: string[] = []
    const store = freshStore((_e, op) => errors.push(op))
    // A draft whose canvas the current schema refuses (an older app version, say).
    const broken = { ...draft(L1, 'old'), canvas: { schemaVersion: 1, items: [{ id: 'x', kind: 'mystery' }] } }
    await store.putDraft(broken as unknown as DraftSnapshot)
    await store.putDraft(draft(L1, 'good'))
    expect((await store.listDrafts(L1)).map((d) => d.tabId)).toEqual(['good'])
    expect(await store.getDraft(L1, 'old')).toBeNull()
    expect(errors).toEqual(['list', 'get'])
  })

  it('checks the shape of a draft', () => {
    expect(isDraftSnapshot(draft(L1, 'a'))).toBe(true)
    expect(isDraftSnapshot(null)).toBe(false)
    expect(isDraftSnapshot({ ...draft(L1, 'a'), editedBy: 'Bob' })).toBe(false)
    expect(isDraftSnapshot({ ...draft(L1, 'a'), inFlight: { saveId: 'x', baseVersion: 1 } })).toBe(false)
  })

  it('swallows and reports errors when IndexedDB is missing', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const seen: string[] = []
    const off = onStorageError((_e, op) => seen.push(op))
    const store = freshStore()
    expect(await store.putDraft(draft(L1, 'a'))).toBe(false)
    expect(await store.getDraft(L1, 'a')).toBeNull()
    expect(await store.listDrafts(L1)).toEqual([])
    expect(await store.deleteDraft(L1, 'a')).toBe(false)
    expect(seen).toEqual(['put', 'get', 'list', 'delete'])
    off()
  })

  it('swallows and reports a refused write (private mode, full disk)', async () => {
    const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    vi.stubGlobal('indexedDB', {
      open() {
        throw quota
      },
    })
    const errors: unknown[] = []
    const store = freshStore((e) => errors.push(e))
    expect(await store.putDraft(draft(L1, 'a'))).toBe(false)
    expect(errors).toEqual([quota])
  })

  it('opens the database again after a failure (WebKit drops idle connections)', async () => {
    const real = indexedDB
    let opens = 0
    // The first connection was dropped: every transaction on it fails.
    const dropped = {
      transaction() {
        throw new DOMException('The database connection is closing.', 'InvalidStateError')
      },
    }
    vi.stubGlobal('indexedDB', {
      open(name: string) {
        opens += 1
        if (opens > 1) return real.open(name)
        const request: { result: unknown; onsuccess?: () => void } = { result: dropped }
        setTimeout(() => request.onsuccess?.())
        return request
      },
    })
    const errors: string[] = []
    const store = freshStore((_e, op) => errors.push(op))
    expect(await store.putDraft(draft(L1, 'a'))).toBe(false)
    expect(await store.putDraft(draft(L1, 'a'))).toBe(true)
    expect(await store.getDraft(L1, 'a')).toEqual(draft(L1, 'a'))
    expect(opens).toBe(2)
    expect(errors).toEqual(['put'])
  })

  it('a broken listener does not break the store', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const off = onStorageError(() => {
      throw new Error('listener bug')
    })
    expect(await freshStore().putDraft(draft(L1, 'a'))).toBe(false)
    off()
  })
})
