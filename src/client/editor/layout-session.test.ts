import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '@/client/api'
import { createLayoutSaver } from '@/client/sync/layout-saver'
import type { DraftSnapshot, DraftStore, LayoutSaver, LayoutSaverOptions, SaveStatus } from '@/client/sync/types'
import type { WatchRemoteVersionOptions } from '@/client/sync/remote-version'
import type { LiveSaver } from '@/client/sync/saver-registry'
import { emptyCanvas, type Canvas } from '@/domain/canvas-schema'
import { addRoundTable } from '@/domain/round-table'
import type { LayoutDetail, SaveLayoutOk } from '@/shared/api'
import { moveItems } from './commands'
import { createDocStore } from './doc-store'
import { openLayoutSession, type ConflictInfo, type LayoutSessionDeps } from './layout-session'
import { createEditorDoc } from './state/editor-doc'

const LAYOUT_ID = '33333333-3333-4333-8333-333333333333'
const WEDDING_ID = '44444444-4444-4444-8444-444444444444'
/** The signed-in user the page was opened for. */
const ME = { id: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', displayName: 'Noa' }

function detail(overrides: Partial<LayoutDetail> = {}): LayoutDetail {
  return {
    id: LAYOUT_ID,
    weddingId: WEDDING_ID,
    name: 'Reception plan',
    kind: 'reception',
    venueTemplateId: null,
    venueName: null,
    venueDeleted: false,
    version: 3,
    editedBy: 'Noa',
    editedById: null,
    updatedAt: '2026-11-09T15:42:00.000Z',
    thumbSvg: '<svg/>',
    canvas: emptyCanvas(),
    lastSaveId: null,
    recentSaveIds: [],
    template: null,
    ...overrides,
  }
}

function draft(overrides: Partial<DraftSnapshot>): DraftSnapshot {
  return {
    layoutId: LAYOUT_ID,
    tabId: 'closed-tab',
    baseVersion: 3,
    canvas: addRoundTable(emptyCanvas(), 'from-draft'),
    userId: ME.id,
    inFlight: null,
    dirty: true,
    updatedAt: '2026-11-09T15:00:00.000Z',
    ...overrides,
  }
}

function memoryDrafts(initial: DraftSnapshot[] = []): DraftStore & { all(): DraftSnapshot[] } {
  const map = new Map(initial.map((d) => [`${d.layoutId}:${d.tabId}`, d]))
  return {
    all: () => [...map.values()],
    putDraft: async (d) => {
      map.set(`${d.layoutId}:${d.tabId}`, d)
      return true
    },
    getDraft: async (layoutId, tabId) => map.get(`${layoutId}:${tabId}`) ?? null,
    listDrafts: async (layoutId) => [...map.values()].filter((d) => d.layoutId === layoutId),
    deleteDraft: async (layoutId, tabId) => map.delete(`${layoutId}:${tabId}`),
  }
}

type FakeSaver = LayoutSaver & {
  options: LayoutSaverOptions
  edits: Canvas[]
  dirty: boolean
  setStatus(status: SaveStatus): void
}

function fakeSaver(options: LayoutSaverOptions): FakeSaver {
  let status: SaveStatus = { kind: 'saved', at: '2026-11-09T15:42:00.000Z' }
  let base = options.baseVersion
  const listeners = new Set<() => void>()
  const notify = () => [...listeners].forEach((l) => l())
  const saver: FakeSaver = {
    options,
    edits: [],
    dirty: false,
    setStatus(next) {
      status = next
      if (next.kind === 'saved') saver.dirty = false
      options.onStatus(next)
      notify()
    },
    noteEdit(canvas) {
      saver.edits.push(canvas)
      saver.dirty = true
      if (status.kind === 'saved') status = { kind: 'saving' }
      notify()
    },
    flush: vi.fn(async () => undefined),
    hasUnsavedChanges: () => saver.dirty,
    resetTo: vi.fn(async (version: number) => {
      base = version
      saver.dirty = false
      status = { kind: 'saved', at: 'now' }
      notify()
    }),
    dispose: vi.fn(() => listeners.clear()),
    getStatus: () => status,
    getBaseVersion: () => base,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    whenStored: vi.fn(async () => undefined),
    isStoredLocally: () => true,
  }
  return saver
}

/** A fetch whose replies the test hands out one by one. */
function fakeFetch() {
  const calls: { body: { baseVersion: number; saveId: string; canvas: Canvas }; respond(status: number, data: unknown): void }[] = []
  const fn = vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        calls.push({
          body: JSON.parse(String(init?.body)),
          respond: (status, data) => resolve(Response.json(data, { status })),
        })
      }),
  )
  return { fn: fn as unknown as typeof fetch, calls }
}

const saved = (version: number, status: SaveLayoutOk['status'] = 'saved'): SaveLayoutOk => ({
  status,
  version,
  updatedAt: '2026-11-09T15:50:00.000Z',
  editedBy: 'Noa',
  editedById: null,
  droppedSeats: [],
})

function setup(
  opts: {
    page?: LayoutDetail
    server?: LayoutDetail
    drafts?: DraftSnapshot[]
    /** Use the real save engine with this fetch (and the memory drafts), instead of the fake. */
    realFetch?: typeof fetch
    newIds?: string[]
  } = {},
) {
  const page = opts.page ?? detail()
  let server = opts.server ?? page
  const store = createDocStore(page.canvas)
  const drafts = memoryDrafts(opts.drafts)
  const savers: FakeSaver[] = []
  const realSavers: LayoutSaver[] = []
  const ids = [...(opts.newIds ?? [])]
  let watchOptions: WatchRemoteVersionOptions | null = null
  const events = {
    onSaver: vi.fn(),
    onStatus: vi.fn(),
    onConflict: vi.fn<(c: ConflictInfo | null) => void>(),
    onNotice: vi.fn(),
    onServerCopy: vi.fn(),
    onGone: vi.fn(),
  }
  const release = vi.fn()
  const deps: Partial<LayoutSessionDeps> = {
    claimTab: async () => ({ tabId: 'this-tab', release }),
    isTabAlive: async () => false,
    drafts,
    getLayout: vi.fn(async () => server),
    duplicateLayout: vi.fn(async (_id, body) => detail({ id: body.id!, name: body.name!, canvas: body.canvas! })),
    createSaver: (options) => {
      if (opts.realFetch) {
        const real = createLayoutSaver({
          ...options,
          fetch: opts.realFetch,
          drafts,
          debounceMs: 1,
          maxWaitMs: 1,
          draftWaitMs: 50,
          isOnline: () => true,
          windowTarget: null,
          documentTarget: null,
        })
        realSavers.push(real)
        return real
      }
      const s = fakeSaver(options)
      savers.push(s)
      return s
    },
    watchRemoteVersion: (options) => {
      watchOptions = options
      return { check: async () => undefined, stop: vi.fn() }
    },
    newId: () => ids.shift() ?? '55555555-5555-4555-8555-555555555555',
    waitForLegacyDrafts: async () => undefined,
    registerSaver: () => () => undefined,
  }
  const session = openLayoutSession({
    layout: page,
    store,
    user: ME,
    events,
    deps,
  })
  return {
    session,
    store,
    drafts,
    events,
    deps,
    release,
    saver: () => savers[0],
    realSaver: () => realSavers[0],
    watch: () => watchOptions!,
    setServer: (next: LayoutDetail) => {
      server = next
    },
  }
}

describe('opening a layout', () => {
  it('starts the save engine at the server version when no drafts are left over', async () => {
    const t = setup()
    await t.session.ready
    expect(t.saver().options.baseVersion).toBe(3)
    expect(t.saver().options.tabId).toBe('this-tab')
    expect(t.events.onSaver).toHaveBeenCalledWith(t.saver())
    expect(t.events.onConflict).not.toHaveBeenCalled()
    expect(t.store.getState().canUndo).toBe(false)
  })

  it('shows a newer server copy than the page had', async () => {
    const newer = detail({ version: 5, canvas: addRoundTable(emptyCanvas(), 'theirs') })
    const t = setup({ server: newer })
    await t.session.ready
    expect(t.store.getState().canvas).toEqual(newer.canvas)
    expect(t.saver().options.baseVersion).toBe(5)
  })

  it('applies a closed tab’s draft made on the current version and saves it', async () => {
    const left = draft({ baseVersion: 3 })
    const t = setup({ drafts: [left] })
    await t.session.ready
    await Promise.resolve()
    expect(t.store.getState().canvas).toEqual(left.canvas)
    expect(t.saver().edits).toEqual([left.canvas])
    // The closed tab's draft stays until the server has its edits.
    expect(t.drafts.all()).toEqual([left])
    t.saver().setStatus({ kind: 'saved', at: '2026-11-09T15:50:00.000Z' })
    await vi.waitFor(() => expect(t.drafts.all()).toHaveLength(0))
  })

  it('keeps a recovered draft when this device cannot store its own copy and the save has not landed', async () => {
    const left = draft({ baseVersion: 3 })
    const t = setup({ drafts: [left] })
    await t.session.ready
    // whenStored resolving (even after a failed write) is not enough.
    await t.saver().whenStored()
    t.saver().setStatus({ kind: 'offline', storedLocally: false })
    await Promise.resolve()
    expect(t.drafts.all()).toEqual([left])
  })

  it('drops drafts that hold nothing unsaved', async () => {
    const t = setup({ drafts: [draft({ dirty: false })] })
    await t.session.ready
    expect(t.drafts.all()).toHaveLength(0)
    expect(t.saver().edits).toHaveLength(0)
  })

  it('saves as the signed-in user, with their name in the "someone else signed in" words', async () => {
    const t = setup({ drafts: [draft({})] })
    await t.session.ready
    expect(t.events.onConflict).not.toHaveBeenCalledWith(expect.objectContaining({ source: 'recovery' }))
    expect(t.saver().options.userId).toBe(ME.id)
    expect(t.saver().options.messages?.otherUser).toMatch(/Sign in again as Noa/)
  })

  it('waits for drafts from before accounts to move in before it looks for drafts', async () => {
    const order: string[] = []
    const t = setup()
    await t.session.ready
    expect(order).toEqual([])
    let release!: () => void
    const moved = new Promise<void>((r) => {
      release = r
    })
    const drafts = {
      ...t.drafts,
      listDrafts: async (layoutId: string) => {
        order.push('list')
        return t.drafts.listDrafts(layoutId)
      },
    }
    const session = openLayoutSession({
      layout: detail(),
      store: createDocStore(emptyCanvas()),
      user: ME,
      events: t.events,
      deps: {
        ...t.deps,
        drafts,
        waitForLegacyDrafts: async () => {
          order.push('legacy')
          await moved
          order.push('legacy done')
        },
      },
    })
    await new Promise((r) => setTimeout(r, 5))
    expect(order).toEqual(['legacy'])
    release()
    await session.ready
    expect(order).toEqual(['legacy', 'legacy done', 'list'])
  })

  it('puts its saver where signing out can reach it, and takes it out on close', async () => {
    const registered: { hasUnsavedChanges(): boolean }[] = []
    const unregister = vi.fn()
    const t = setup()
    await t.session.ready
    const session = openLayoutSession({
      layout: detail(),
      store: createDocStore(emptyCanvas()),
      user: ME,
      events: t.events,
      deps: {
        ...t.deps,
        registerSaver: (s) => {
          registered.push(s)
          return unregister
        },
      },
    })
    await session.ready
    expect(registered).toHaveLength(1)
    session.close()
    expect(unregister).toHaveBeenCalledTimes(1)
  })

  it('its flush, as signing out calls it, ends only once storage no longer holds what was saved', async () => {
    // Signing out reads this user's storage right after the flush, and counts any draft left there as unsaved.
    const left = draft({ baseVersion: 3 })
    const drafts = memoryDrafts([left])
    const deleteNow = drafts.deleteDraft
    drafts.deleteDraft = (layoutId, tabId) => new Promise((resolve) => setTimeout(() => resolve(deleteNow(layoutId, tabId)), 30))
    const f = fakeFetch()
    let registered: LiveSaver | null = null
    const t = setup()
    await t.session.ready
    const session = openLayoutSession({
      layout: detail(),
      store: createDocStore(emptyCanvas()),
      user: ME,
      events: t.events,
      deps: {
        ...t.deps,
        drafts,
        createSaver: (options) =>
          createLayoutSaver({ ...options, fetch: f.fn, drafts, debounceMs: 1, maxWaitMs: 1, draftWaitMs: 50, isOnline: () => true, windowTarget: null, documentTarget: null }),
        registerSaver: (s) => {
          registered = s
          return () => undefined
        },
      },
    })
    await session.ready
    // The closed tab's draft is applied and sent.
    await vi.waitFor(() => expect(f.calls).toHaveLength(1))
    const flushing = registered!.flush()
    f.calls[0].respond(200, saved(4))
    await flushing
    // Neither this tab's draft nor the closed tab's is left to count.
    expect(drafts.all()).toEqual([])
    session.close()
  })

  it('reports a conflict for a draft made on an older version, and keeps it as a copy', async () => {
    const left = draft({ baseVersion: 2 })
    const t = setup({ drafts: [left] })
    await t.session.ready
    const conflict = t.events.onConflict.mock.calls[0][0]
    expect(conflict).toMatchObject({
      source: 'recovery',
      partlySaved: false,
      server: { version: 3, editedBy: 'Noa' },
      draft: left,
    })
    // The editor keeps showing the server's version.
    expect(t.store.getState().canvas).toEqual(emptyCanvas())

    const copy = await t.session.keepMineAsCopy("Reception plan (Aiden's copy)")
    expect(t.deps.duplicateLayout).toHaveBeenCalledWith(LAYOUT_ID, {
      id: '55555555-5555-4555-8555-555555555555',
      name: "Reception plan (Aiden's copy)",
      canvas: left.canvas,
    })
    expect(copy.canvas).toEqual(left.canvas)
    expect(t.drafts.all()).toHaveLength(0)
    expect(t.events.onConflict).toHaveBeenLastCalledWith(null)
  })
})

describe('while open', () => {
  it('hands each edit to the save engine', async () => {
    const t = setup()
    await t.session.ready
    const canvas = t.store.edit('Add table', (c) => addRoundTable(c, 'a'))!
    t.session.noteEdit(canvas)
    expect(t.saver().edits).toEqual([canvas])
  })

  it('empties seats the server dropped, outside undo', async () => {
    const guest = '66666666-6666-4666-8666-666666666666'
    const start = addRoundTable(emptyCanvas(), 'a')
    const seatedCanvas: Canvas = {
      ...start,
      items: start.items.map((i) =>
        i.kind === 'table' ? { ...i, seats: i.seats.map((s) => (s.index === 0 ? { ...s, guestId: guest } : s)) } : i,
      ),
    }
    const t = setup({ page: detail({ canvas: seatedCanvas }) })
    await t.session.ready
    t.saver().options.onDroppedSeats([{ itemId: 'a', seatIndex: 0, guestId: guest, reason: 'removed-guest' }])
    const table = t.store.getState().canvas.items[0]
    expect(table.kind === 'table' && table.seats[0].guestId).toBeNull()
    expect(t.store.getState().canUndo).toBe(false)
  })

  it('empties seats the server dropped inside a drag under way, keeping the drag (A6)', async () => {
    const guest = '66666666-6666-4666-8666-666666666666'
    const start = addRoundTable(emptyCanvas(), 'a')
    const seatedCanvas: Canvas = {
      ...start,
      items: start.items.map((i) => (i.kind === 'table' ? { ...i, seats: i.seats.map((s) => (s.index === 0 ? { ...s, guestId: guest } : s)) } : i)),
    }
    const t = setup({ page: detail({ canvas: seatedCanvas }) })
    await t.session.ready
    const doc = createEditorDoc({ store: t.store, canEdit: () => true, onCommit: (c) => t.session.noteEdit(c) })
    t.store.routeServerPatches(doc.patchFromServer)
    const g = doc.begin('Move')!
    g.preview((c) => moveItems(c, ['a'], 40, 0))
    t.saver().options.onDroppedSeats([{ itemId: 'a', seatIndex: 0, guestId: guest, reason: 'removed-guest' }])
    expect(g.isActive()).toBe(true)
    g.preview((c) => moveItems(c, ['a'], 60, 0))
    g.commit()
    const table = t.store.getState().canvas.items[0]
    expect(table.kind === 'table' && table.seats[0].guestId).toBeNull()
    expect(table.x).toBe(60)
    expect(t.store.getState().history.past).toHaveLength(1)
    expect(t.saver().edits).toHaveLength(1)
    expect(t.saver().edits[0]).toBe(t.store.getState().canvas)
  })

  it('quietly loads the other person’s newer version when nothing is unsaved', async () => {
    const t = setup()
    await t.session.ready
    const theirs = detail({ version: 4, editedBy: 'Aiden', canvas: addRoundTable(emptyCanvas(), 'theirs') })
    t.setServer(theirs)
    t.watch().onChange({ version: 4, updatedAt: theirs.updatedAt, editedBy: 'Aiden', editedById: null, lastSaveId: null, recentSaveIds: [] })
    await vi.waitFor(() => expect(t.events.onNotice).toHaveBeenCalledWith("Loaded Aiden's changes"))
    expect(t.store.getState().canvas).toEqual(theirs.canvas)
    expect(t.saver().resetTo).toHaveBeenCalledWith(4)
  })

  it('says "your changes" when the newer version is the signed-in user’s own, from another tab', async () => {
    const t = setup()
    await t.session.ready
    const mine = detail({ version: 4, editedBy: 'Noa', editedById: ME.id, canvas: addRoundTable(emptyCanvas(), 'other-tab') })
    t.setServer(mine)
    t.watch().onChange({ version: 4, updatedAt: mine.updatedAt, editedBy: 'Noa', editedById: ME.id, lastSaveId: null, recentSaveIds: [] })
    await vi.waitFor(() => expect(t.events.onNotice).toHaveBeenCalledWith('Loaded your changes from another tab or device'))
  })

  it('leaves a tab with unsaved edits alone, so the next save meets the conflict', async () => {
    const t = setup()
    await t.session.ready
    const mine = t.store.edit('Add table', (c) => addRoundTable(c, 'mine'))!
    t.session.noteEdit(mine)
    t.setServer(detail({ version: 4, editedBy: 'Aiden', canvas: addRoundTable(emptyCanvas(), 'theirs') }))
    t.watch().onChange({ version: 4, updatedAt: 'x', editedBy: 'Aiden', editedById: null, lastSaveId: null, recentSaveIds: [] })
    await new Promise((r) => setTimeout(r, 0))
    expect(t.store.getState().canvas).toBe(mine)
    expect(t.events.onNotice).not.toHaveBeenCalled()
  })

  it('a save conflict offers the choice; Load their version replaces the canvas and clears undo', async () => {
    const t = setup()
    await t.session.ready
    t.session.noteEdit(t.store.edit('Add table', (c) => addRoundTable(c, 'mine'))!)
    t.saver().setStatus({
      kind: 'conflict',
      server: { version: 4, updatedAt: '2026-11-09T15:42:00.000Z', editedBy: 'Aiden', editedById: null, lastSaveId: null, recentSaveIds: [] },
    })
    expect(t.events.onConflict).toHaveBeenLastCalledWith({
      source: 'save',
      partlySaved: false,
      server: { version: 4, editedBy: 'Aiden', editedById: null, updatedAt: '2026-11-09T15:42:00.000Z' },
      draft: null,
    })
    const theirs = detail({ version: 4, editedBy: 'Aiden', canvas: addRoundTable(emptyCanvas(), 'theirs') })
    t.setServer(theirs)
    await t.session.loadTheirs()
    expect(t.store.getState().canvas).toEqual(theirs.canvas)
    expect(t.store.getState().canUndo).toBe(false)
    expect(t.saver().resetTo).toHaveBeenCalledWith(4)
    expect(t.events.onConflict).toHaveBeenLastCalledWith(null)
  })

  it('Keep mine as a new copy sends this tab’s canvas, then shows the server’s version with no undo steps', async () => {
    const t = setup()
    await t.session.ready
    const mine = t.store.edit('Add table', (c) => addRoundTable(c, 'mine'))!
    t.session.noteEdit(mine)
    t.saver().setStatus({
      kind: 'conflict',
      server: { version: 4, updatedAt: '2026-11-09T15:42:00.000Z', editedBy: 'Aiden', editedById: null, lastSaveId: null, recentSaveIds: [] },
    })
    const theirs = detail({ version: 4, editedBy: 'Aiden', canvas: addRoundTable(emptyCanvas(), 'theirs') })
    t.setServer(theirs)
    const resetOrder: string[] = []
    t.store.subscribe(() => resetOrder.push('store'))
    vi.mocked(t.saver().resetTo).mockImplementationOnce(async () => {
      resetOrder.push('saver')
    })

    await t.session.keepMineAsCopy("Reception plan (Noa's copy)")
    expect(t.deps.duplicateLayout).toHaveBeenCalledWith(
      LAYOUT_ID,
      expect.objectContaining({ canvas: mine, name: "Reception plan (Noa's copy)" }),
    )
    // The original shows the other person's version, and Undo cannot bring "mine" back.
    expect(t.store.getState().canvas).toEqual(theirs.canvas)
    expect(t.store.getState().canUndo).toBe(false)
    expect(t.saver().resetTo).toHaveBeenCalledWith(4)
    expect(resetOrder).toEqual(['store', 'saver'])
    expect(t.events.onConflict).toHaveBeenLastCalledWith(null)
  })

  it('after Keep mine as a new copy, an edit before the page leaves cannot reach the old layout', async () => {
    const t = setup()
    await t.session.ready
    const mine = t.store.edit('Add table', (c) => addRoundTable(c, 'mine'))!
    t.session.noteEdit(mine)
    t.saver().setStatus({
      kind: 'conflict',
      server: { version: 4, updatedAt: '2026-11-09T15:42:00.000Z', editedBy: 'Aiden', editedById: null, lastSaveId: null, recentSaveIds: [] },
    })
    t.setServer(detail({ version: 4, editedBy: 'Aiden', canvas: addRoundTable(emptyCanvas(), 'theirs') }))
    await t.session.keepMineAsCopy("Reception plan (Noa's copy)")
    const editsBefore = t.saver().edits.length

    // Ctrl+Z has nothing to undo; a new edit is refused.
    expect(t.store.undo()).toBeNull()
    t.session.noteEdit(t.store.edit('Add table', (c) => addRoundTable(c, 'late'))!)
    expect(t.saver().edits).toHaveLength(editsBefore)
    // Leaving sends nothing either.
    t.session.close()
    expect(t.saver().flush).not.toHaveBeenCalled()
  })

  it('Keep mine as a new copy with the real engine: nothing more is saved to the original', async () => {
    const f = fakeFetch()
    const t = setup({ realFetch: f.fn })
    await t.session.ready
    const mine = t.store.edit('Add table', (c) => addRoundTable(c, 'mine'))!
    t.session.noteEdit(mine)
    await vi.waitFor(() => expect(f.calls).toHaveLength(1))
    t.setServer(detail({ version: 4, editedBy: 'Aiden', canvas: addRoundTable(emptyCanvas(), 'theirs') }))
    f.calls[0].respond(409, {
      error: 'conflict',
      version: 4,
      updatedAt: '2026-11-09T15:42:00.000Z',
      editedBy: 'Aiden',
      lastSaveId: null,
      recentSaveIds: [],
    })
    await vi.waitFor(() => expect(t.events.onConflict).toHaveBeenCalled())
    await t.session.keepMineAsCopy("Reception plan (Noa's copy)")
    expect(t.realSaver().getBaseVersion()).toBe(4)
    t.session.noteEdit(t.store.edit('Add table', (c) => addRoundTable(c, 'late'))!)
    t.store.undo()
    await new Promise((r) => setTimeout(r, 20))
    expect(f.calls).toHaveLength(1)
    expect(t.realSaver().hasUnsavedChanges()).toBe(false)
  })

  it('a retried copy after a lost reply finds the copy the first try made', async () => {
    const t = setup()
    await t.session.ready
    t.session.noteEdit(t.store.edit('Add table', (c) => addRoundTable(c, 'mine'))!)
    t.saver().setStatus({
      kind: 'conflict',
      server: { version: 4, updatedAt: '2026-11-09T15:42:00.000Z', editedBy: 'Aiden', editedById: null, lastSaveId: null, recentSaveIds: [] },
    })
    const made = detail({ id: '55555555-5555-4555-8555-555555555555', name: "Reception plan (Noa's copy)" })
    vi.mocked(t.deps.duplicateLayout!).mockRejectedValueOnce(
      new ApiRequestError(409, { error: 'id_taken' }, 'POST failed: id_taken'),
    )
    vi.mocked(t.deps.getLayout!).mockResolvedValueOnce(made)
    const copy = await t.session.keepMineAsCopy("Reception plan (Noa's copy)")
    expect(copy).toBe(made)
    expect(t.deps.getLayout).toHaveBeenCalledWith(made.id)
  })

  it('close() sends what is waiting, and stops the engine and lets the tab lock go only once that settles', async () => {
    const t = setup()
    await t.session.ready
    t.session.noteEdit(t.store.edit('Add table', (c) => addRoundTable(c, 'a'))!)
    let finish!: () => void
    vi.mocked(t.saver().flush).mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
    t.session.close()
    // A normal save, not keepalive: the page stays alive when leaving inside the app.
    expect(t.saver().flush).toHaveBeenCalledWith()
    expect(t.saver().dispose).not.toHaveBeenCalled()
    expect(t.release).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() => expect(t.saver().dispose).toHaveBeenCalled())
    expect(t.release).toHaveBeenCalled()
  })

  it('close() with nothing unsaved stops at once', async () => {
    const t = setup()
    await t.session.ready
    t.session.close()
    expect(t.saver().flush).not.toHaveBeenCalled()
    expect(t.saver().dispose).toHaveBeenCalled()
    expect(t.release).toHaveBeenCalled()
  })

  it('close() before the layout opened lets the lock go and makes no engine', async () => {
    const t = setup()
    t.session.close()
    await t.session.ready
    expect(t.saver()).toBeUndefined()
    expect(t.release).toHaveBeenCalled()
  })
})

describe('closing inside the app, with the real save engine', () => {
  it('waits for the save in flight, sends the edits made after it, then deletes the draft', async () => {
    const f = fakeFetch()
    const t = setup({ realFetch: f.fn })
    await t.session.ready
    const first = t.store.edit('Add table', (c) => addRoundTable(c, 'a'))!
    t.session.noteEdit(first)
    await vi.waitFor(() => expect(f.calls).toHaveLength(1))
    const later = t.store.edit('Add table', (c) => addRoundTable(c, 'b'))!
    t.session.noteEdit(later)

    // Browser Back while the first save is out.
    t.session.close()
    expect(t.release).not.toHaveBeenCalled()
    f.calls[0].respond(200, saved(4))

    // The edit made after the first snapshot goes out from the version it returned.
    await vi.waitFor(() => expect(f.calls).toHaveLength(2))
    expect(f.calls[1].body).toMatchObject({ baseVersion: 4, canvas: later })
    expect(t.drafts.all()).toHaveLength(1)

    f.calls[1].respond(200, saved(5))
    // The reply is read: the draft goes, then the engine stops and the lock is let go.
    await vi.waitFor(() => expect(t.release).toHaveBeenCalled())
    await t.realSaver().whenStored()
    expect(t.drafts.all()).toHaveLength(0)
    expect(t.realSaver().hasUnsavedChanges()).toBe(false)
  })
})

describe('recovery with recent save ids', () => {
  const SAVE = '77777777-7777-4777-8777-777777777777'
  const landedFirst = addRoundTable(emptyCanvas(), 'landed')
  const afterIt = addRoundTable(landedFirst, 'later')

  it('drops a draft whose in-flight save landed before someone else saved, when nothing came after it', async () => {
    const left = draft({ baseVersion: 3, canvas: landedFirst, inFlight: { saveId: SAVE, baseVersion: 3, canvas: landedFirst } })
    const server = detail({
      version: 5,
      editedBy: 'Aiden',
      lastSaveId: 'someone-else',
      recentSaveIds: ['someone-else', SAVE],
      canvas: addRoundTable(landedFirst, 'theirs'),
    })
    const t = setup({ server, drafts: [left] })
    await t.session.ready
    expect(t.drafts.all()).toHaveLength(0)
    expect(t.events.onConflict).not.toHaveBeenCalled()
    expect(t.saver().edits).toHaveLength(0)
  })

  it('sends the later edits on the server version when the landed save is still the last one', async () => {
    const left = draft({ baseVersion: 3, canvas: afterIt, inFlight: { saveId: SAVE, baseVersion: 3, canvas: landedFirst } })
    const server = detail({ version: 4, lastSaveId: SAVE, recentSaveIds: [SAVE], canvas: landedFirst })
    const t = setup({ server, drafts: [left] })
    await t.session.ready
    expect(t.saver().options.baseVersion).toBe(4)
    expect(t.saver().edits).toEqual([afterIt])
  })

  it('shows the conflict for the later edits only when someone saved after the landed save', async () => {
    const left = draft({ baseVersion: 3, canvas: afterIt, inFlight: { saveId: SAVE, baseVersion: 3, canvas: landedFirst } })
    const server = detail({
      version: 5,
      editedBy: 'Aiden',
      lastSaveId: 'someone-else',
      recentSaveIds: ['someone-else', SAVE],
      canvas: addRoundTable(landedFirst, 'theirs'),
    })
    const t = setup({ server, drafts: [left] })
    await t.session.ready
    expect(t.events.onConflict).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'recovery', partlySaved: true, draft: left }),
    )
    expect(t.saver().options.baseVersion).toBe(5)
  })
})

describe('this tab’s own draft from before a reload', () => {
  it('is moved to a fresh key when another tab’s newer draft is applied, so the saver cannot overwrite it', async () => {
    const own = draft({ tabId: 'this-tab', baseVersion: 3, canvas: addRoundTable(emptyCanvas(), 'own'), updatedAt: '2026-11-09T15:00:00.000Z' })
    const other = draft({ tabId: 'closed-tab', baseVersion: 3, canvas: addRoundTable(emptyCanvas(), 'other'), updatedAt: '2026-11-09T15:05:00.000Z' })
    const f = fakeFetch()
    const t = setup({ drafts: [own, other], realFetch: f.fn, newIds: ['moved-key'] })
    await t.session.ready
    // The other tab's newer draft is applied and saved under this tab's key.
    expect(t.store.getState().canvas).toEqual(other.canvas)
    await t.realSaver().whenStored()
    const byTab = new Map(t.drafts.all().map((d) => [d.tabId, d]))
    expect(byTab.get('this-tab')?.canvas).toEqual(other.canvas)
    // The own draft's edits are kept under a fresh key for the next open.
    expect(byTab.get('moved-key')).toEqual({ ...own, tabId: 'moved-key' })
  })

  it('shows up as a conflict on the next open once the applied draft has saved', async () => {
    const own = draft({ tabId: 'moved-key', baseVersion: 3, canvas: addRoundTable(emptyCanvas(), 'own') })
    const t = setup({ server: detail({ version: 4, canvas: addRoundTable(emptyCanvas(), 'other') }), drafts: [own] })
    await t.session.ready
    expect(t.events.onConflict).toHaveBeenCalledWith(expect.objectContaining({ source: 'recovery', draft: own }))
  })
})

describe('Save as a copy (after a 422 or 410)', () => {
  it('stores this tab’s canvas as a new layout, refuses later edits and drops this tab’s draft of the old one', async () => {
    const f = fakeFetch()
    const t = setup({ realFetch: f.fn, newIds: ['88888888-8888-4888-8888-888888888888'] })
    await t.session.ready
    const mine = t.store.edit('Add table', (c) => addRoundTable(c, 'mine'))!
    t.session.noteEdit(mine)
    await vi.waitFor(() => expect(f.calls).toHaveLength(1))
    f.calls[0].respond(410, { error: 'gone' })
    await vi.waitFor(() => expect(t.realSaver().getStatus().kind).toBe('failed'))
    await t.realSaver().whenStored()
    expect(t.drafts.all()).toHaveLength(1)

    const copy = await t.session.saveAsCopy("Reception plan (Noa's copy)")
    expect(t.deps.duplicateLayout).toHaveBeenCalledWith(LAYOUT_ID, {
      id: '88888888-8888-4888-8888-888888888888',
      name: "Reception plan (Noa's copy)",
      canvas: mine,
    })
    expect(copy.id).toBe('88888888-8888-4888-8888-888888888888')
    expect(t.drafts.all()).toHaveLength(0)
    t.session.noteEdit(t.store.edit('Add table', (c) => addRoundTable(c, 'late'))!)
    await t.realSaver().whenStored()
    expect(t.drafts.all()).toHaveLength(0)
    expect(f.calls).toHaveLength(1)
  })

  it('keeps everything as it was when the copy fails', async () => {
    const t = setup()
    await t.session.ready
    const mine = t.store.edit('Add table', (c) => addRoundTable(c, 'mine'))!
    t.session.noteEdit(mine)
    vi.mocked(t.deps.duplicateLayout!).mockRejectedValueOnce(new ApiRequestError(404, { error: 'not_found' }, 'gone'))
    await expect(t.session.saveAsCopy("Reception plan (Noa's copy)")).rejects.toThrow()
    expect(t.saver().dispose).not.toHaveBeenCalled()
    t.session.noteEdit(t.store.edit('Add table', (c) => addRoundTable(c, 'more'))!)
    expect(t.saver().edits).toHaveLength(2)
  })
})
