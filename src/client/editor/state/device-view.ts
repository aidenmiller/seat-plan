/**
 * What each device keeps for itself, never in the saved canvas (PLAN change
 * 1, DECISIONS 16 and 19), all in localStorage:
 *
 *  - 'seat-plan:view:<layoutId>': the camera and the layer switches for that
 *    layout, so each layout reopens where this person left it.
 *  - 'seat-plan:wheel': the "Mouse wheel: zoom / pan" setting (PLAN change 11).
 *  - 'seat-plan:mode': the last Edit or View choice.
 *
 * Storage can be missing (server render) or blocked; every read falls back to
 * the defaults and every write is allowed to fail.
 */
import { parseCamera, type Camera } from '@/domain/camera'
import type { WheelSetting } from '@/domain/wheel'
import { createStore, type Store } from './store'
import type { EditorMode } from './ui-store'

export const VIEW_KEY_PREFIX = 'seat-plan:view:'
export const WHEEL_KEY = 'seat-plan:wheel'
export const MODE_KEY = 'seat-plan:mode'

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type LayerName = 'venue' | 'furniture' | 'notes'
export const LAYER_NAMES: readonly LayerName[] = ['venue', 'furniture', 'notes']
export type LayerSwitch = { visible: boolean; locked: boolean }
export type Layers = Record<LayerName, LayerSwitch>

export type DeviceView = {
  /** Null until this device has looked at the layout: the editor then fits the content. */
  camera: Camera | null
  layers: Layers
  showReferenceImage: boolean
}

export function defaultLayers(): Layers {
  return {
    // The venue layer is the template's fixed items: always locked in a layout (spec section 5).
    venue: { visible: true, locked: true },
    furniture: { visible: true, locked: false },
    notes: { visible: true, locked: false },
  }
}

export function defaultDeviceView(): DeviceView {
  return { camera: null, layers: defaultLayers(), showReferenceImage: false }
}

/** localStorage, or null on the server or when the browser blocks it. */
export function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readJson(storage: StorageLike | null, key: string): unknown {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

function write(storage: StorageLike | null, key: string, value: string): void {
  if (!storage) return
  try {
    storage.setItem(key, value)
  } catch {
    // Full or blocked: this device just forgets.
  }
}

function parseLayers(value: unknown): Layers {
  const layers = defaultLayers()
  if (typeof value !== 'object' || value === null) return layers
  const v = value as Record<string, unknown>
  for (const name of LAYER_NAMES) {
    const s = v[name]
    if (typeof s !== 'object' || s === null) continue
    const { visible, locked } = s as Record<string, unknown>
    if (typeof visible === 'boolean') layers[name].visible = visible
    if (typeof locked === 'boolean' && name !== 'venue') layers[name].locked = locked
  }
  return layers
}

export function readDeviceView(storage: StorageLike | null, layoutId: string): DeviceView {
  const value = readJson(storage, VIEW_KEY_PREFIX + layoutId)
  if (typeof value !== 'object' || value === null) return defaultDeviceView()
  const v = value as Record<string, unknown>
  return {
    camera: parseCamera(v.camera),
    layers: parseLayers(v.layers),
    showReferenceImage: v.showReferenceImage === true,
  }
}

export function writeDeviceView(storage: StorageLike | null, layoutId: string, view: DeviceView): void {
  write(storage, VIEW_KEY_PREFIX + layoutId, JSON.stringify(view))
}

export function readWheelSetting(storage: StorageLike | null): WheelSetting {
  const raw = readJson(storage, WHEEL_KEY)
  return raw === 'zoom' || raw === 'pan' || raw === 'auto' ? raw : 'auto'
}

export function writeWheelSetting(storage: StorageLike | null, setting: WheelSetting): void {
  write(storage, WHEEL_KEY, JSON.stringify(setting))
}

export function readMode(storage: StorageLike | null): EditorMode | null {
  const raw = readJson(storage, MODE_KEY)
  return raw === 'edit' || raw === 'view' ? raw : null
}

export function writeMode(storage: StorageLike | null, mode: EditorMode): void {
  write(storage, MODE_KEY, JSON.stringify(mode))
}

// ---------------------------------------------------------------- the store

export type ViewState = {
  layers: Layers
  showReferenceImage: boolean
  wheel: WheelSetting
}

export type ViewStore = Store<ViewState> & {
  layoutId: string
  /** Reads this device's saved view (call once, in the browser). Returns the saved camera, if any. */
  load(): Camera | null
  setLayer(name: LayerName, patch: Partial<LayerSwitch>): void
  setShowReferenceImage(on: boolean): void
  setWheel(setting: WheelSetting): void
  /** The camera after a gesture settles. */
  saveCamera(camera: Camera): void
  /** The last saved camera, or null. */
  camera(): Camera | null
}

/** The per-device view of one layout. Starts at the defaults; load() reads storage. */
export function createViewStore(layoutId: string, storage: StorageLike | null): ViewStore {
  const store = createStore<ViewState>({ layers: defaultLayers(), showReferenceImage: false, wheel: 'auto' })
  let camera: Camera | null = null

  function persist() {
    const s = store.getState()
    writeDeviceView(storage, layoutId, { camera, layers: s.layers, showReferenceImage: s.showReferenceImage })
  }

  return {
    ...store,
    layoutId,
    load() {
      const saved = readDeviceView(storage, layoutId)
      camera = saved.camera
      store.setState({ layers: saved.layers, showReferenceImage: saved.showReferenceImage, wheel: readWheelSetting(storage) })
      return camera
    },
    setLayer(name, patch) {
      const layers = store.getState().layers
      const next: LayerSwitch = { ...layers[name], ...patch }
      if (name === 'venue') next.locked = true
      if (next.visible === layers[name].visible && next.locked === layers[name].locked) return
      store.setState({ layers: { ...layers, [name]: next } })
      persist()
    },
    setShowReferenceImage(on) {
      store.setState({ showReferenceImage: on })
      persist()
    },
    setWheel(setting) {
      store.setState({ wheel: setting })
      writeWheelSetting(storage, setting)
    },
    saveCamera(next) {
      camera = { zoom: next.zoom, x: next.x, y: next.y }
      persist()
    },
    camera: () => camera,
  }
}
