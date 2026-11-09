import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Canvas } from '@/domain/canvas-schema'
import type { DroppedSeat, SaveLayoutOk } from '@/shared/api'
import { createLayoutSaver, KEEPALIVE_LIMIT_BYTES } from './layout-saver'
import { createDraftStore } from './outbox'
import type { DraftSnapshot, DraftStore, LayoutSaverOptions, SaveStatus } from './types'

const LAYOUT = '6f1c2b9e-3d4a-4c5b-8e7f-0a1b2c3d4e5f'
const TAB = 'tab-a'
const GUEST = '0b9f6a3e-6c1d-4c8e-9f57-2a1d6f1e7a10'
const START = new Date('2026-11-09T12:00:00.000Z')

/** A valid canvas that differs by `n`. */
function canvasN(n: number, label = 'Bar'): Canvas {
  return {
    schemaVersion: 1,
    items: [
      { id: 'f1', kind: 'fixture', type: 'bar', x: n, y: 0, rotation: 0, locked: false, width: 100, height: 50, label },
    ],
  }
}

type Call = {
  url: string
  init: RequestInit
  body: { baseVersion: number; saveId: string; editedBy: string; tabId: string; canvas: Canvas }
  at: number
  respond(status: number, data?: unknown): void
  fail(error?: unknown): void
}

function fakeFetch(log?: string[]) {
  const calls: Call[] = []
  const fn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      const body = JSON.parse(String(init?.body))
      log?.push(`fetch:${body.saveId}`)
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      calls.push({
        url: String(url),
        init: init ?? {},
        body,
        at: Date.now(),
        respond: (status, data) =>
          resolve(
            new Response(JSON.stringify(data ?? {}), {
              status,
              headers: { 'content-type': 'application/json' },
            }),
          ),
        fail: (error = new TypeError('Failed to fetch')) => reject(error),
      })
    })
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

function ok(version: number, extra: Partial<SaveLayoutOk> = {}): SaveLayoutOk {
  return {
    status: 'saved',
    version,
    updatedAt: `2026-11-09T12:00:${String(version).padStart(2, '0')}.000Z`,
    editedBy: 'Noa',
    droppedSeats: [],
    ...extra,
  }
}

/** Let IndexedDB (which runs on real setImmediate) and promise chains finish, without moving the fake clock. */
async function settle(rounds = 40) {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

async function tick(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await settle()
}

let dbCounter = 0

function setup(over: Partial<LayoutSaverOptions> = {}, opts: { log?: string[] } = {}) {
  const realDrafts = createDraftStore({ dbName: `saver-test-${++dbCounter}` })
  const f = fakeFetch(opts.log)
  const statuses: SaveStatus[] = []
  const dropped: DroppedSeat[][] = []
  const win = new EventTarget()
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as string })
  let online = true
  const saver = createLayoutSaver({
    layoutId: LAYOUT,
    tabId: TAB,
    baseVersion: 3,
    editedBy: () => 'Noa',
    onStatus: (s) => statuses.push(s),
    onDroppedSeats: (d) => dropped.push(d),
    fetch: f.fn,
    drafts: realDrafts,
    random: () => 0.5,
    isOnline: () => online,
    windowTarget: win,
    documentTarget: doc,
    ...over,
  })
  return {
    saver,
    drafts: (over.drafts as DraftStore | undefined) ?? realDrafts,
    calls: f.calls,
    statuses,
    dropped,
    win,
    doc,
    setOnline(value: boolean) {
      online = value
    },
    status: () => saver.getStatus(),
    draft: () => realDrafts.getDraft(LAYOUT, TAB),
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: START })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('drafts', () => {
  it('writes the draft before any network call', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    expect(t.status()).toEqual({ kind: 'saving' })
    await settle()
    expect(t.calls).toHaveLength(0)
    const draft = await t.draft()
    expect(draft).toMatchObject({ layoutId: LAYOUT, tabId: TAB, baseVersion: 3, dirty: true, inFlight: null })
    expect(draft!.canvas).toEqual(canvasN(1))
    expect(t.saver.hasUnsavedChanges()).toBe(true)
  })

  it('records the in-flight snapshot and saveId before the request leaves', async () => {
    const log: string[] = []
    const real = createDraftStore({ dbName: `saver-log-${++dbCounter}` })
    const spy: DraftStore = {
      ...real,
      async putDraft(d: DraftSnapshot) {
        const stored = await real.putDraft(d)
        log.push(d.inFlight ? `draft:${d.inFlight.saveId}` : 'draft')
        return stored
      },
    }
    const t = setup({ drafts: spy }, { log })
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    expect(t.calls).toHaveLength(1)
    const saveId = t.calls[0].body.saveId
    expect(log).toEqual(['draft', `draft:${saveId}`, `fetch:${saveId}`])
    const draft = await real.getDraft(LAYOUT, TAB)
    expect(draft!.inFlight).toEqual({ saveId, baseVersion: 3, canvas: canvasN(1) })
  })

  it('deletes the draft once the server has everything', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    t.calls[0].respond(200, ok(4))
    await settle()
    expect(await t.draft()).toBeNull()
    expect(t.saver.hasUnsavedChanges()).toBe(false)
    expect(t.status()).toEqual({ kind: 'saved', at: ok(4).updatedAt })
    expect(t.saver.getBaseVersion()).toBe(4)
  })

  it('whenStored waits for the queued draft writes', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    t.saver.noteEdit(canvasN(2))
    await t.saver.whenStored()
    expect((await t.draft())!.canvas).toEqual(canvasN(2))
  })

  it('keeps saving when the browser will not store drafts', async () => {
    const failing: DraftStore = {
      putDraft: vi.fn(async () => false),
      getDraft: vi.fn(async () => null),
      listDrafts: vi.fn(async () => []),
      deleteDraft: vi.fn(async () => false),
    }
    const t = setup({ drafts: failing })
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    expect(t.calls).toHaveLength(1)
    t.calls[0].respond(200, ok(4))
    await settle()
    expect(t.status().kind).toBe('saved')
  })

  it('does not let a stuck IndexedDB hold the save up for long', async () => {
    const stuck: DraftStore = {
      putDraft: () => new Promise<boolean>(() => {}),
      getDraft: async () => null,
      listDrafts: async () => [],
      deleteDraft: async () => true,
    }
    const t = setup({ drafts: stuck, draftWaitMs: 2000 })
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    expect(t.calls).toHaveLength(0)
    await tick(2000)
    expect(t.calls).toHaveLength(1)
  })
})

describe('debounce', () => {
  it('saves 1 s after the last edit', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(999)
    expect(t.calls).toHaveLength(0)
    await tick(1)
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0].url).toBe(`/api/layouts/${LAYOUT}`)
    expect(t.calls[0].init.method).toBe('PUT')
    expect(t.calls[0].body).toMatchObject({ baseVersion: 3, editedBy: 'Noa', tabId: TAB, canvas: canvasN(1) })
    expect(t.calls[0].body.saveId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('starts the wait again on every edit', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(600)
    t.saver.noteEdit(canvasN(2))
    await tick(600)
    t.saver.noteEdit(canvasN(3))
    await tick(999)
    expect(t.calls).toHaveLength(0)
    await tick(1)
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0].body.canvas).toEqual(canvasN(3))
  })

  it('saves at most 5 s after the first unsent edit, even while editing goes on', async () => {
    const t = setup()
    // An edit every 400 ms, from 0 to 4800 ms: the 1 s debounce never runs out.
    for (let ms = 0; ms <= 4800; ms += 400) {
      t.saver.noteEdit(canvasN(ms))
      if (ms < 4800) await tick(400)
      expect(t.calls).toHaveLength(0)
    }
    await tick(199)
    expect(t.calls).toHaveLength(0)
    await tick(1)
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0].body.canvas).toEqual(canvasN(4800))
  })

  it('ignores a call with the same canvas object', async () => {
    const t = setup()
    const c = canvasN(1)
    t.saver.noteEdit(c)
    await tick(1000)
    t.calls[0].respond(200, ok(4))
    await settle()
    t.saver.noteEdit(c)
    expect(t.saver.hasUnsavedChanges()).toBe(false)
    await tick(5000)
    expect(t.calls).toHaveLength(1)
  })
})

describe('one save in flight', () => {
  it('waits for the save in flight, then sends later edits from the version it returned', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    expect(t.calls).toHaveLength(1)

    t.saver.noteEdit(canvasN(2))
    await tick(1000)
    t.saver.noteEdit(canvasN(3))
    await tick(6000)
    expect(t.calls).toHaveLength(1)

    t.calls[0].respond(200, ok(4))
    await settle()
    expect(t.calls).toHaveLength(2)
    expect(t.calls[1].body.baseVersion).toBe(4)
    expect(t.calls[1].body.canvas).toEqual(canvasN(3))
    expect(t.calls[1].body.saveId).not.toBe(t.calls[0].body.saveId)
    expect(t.saver.hasUnsavedChanges()).toBe(true)
    expect(t.status()).toEqual({ kind: 'saving' })
    const draft = await t.draft()
    expect(draft).toMatchObject({ baseVersion: 4, dirty: true })
    expect(draft!.inFlight!.saveId).toBe(t.calls[1].body.saveId)

    t.calls[1].respond(200, ok(5))
    await settle()
    expect(t.saver.getBaseVersion()).toBe(5)
    expect(t.saver.hasUnsavedChanges()).toBe(false)
    expect(await t.draft()).toBeNull()
  })

  it('keeps the debounce for edits made just before the reply', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    await tick(300)
    t.saver.noteEdit(canvasN(2))
    t.calls[0].respond(200, ok(4))
    await settle()
    expect(t.calls).toHaveLength(1)
    // The draft keeps the newer edit, now on top of version 4.
    expect(await t.draft()).toMatchObject({ baseVersion: 4, dirty: true, inFlight: null })
    await tick(999)
    expect(t.calls).toHaveLength(1)
    await tick(1)
    expect(t.calls).toHaveLength(2)
    expect(t.calls[1].body).toMatchObject({ baseVersion: 4, canvas: canvasN(2) })
  })
})

describe('retries', () => {
  it('resends the same snapshot with the same saveId after a network error or 5xx', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    const first = t.calls[0].body
    t.saver.noteEdit(canvasN(2)) // waits for the next save

    t.calls[0].fail()
    await settle()
    expect(t.status()).toMatchObject({ kind: 'retrying', attempt: 1 })
    await tick(999)
    expect(t.calls).toHaveLength(1)
    await tick(1)
    expect(t.calls).toHaveLength(2)
    expect(t.calls[1].body).toEqual(first)

    t.calls[1].respond(503, { error: 'unavailable' })
    await settle()
    expect(t.status()).toMatchObject({ kind: 'retrying', attempt: 2 })
    await tick(2000)
    expect(t.calls).toHaveLength(3)
    expect(t.calls[2].body).toEqual(first)

    t.calls[2].respond(200, ok(4))
    await settle()
    expect(t.calls).toHaveLength(4)
    expect(t.calls[3].body).toMatchObject({ baseVersion: 4, canvas: canvasN(2) })
    expect(t.calls[3].body.saveId).not.toBe(first.saveId)
  })

  it('backs off 1, 2, 4, 8, 16, then 30 s', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000]
    for (let i = 0; i < delays.length; i++) {
      t.calls[i].respond(500)
      await settle()
      const s = t.status()
      expect(s).toMatchObject({ kind: 'retrying', attempt: i + 1 })
      expect(s.kind === 'retrying' && Date.parse(s.nextTryAt) - Date.now()).toBe(delays[i])
      await tick(delays[i] - 1)
      expect(t.calls).toHaveLength(i + 1)
      await tick(1)
      expect(t.calls).toHaveLength(i + 2)
    }
  })

  it('treats already-saved as success', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    t.calls[0].fail()
    await tick(1000)
    t.calls[1].respond(200, ok(4, { status: 'already-saved' }))
    await settle()
    expect(t.status()).toEqual({ kind: 'saved', at: ok(4).updatedAt })
    expect(t.saver.getBaseVersion()).toBe(4)
    expect(await t.draft()).toBeNull()
  })

  it('takes the version of an older landed save as the base, so the next save meets the newer one', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    t.saver.noteEdit(canvasN(2)) // waits for the next save
    t.calls[0].fail() // the reply is lost, but the save landed as version 4
    await tick(1000)
    expect(t.calls[1].body.saveId).toBe(t.calls[0].body.saveId)
    // Someone saved version 5 since; the server answers with the version this save made.
    t.calls[1].respond(200, ok(4, { status: 'already-saved' }))
    await settle()
    expect(t.saver.getBaseVersion()).toBe(4)
    expect(t.calls).toHaveLength(3)
    expect(t.calls[2].body).toMatchObject({ baseVersion: 4, canvas: canvasN(2) })
    t.calls[2].respond(409, {
      error: 'conflict',
      version: 5,
      updatedAt: '2026-11-09T12:00:05.000Z',
      editedBy: 'Aiden',
      lastSaveId: 'eeeeeeee-1111-4111-8111-111111111111',
      recentSaveIds: ['eeeeeeee-1111-4111-8111-111111111111', t.calls[0].body.saveId],
    })
    await settle()
    expect(t.status()).toMatchObject({ kind: 'conflict', server: { version: 5 } })
    expect(t.saver.hasUnsavedChanges()).toBe(true)
  })

  it('retries at once when the browser comes back online', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    t.calls[0].fail()
    await settle()
    t.win.dispatchEvent(new Event('online'))
    await settle()
    expect(t.calls).toHaveLength(2)
    expect(t.calls[1].body.saveId).toBe(t.calls[0].body.saveId)
  })

  it('retries at once when the page becomes visible', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    t.calls[0].respond(502)
    await settle()
    t.doc.visibilityState = 'hidden'
    t.doc.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(t.calls).toHaveLength(1)
    t.doc.visibilityState = 'visible'
    t.doc.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(t.calls).toHaveLength(2)
    expect(t.calls[1].body.saveId).toBe(t.calls[0].body.saveId)
  })

  it('drops a request that hangs and retries it', async () => {
    const t = setup({ requestTimeoutMs: 10_000 })
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    await tick(10_000)
    expect(t.status()).toMatchObject({ kind: 'retrying', attempt: 1, reason: 'The server took too long to answer.' })
    await tick(1000)
    expect(t.calls).toHaveLength(2)
    expect(t.calls[1].body).toEqual(t.calls[0].body)
  })

  it('retries a 200 reply it cannot read', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    t.calls[0].respond(200, { hello: 'there' })
    await settle()
    expect(t.status()).toMatchObject({ kind: 'retrying', attempt: 1 })
  })
})

describe('offline', () => {
  it('waits while offline and sends as soon as the browser is back online', async () => {
    const t = setup()
    t.setOnline(false)
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    expect(t.calls).toHaveLength(0)
    expect(t.status()).toEqual({ kind: 'offline', storedLocally: true })
    t.saver.noteEdit(canvasN(2))
    await tick(1000)
    expect(t.status()).toEqual({ kind: 'offline', storedLocally: true })
    expect((await t.draft())!.canvas).toEqual(canvasN(2))

    t.setOnline(true)
    t.win.dispatchEvent(new Event('online'))
    await settle()
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0].body.canvas).toEqual(canvasN(2))
  })

  it('shows offline when a request fails with the network gone', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    t.setOnline(false)
    t.calls[0].fail()
    await settle()
    expect(t.status()).toEqual({ kind: 'offline', storedLocally: true })
    t.setOnline(true)
    t.win.dispatchEvent(new Event('online'))
    await settle()
    expect(t.calls).toHaveLength(2)
    expect(t.calls[1].body.saveId).toBe(t.calls[0].body.saveId)
  })
})

describe('when this device will not store the draft', () => {
  function flaky() {
    let works = false
    const store = createDraftStore({ dbName: `saver-flaky-${++dbCounter}` })
    const drafts: DraftStore = {
      ...store,
      putDraft: async (d) => (works ? store.putDraft(d) : false),
    }
    return { drafts, fix: () => (works = true) }
  }

  it('says so on the offline status, and again once a write works', async () => {
    const f = flaky()
    const t = setup({ drafts: f.drafts })
    t.setOnline(false)
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    expect(t.status()).toEqual({ kind: 'offline', storedLocally: false })
    expect(t.saver.isStoredLocally()).toBe(false)
    f.fix()
    t.saver.noteEdit(canvasN(2))
    await settle()
    expect(t.status()).toEqual({ kind: 'offline', storedLocally: true })
    expect(t.saver.isStoredLocally()).toBe(true)
  })

  it('says so on the retrying status', async () => {
    const f = flaky()
    const t = setup({ drafts: f.drafts })
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    t.calls[0].respond(503)
    await settle()
    expect(t.status()).toMatchObject({ kind: 'retrying', attempt: 1, storedLocally: false })
  })

  it('counts a write that throws as not stored', async () => {
    const t = setup({
      drafts: {
        putDraft: async () => {
          throw new Error('broken store')
        },
        getDraft: async () => null,
        listDrafts: async () => [],
        deleteDraft: async () => true,
      },
    })
    t.setOnline(false)
    t.saver.noteEdit(canvasN(1))
    await t.saver.whenStored()
    await tick(1000)
    expect(t.status()).toEqual({ kind: 'offline', storedLocally: false })
  })
})

describe('replies that stop saving', () => {
  it('409 shows the conflict and sends nothing more until resetTo', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    t.calls[0].respond(409, {
      error: 'conflict',
      version: 6,
      updatedAt: '2026-11-09T11:42:00.000Z',
      editedBy: 'Aiden',
      lastSaveId: '9d9d9d9d-1111-4111-8111-111111111111',
      recentSaveIds: ['9d9d9d9d-1111-4111-8111-111111111111'],
    })
    await settle()
    expect(t.status()).toEqual({
      kind: 'conflict',
      server: {
        version: 6,
        updatedAt: '2026-11-09T11:42:00.000Z',
        editedBy: 'Aiden',
        lastSaveId: '9d9d9d9d-1111-4111-8111-111111111111',
        recentSaveIds: ['9d9d9d9d-1111-4111-8111-111111111111'],
      },
    })
    t.saver.noteEdit(canvasN(2))
    t.win.dispatchEvent(new Event('online'))
    await t.saver.flush()
    await tick(60_000)
    expect(t.calls).toHaveLength(1)
    expect(t.saver.hasUnsavedChanges()).toBe(true)
    expect((await t.draft())!.canvas).toEqual(canvasN(2))

    await t.saver.resetTo(6)
    await settle()
    expect(t.status().kind).toBe('saved')
    expect(t.saver.hasUnsavedChanges()).toBe(false)
    expect(await t.draft()).toBeNull()

    t.saver.noteEdit(canvasN(3))
    await tick(1000)
    expect(t.calls).toHaveLength(2)
    expect(t.calls[1].body).toMatchObject({ baseVersion: 6, canvas: canvasN(3) })
  })

  it.each([
    [422, 'invalid'],
    [410, 'gone'],
    [400, 'invalid'],
  ] as const)('%i stops retrying (%s)', async (code, reason) => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    t.calls[0].respond(code, { error: reason })
    await settle()
    expect(t.status()).toMatchObject({ kind: 'failed', reason })
    t.saver.noteEdit(canvasN(2))
    t.win.dispatchEvent(new Event('online'))
    await tick(120_000)
    expect(t.calls).toHaveLength(1)
    expect(t.saver.hasUnsavedChanges()).toBe(true)
  })

  it('401 asks to sign in again, keeps the draft, and tries again when the page is shown', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    t.calls[0].respond(401, { error: 'unauthorized' })
    await settle()
    const s = t.status()
    expect(s).toMatchObject({ kind: 'failed', reason: 'signed-out' })
    expect(s.kind === 'failed' && s.message).toMatch(/Sign in again/)
    await tick(120_000)
    expect(t.calls).toHaveLength(1)
    expect(await t.draft()).toMatchObject({ dirty: true, canvas: canvasN(1) })

    t.doc.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(t.calls).toHaveLength(2)
    expect(t.calls[1].body.saveId).toBe(t.calls[0].body.saveId)
    t.calls[1].respond(200, ok(4))
    await settle()
    expect(t.status().kind).toBe('saved')
  })
})

describe('dropped seats', () => {
  it('passes seats the server emptied to the editor', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    const dropped: DroppedSeat[] = [{ itemId: 't1', seatIndex: 2, guestId: GUEST, reason: 'removed-guest' }]
    t.calls[0].respond(200, ok(4, { droppedSeats: dropped }))
    await settle()
    expect(t.dropped).toEqual([dropped])
    expect(t.status().kind).toBe('saved')
  })
})

describe('flush', () => {
  it('sends now and resolves once the attempt settles', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    let done = false
    const flushing = t.saver.flush().then(() => {
      done = true
    })
    await settle()
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0].init.keepalive).toBe(false)
    expect(done).toBe(false)
    t.calls[0].respond(200, ok(4))
    await flushing
    expect(t.status().kind).toBe('saved')
  })

  it('uses keepalive for a small body', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    void t.saver.flush({ keepalive: true })
    await settle()
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0].init.keepalive).toBe(true)
  })

  it('sends a body of 60,000 bytes or more without keepalive', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1, 'x'.repeat(200)))
    const big: Canvas = {
      schemaVersion: 1,
      items: Array.from({ length: 400 }, (_, i) => ({
        ...canvasN(i, 'y'.repeat(150)).items[0],
        id: `f${i}`,
      })),
    }
    expect(JSON.stringify(big).length).toBeGreaterThan(KEEPALIVE_LIMIT_BYTES)
    t.saver.noteEdit(big)
    void t.saver.flush({ keepalive: true })
    await settle()
    expect(t.calls).toHaveLength(1)
    expect(t.calls[0].init.keepalive).toBe(false)
  })

  it('does nothing extra on page hide while a save is out', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    t.saver.noteEdit(canvasN(2))
    await t.saver.flush({ keepalive: true })
    await settle()
    expect(t.calls).toHaveLength(1)
    expect((await t.draft())!.canvas).toEqual(canvasN(2))
  })

  it('skips the retry wait', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    t.calls[0].fail()
    await settle()
    void t.saver.flush()
    await settle()
    expect(t.calls).toHaveLength(2)
    expect(t.calls[1].body).toEqual(t.calls[0].body)
  })
})

describe('lifecycle', () => {
  it('tells subscribers about edits and status changes', async () => {
    const t = setup()
    const seen: boolean[] = []
    const unsubscribe = t.saver.subscribe(() => seen.push(t.saver.hasUnsavedChanges()))
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    t.calls[0].respond(200, ok(4))
    await settle()
    expect(seen[0]).toBe(true)
    expect(seen.at(-1)).toBe(false)
    unsubscribe()
    const count = seen.length
    t.saver.noteEdit(canvasN(2))
    expect(seen).toHaveLength(count)
  })

  it('reports each status once', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    t.saver.noteEdit(canvasN(2))
    await tick(1000)
    t.calls[0].respond(200, ok(4))
    await settle()
    expect(t.statuses).toEqual([{ kind: 'saving' }, { kind: 'saved', at: ok(4).updatedAt }])
  })

  it('dispose stops timers and leaves the dirty draft', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await settle()
    t.saver.dispose()
    await tick(10_000)
    t.win.dispatchEvent(new Event('online'))
    await settle()
    expect(t.calls).toHaveLength(0)
    expect(await t.draft()).toMatchObject({ dirty: true, canvas: canvasN(1) })
  })

  it('ignores the reply to a request that was out when disposed', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    t.saver.dispose()
    t.calls[0].respond(200, ok(4))
    await settle()
    expect(t.statuses.at(-1)).toEqual({ kind: 'saving' })
    // The draft still names the save, so the next load can tell it landed.
    expect((await t.draft())!.inFlight!.saveId).toBe(t.calls[0].body.saveId)
  })

  it('resetTo drops a request still out and starts from the given version', async () => {
    const t = setup()
    t.saver.noteEdit(canvasN(1))
    await tick(1000)
    await t.saver.resetTo(9)
    await settle()
    expect(t.saver.getBaseVersion()).toBe(9)
    expect(t.status().kind).toBe('saved')
    t.saver.noteEdit(canvasN(2))
    await tick(1000)
    expect(t.calls).toHaveLength(2)
    expect(t.calls[1].body.baseVersion).toBe(9)
  })
})
