import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyCanvas } from '@/domain/canvas-schema'
import { makeItem } from '@/domain/presets'
import type { CameraController, CameraTargets } from '../camera/camera-controller'
import { createDocStore } from '../doc-store'
import { createEditorState } from '../state'
import type { EditorController } from './controller'
import { attachInput, isIOS, overlayTarget } from './dom-adapter'

/** A viewport that dispatches events, with just the element parts the adapter uses. */
function fakeViewport() {
  const target = new EventTarget()
  const props = new Map<string, string>()
  const captured: number[] = []
  const style = {
    touchAction: '',
    userSelect: '',
    overscrollBehavior: '',
    setProperty: (k: string, v: string) => void props.set(k, v),
    getPropertyValue: (k: string) => props.get(k) ?? '',
  }
  const viewport = Object.assign(target, {
    style,
    tabIndex: 0,
    hasAttribute: () => false,
    setPointerCapture: (id: number) => void captured.push(id),
    focus: vi.fn(),
    contains: () => true,
  })
  return { viewport, props, captured }
}

function fakeController() {
  return {
    pointer: vi.fn(),
    targetAt: vi.fn(() => ({ kind: 'empty' as const })),
    hover: vi.fn(),
    contextMenu: vi.fn(),
    wheel: vi.fn(),
    gesture: vi.fn(),
    keyDown: vi.fn(() => true),
    keyUp: vi.fn(() => false),
    blur: vi.fn(),
  }
}

const camera = { clientToScreen: (x: number, y: number) => ({ x: x - 10, y: y - 20 }), measure: vi.fn() }

function event(type: string, props: Record<string, unknown>): Event {
  const e = new Event(type, { cancelable: true })
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v })
  return e
}

function setup() {
  const win = new EventTarget()
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', { activeElement: null, querySelector: () => null })
  const v = fakeViewport()
  const controller = fakeController()
  const detach = attachInput({
    viewport: v.viewport as unknown as HTMLElement,
    controller: controller as unknown as EditorController,
    camera: camera as unknown as CameraController,
  })
  return { ...v, controller, detach, win }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const pointer = (type: string, o: Record<string, unknown> = {}) =>
  event(type, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 110, clientY: 120, shiftKey: false, altKey: false, ...o })

describe('the DOM adapter', () => {
  it('turns off touch scrolling, selection and the long-press callout, and puts them back', () => {
    const { viewport, props, detach } = setup()
    expect(viewport.style.touchAction).toBe('none')
    expect(viewport.style.userSelect).toBe('none')
    expect(props.get('-webkit-touch-callout')).toBe('none')
    detach()
    expect(viewport.style.touchAction).toBe('')
  })

  it('sends a press, its moves and its release in viewport coordinates, and captures the pointer', () => {
    const { viewport, controller, captured } = setup()
    viewport.dispatchEvent(pointer('pointerdown', { shiftKey: true }))
    viewport.dispatchEvent(pointer('pointermove', { clientX: 130 }))
    viewport.dispatchEvent(pointer('pointerup', { clientX: 130 }))
    expect(captured).toEqual([1])
    const calls = controller.pointer.mock.calls.map(([input]) => input)
    expect(calls[0]).toMatchObject({ type: 'down', id: 1, pointer: 'mouse', at: { x: 100, y: 100 }, shift: true, target: { kind: 'empty' } })
    expect(calls[1]).toMatchObject({ type: 'move', at: { x: 120, y: 100 } })
    expect(calls[2]).toMatchObject({ type: 'up', at: { x: 120, y: 100 } })
  })

  it('sends hover for a mouse with no button down', () => {
    const { viewport, controller } = setup()
    viewport.dispatchEvent(pointer('pointermove', { buttons: 0 }))
    expect(controller.hover).toHaveBeenCalledWith({ x: 100, y: 100 })
    expect(controller.pointer).not.toHaveBeenCalled()
  })

  it('takes the wheel with preventDefault', () => {
    const { viewport, controller } = setup()
    const e = event('wheel', { deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: true, clientX: 10, clientY: 20, wheelDeltaY: 120 })
    viewport.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    expect(controller.wheel).toHaveBeenCalledWith(expect.objectContaining({ deltaY: -100, ctrlKey: true, wheelDeltaY: 120, at: { x: 0, y: 0 } }))
  })

  it('opens the menu on right click but not right after a touch', () => {
    const { viewport, controller } = setup()
    const right = event('contextmenu', { clientX: 110, clientY: 120 })
    viewport.dispatchEvent(right)
    expect(right.defaultPrevented).toBe(true)
    expect(controller.contextMenu).toHaveBeenCalledWith({ x: 100, y: 100 }, { kind: 'empty' }, 'mouse')
    controller.contextMenu.mockClear()
    viewport.dispatchEvent(event('contextmenu', { clientX: 110, clientY: 120, pointerType: 'touch' }))
    expect(controller.contextMenu).not.toHaveBeenCalled()
  })

  it('prevents the browser use of handled keys, and leaves text fields alone', () => {
    const { win, controller } = setup()
    const key = event('keydown', { key: 'd', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })
    win.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(true)
    controller.keyDown.mockClear()
    const typing = event('keydown', { key: 'Backspace', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })
    Object.defineProperty(typing, 'target', { value: { tagName: 'INPUT', type: 'text' } })
    win.dispatchEvent(typing)
    expect(controller.keyDown).not.toHaveBeenCalled()
  })

  it('lets go of everything when the window loses focus', () => {
    const { win, controller } = setup()
    win.dispatchEvent(new Event('blur'))
    expect(controller.blur).toHaveBeenCalled()
  })

  it('cancels every press when the window loses focus, and drops their late releases (A7)', () => {
    const { viewport, win, controller } = setup()
    viewport.dispatchEvent(pointer('pointerdown', { pointerId: 4, pointerType: 'touch' }))
    viewport.dispatchEvent(pointer('pointerdown', { pointerId: 5, pointerType: 'touch', clientX: 200 }))
    controller.pointer.mockClear()
    win.dispatchEvent(new Event('blur'))
    expect(controller.pointer.mock.calls.map(([input]) => input)).toEqual([
      { type: 'cancel', id: 4 },
      { type: 'cancel', id: 5 },
    ])
    expect(controller.blur).toHaveBeenCalled()
    controller.pointer.mockClear()
    viewport.dispatchEvent(pointer('pointerup', { pointerId: 4, pointerType: 'touch' }))
    expect(controller.pointer).not.toHaveBeenCalled()
  })

  it('finds handles and the rotate handle by their data attributes', () => {
    const el = (attrs: Record<string, string>, selectorHit: string) => ({
      closest: (sel: string) => (sel === selectorHit ? { closest: () => null, getAttribute: (k: string) => attrs[k] ?? null } : null),
    })
    const root = { contains: () => true }
    expect(overlayTarget({ target: el({ 'data-handle': 'se', 'data-item-id': 't1' }, '[data-handle]') as unknown as EventTarget }, root)).toEqual({
      kind: 'handle',
      itemId: 't1',
      handle: 'se',
    })
    expect(overlayTarget({ target: el({ 'data-item-id': 't1' }, '[data-rotate-handle]') as unknown as EventTarget }, root)).toEqual({ kind: 'rotate', itemId: 't1' })
    expect(overlayTarget({ target: el({ 'data-handle': 'zz', 'data-item-id': 't1' }, '[data-handle]') as unknown as EventTarget }, root)).toBeNull()
  })

  it('finds a wall point by data-vertex (the template editor)', () => {
    const el = (attrs: Record<string, string>) => ({
      closest: (sel: string) => (sel === '[data-vertex]' ? { closest: () => null, getAttribute: (k: string) => attrs[k] ?? null } : null),
    })
    const root = { contains: () => true }
    expect(overlayTarget({ target: el({ 'data-vertex': '2', 'data-item-id': 'w1' }) as unknown as EventTarget }, root)).toEqual({
      kind: 'vertex',
      itemId: 'w1',
      index: 2,
    })
    expect(overlayTarget({ target: el({ 'data-vertex': 'x', 'data-item-id': 'w1' }) as unknown as EventTarget }, root)).toBeNull()
  })

  it('picks the nearest handle when the touch targets of neighboring handles overlap', () => {
    // A thin table at a low zoom: e and se sit 10 px apart, so se's 44 px target covers e.
    const handle = (name: string, x: number, y: number) => ({
      getAttribute: (k: string) => (k === 'data-handle' ? name : k === 'data-item-id' ? 't1' : null),
      getBoundingClientRect: () => ({ left: x - 22, top: y - 22, width: 44, height: 44 }) as DOMRect,
    })
    const handles = [handle('ne', 100, 90), handle('e', 100, 100), handle('se', 100, 110)]
    const root = { contains: () => true, querySelectorAll: () => handles }
    const pressedOnSe = { closest: (sel: string) => (sel === '[data-handle]' ? handles[2] : null) } as unknown as EventTarget
    expect(overlayTarget({ target: pressedOnSe, clientX: 101, clientY: 101 }, root)).toEqual({ kind: 'handle', itemId: 't1', handle: 'e' })
    expect(overlayTarget({ target: pressedOnSe, clientX: 100, clientY: 108 }, root)).toEqual({ kind: 'handle', itemId: 't1', handle: 'se' })
  })

  it('knows iPhones and iPads, which pinch with touch', () => {
    expect(isIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe(true)
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
  })
})

describe('the DOM adapter with the real editor', () => {
  it('still selects on a tap after the window lost focus during a touch (A7)', () => {
    const win = new EventTarget()
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', { activeElement: null, querySelector: () => null })
    const store = createDocStore({ ...emptyCanvas(), items: [makeItem('round', { x: 300, y: 300 }, 'a', emptyCanvas())] })
    const editor = createEditorState({
      layoutId: 'L1',
      store,
      onCommit: () => undefined,
      settings: () => ({ unit: 'ft', minGapCm: 152.4 }),
      storage: null,
      scheduler: { requestFrame: () => 1, cancelFrame: () => undefined, setTimer: () => 1, clearTimer: () => undefined },
      traits: () => ({ width: 1440, touchOnly: false, phone: false }),
      setTimer: () => undefined,
    })
    editor.loadDevice()
    const style = { transform: '', transformOrigin: '', setProperty: () => undefined }
    const targets: CameraTargets = {
      viewport: { style, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }), setAttribute: () => undefined },
      wrapper: { style: { ...style } },
      world: { setAttribute: () => undefined },
    }
    editor.camera.attach(targets)
    editor.camera.set({ zoom: 1, x: 0, y: 0 }, { immediate: true })
    const { viewport } = fakeViewport()
    const detach = attachInput({ viewport: viewport as unknown as HTMLElement, controller: editor.controller, camera: editor.camera })
    const touch = (type: string, id: number) => pointer(type, { pointerId: id, pointerType: 'touch', clientX: 300, clientY: 300 })

    viewport.dispatchEvent(touch('pointerdown', 9))
    expect(editor.controller.isBusy()).toBe(true)
    win.dispatchEvent(new Event('blur'))
    viewport.dispatchEvent(touch('pointerup', 9))
    expect(editor.controller.isBusy()).toBe(false)
    viewport.dispatchEvent(touch('pointerdown', 10))
    viewport.dispatchEvent(touch('pointerup', 10))
    expect(editor.ui.getState().selection).toEqual(['a'])
    detach()
    editor.destroy()
  })
})
