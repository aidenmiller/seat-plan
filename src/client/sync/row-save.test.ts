import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRowSaver,
  createRowStore,
  rowDbName,
  isRetryableStatus,
  mergePatches,
  ROW_LOCK_PREFIX,
  ROW_STATUS_TEXT,
  type RowSaveEvent,
  type RowStore,
  type StoredRow,
} from './row-save'
import type { LockManagerLike } from './tab-lock'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const G = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

type Call = { path: string; method: string; body: unknown; keepalive: boolean }

/** A fetch that answers from a script, one reply per call, and records what was sent. */
function fakeFetch(replies: (number | 'network' | 'hang')[] = []) {
  const calls: Call[] = []
  const queue = [...replies]
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ path: String(input), method: init?.method ?? 'GET', body, keepalive: init?.keepalive === true })
    const next = queue.shift() ?? 200
    if (next === 'network') throw new TypeError('Failed to fetch')
    if (next === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    }
    const reply = next >= 400 ? { error: next === 409 ? 'conflict' : 'invalid', message: next === 409 ? 'Someone else just changed this partner link.' : undefined } : { ok: true, echo: body }
    return new Response(JSON.stringify(reply), { status: next, headers: { 'content-type': 'application/json' } })
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

function memoryStore(initial: StoredRow[] = []): RowStore & { rows: Map<string, StoredRow> } {
  const rows = new Map<string, StoredRow>(initial.map((r) => [`${r.queueId}|${r.kind}|${r.id}`, r]))
  return {
    rows,
    async put(row) {
      rows.set(`${row.queueId}|${row.kind}|${row.id}`, row)
      return true
    },
    async remove(queueId, kind, id) {
      rows.delete(`${queueId}|${kind}|${id}`)
      return true
    },
    async list() {
      return [...rows.values()]
    },
  }
}

function fakeLocks(heldByOthers: string[] = []): LockManagerLike & { mine: string[] } {
  const mine: string[] = []
  return {
    mine,
    async request(name, _options, callback) {
      if (heldByOthers.includes(name)) return callback(null)
      mine.push(name)
      void callback({ name })
      return undefined
    },
    async query() {
      return { held: [...heldByOthers, ...mine].map((name) => ({ name })) }
    },
  }
}

function saverWith(over: Partial<Parameters<typeof createRowSaver>[0]> = {}) {
  const net = fakeFetch()
  const events: RowSaveEvent[] = []
  const saver = createRowSaver({
    fetch: net.fn,
    store: null,
    locks: null,
    queueId: 'q1',
    windowTarget: null,
    random: () => 0.5,
    ...over,
  })
  saver.onEvent((e) => events.push(e))
  return { saver, events, net }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('merging edits', () => {
  it('lets later fields win', () => {
    expect(mergePatches({ firstName: 'Ann', meal: 'Fish' }, { meal: 'Beef', rsvp: 'yes' })).toEqual({
      firstName: 'Ann',
      meal: 'Beef',
      rsvp: 'yes',
    })
  })

  it('keeps the earlier expected partner of each guest, which is what the server still holds', () => {
    // Link A to B, then (before it is sent) A to C instead.
    const first = { partnerId: B, expectedPartners: { [A]: null, [B]: null } }
    const second = { partnerId: C, expectedPartners: { [A]: B, [C]: null } }
    expect(mergePatches(first, second)).toEqual({ partnerId: C, expectedPartners: { [A]: null, [B]: null, [C]: null } })
  })

  it('stops for good on 401 stale_page (someone else signed in): keeps the edits stored, sends nothing more', async () => {
    const store = memoryStore()
    const net = fakeFetch()
    const replies: Response[] = [Response.json({ error: 'stale_page' }, { status: 401 })]
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = replies.shift()
      if (next) {
        net.calls.push({ path: String(input), method: init?.method ?? 'GET', body: JSON.parse(String(init?.body)), keepalive: false })
        return next
      }
      return net.fn(input, init)
    }) as unknown as typeof fetch
    const win = new EventTarget()
    const { saver, events } = saverWith({ store, fetch: fetchFn, windowTarget: win })
    saver.queue('guest', A, { meal: 'Fish' })
    await vi.advanceTimersByTimeAsync(300)
    expect(net.calls).toHaveLength(1)
    expect(saver.getStatus()).toMatchObject({ kind: 'other-user' })
    expect(saver.hasUnsavedChanges()).toBe(true)
    expect(saver.pendingFor('guest', A)).toEqual({ meal: 'Fish' })
    expect(events).toEqual([])
    // Nothing brings it back: time, the browser online again, a flush, more edits.
    saver.queue('guest', A, { rsvp: 'yes' })
    win.dispatchEvent(new Event('online'))
    await saver.flush()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(net.calls).toHaveLength(1)
    // Both edits stay stored for this user, for when they sign in again.
    await saver.whenStored()
    expect([...store.rows.values()].map((r) => r.patch)).toEqual([{ meal: 'Fish', rsvp: 'yes' }])
  })

  it('resume() after stale_page (the same person signed in again) sends the kept edits and clears them', async () => {
    const store = memoryStore()
    const replies = [Response.json({ error: 'stale_page' }, { status: 401 })]
    const sent: unknown[] = []
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)))
      return replies.shift() ?? Response.json({ ok: true })
    }) as unknown as typeof fetch
    const { saver, events } = saverWith({ store, fetch: fetchFn })
    saver.queue('guest', A, { meal: 'Fish' })
    await vi.advanceTimersByTimeAsync(300)
    saver.queue('guest', A, { rsvp: 'yes' })
    expect(saver.getStatus()).toMatchObject({ kind: 'other-user' })

    saver.resume()
    await vi.advanceTimersByTimeAsync(0)
    await saver.flush()
    expect(sent).toEqual([{ meal: 'Fish' }, { meal: 'Fish', rsvp: 'yes' }])
    expect(saver.getStatus()).toEqual({ kind: 'saved' })
    expect(saver.hasUnsavedChanges()).toBe(false)
    expect(events.map((e) => e.type)).toEqual(['saved'])
    await saver.whenStored()
    expect([...store.rows.values()]).toEqual([])
  })

  it('resume() does nothing to a queue that was not stopped', async () => {
    const { saver, net } = saverWith()
    saver.resume()
    await vi.advanceTimersByTimeAsync(1000)
    expect(net.calls).toHaveLength(0)
    expect(saver.getStatus()).toEqual({ kind: 'saved' })
  })

  it('keeps retrying a plain 401 (the session ran out), so the edits go once the same person signs in again', async () => {
    const replies = [401, 200]
    const calls: number[] = []
    const fetchFn = vi.fn(async () => {
      const status = replies.shift() ?? 200
      calls.push(status)
      return Response.json(status === 401 ? { error: 'unauthorized' } : { ok: true }, { status })
    }) as unknown as typeof fetch
    const { saver } = saverWith({ fetch: fetchFn })
    saver.queue('guest', A, { meal: 'Fish' })
    await vi.advanceTimersByTimeAsync(300)
    expect(saver.getStatus()).toMatchObject({ kind: 'retrying', reason: 'You were signed out. Reload the page to sign in again.' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toEqual([401, 200])
    expect(saver.getStatus()).toEqual({ kind: 'saved' })
  })

  it('knows which replies are worth trying again', () => {
    for (const s of [0, 401, 408, 429, 500, 503]) expect(isRetryableStatus(s)).toBe(true)
    for (const s of [400, 404, 409, 410, 413, 422]) expect(isRetryableStatus(s)).toBe(false)
  })

  it('has the header words', () => {
    expect(ROW_STATUS_TEXT).toEqual({
      saved: 'Saved',
      saving: 'Saving…',
      retrying: 'Not saved, retrying',
      'other-user': 'Not saved: someone else signed in',
    })
  })
})

describe('the row saver', () => {
  it('sends only the changed fields, merging consecutive edits to one row into one PATCH', async () => {
    const { saver, net, events } = saverWith()
    saver.queue('guest', A, { firstName: 'Ann' })
    saver.queue('guest', A, { meal: 'Fish' })
    saver.queue('guest', A, { meal: 'Beef' })
    expect(saver.getStatus()).toEqual({ kind: 'saving' })
    expect(saver.pendingFor('guest', A)).toEqual({ firstName: 'Ann', meal: 'Beef' })
    await vi.advanceTimersByTimeAsync(300)
    expect(net.calls).toEqual([{ path: `/api/guests/${A}`, method: 'PATCH', body: { firstName: 'Ann', meal: 'Beef' }, keepalive: false }])
    expect(saver.getStatus()).toEqual({ kind: 'saved' })
    expect(saver.hasUnsavedChanges()).toBe(false)
    expect(events).toEqual([
      { type: 'saved', kind: 'guest', id: A, patch: { firstName: 'Ann', meal: 'Beef' }, reply: { ok: true, echo: { firstName: 'Ann', meal: 'Beef' } } },
    ])
  })

  it('sends one row at a time, in the order the rows were first edited, groups too', async () => {
    const { saver, net } = saverWith()
    saver.queue('guest', B, { rsvp: 'yes' })
    saver.queue('group', G, { name: 'Book Club' })
    saver.queue('guest', A, { side: 'Noa' })
    saver.queue('guest', B, { meal: 'Fish' })
    await vi.advanceTimersByTimeAsync(300)
    expect(net.calls.map((c) => [c.path, c.body])).toEqual([
      [`/api/guests/${B}`, { rsvp: 'yes', meal: 'Fish' }],
      [`/api/groups/${G}`, { name: 'Book Club' }],
      [`/api/guests/${A}`, { side: 'Noa' }],
    ])
  })

  it('holds edits made while the row is out, and sends them after as one', async () => {
    let release: (r: Response) => void = () => undefined
    const calls: unknown[] = []
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)))
      if (calls.length === 1) return new Promise<Response>((resolve) => (release = resolve))
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const { saver } = saverWith({ fetch: fetchFn })
    saver.queue('guest', A, { firstName: 'Ann' })
    await vi.advanceTimersByTimeAsync(300)
    saver.queue('guest', A, { lastName: 'Lee' })
    saver.queue('guest', A, { nickname: 'Annie' })
    // What is out, then what waits.
    expect(saver.pendingFor('guest', A)).toEqual({ firstName: 'Ann', lastName: 'Lee', nickname: 'Annie' })
    expect(calls).toHaveLength(1)
    release(new Response('{}', { status: 200 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual([{ firstName: 'Ann' }, { lastName: 'Lee', nickname: 'Annie' }])
    await vi.advanceTimersByTimeAsync(300)
    expect(saver.getStatus().kind).toBe('saved')
  })

  it('retries with backoff when the server cannot be reached, then shows Saved', async () => {
    const net = fakeFetch(['network', 503, 200])
    const statuses: string[] = []
    const heard: string[] = []
    const { saver } = saverWith({ fetch: net.fn, onStatus: (s) => heard.push(ROW_STATUS_TEXT[s.kind]) })
    saver.subscribe(() => statuses.push(saver.getStatus().kind))
    saver.queue('guest', A, { meal: 'Fish' })
    await vi.advanceTimersByTimeAsync(300)
    expect(saver.getStatus()).toMatchObject({ kind: 'retrying', attempt: 1, reason: 'Could not reach the server.' })
    // An edit during the backoff waits for the retry and joins it.
    saver.queue('guest', A, { rsvp: 'yes' })
    await vi.advanceTimersByTimeAsync(999)
    expect(net.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(net.calls).toHaveLength(2)
    expect(saver.getStatus()).toMatchObject({ kind: 'retrying', attempt: 2, reason: 'The server had a problem.' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(net.calls.map((c) => c.body)).toEqual([{ meal: 'Fish' }, { meal: 'Fish', rsvp: 'yes' }, { meal: 'Fish', rsvp: 'yes' }])
    expect(saver.getStatus()).toEqual({ kind: 'saved' })
    // "Not saved, retrying" stays up while a retry is out, with no flash of "Saving…".
    expect(statuses.filter((s, i) => s !== statuses[i - 1])).toEqual(['saving', 'retrying', 'saved'])
    // onStatus hears each new status once, in the header's words (the attempt number changes on the second failure).
    expect(heard).toEqual(['Saving…', 'Not saved, retrying', 'Not saved, retrying', 'Saved'])
  })

  it('retries a request that never answers', async () => {
    const net = fakeFetch(['hang', 200])
    const { saver } = saverWith({ fetch: net.fn, requestTimeoutMs: 5000 })
    saver.queue('guest', A, { meal: 'Fish' })
    await vi.advanceTimersByTimeAsync(300 + 5000)
    expect(saver.getStatus().kind).toBe('retrying')
    await vi.advanceTimersByTimeAsync(1000)
    expect(net.calls).toHaveLength(2)
    expect(saver.getStatus().kind).toBe('saved')
  })

  it('tries again at once when the browser comes back online', async () => {
    const win = new EventTarget()
    const net = fakeFetch(['network', 200])
    const { saver } = saverWith({ fetch: net.fn, windowTarget: win, isOnline: () => false })
    saver.queue('guest', A, { meal: 'Fish' })
    await vi.advanceTimersByTimeAsync(300)
    expect(saver.getStatus()).toMatchObject({ kind: 'retrying', reason: 'You are offline. Your changes are kept on this device.' })
    win.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(net.calls).toHaveLength(2)
    expect(saver.getStatus().kind).toBe('saved')
  })

  it('drops a refused edit and the newer edits of that row, reports why, and carries on with other rows', async () => {
    const net = fakeFetch([409, 200])
    const { saver, events } = saverWith({ fetch: net.fn })
    saver.queue('guest', A, { partnerId: B, expectedPartners: { [A]: null, [B]: null } })
    saver.queue('guest', C, { meal: 'Fish' })
    await vi.advanceTimersByTimeAsync(300)
    expect(events[0]).toMatchObject({
      type: 'rejected',
      kind: 'guest',
      id: A,
      status: 409,
      message: 'Someone else just changed this partner link.',
    })
    expect(events[1]).toMatchObject({ type: 'saved', id: C })
    expect(saver.pendingFor('guest', A)).toBeNull()
    expect(saver.getStatus().kind).toBe('saved')
  })

  it('says plainly when the row is gone or the change was refused', async () => {
    const replies = [404, 422]
    const fetchFn = vi.fn(async () => {
      const s = replies.shift()!
      const body = s === 422 ? { error: 'invalid', issues: ['firstName: Names cannot be empty'] } : { error: 'not_found' }
      return new Response(JSON.stringify(body), { status: s })
    }) as unknown as typeof fetch
    const { saver, events } = saverWith({ fetch: fetchFn })
    saver.queue('group', G, { name: 'Gone' })
    saver.queue('guest', A, { firstName: ' ' })
    await vi.advanceTimersByTimeAsync(300)
    expect(events.map((e) => (e.type === 'rejected' ? e.message : ''))).toEqual([
      'This group was deleted.',
      'Names cannot be empty.',
    ])
  })

  it('flush sends at once, skipping the wait, with keepalive when the page is going away', async () => {
    const { saver, net } = saverWith()
    saver.queue('guest', A, { meal: 'Fish' })
    saver.queue('guest', B, { meal: 'Beef' })
    await saver.flush({ keepalive: true })
    expect(net.calls.map((c) => [c.body, c.keepalive])).toEqual([
      [{ meal: 'Fish' }, true],
      [{ meal: 'Beef' }, true],
    ])
    expect(saver.hasUnsavedChanges()).toBe(false)
  })

  it('ignores empty edits and stops after dispose', async () => {
    const { saver, net } = saverWith()
    saver.queue('guest', A, {})
    expect(saver.hasUnsavedChanges()).toBe(false)
    saver.queue('guest', A, { meal: 'Fish' })
    saver.dispose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(net.calls).toHaveLength(0)
  })
})

describe('keeping the queue on this device', () => {
  it('stores each row with its waiting fields, and forgets it once saved', async () => {
    const store = memoryStore()
    const { saver } = saverWith({ store })
    saver.queue('guest', A, { meal: 'Fish' })
    saver.queue('guest', A, { rsvp: 'yes' })
    await vi.advanceTimersByTimeAsync(0)
    expect([...store.rows.values()]).toEqual([
      expect.objectContaining({ queueId: 'q1', kind: 'guest', id: A, patch: { meal: 'Fish', rsvp: 'yes' } }),
    ])
    await vi.advanceTimersByTimeAsync(300)
    expect(store.rows.size).toBe(0)
  })

  it('keeps a row stored while its retries fail', async () => {
    const store = memoryStore()
    const { saver } = saverWith({ store, fetch: fakeFetch(['network']).fn })
    saver.queue('guest', A, { meal: 'Fish' })
    await vi.advanceTimersByTimeAsync(300)
    expect(saver.getStatus().kind).toBe('retrying')
    expect(store.rows.size).toBe(1)
  })

  it('on start, sends what this page left and what closed tabs left, but not what open tabs hold', async () => {
    const store = memoryStore([
      { queueId: 'q1', kind: 'guest', id: A, patch: { meal: 'Fish', rsvp: 'no' }, queuedAt: '2026-11-09T10:00:00.000Z' },
      { queueId: 'closed', kind: 'group', id: G, patch: { color: '#2563EB' }, queuedAt: '2026-11-09T09:00:00.000Z' },
      { queueId: 'open', kind: 'guest', id: B, patch: { meal: 'Beef' }, queuedAt: '2026-11-09T08:00:00.000Z' },
    ])
    const locks = fakeLocks([`${ROW_LOCK_PREFIX}open`])
    const { saver, net } = saverWith({ store, locks })
    const started = saver.start()
    // Edits made while start() reads the store are newer than the stored ones.
    saver.queue('guest', A, { rsvp: 'yes' })
    await started
    expect(locks.mine).toEqual([`${ROW_LOCK_PREFIX}q1`])
    expect(saver.pendingFor('guest', A)).toEqual({ meal: 'Fish', rsvp: 'yes' })
    await vi.advanceTimersByTimeAsync(300)
    expect(net.calls.map((c) => [c.path, c.body])).toEqual([
      [`/api/groups/${G}`, { color: '#2563EB' }],
      [`/api/guests/${A}`, { meal: 'Fish', rsvp: 'yes' }],
    ])
    expect([...store.rows.values()].map((r) => r.queueId)).toEqual(['open'])
  })

  it('without Web Locks, takes over only its own stored edits', async () => {
    const store = memoryStore([
      { queueId: 'q1', kind: 'guest', id: A, patch: { meal: 'Fish' }, queuedAt: '2026-11-09T10:00:00.000Z' },
      { queueId: 'other', kind: 'guest', id: B, patch: { meal: 'Beef' }, queuedAt: '2026-11-09T09:00:00.000Z' },
    ])
    const { saver, net } = saverWith({ store, locks: null })
    await saver.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(net.calls.map((c) => c.path)).toEqual([`/api/guests/${A}`])
  })

  it('takes a fresh queue id when another open page holds this one (a duplicated tab)', async () => {
    const store = memoryStore([
      { queueId: 'q1', kind: 'guest', id: A, patch: { meal: 'Fish' }, queuedAt: '2026-11-09T10:00:00.000Z' },
    ])
    const locks = fakeLocks([`${ROW_LOCK_PREFIX}q1`])
    const { saver, net } = saverWith({ store, locks, newId: () => 'fresh' })
    await saver.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(locks.mine).toEqual([`${ROW_LOCK_PREFIX}fresh`])
    // The other page still holds q1, so its edits stay with it.
    expect(net.calls).toHaveLength(0)
  })

  it('stores rows in IndexedDB, stamped with the user, and reads them back', async () => {
    vi.useRealTimers()
    const store = createRowStore({ userId: 'user-1', dbName: `rows-test-${Math.random()}` })
    const row: StoredRow = { queueId: 'q1', kind: 'guest', id: A, patch: { meal: 'Fish' }, queuedAt: '2026-11-09T10:00:00.000Z' }
    expect(await store.put(row)).toBe(true)
    expect(await store.list()).toEqual([{ ...row, userId: 'user-1' }])
    expect(await store.remove('q1', 'guest', A)).toBe(true)
    expect(await store.list()).toEqual([])
  })

  it('keeps each user’s queue apart: a row of someone else is refused and never handed back', async () => {
    vi.useRealTimers()
    expect(rowDbName('user-1')).toBe('seat-plan-rows-u-user-1')
    const dbName = `rows-test-${Math.random()}`
    const mine = createRowStore({ userId: 'user-1', dbName })
    const theirs = createRowStore({ userId: 'user-2', dbName })
    const row: StoredRow = { queueId: 'q1', kind: 'guest', id: A, patch: { meal: 'Fish' }, queuedAt: '2026-11-09T10:00:00.000Z' }
    expect(await mine.put({ ...row, userId: 'user-2' })).toBe(false)
    expect(await theirs.put({ ...row, id: B })).toBe(true)
    expect(await mine.put(row)).toBe(true)
    expect((await mine.list()).map((r) => r.id)).toEqual([A])
    expect((await theirs.list()).map((r) => r.id)).toEqual([B])
  })
})
