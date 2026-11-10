import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Canvas, type Item, type Table } from '@/domain/canvas-schema'
import { minZoomForLevel } from '@/domain/detail-level'
import type { Point } from '@/domain/geometry'
import { makeItem } from '@/domain/presets'
import type { Rule } from '@/domain/rules'
import { seatCenters } from '@/domain/seating'
import type { CameraTargets, FrameScheduler } from '../camera/camera-controller'
import { createDocStore } from '../doc-store'
import { LONG_PRESS_MS, type PointerKind } from '../input/pointer-machine'
import { createEditorState } from '../state'
import type { StorageLike } from '../state/device-view'
import { focusCamera, ghostTransform, HOVER_CARD_MS, PULSE_MS, seatName, type ListWindow } from './controller'
import { LIST_LONG_PRESS_MS } from './list-press'
import type { PeopleGuest } from './people'

function memoryStorage(): StorageLike {
  const data = new Map<string, string>()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }
}

function fakeTargets(): CameraTargets {
  const style = { transform: '', transformOrigin: '', setProperty: () => undefined }
  return {
    viewport: { style, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }), setAttribute: () => undefined },
    wrapper: { style: { ...style } },
    world: { setAttribute: () => undefined },
  }
}

function guest(id: string, firstName: string, lastName: string, extra: Partial<PeopleGuest> = {}): PeopleGuest {
  return { id, firstName, lastName, nickname: null, rsvp: 'yes', partnerId: null, coupleRuleEnabled: true, ...extra }
}

const GUESTS = [
  guest('jane', 'Jane', 'Doe'),
  guest('john', 'John', 'Roe'),
  guest('ann', 'Ann', 'Lee'),
  guest('bo', 'Bo', 'Ray'),
  ...Array.from({ length: 8 }, (_, i) => guest(`f${i}`, `Full${i}`, 'Guest')),
]

/** Round tables of 8 at x, with guests in the first seats. */
function table(id: string, x: number, y: number, guests: (string | null)[] = []): Table {
  const t = makeItem('round', { x, y }, id, emptyCanvas()) as Table
  return { ...t, number: Number(id.replace(/\D/g, '')) || 1, name: '', seats: t.seats.map((s, i) => ({ index: i, guestId: guests[i] ?? null })) }
}

/** Table 1 at the middle with Jane in seat 0; Table 2 to the right, full; Table 3 below, empty. */
function defaultItems(): Item[] {
  return [
    table('t1', 0, 0, ['jane']),
    table('t2', 400, 0, ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7']),
    table('t3', 0, 400),
  ]
}

type HarnessOptions = {
  items?: Item[]
  mode?: 'edit' | 'view'
  zoom?: number
  reducedMotion?: boolean
  rules?: Rule[]
  guests?: PeopleGuest[]
  listWindow?: ListWindow | null
}

/** World (0, 0) shows at the middle of a 1000 by 800 viewport whose top left is the page's. */
function harness(o: HarnessOptions = {}) {
  const store = createDocStore({ ...emptyCanvas(), items: o.items ?? defaultItems() })
  const commits: Canvas[] = []
  const notices: string[] = []
  const taps: string[] = []
  let refusals = 0
  let time = 0
  let timers: { at: number; cb: () => void; id: number }[] = []
  let frames: (() => void)[] = []
  let n = 0
  const scheduler: FrameScheduler = {
    requestFrame: (cb) => {
      frames.push(cb)
      return frames.length
    },
    cancelFrame: () => undefined,
    setTimer: (cb, ms) => {
      const id = ++n
      timers.push({ at: time + ms, cb, id })
      return id
    },
    clearTimer: (id) => {
      timers = timers.filter((t) => t.id !== id)
    },
  }
  const editor = createEditorState({
    layoutId: 'L1',
    store,
    onCommit: (c) => commits.push(c),
    settings: () => ({ unit: 'ft', minGapCm: 152.4 }),
    storage: memoryStorage(),
    newId: () => `new${++n}`,
    scheduler,
    traits: () => ({ width: 1440, touchOnly: false, phone: false }),
    events: { onNotice: (t) => void notices.push(t), onRefused: () => void refusals++, onTap: (t) => void taps.push(t.target.kind) },
    now: () => time,
    setTimer: (cb, ms) => void timers.push({ at: time + ms, cb, id: ++n }),
    reducedMotion: () => o.reducedMotion ?? false,
    listWindow: o.listWindow ?? null,
  })
  editor.loadDevice()
  editor.camera.attach(fakeTargets())
  editor.camera.set({ zoom: o.zoom ?? 1, x: 500, y: 400 }, { immediate: true })
  if (o.mode) editor.ui.setState({ mode: o.mode })
  editor.setPeople({ guests: o.guests ?? GUESTS, rules: o.rules ?? [] })
  const c = editor.controller
  let pointerId = 1
  const s = () => editor.seating.store.getState()
  const zoom = () => editor.camera.get().zoom

  const h = {
    editor,
    store,
    commits,
    notices,
    taps,
    refusals: () => refusals,
    s,
    canvas: () => store.getState().canvas,
    table: (id: string) => store.getState().canvas.items.find((i) => i.id === id) as Table,
    seatOf: (id: string, index: number) => (store.getState().canvas.items.find((i) => i.id === id) as Table).seats[index].guestId,
    /** A seat's center on screen (and on the page: the viewport's top left is the page's). */
    seat(id: string, index: number): Point {
      const w = seatCenters(h.table(id))[index]
      return editor.camera.worldToScreen(w)
    },
    world: (p: Point) => editor.camera.worldToScreen(p),
    setTime(t: number) {
      time = t
      for (;;) {
        const due = timers.filter((x) => x.at <= t)
        if (due.length === 0) break
        timers = timers.filter((x) => x.at > t)
        for (const timer of due) timer.cb()
      }
    },
    runFrames() {
      const due = frames
      frames = []
      for (const f of due) f()
    },
    /** A canvas press: down at the first point, moves through the rest, up at the last. */
    drag(points: Point[], m: { shift?: boolean; pointer?: PointerKind } = {}) {
      const id = pointerId++
      const mods = { shift: m.shift ?? false, alt: false }
      c.pointer({ type: 'down', id, pointer: m.pointer ?? 'mouse', button: 0, at: points[0], time, target: c.targetAt(points[0]), ...mods })
      for (const p of points.slice(1)) c.pointer({ type: 'move', id, at: p, time, ...mods })
      c.pointer({ type: 'up', id, at: points[points.length - 1], time, ...mods })
    },
    click(p: Point, m: { shift?: boolean; pointer?: PointerKind } = {}) {
      h.drag([p], m)
    },
    /** A press on a name in the side list. */
    listDown(guestId: string, at: Point, pointer: PointerKind = 'mouse') {
      const id = pointerId++
      editor.seating.listPointer({ type: 'down', id, pointer, button: 0, guestId, at, time })
      return {
        move: (p: Point) => editor.seating.listPointer({ type: 'move', id, at: p, time }),
        up: (p: Point) => editor.seating.listPointer({ type: 'up', id, at: p, time }),
        cancel: () => editor.seating.listPointer({ type: 'cancel', id }),
      }
    },
    /** A whole list drag with a mouse: from the list (off the canvas, at x 1200) to `to`. */
    listDrag(guestId: string, to: Point) {
      const p = h.listDown(guestId, { x: 1200, y: 300 })
      p.move({ x: 1150, y: 300 })
      p.move(to)
      p.up(to)
    },
    key: (key: string) => c.keyDown({ key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }),
    zoom,
  }
  return h
}

const TABLE_CENTER = { x: 0, y: 0 }

describe('seating actions', () => {
  it('seats a guest from the list at a seat: one undo step, saved once', () => {
    const h = harness()
    expect(h.editor.actions.seatGuest('john', 't1', 3)).toEqual({ status: 'done', seat: { itemId: 't1', seatIndex: 3 }, from: null, displaced: null })
    expect(h.seatOf('t1', 3)).toBe('john')
    expect(h.commits).toHaveLength(1)
    expect(h.store.getState().history.past).toHaveLength(1)
    expect(h.store.getState().history.past[0].label).toBe('Seat guest')
    expect(h.editor.actions.undo()).toBe(true)
    expect(h.seatOf('t1', 3)).toBeNull()
  })

  it("takes a table's first free seat, and says when it is full", () => {
    const h = harness()
    expect(h.editor.actions.seatAtTable('john', 't1')).toMatchObject({ status: 'done', seat: { itemId: 't1', seatIndex: 1 } })
    expect(h.editor.actions.seatAtTable('ann', 't2')).toEqual({ status: 'full', itemId: 't2', message: 'Table 2 is full' })
    expect(h.notices).toEqual(['Table 2 is full'])
    expect(h.commits).toHaveLength(1)
  })

  it('moves and swaps seated guests', () => {
    const h = harness()
    expect(h.editor.actions.moveGuest('jane', 't3', 2)).toMatchObject({ status: 'done', from: { itemId: 't1', seatIndex: 0 }, seat: { itemId: 't3', seatIndex: 2 } })
    expect(h.seatOf('t1', 0)).toBeNull()
    expect(h.editor.actions.swapGuests('jane', 'f3')).toMatchObject({ status: 'done' })
    expect(h.seatOf('t2', 3)).toBe('jane')
    expect(h.seatOf('t3', 2)).toBe('f3')
    expect(h.store.getState().history.past.map((s) => s.label)).toEqual(['Move guest', 'Swap guests'])
    // Swapping with someone unseated does nothing.
    expect(h.editor.actions.swapGuests('jane', 'ann')).toEqual({ status: 'unchanged' })
  })

  it('unseats one guest, or several as one undo step', () => {
    const h = harness()
    h.editor.actions.seatGuest('john', 't1', 1)
    expect(h.editor.actions.unseatGuest('jane')).toMatchObject({ status: 'done', seat: null, from: { itemId: 't1', seatIndex: 0 } })
    h.editor.actions.seatGuest('jane', 't1', 0)
    expect(h.editor.actions.unseatGuests(['jane', 'john', 'nobody'])).toMatchObject({ status: 'done' })
    expect(h.seatOf('t1', 0)).toBeNull()
    expect(h.seatOf('t1', 1)).toBeNull()
    expect(h.store.getState().history.past.at(-1)?.label).toBe('Unseat guests')
    expect(h.editor.actions.unseatGuests(['jane'])).toEqual({ status: 'unchanged' })
  })

  it('unseats the guests selected on the canvas', () => {
    const h = harness()
    h.editor.actions.seatGuest('john', 't1', 1)
    h.click(h.seat('t1', 0))
    h.click(h.seat('t1', 1), { shift: true })
    expect(h.editor.ui.getState().guestSeats).toHaveLength(2)
    expect(h.editor.actions.unseatSelectedGuests()).toMatchObject({ status: 'done' })
    expect(h.table('t1').seats.every((s) => s.guestId === null)).toBe(true)
    expect(h.editor.ui.getState().guestSeats).toEqual([])
  })

  it('reorders seats within a table, as the Properties list does', () => {
    const h = harness()
    expect(h.editor.actions.reorderSeat('t2', 0, 5)).toMatchObject({ status: 'done' })
    expect(h.seatOf('t2', 0)).toBe('f5')
    expect(h.seatOf('t2', 5)).toBe('f0')
  })

  it('refuses every seating change in View mode', () => {
    const h = harness({ mode: 'view' })
    expect(h.editor.actions.seatGuest('john', 't1', 1)).toEqual({ status: 'refused' })
    expect(h.editor.actions.unseatGuest('jane')).toEqual({ status: 'refused' })
    expect(h.editor.actions.startPick('john')).toBe(false)
    expect(h.editor.actions.openSeatPicker('t1', 1)).toBe(false)
    expect(h.refusals()).toBe(4)
    expect(h.commits).toHaveLength(0)
  })

  it('keeps a selected guest selected when they move', () => {
    const h = harness()
    h.click(h.seat('t1', 0))
    expect(h.editor.ui.getState().guestSeats).toEqual([{ itemId: 't1', seatIndex: 0 }])
    h.editor.actions.moveGuest('jane', 't3', 4)
    expect(h.editor.ui.getState().guestSeats).toEqual([{ itemId: 't3', seatIndex: 4 }])
  })

  it("names the guests a seat count change would unseat", () => {
    const h = harness()
    const r = h.editor.actions.removeSeat('t2')
    expect(r.status).toBe('confirm')
    if (r.status !== 'confirm') return
    expect(r.unseated).toEqual(['f7'])
    expect(r.names).toEqual(['Full7 Guest'])
    h.editor.setPeople({ guests: [] })
    const again = h.editor.actions.setSeatCount('t2', 6)
    expect(again.status === 'confirm' && again.names).toEqual(['Guest', 'Guest'])
  })
})

describe('guest selection on the canvas', () => {
  it('selects the guest in a taken seat, and Shift+click adds or removes', () => {
    const h = harness()
    h.editor.actions.seatGuest('john', 't3', 0)
    h.click(h.seat('t1', 0))
    expect(h.editor.ui.getState()).toMatchObject({ guestSeats: [{ itemId: 't1', seatIndex: 0 }], selection: [] })
    h.click(h.seat('t3', 0), { shift: true })
    expect(h.editor.ui.getState().guestSeats).toEqual([
      { itemId: 't1', seatIndex: 0 },
      { itemId: 't3', seatIndex: 0 },
    ])
    h.click(h.seat('t1', 0), { shift: true })
    expect(h.editor.ui.getState().guestSeats).toEqual([{ itemId: 't3', seatIndex: 0 }])
  })
})

describe('dragging a name from the side list', () => {
  it('drops on an empty seat: the seat grows while dragging, and the drop is one step', () => {
    const h = harness()
    const p = h.listDown('john', { x: 1200, y: 300 })
    p.move({ x: 1203, y: 300 })
    expect(h.s().drag).toBeNull()
    p.move({ x: 1150, y: 300 })
    expect(h.s().drag).toMatchObject({ guestId: 'john', text: 'John Roe', source: 'list', from: null, target: { kind: 'none' }, targetSeat: null })
    p.move(h.seat('t1', 2))
    expect(h.s().drag?.targetSeat).toEqual({ itemId: 't1', seatIndex: 2 })
    expect(h.commits).toHaveLength(0)
    p.up(h.seat('t1', 2))
    expect(h.s().drag).toBeNull()
    expect(h.seatOf('t1', 2)).toBe('john')
    expect(h.commits).toHaveLength(1)
    expect(h.store.getState().history.past).toHaveLength(1)
  })

  it("drops on a table: its first free seat", () => {
    const h = harness()
    h.listDrag('john', h.world(TABLE_CENTER))
    expect(h.seatOf('t1', 1)).toBe('john')
  })

  it('drops on a taken seat: the guest there goes to Unassigned', () => {
    const h = harness()
    h.listDrag('john', h.seat('t1', 0))
    expect(h.seatOf('t1', 0)).toBe('john')
    expect(h.table('t1').seats.some((s) => s.guestId === 'jane')).toBe(false)
  })

  it('changes nothing on a full table and says so', () => {
    const h = harness()
    const p = h.listDown('john', { x: 1200, y: 300 })
    p.move({ x: 1100, y: 300 })
    p.move(h.world({ x: 400, y: 0 }))
    expect(h.s().drag?.target).toEqual({ kind: 'full', itemId: 't2', label: 'Table 2' })
    p.up(h.world({ x: 400, y: 0 }))
    expect(h.notices).toEqual(['Table 2 is full'])
    expect(h.commits).toHaveLength(0)
  })

  it('ends with no change on Esc or pointercancel', () => {
    const h = harness()
    const p = h.listDown('john', { x: 1200, y: 300 })
    p.move(h.seat('t1', 2))
    expect(h.key('Escape')).toBe(true)
    expect(h.s().drag).toBeNull()
    p.up(h.seat('t1', 2))
    const q = h.listDown('john', { x: 1200, y: 300 })
    q.move(h.seat('t1', 2))
    q.cancel()
    expect(h.s().drag).toBeNull()
    expect(h.commits).toHaveLength(0)
  })

  it('with a finger, starts after a 450 ms hold', () => {
    const h = harness()
    const p = h.listDown('john', { x: 1200, y: 300 }, 'touch')
    h.setTime(LIST_LONG_PRESS_MS - 1)
    expect(h.s().drag).toBeNull()
    h.setTime(LIST_LONG_PRESS_MS)
    expect(h.s().drag).toMatchObject({ guestId: 'john', pointer: 'touch' })
    p.move(h.seat('t3', 0))
    p.up(h.seat('t3', 0))
    expect(h.seatOf('t3', 0)).toBe('john')
  })

  it('a press that can drag is refused in View mode, and says why', () => {
    const h = harness({ mode: 'view' })
    const p = h.listDown('john', { x: 1200, y: 300 })
    p.move(h.seat('t1', 2))
    p.up(h.seat('t1', 2))
    expect(h.s().drag).toBeNull()
    expect(h.refusals()).toBe(1)
    expect(h.commits).toHaveLength(0)
  })

  it('in View mode a row never drags: a long or wobbly press on a seated name still pans to the seat, with no refusal (review finding)', () => {
    const h = harness({ mode: 'view', zoom: 0.3 })
    const row = (id: number, pointer: string, x: number, y: number, timeStamp = 0) => ({ pointerId: id, pointerType: pointer, button: 0, clientX: x, clientY: y, timeStamp })
    // A finger held 600 ms on Jane (seated), then lifted.
    h.editor.seating.listPointerDown(row(1, 'touch', 1200, 300), 'jane')
    h.setTime(600)
    expect(h.s().drag).toBeNull()
    h.editor.seating.listPointer({ type: 'up', id: 1, at: { x: 1202, y: 301 }, time: 600 })
    expect(h.refusals()).toBe(0)
    expect(h.s().pulse).toMatchObject({ itemId: 't1', seatIndex: 0 })
    // A mouse click that wobbles 5 px pans too, and a real drag does nothing at all.
    h.setTime(5000)
    expect(h.s().pulse).toBeNull()
    h.editor.seating.listPointerDown(row(2, 'mouse', 1200, 300), 'jane')
    h.editor.seating.listPointer({ type: 'move', id: 2, at: { x: 1205, y: 300 }, time: 5000 })
    h.editor.seating.listPointer({ type: 'up', id: 2, at: { x: 1205, y: 300 }, time: 5000 })
    expect(h.s().pulse).toMatchObject({ itemId: 't1', seatIndex: 0 })
    h.editor.seating.listPointerDown(row(3, 'mouse', 1200, 300), 'john')
    h.editor.seating.listPointer({ type: 'move', id: 3, at: h.seat('t3', 0), time: 5000 })
    h.editor.seating.listPointer({ type: 'up', id: 3, at: h.seat('t3', 0), time: 5000 })
    expect(h.s().drag).toBeNull()
    expect(h.s().pick).toBeNull()
    expect(h.refusals()).toBe(0)
    expect(h.commits).toHaveLength(0)
    // The keyboard on an unassigned name starts nothing in View mode.
    h.editor.seating.rowActivate('john')
    expect(h.s().pick).toBeNull()
    expect(h.refusals()).toBe(0)
  })

  it('puts a name back on the list with no change', () => {
    const h = harness()
    h.editor.seating.registerListZone({ getBoundingClientRect: () => ({ left: 1100, top: 0, width: 300, height: 800 }) })
    const p = h.listDown('jane', { x: 1200, y: 300 })
    p.move({ x: 1250, y: 300 })
    expect(h.s().drag?.target).toEqual({ kind: 'none' })
    p.up({ x: 1250, y: 300 })
    expect(h.seatOf('t1', 0)).toBe('jane')
    expect(h.commits).toHaveLength(0)
  })

  it('tints tables once at the start: green where the partner sits, red where a rule would break', () => {
    const guests = [...GUESTS.filter((g) => g.id !== 'john' && g.id !== 'ann'), guest('john', 'John', 'Roe', { partnerId: 'ann' }), guest('ann', 'Ann', 'Lee', { partnerId: 'john' })]
    const apart: Rule = { id: 'r1', kind: 'apart', guestIds: ['john', 'jane'], nextToEachOther: false, appliesTo: 'both', enabled: true }
    const h = harness({ guests, rules: [apart] })
    h.editor.actions.seatGuest('ann', 't3', 0)
    const p = h.listDown('john', { x: 1200, y: 300 })
    p.move({ x: 1100, y: 300 })
    const tints = h.s().drag!.tints
    expect(tints.get('t3')).toBe('good')
    expect(tints.get('t1')).toBe('bad')
    p.move(h.seat('t3', 1))
    expect(h.s().drag!.tints).toBe(tints)
  })

  it('moves the ghost with a transform once per frame', () => {
    const h = harness()
    const ghost = { style: { transform: '' } }
    const p = h.listDown('john', { x: 1200, y: 300 })
    p.move({ x: 1100, y: 300 })
    h.editor.seating.bindGhost(ghost)
    expect(ghost.style.transform).toBe(ghostTransform({ x: 1100, y: 300 }, 'mouse'))
    p.move({ x: 900, y: 200 })
    p.move({ x: 800, y: 100 })
    expect(ghost.style.transform).toBe(ghostTransform({ x: 1100, y: 300 }, 'mouse'))
    h.runFrames()
    expect(ghost.style.transform).toBe(ghostTransform({ x: 800, y: 100 }, 'mouse'))
    expect(h.editor.seating.ghostPosition()).toEqual({ x: 800, y: 100 })
    p.up({ x: 800, y: 100 })
    expect(h.editor.seating.ghostPosition()).toBeNull()
    expect(ghostTransform({ x: 10, y: 100 }, 'touch')).toBe('translate3d(10px, 68px, 0) translate(-50%, -100%)')
  })
})

describe('dragging a seated guest on the canvas', () => {
  it('moves them to an empty seat', () => {
    const h = harness()
    h.drag([h.seat('t1', 0), h.seat('t3', 0), h.seat('t3', 1)])
    expect(h.seatOf('t3', 1)).toBe('jane')
    expect(h.seatOf('t1', 0)).toBeNull()
    expect(h.commits).toHaveLength(1)
    expect(h.store.getState().history.past[0].label).toBe('Move guest')
  })

  it('swaps them with the guest in a taken seat', () => {
    const h = harness()
    h.drag([h.seat('t1', 0), h.seat('t2', 5)])
    expect(h.seatOf('t2', 5)).toBe('jane')
    expect(h.seatOf('t1', 0)).toBe('f5')
  })

  it('unseats them when dropped on the side list', () => {
    const h = harness()
    h.editor.seating.registerListZone({ getBoundingClientRect: () => ({ left: 900, top: 0, width: 100, height: 800 }) })
    const id = 99
    const c = h.editor.controller
    c.pointer({ type: 'down', id, pointer: 'mouse', button: 0, at: h.seat('t1', 0), time: 0, target: c.targetAt(h.seat('t1', 0)), shift: false, alt: false })
    c.pointer({ type: 'move', id, at: { x: 950, y: 300 }, time: 0, shift: false, alt: false })
    expect(h.s().drag).toMatchObject({ source: 'seat', from: { itemId: 't1', seatIndex: 0 }, target: { kind: 'list' } })
    c.pointer({ type: 'up', id, at: { x: 950, y: 300 }, time: 0, shift: false, alt: false })
    expect(h.seatOf('t1', 0)).toBeNull()
    expect(h.store.getState().history.past[0].label).toBe('Unseat guest')
  })

  it('changes nothing on Esc, or dropped on a full table', () => {
    const h = harness()
    const id = 7
    const c = h.editor.controller
    c.pointer({ type: 'down', id, pointer: 'mouse', button: 0, at: h.seat('t1', 0), time: 0, target: c.targetAt(h.seat('t1', 0)), shift: false, alt: false })
    c.pointer({ type: 'move', id, at: h.seat('t3', 1), time: 0, shift: false, alt: false })
    expect(h.s().drag?.targetSeat).toEqual({ itemId: 't3', seatIndex: 1 })
    expect(h.key('Escape')).toBe(true)
    expect(h.s().drag).toBeNull()
    c.pointer({ type: 'up', id, at: h.seat('t3', 1), time: 0, shift: false, alt: false })
    h.drag([h.seat('t1', 0), h.world({ x: 400, y: 0 })])
    expect(h.notices).toEqual(['Table 2 is full'])
    expect(h.commits).toHaveLength(0)
  })

  it('picks a guest up from a locked table too', () => {
    const items = defaultItems().map((i) => (i.id === 't1' ? { ...i, locked: true } : i))
    const h = harness({ items })
    h.drag([h.seat('t1', 0), h.seat('t3', 0)])
    expect(h.seatOf('t3', 0)).toBe('jane')
  })

  it('with a finger, needs the 450 ms hold, else the drag pans', () => {
    const h = harness()
    const before = h.editor.camera.get()
    h.drag([h.seat('t1', 0), h.seat('t3', 0)], { pointer: 'touch' })
    expect(h.seatOf('t1', 0)).toBe('jane')
    expect(h.editor.camera.get()).not.toEqual(before)
  })

  it('a second finger during a touch drag cancels it: nobody moves and nothing saves (review finding)', () => {
    const h = harness()
    const c = h.editor.controller
    const t = { shift: false, alt: false }
    const start = h.seat('t1', 0)
    c.pointer({ type: 'down', id: 1, pointer: 'touch', button: 0, at: start, time: 0, target: c.targetAt(start), ...t })
    h.setTime(LONG_PRESS_MS)
    // Over Table 2's seat 0, on the way somewhere else.
    c.pointer({ type: 'move', id: 1, at: h.seat('t2', 0), time: LONG_PRESS_MS, ...t })
    expect(h.s().drag).toMatchObject({ guestId: 'jane', target: { kind: 'seat', itemId: 't2', seatIndex: 0 } })
    c.pointer({ type: 'down', id: 2, pointer: 'touch', button: 0, at: { x: 900, y: 700 }, time: LONG_PRESS_MS, target: c.targetAt({ x: 900, y: 700 }), ...t })
    expect(h.s().drag).toBeNull()
    c.pointer({ type: 'move', id: 2, at: { x: 920, y: 720 }, time: LONG_PRESS_MS, ...t })
    c.pointer({ type: 'up', id: 1, at: h.seat('t2', 0), time: LONG_PRESS_MS, ...t })
    c.pointer({ type: 'up', id: 2, at: { x: 920, y: 720 }, time: LONG_PRESS_MS, ...t })
    expect(h.seatOf('t1', 0)).toBe('jane')
    expect(h.seatOf('t2', 0)).toBe('f0')
    expect(h.commits).toHaveLength(0)
  })
})

describe("the phone's tap-then-tap", () => {
  it('a tapped name waits for a seat tap, then sits there', () => {
    const h = harness()
    const p = h.listDown('john', { x: 1200, y: 300 }, 'touch')
    p.up({ x: 1201, y: 301 })
    expect(h.s().pick).toEqual({ guestId: 'john', name: 'John R.', prompt: 'Tap a seat for John R.' })
    // A tap on a full table keeps waiting and says why; nothing gets selected.
    h.click(h.world({ x: 400, y: 0 }), { pointer: 'touch' })
    expect(h.notices).toEqual(['Table 2 is full'])
    expect(h.s().pick).not.toBeNull()
    expect(h.editor.ui.getState().selection).toEqual([])
    h.click(h.seat('t3', 7), { pointer: 'touch' })
    expect(h.seatOf('t3', 7)).toBe('john')
    expect(h.s().pick).toBeNull()
    expect(h.commits).toHaveLength(1)
  })

  it('a tap on a table takes its first free seat', () => {
    const h = harness()
    h.editor.actions.startPick('john')
    h.click(h.world({ x: 0, y: 400 }), { pointer: 'touch' })
    expect(h.seatOf('t3', 0)).toBe('john')
  })

  it('Cancel, Esc and View mode end it', () => {
    const h = harness()
    h.editor.actions.startPick('john')
    h.editor.actions.cancelPick()
    expect(h.s().pick).toBeNull()
    h.editor.actions.startPick('john')
    expect(h.key('Escape')).toBe(true)
    expect(h.s().pick).toBeNull()
    h.editor.actions.startPick('john')
    h.editor.actions.setMode('view')
    expect(h.s().pick).toBeNull()
  })

  it('a tapped seated name pans to their seat instead', () => {
    const h = harness({ reducedMotion: true })
    const p = h.listDown('jane', { x: 1200, y: 300 }, 'touch')
    p.up({ x: 1200, y: 300 })
    expect(h.s().pick).toBeNull()
    expect(h.s().pulse).toMatchObject({ itemId: 't1', seatIndex: 0 })
  })
})

describe('the + on empty seats', () => {
  it('opens a guest picker at the seat on a tap, without selecting the table', () => {
    const h = harness()
    expect(h.editor.seating.plusAt(h.seat('t1', 2))).toMatchObject({ itemId: 't1', seatIndex: 2 })
    expect(h.editor.seating.plusAt(h.seat('t1', 0))).toBeNull()
    h.click(h.seat('t1', 2))
    expect(h.s().picker).toMatchObject({ itemId: 't1', seatIndex: 2, label: 'Table 1, seat 3', screen: h.seat('t1', 2), client: h.seat('t1', 2) })
    expect(h.editor.ui.getState().selection).toEqual([])
    expect(h.editor.actions.chooseForSeat('john')).toMatchObject({ status: 'done' })
    expect(h.seatOf('t1', 2)).toBe('john')
    expect(h.s().picker).toBeNull()
    expect(h.commits).toHaveLength(1)
  })

  it('takes presses up to 22 px from the seat at middle level, but a taken seat under the pointer wins', () => {
    const h = harness({ zoom: 0.65 })
    expect(h.editor.camera.detailLevel()).toBe('middle')
    const at = h.seat('t1', 2)
    h.click({ x: at.x + 18, y: at.y })
    expect(h.s().picker).toMatchObject({ itemId: 't1', seatIndex: 2 })
    h.editor.actions.closeSeatPicker()
    h.click(h.seat('t1', 0))
    expect(h.s().picker).toBeNull()
    expect(h.editor.ui.getState().guestSeats).toEqual([{ itemId: 't1', seatIndex: 0 }])
  })

  it('works only in Edit mode at close and middle level, and not during a drag', () => {
    const h = harness()
    const at = () => h.seat('t3', 1)
    h.editor.actions.setMode('view')
    expect(h.editor.seating.plusAt(at())).toBeNull()
    expect(h.editor.controller.targetAt(at())).toMatchObject({ kind: 'seat', itemId: 't3', seatIndex: 1 })
    expect(h.editor.controller.targetAt(at())).not.toHaveProperty('plus')
    h.editor.actions.setMode('edit')
    expect(h.editor.seating.plusAt(at())).toMatchObject({ itemId: 't3', seatIndex: 1 })
    h.editor.camera.set({ zoom: 0.2, x: 500, y: 400 }, { immediate: true })
    expect(h.editor.seating.plusAt(at())).toBeNull()
    h.editor.camera.set({ zoom: 1, x: 500, y: 400 }, { immediate: true })
    const p = h.listDown('john', { x: 1200, y: 300 })
    p.move({ x: 1100, y: 300 })
    expect(h.editor.seating.plusAt(at())).toBeNull()
    p.up({ x: 1100, y: 300 })
    expect(h.editor.seating.plusAt(at())).not.toBeNull()
  })

  it('a dragged table has no + until the drag ends', () => {
    const h = harness()
    const from = h.world({ x: 0, y: 30 })
    const c = h.editor.controller
    c.pointer({ type: 'down', id: 3, pointer: 'mouse', button: 0, at: from, time: 0, target: c.targetAt(from), shift: false, alt: false })
    c.pointer({ type: 'move', id: 3, at: { x: from.x + 40, y: from.y }, time: 0, shift: false, alt: false })
    expect(h.editor.seating.plusAt(h.seat('t3', 1))).toBeNull()
    c.pointer({ type: 'up', id: 3, at: { x: from.x + 40, y: from.y }, time: 0, shift: false, alt: false })
    expect(h.editor.seating.plusAt(h.seat('t3', 1))).not.toBeNull()
  })

  it('every empty seat on screen takes a +, not only the 60 nearest the middle (review finding)', () => {
    // 25 new ten-seat tables at middle level: 250 empty seats.
    const items = Array.from({ length: 25 }, (_, i) => {
      const t = table(`t${i + 1}`, (i % 5) * 400 - 800, Math.floor(i / 5) * 400 - 800)
      return { ...t, seatCount: 10, seats: Array.from({ length: 10 }, (_, index) => ({ index, guestId: null })) }
    })
    const h = harness({ items, zoom: 0.5 })
    expect(h.editor.camera.detailLevel()).toBe('middle')
    // A seat near the edge of the view, far from the middle.
    const edge = h.seat('t25', 3)
    expect(h.editor.controller.targetAt(edge)).toMatchObject({ kind: 'seat', itemId: 't25', seatIndex: 3, plus: true })
    h.click(edge)
    expect(h.s().picker).toMatchObject({ itemId: 't25', seatIndex: 3 })
    expect(h.editor.ui.getState().selection).toEqual([])
  })

  it("the + never takes a press meant for another item's body (review finding)", () => {
    // A cake table (a fixture) whose edge is 30 cm above the top seat's center, on an empty round table, at middle level.
    const cake = { ...makeItem('cake', { x: 0, y: -(76.2 + 30.5 + 30 + 45) }, 'cake', emptyCanvas()), width: 90, height: 90 }
    const h = harness({ items: [table('t1', 0, 0), cake], zoom: 0.6 })
    const seat0 = seatCenters(h.table('t1'))[0]
    // 3 cm inside the cake table's bottom edge: within 22 px of seat 0.
    const press = h.world({ x: 0, y: cake.y + 45 - 3 })
    expect(Math.hypot(press.x - h.world(seat0).x, press.y - h.world(seat0).y)).toBeLessThan(22)
    expect(h.editor.controller.targetAt(press)).toMatchObject({ kind: 'item', itemId: 'cake' })
    h.drag([press, { x: press.x, y: press.y - 60 }])
    expect(h.table('t1').x).toBe(0)
    expect(h.table('t1').y).toBe(0)
    expect((h.canvas().items.find((i) => i.id === 'cake') as Item).y).toBeLessThan(cake.y)
    // Empty canvas next to a seat, or the table's own body, still finds the +.
    expect(h.editor.controller.targetAt(h.world({ x: seat0.x + 30, y: seat0.y }))).toMatchObject({ kind: 'seat', seatIndex: 0, plus: true })
  })

  it('closes the picker on Esc, a press elsewhere, or when the seat is taken', () => {
    const h = harness()
    h.editor.actions.openSeatPicker('t3', 0)
    expect(h.key('Escape')).toBe(true)
    expect(h.s().picker).toBeNull()
    h.editor.actions.openSeatPicker('t3', 0)
    h.click(h.world({ x: -400, y: -300 }))
    expect(h.s().picker).toBeNull()
    h.editor.actions.openSeatPicker('t3', 0)
    h.editor.actions.seatGuest('ann', 't3', 0)
    expect(h.s().picker).toBeNull()
    expect(h.editor.actions.openSeatPicker('t1', 0)).toBe(false)
    expect(seatName(h.table('t3'), 0)).toBe('Table 3, seat 1')
  })
})

describe('pan to a seat', () => {
  it('glides to at least close level with the seat in the middle, and pulses it for two seconds', () => {
    const h = harness({ zoom: 0.2 })
    expect(h.editor.actions.panToGuest('jane')).toBe('done')
    expect(h.editor.camera.isAnimating()).toBe(true)
    expect(h.s().pulse).toMatchObject({ itemId: 't1', seatIndex: 0 })
    h.setTime(150)
    h.runFrames()
    h.setTime(310)
    h.runFrames()
    expect(h.editor.camera.isAnimating()).toBe(false)
    expect(h.zoom()).toBeCloseTo(minZoomForLevel('close'), 9)
    expect(h.editor.camera.detailLevel()).toBe('close')
    const at = h.seat('t1', 0)
    expect(at.x).toBeCloseTo(500, 6)
    expect(at.y).toBeCloseTo(400, 6)
    h.setTime(PULSE_MS - 1)
    expect(h.s().pulse).not.toBeNull()
    h.setTime(PULSE_MS)
    expect(h.s().pulse).toBeNull()
  })

  it('keeps a closer zoom, works in View mode, and jumps when asked for less motion', () => {
    const h = harness({ zoom: 2, mode: 'view', reducedMotion: true })
    expect(h.editor.actions.panToGuest('jane')).toBe('done')
    expect(h.editor.camera.isAnimating()).toBe(false)
    expect(h.zoom()).toBe(2)
    expect(h.seat('t1', 0).x).toBeCloseTo(500, 6)
  })

  it('centers in the part of the view the bottom sheet leaves free', () => {
    const cam = focusCamera({ x: 100, y: 100 }, 1, { width: 390, height: 700 }, { top: 66, right: 0, bottom: 154, left: 0 })
    expect(cam).toEqual({ zoom: 1, x: 195 - 100, y: 66 + (700 - 66 - 154) / 2 - 100 })
  })

  it('says when the guest has no seat', () => {
    const h = harness()
    expect(h.editor.actions.panToGuest('john')).toBe('notSeated')
    expect(h.s().pulse).toBeNull()
  })
})

describe('guest cards', () => {
  it('shows after a mouse rests 150 ms on a taken seat, and goes when it leaves', () => {
    const h = harness()
    h.editor.controller.hover(h.seat('t1', 0))
    h.setTime(HOVER_CARD_MS - 1)
    expect(h.s().card).toBeNull()
    h.setTime(HOVER_CARD_MS)
    expect(h.s().card).toMatchObject({ guestId: 'jane', itemId: 't1', seatIndex: 0, source: 'hover', screen: h.seat('t1', 0) })
    h.editor.controller.hover(h.world({ x: -400, y: -300 }))
    expect(h.s().card).toBeNull()
  })

  it('does not show when the mouse moves on before 150 ms', () => {
    const h = harness()
    h.editor.controller.hover(h.seat('t1', 0))
    h.setTime(100)
    h.editor.controller.hover(null)
    h.setTime(400)
    expect(h.s().card).toBeNull()
  })

  it('shows for a seat tapped in View mode, and goes with a tap elsewhere or a pan', () => {
    const h = harness({ mode: 'view' })
    h.click(h.seat('t1', 0), { pointer: 'touch' })
    expect(h.s().card).toMatchObject({ guestId: 'jane', source: 'tap' })
    // The card is the whole answer: the page does not also open the table's details.
    expect(h.taps).toEqual([])
    h.click(h.world({ x: -400, y: -300 }), { pointer: 'touch' })
    expect(h.s().card).toBeNull()
    expect(h.taps).toEqual(['empty'])
    h.click(h.seat('t1', 0), { pointer: 'touch' })
    h.editor.camera.panBy(10, 0)
    h.runFrames()
    expect(h.s().card).toBeNull()
  })

  it('a tap in Edit mode selects the guest and shows no card', () => {
    const h = harness()
    h.click(h.seat('t1', 0), { pointer: 'touch' })
    expect(h.s().card).toBeNull()
    expect(h.editor.ui.getState().guestSeats).toHaveLength(1)
  })
})

describe('a side list row in the browser', () => {
  /** A stand-in for the window: real EventTarget listeners, events carrying pointer fields. */
  function fakeWindow() {
    const target = new EventTarget()
    const counts = new Map<string, number>()
    const win: ListWindow = {
      addEventListener(type, listener, options) {
        counts.set(type, (counts.get(type) ?? 0) + 1)
        target.addEventListener(type, listener, options)
      },
      removeEventListener(type, listener, options) {
        counts.set(type, (counts.get(type) ?? 0) - 1)
        target.removeEventListener(type, listener, options)
      },
    }
    const fire = (type: string, fields: Record<string, unknown> = {}, cancelable = false) => {
      const event = new Event(type, { cancelable })
      for (const [k, v] of Object.entries(fields)) Object.defineProperty(event, k, { value: v })
      target.dispatchEvent(event)
      return event
    }
    const listening = () => [...counts.values()].some((n) => n > 0)
    return { win, fire, listening }
  }
  const pointer = (id: number, type: string, x: number, y: number) => ({ pointerId: id, pointerType: type, button: 0, clientX: x, clientY: y, timeStamp: 0 })

  it('follows a mouse drag through window events and stops listening after the drop', () => {
    const w = fakeWindow()
    const h = harness({ listWindow: w.win })
    h.editor.seating.listPointerDown(pointer(5, 'mouse', 1200, 300), 'john')
    expect(w.listening()).toBe(true)
    const to = h.seat('t1', 2)
    w.fire('pointermove', pointer(5, 'mouse', 1100, 300))
    w.fire('pointermove', pointer(6, 'mouse', 0, 0))
    w.fire('pointermove', pointer(5, 'mouse', to.x, to.y))
    expect(h.s().drag?.targetSeat).toEqual({ itemId: 't1', seatIndex: 2 })
    w.fire('pointerup', pointer(5, 'mouse', to.x, to.y))
    expect(h.seatOf('t1', 2)).toBe('john')
    expect(w.listening()).toBe(false)
  })

  it('stops the page scrolling only once a finger has held for 450 ms, and Esc cancels', () => {
    const w = fakeWindow()
    const h = harness({ listWindow: w.win })
    h.editor.seating.listPointerDown(pointer(1, 'touch', 1200, 300), 'john')
    expect(w.fire('touchmove', {}, true).defaultPrevented).toBe(false)
    expect(w.fire('contextmenu', {}, true).defaultPrevented).toBe(true)
    h.setTime(LIST_LONG_PRESS_MS)
    expect(h.s().drag).not.toBeNull()
    expect(w.fire('touchmove', {}, true).defaultPrevented).toBe(true)
    expect(w.fire('keydown', { key: 'Escape' }, true).defaultPrevented).toBe(true)
    expect(h.s().drag).toBeNull()
    expect(w.listening()).toBe(false)
    expect(h.commits).toHaveLength(0)
  })

  it('lets go when the browser takes the touch for a scroll', () => {
    const w = fakeWindow()
    const h = harness({ listWindow: w.win })
    h.editor.seating.listPointerDown(pointer(1, 'touch', 1200, 300), 'john')
    w.fire('pointercancel', { pointerId: 1 })
    expect(w.listening()).toBe(false)
    h.setTime(LIST_LONG_PRESS_MS)
    expect(h.s().drag).toBeNull()
  })

  it('ignores a right press', () => {
    const w = fakeWindow()
    const h = harness({ listWindow: w.win })
    h.editor.seating.listPointerDown({ ...pointer(1, 'mouse', 0, 0), button: 2 }, 'john')
    expect(w.listening()).toBe(false)
  })
})
