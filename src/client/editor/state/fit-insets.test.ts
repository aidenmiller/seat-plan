import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyCanvas } from '@/domain/canvas-schema'
import { contentBox } from '@/domain/geometry'
import { makeItem } from '@/domain/presets'
import type { FrameScheduler } from '../camera/camera-controller'
import { createDocStore } from '../doc-store'
import type { StorageLike } from './device-view'
import { createEditorState } from './index'

/**
 * Fit to content leaves room for what covers the canvas (the toolbar, the
 * zoom controls and on phones the bottom sheet's strip): the first fit on
 * mount, and every fit after it (the zoom button, the canvas menu and
 * Ctrl+1 all call actions.zoomFit).
 */

function memoryStorage(): StorageLike {
  const data = new Map<string, string>()
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

const scheduler: FrameScheduler = {
  requestFrame: () => 1,
  cancelFrame: () => undefined,
  setTimer: () => 1,
  clearTimer: () => undefined,
}

function fakeElement(width: number, height: number) {
  const style = {
    transform: '',
    transformOrigin: '',
    touchAction: '',
    userSelect: '',
    overscrollBehavior: '',
    setProperty: () => undefined,
    getPropertyValue: () => '',
  }
  return {
    style,
    tabIndex: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    setAttribute: () => undefined,
    hasAttribute: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
}

const PHONE_INSETS = { top: 66, right: 0, bottom: 154, left: 0 }

function editorWithTable() {
  const canvas = emptyCanvas()
  const table = makeItem('round', { x: 0, y: 0 }, 't1', canvas)
  const store = createDocStore({ ...canvas, items: [table] })
  const editor = createEditorState({
    layoutId: 'l1',
    store,
    onCommit: () => undefined,
    settings: () => ({ unit: 'ft', minGapCm: 152.4 }),
    storage: memoryStorage(),
    scheduler,
    traits: () => ({ width: 390, touchOnly: true, phone: true }),
  })
  return { editor, box: contentBox({ items: [table] })! }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fit to content with the fit insets', () => {
  it('keeps the first fit on mount clear of the phone toolbar and bottom sheet', () => {
    vi.stubGlobal('window', { addEventListener: () => undefined, removeEventListener: () => undefined })
    const { editor, box } = editorWithTable()
    editor.camera.setFitInsets(PHONE_INSETS)
    const viewport = fakeElement(390, 700)
    const cleanup = editor.mount({
      viewport: viewport as unknown as HTMLElement,
      wrapper: fakeElement(390, 700) as unknown as HTMLElement,
      world: { setAttribute: () => undefined } as unknown as SVGGElement,
    })
    const top = editor.camera.worldToScreen({ x: 0, y: box.minY })
    const bottom = editor.camera.worldToScreen({ x: 0, y: box.maxY })
    const middle = editor.camera.worldToScreen({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 })
    expect(top.y).toBeGreaterThanOrEqual(PHONE_INSETS.top)
    expect(bottom.y).toBeLessThanOrEqual(700 - PHONE_INSETS.bottom)
    // Centered in the free part, not in the whole viewport.
    expect(middle.y).toBeCloseTo(PHONE_INSETS.top + (700 - PHONE_INSETS.top - PHONE_INSETS.bottom) / 2, 6)
    expect(middle.x).toBeCloseTo(195, 6)
    cleanup()
    editor.destroy()
  })

  it('uses the same insets for the Fit button, the canvas menu and Ctrl+1 (actions.zoomFit)', () => {
    const { editor, box } = editorWithTable()
    editor.camera.attach({
      viewport: fakeElement(390, 700),
      wrapper: fakeElement(390, 700),
      world: { setAttribute: () => undefined },
    })
    editor.camera.setFitInsets(PHONE_INSETS)
    editor.camera.zoomReset()
    editor.camera.panBy(500, 500)
    editor.camera.flush()
    editor.actions.zoomFit()
    const middle = editor.camera.worldToScreen({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 })
    expect(middle.y).toBeCloseTo(66 + 240, 6)
    expect(editor.camera.worldToScreen({ x: 0, y: box.maxY }).y).toBeLessThanOrEqual(700 - 154)
    // The keyboard shortcut goes through the same action.
    editor.camera.panBy(-300, 0)
    editor.camera.flush()
    editor.controller.keyDown({ key: '1', code: 'Digit1', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })
    expect(editor.camera.worldToScreen({ x: (box.minX + box.maxX) / 2, y: 0 }).x).toBeCloseTo(195, 6)
    editor.destroy()
  })
})
