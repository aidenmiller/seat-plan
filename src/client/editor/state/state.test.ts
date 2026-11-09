import { describe, expect, it, vi } from 'vitest'
import { emptyCanvas, type Canvas } from '@/domain/canvas-schema'
import { addItem } from '../commands'
import {
  createViewStore,
  MODE_KEY,
  readDeviceView,
  readMode,
  readWheelSetting,
  VIEW_KEY_PREFIX,
  WHEEL_KEY,
  writeMode,
  type StorageLike,
} from './device-view'
import { defaultMode, initialMode, readDeviceTraits } from './mode'
import { createStore, shallowEqual } from './store'
import { createUiStore } from './ui-store'

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

describe('createStore', () => {
  it('tells listeners only when a field changes', () => {
    const store = createStore({ a: 1, b: 'x' })
    const listener = vi.fn()
    store.subscribe(listener)
    store.setState({ a: 1 })
    expect(listener).not.toHaveBeenCalled()
    store.setState((s) => ({ a: s.a + 1 }))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getState()).toEqual({ a: 2, b: 'x' })
  })

  it('compares shallowly', () => {
    expect(shallowEqual([1, 2], [1, 2])).toBe(true)
    expect(shallowEqual([1, 2], [1, 3])).toBe(false)
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true)
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})

describe('the UI store', () => {
  it('selects, toggles and adds', () => {
    const ui = createUiStore()
    ui.select(['a', 'b'])
    ui.toggle('b')
    ui.toggle('c')
    expect(ui.getState().selection).toEqual(['a', 'c'])
    ui.add(['c', 'd'])
    expect(ui.getState().selection).toEqual(['a', 'c', 'd'])
    ui.clearSelection()
    expect(ui.getState().selection).toEqual([])
  })

  it('keeps guests and items apart in the selection', () => {
    const ui = createUiStore()
    ui.select(['a'])
    ui.selectSeat({ itemId: 't', seatIndex: 2 })
    expect(ui.getState().selection).toEqual([])
    ui.selectSeat({ itemId: 'u', seatIndex: 0 }, true)
    ui.selectSeat({ itemId: 't', seatIndex: 2 }, true)
    expect(ui.getState().guestSeats).toEqual([{ itemId: 'u', seatIndex: 0 }])
    ui.select(['a'])
    expect(ui.getState().guestSeats).toEqual([])
  })

  it('does not notify for a selection that did not change', () => {
    const ui = createUiStore()
    ui.select(['a'])
    const listener = vi.fn()
    ui.subscribe(listener)
    ui.select(['a'])
    ui.setHover(null)
    ui.setTool({ kind: 'select' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('drops items and seats that are gone', () => {
    const ui = createUiStore()
    let canvas: Canvas = addItem(emptyCanvas(), 'round', { x: 0, y: 0 }, 'a')
    ui.select(['a', 'gone'])
    ui.setHover({ kind: 'item', itemId: 'gone' })
    ui.prune(canvas)
    expect(ui.getState().selection).toEqual(['a'])
    expect(ui.getState().hover).toBeNull()
    const t = canvas.items[0]
    if (t.kind !== 'table') throw new Error('table expected')
    canvas = { ...canvas, items: [{ ...t, seats: t.seats.map((s, i) => (i === 1 ? { ...s, guestId: '00000000-0000-4000-8000-000000000001' } : s)) }] }
    ui.selectSeat({ itemId: 'a', seatIndex: 1 })
    ui.selectSeat({ itemId: 'a', seatIndex: 2 }, true)
    ui.prune(canvas)
    expect(ui.getState().guestSeats).toEqual([{ itemId: 'a', seatIndex: 1 }])
  })

  it('drops tools and the phone Select switch in View mode', () => {
    const ui = createUiStore({ mode: 'edit' })
    ui.setTool({ kind: 'place', presetId: 'round' })
    ui.setPhoneSelect(true)
    ui.setMode('view')
    expect(ui.getState()).toMatchObject({ mode: 'view', tool: { kind: 'select' }, phoneSelect: false })
  })
})

describe('the device view', () => {
  it('keeps camera and layers per layout, never the venue unlocked', () => {
    const storage = memoryStorage()
    const view = createViewStore('L1', storage)
    expect(view.load()).toBeNull()
    view.saveCamera({ zoom: 0.5, x: 10, y: 20 })
    view.setLayer('notes', { visible: false })
    view.setLayer('venue', { locked: false })
    const saved = readDeviceView(storage, 'L1')
    expect(saved.camera).toEqual({ zoom: 0.5, x: 10, y: 20 })
    expect(saved.layers.notes.visible).toBe(false)
    expect(saved.layers.venue.locked).toBe(true)
    expect(readDeviceView(storage, 'L2').camera).toBeNull()

    const again = createViewStore('L1', storage)
    expect(again.load()).toEqual({ zoom: 0.5, x: 10, y: 20 })
    expect(again.getState().layers.notes.visible).toBe(false)
  })

  it('falls back to defaults for missing, broken or blocked storage', () => {
    const storage = memoryStorage()
    storage.data.set(VIEW_KEY_PREFIX + 'L1', '{not json')
    expect(readDeviceView(storage, 'L1').camera).toBeNull()
    storage.data.set(VIEW_KEY_PREFIX + 'L1', JSON.stringify({ camera: { zoom: 99, x: 1, y: 2 }, layers: { furniture: { locked: 'yes' } } }))
    const v = readDeviceView(storage, 'L1')
    expect(v.camera).toEqual({ zoom: 8, x: 1, y: 2 })
    expect(v.layers.furniture.locked).toBe(false)
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => undefined,
    }
    expect(readDeviceView(blocked, 'L1').camera).toBeNull()
    expect(() => createViewStore('L1', blocked).saveCamera({ zoom: 1, x: 0, y: 0 })).not.toThrow()
    expect(readDeviceView(null, 'L1').camera).toBeNull()
  })

  it('remembers the mouse wheel setting and the mode for the whole device', () => {
    const storage = memoryStorage()
    expect(readWheelSetting(storage)).toBe('auto')
    createViewStore('L1', storage).setWheel('pan')
    expect(readWheelSetting(storage)).toBe('pan')
    expect(storage.data.has(WHEEL_KEY)).toBe(true)
    expect(readMode(storage)).toBeNull()
    writeMode(storage, 'view')
    expect(readMode(storage)).toBe('view')
    expect(storage.data.get(MODE_KEY)).toBe('"view"')
  })
})

describe('the mode a device opens in (PLAN change 13, DECISIONS 19)', () => {
  it('opens phones, touch-only devices and narrow screens in View, else Edit', () => {
    expect(defaultMode({ width: 1440, touchOnly: false, phone: false })).toBe('edit')
    expect(defaultMode({ width: 767, touchOnly: false, phone: false })).toBe('view')
    expect(defaultMode({ width: 844, touchOnly: true, phone: false })).toBe('view')
    expect(defaultMode({ width: 1024, touchOnly: false, phone: true })).toBe('view')
  })

  it('uses the device remembered choice first', () => {
    const storage = memoryStorage()
    const phone = { width: 390, touchOnly: true, phone: true }
    expect(initialMode(storage, phone)).toBe('view')
    writeMode(storage, 'edit')
    expect(initialMode(storage, phone)).toBe('edit')
  })

  it('reads touch-only and phones from the browser', () => {
    const media = (fine: boolean) => (q: string) => ({ matches: q.includes('fine') ? fine : !fine })
    const iphone = readDeviceTraits({
      innerWidth: 844,
      matchMedia: media(false),
      navigator: { maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' },
    })
    expect(iphone).toEqual({ width: 844, touchOnly: true, phone: true })
    const laptop = readDeviceTraits({ innerWidth: 1440, matchMedia: media(true), navigator: { maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (Macintosh)' } })
    expect(laptop).toEqual({ width: 1440, touchOnly: false, phone: false })
    expect(readDeviceTraits(undefined)).toEqual({ width: 1440, touchOnly: false, phone: false })
  })
})
