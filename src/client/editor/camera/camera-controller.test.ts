import { describe, expect, it, vi } from 'vitest'
import { screenToWorld } from '@/domain/camera'
import {
  ANIMATE_MS,
  createCameraController,
  cssMatrix,
  easeInOutCubic,
  interpolateCamera,
  gridVars,
  SETTLE_MS,
  worldTransform,
  wrapperTransform,
  type CameraTargets,
  type FrameScheduler,
} from './camera-controller'

/** Frames and timers that run only when the test says so. */
function fakeScheduler() {
  let now = 0
  let nextId = 1
  const frames = new Map<number, () => void>()
  const timers = new Map<number, { at: number; cb: () => void }>()
  const scheduler: FrameScheduler = {
    requestFrame: (cb) => {
      const id = nextId++
      frames.set(id, cb)
      return id
    },
    cancelFrame: (id) => void frames.delete(id),
    setTimer: (cb, ms) => {
      const id = nextId++
      timers.set(id, { at: now + ms, cb })
      return id
    },
    clearTimer: (id) => void timers.delete(id),
  }
  return {
    scheduler,
    frameCount: () => frames.size,
    /** Runs the frames waiting now. */
    frame() {
      const due = [...frames.values()]
      frames.clear()
      for (const cb of due) cb()
    },
    advance(ms: number) {
      now += ms
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id)
          t.cb()
        }
      }
    },
  }
}

function fakeTargets(width = 1000, height = 800) {
  const vars = new Map<string, string>()
  const attrs = new Map<string, string>()
  const worldAttrs = new Map<string, string>()
  const wrapperStyle = { transform: '', transformOrigin: '', setProperty: () => undefined }
  const targets: CameraTargets = {
    viewport: {
      style: { transform: '', transformOrigin: '', setProperty: (k: string, v: string) => void vars.set(k, v) },
      getBoundingClientRect: () => ({ left: 100, top: 50, width, height }),
      setAttribute: (k, v) => void attrs.set(k, v),
    },
    wrapper: { style: wrapperStyle },
    world: { setAttribute: (k, v) => void worldAttrs.set(k, v) },
  }
  return { targets, vars, attrs, worldAttrs, wrapperStyle }
}

describe('camera math', () => {
  it('writes matrices without float noise', () => {
    expect(cssMatrix(0.5, 10, -20)).toBe('matrix(0.5,0,0,0.5,10,-20)')
    expect(cssMatrix(1 / 3, 0.1 + 0.2, 1e-9)).toBe('matrix(0.333333,0,0,0.333333,0.3,0)')
    expect(worldTransform({ zoom: 2, x: 5, y: 6 })).toBe('matrix(2,0,0,2,5,6)')
  })

  it('moves the wrapper from the drawn camera to the live one', () => {
    const drawn = { zoom: 1, x: 0, y: 0 }
    expect(wrapperTransform(drawn, drawn)).toBe('')
    expect(wrapperTransform(drawn, { zoom: 1, x: 30, y: -10 })).toBe('matrix(1,0,0,1,30,-10)')
    // What the drawn camera put at screen s, the live camera puts at s * k + (x, y).
    const live = { zoom: 2, x: 40, y: 10 }
    const t = wrapperTransform({ zoom: 0.5, x: 10, y: 20 }, live)
    expect(t).toBe('matrix(4,0,0,4,0,-70)')
    const world = { x: 100, y: 100 }
    const drawnScreen = { x: 100 * 0.5 + 10, y: 100 * 0.5 + 20 }
    expect(drawnScreen.x * 4 + 0).toBeCloseTo(world.x * live.zoom + live.x, 9)
    expect(drawnScreen.y * 4 - 70).toBeCloseTo(world.y * live.zoom + live.y, 9)
  })

  it('places grid lines in real units and thins them when they crowd (DECISIONS 35)', () => {
    expect(gridVars({ zoom: 1, x: 0, y: 0 }, 'ft')).toEqual({ step: 30.48, x: 0, y: 0 })
    expect(gridVars({ zoom: 1, x: 100, y: -10 }, 'm')).toEqual({ step: 50, x: 0, y: 40 })
    // At 10% a foot is 3 px: every fifth line, 15.24 px apart.
    expect(gridVars({ zoom: 0.1, x: 0, y: 0 }, 'ft').step).toBeCloseTo(15.24, 9)
  })
})

describe('the camera controller', () => {
  it('moves the wrapper once per frame during a gesture, then redraws the SVG after 150 ms', () => {
    const clock = fakeScheduler()
    const page = fakeTargets()
    const onSettle = vi.fn()
    const camera = createCameraController({ scheduler: clock.scheduler, onSettle })
    camera.attach(page.targets)
    expect(page.worldAttrs.get('transform')).toBe('matrix(1,0,0,1,0,0)')
    expect(page.wrapperStyle.transformOrigin).toBe('0 0')

    camera.panBy(10, 0)
    camera.panBy(10, 5)
    camera.zoomAt({ x: 0, y: 0 }, 2)
    expect(clock.frameCount()).toBe(1)
    clock.frame()
    expect(page.wrapperStyle.transform).toBe('matrix(2,0,0,2,40,10)')
    // The SVG is untouched mid-gesture.
    expect(page.worldAttrs.get('transform')).toBe('matrix(1,0,0,1,0,0)')
    expect(camera.isMoving()).toBe(true)

    clock.advance(SETTLE_MS - 1)
    expect(onSettle).not.toHaveBeenCalled()
    clock.advance(1)
    expect(page.worldAttrs.get('transform')).toBe('matrix(2,0,0,2,40,10)')
    expect(page.wrapperStyle.transform).toBe('')
    expect(page.vars.get('--zoom')).toBe('2')
    expect(onSettle).toHaveBeenCalledWith({ zoom: 2, x: 40, y: 10 })
    expect(camera.isMoving()).toBe(false)
  })

  it('waits for the gesture to stop before settling', () => {
    const clock = fakeScheduler()
    const onSettle = vi.fn()
    const camera = createCameraController({ scheduler: clock.scheduler, onSettle })
    for (let i = 0; i < 5; i++) {
      camera.panBy(1, 0)
      clock.frame()
      clock.advance(100)
    }
    expect(onSettle).not.toHaveBeenCalled()
    clock.advance(50)
    expect(onSettle).toHaveBeenCalledTimes(1)
  })

  it('tells frame listeners in the same frame as the wrapper write', () => {
    const clock = fakeScheduler()
    const page = fakeTargets()
    const camera = createCameraController({ scheduler: clock.scheduler })
    camera.attach(page.targets)
    const seen: string[] = []
    camera.subscribeFrame((c) => seen.push(`${c.x}:${page.wrapperStyle.transform}`))
    camera.panBy(25, 0)
    clock.frame()
    expect(seen).toEqual(['25:matrix(1,0,0,1,25,0)'])
  })

  it('publishes the zoom text when it changes and the detail level only at settle', () => {
    const clock = fakeScheduler()
    const page = fakeTargets()
    const camera = createCameraController({ scheduler: clock.scheduler })
    camera.attach(page.targets)
    const label = { textContent: null as string | null }
    camera.bindZoomLabel(label)
    const onText = vi.fn()
    const onLevel = vi.fn()
    camera.subscribeZoomText(onText)
    camera.subscribeDetailLevel(onLevel)
    expect(label.textContent).toBe('100%')
    expect(camera.detailLevel()).toBe('close')

    camera.panBy(50, 50)
    clock.frame()
    expect(onText).not.toHaveBeenCalled()

    camera.zoomAt({ x: 0, y: 0 }, 0.3)
    clock.frame()
    expect(label.textContent).toBe('30%')
    expect(onText).toHaveBeenCalledTimes(1)
    expect(onLevel).not.toHaveBeenCalled()
    expect(camera.detailLevel()).toBe('close')
    clock.advance(SETTLE_MS)
    expect(camera.detailLevel()).toBe('far')
    expect(onLevel).toHaveBeenCalledTimes(1)
    expect(page.attrs.get('data-detail')).toBe('far')
  })

  it('zooms toward the pointer, keeping the world point under it', () => {
    const clock = fakeScheduler()
    const camera = createCameraController({ scheduler: clock.scheduler, initial: { zoom: 1, x: 30, y: 40 } })
    const pointer = { x: 300, y: 200 }
    const before = camera.screenToWorld(pointer)
    camera.zoomAt(pointer, 1.7)
    const after = screenToWorld(camera.get(), pointer)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('clamps zoom to 10% and 800%', () => {
    const clock = fakeScheduler()
    const camera = createCameraController({ scheduler: clock.scheduler })
    camera.zoomAt({ x: 0, y: 0 }, 100)
    expect(camera.get().zoom).toBe(8)
    camera.zoomTo({ x: 0, y: 0 }, 0.001)
    expect(camera.get().zoom).toBe(0.1)
  })

  it('steps the zoom buttons and fits the content at once, without a gesture', () => {
    const clock = fakeScheduler()
    const page = fakeTargets(1000, 800)
    const onSettle = vi.fn()
    const camera = createCameraController({ scheduler: clock.scheduler, onSettle })
    camera.attach(page.targets)
    expect(camera.viewportSize()).toEqual({ width: 1000, height: 800 })
    camera.zoomIn()
    expect(camera.get().zoom).toBe(1.5)
    expect(page.worldAttrs.get('transform')).toBe(worldTransform(camera.get()))
    camera.zoomOut()
    camera.zoomOut()
    expect(camera.get().zoom).toBe(0.75)
    camera.zoomReset()
    expect(camera.get().zoom).toBe(1)
    // The world point at the viewport's center stays there.
    expect(camera.screenToWorld({ x: 500, y: 400 }).x).toBeCloseTo(screenToWorld({ zoom: 1, x: 0, y: 0 }, { x: 500, y: 400 }).x, 9)
    camera.fit({ minX: -1000, minY: -500, maxX: 1000, maxY: 500 })
    expect(camera.get().zoom).toBeCloseTo((1000 - 96) / 2000, 9)
    expect(camera.worldToScreen({ x: 0, y: 0 })).toEqual({ x: 500, y: 400 })
    expect(onSettle).toHaveBeenCalledTimes(5)
    expect(clock.frameCount()).toBe(0)
  })

  it('keeps the fitted content clear of the fit insets (phone toolbar and bottom sheet)', () => {
    const clock = fakeScheduler()
    const page = fakeTargets(390, 700)
    const camera = createCameraController({ scheduler: clock.scheduler })
    camera.attach(page.targets)
    expect(camera.fitInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    const insets = { top: 66, right: 0, bottom: 154, left: 0 }
    camera.setFitInsets(insets)
    // Stored as a copy: changing the object passed in changes nothing.
    insets.top = 500
    expect(camera.fitInsets()).toEqual({ top: 66, right: 0, bottom: 154, left: 0 })
    const box = { minX: 0, minY: 0, maxX: 1000, maxY: 2000 }
    camera.fit(box)
    expect(camera.get().zoom).toBeCloseTo((700 - 66 - 154 - 96) / 2000, 9)
    expect(camera.worldToScreen({ x: 500, y: 0 }).y).toBeCloseTo(66 + 48, 9)
    expect(camera.worldToScreen({ x: 500, y: 2000 }).y).toBeCloseTo(700 - 154 - 48, 9)
    expect(camera.worldToScreen({ x: 500, y: 1000 }).x).toBeCloseTo(195, 9)
    // Back to no insets: the whole viewport again, where the width decides.
    camera.setFitInsets({ top: 0, right: 0, bottom: 0, left: 0 })
    camera.fit(box)
    expect(camera.get().zoom).toBeCloseTo(Math.min((390 - 96) / 1000, (700 - 96) / 2000), 9)
    expect(camera.worldToScreen({ x: 500, y: 1000 })).toEqual({ x: 195, y: 350 })
  })

  it('turns client coordinates into viewport coordinates', () => {
    const camera = createCameraController({ scheduler: fakeScheduler().scheduler })
    camera.attach(fakeTargets().targets)
    expect(camera.clientToScreen(150, 80)).toEqual({ x: 50, y: 30 })
  })

  it('writes the grid each frame in the wedding unit', () => {
    const clock = fakeScheduler()
    const page = fakeTargets()
    const camera = createCameraController({ scheduler: clock.scheduler, gridUnit: 'm' })
    camera.attach(page.targets)
    expect(page.vars.get('--grid-step')).toBe('50px')
    camera.panBy(20, 0)
    clock.frame()
    expect(page.vars.get('--grid-x')).toBe('20px')
    camera.setGridUnit('ft')
    expect(page.vars.get('--grid-step')).toBe('30.48px')
  })
})

describe('gliding to a camera', () => {
  it('eases from slow to fast to slow', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(0.5)).toBe(0.5)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(0.1)).toBeLessThan(0.1)
    expect(easeInOutCubic(0.9)).toBeGreaterThan(0.9)
  })

  it('zooms by even ratios and moves the centered world point in a straight line', () => {
    const center = { x: 500, y: 400 }
    const a = { zoom: 0.5, x: 0, y: 0 }
    const b = { zoom: 2, x: -1000, y: -600 }
    expect(interpolateCamera(a, b, 0, center)).toBe(a)
    expect(interpolateCamera(a, b, 1, center)).toBe(b)
    const mid = interpolateCamera(a, b, 0.5, center)
    expect(mid.zoom).toBeCloseTo(1, 9)
    const wa = screenToWorld(a, center)
    const wb = screenToWorld(b, center)
    const wm = screenToWorld(mid, center)
    expect(wm.x).toBeCloseTo((wa.x + wb.x) / 2, 9)
    expect(wm.y).toBeCloseTo((wa.y + wb.y) / 2, 9)
  })

  it('glides over about 300 ms, one wrapper write per frame, then settles once', () => {
    const clock = fakeScheduler()
    const page = fakeTargets(1000, 800)
    const onSettle = vi.fn()
    let t = 0
    const camera = createCameraController({ scheduler: clock.scheduler, onSettle, now: () => t })
    camera.attach(page.targets)
    const target = { zoom: 2, x: -300, y: -200 }
    camera.animateTo(target)
    expect(camera.isAnimating()).toBe(true)
    expect(camera.isMoving()).toBe(true)
    expect(clock.frameCount()).toBe(1)

    t = ANIMATE_MS / 2
    clock.frame()
    expect(camera.get().zoom).toBeGreaterThan(1)
    expect(camera.get().zoom).toBeLessThan(2)
    expect(page.wrapperStyle.transform).not.toBe('')
    // The SVG keeps its drawing until the glide arrives.
    expect(page.worldAttrs.get('transform')).toBe('matrix(1,0,0,1,0,0)')
    expect(onSettle).not.toHaveBeenCalled()

    t = ANIMATE_MS + 5
    clock.frame()
    expect(camera.get()).toEqual(target)
    expect(camera.isAnimating()).toBe(false)
    expect(camera.isMoving()).toBe(false)
    expect(page.worldAttrs.get('transform')).toBe('matrix(2,0,0,2,-300,-200)')
    expect(page.wrapperStyle.transform).toBe('')
    expect(onSettle).toHaveBeenCalledTimes(1)
    expect(clock.frameCount()).toBe(0)
  })

  it('stops where it is when a gesture or a button moves the camera', () => {
    const clock = fakeScheduler()
    const page = fakeTargets(1000, 800)
    let t = 0
    const camera = createCameraController({ scheduler: clock.scheduler, now: () => t })
    camera.attach(page.targets)
    camera.animateTo({ zoom: 4, x: -2000, y: -2000 })
    t = 100
    clock.frame()
    const mid = camera.get()
    camera.panBy(10, 0)
    expect(camera.isAnimating()).toBe(false)
    expect(camera.get()).toEqual({ ...mid, x: mid.x + 10 })
    t = 1000
    clock.frame()
    expect(camera.get().zoom).toBe(mid.zoom)
  })

  it('jumps when nothing is attached or the duration is 0, and flush lands at the end', () => {
    const clock = fakeScheduler()
    const camera = createCameraController({ scheduler: clock.scheduler, now: () => 0 })
    camera.animateTo({ zoom: 2, x: 5, y: 5 })
    expect(camera.get()).toEqual({ zoom: 2, x: 5, y: 5 })
    expect(camera.isAnimating()).toBe(false)

    const attached = createCameraController({ scheduler: clock.scheduler, now: () => 0 })
    attached.attach(fakeTargets().targets)
    attached.animateTo({ zoom: 3, x: 1, y: 2 }, { durationMs: 0 })
    expect(attached.get()).toEqual({ zoom: 3, x: 1, y: 2 })
    attached.animateTo({ zoom: 1, x: 0, y: 0 })
    attached.flush()
    expect(attached.get()).toEqual({ zoom: 1, x: 0, y: 0 })
    expect(attached.isAnimating()).toBe(false)
  })
})
