import { describe, expect, it } from 'vitest'
import { classifyWheel, rememberWheel, wheelDevice, wheelPanDelta, wheelZoomFactor, type WheelHistory, type WheelLike } from './wheel'

const ev = (e: Partial<WheelLike>): WheelLike => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...e })

/** Feeds events through in order, as the controller does, and returns each action. */
function run(events: WheelLike[], setting: 'auto' | 'zoom' | 'pan' = 'auto'): string[] {
  let history: WheelHistory = []
  return events.map((e) => {
    const action = classifyWheel(e, history, setting)
    history = rememberWheel(history, e)
    return action
  })
}

describe('classifyWheel (PLAN change 11)', () => {
  it('zooms on a pinch, whatever the setting', () => {
    const pinch = ev({ deltaY: -3.2, ctrlKey: true })
    expect(classifyWheel(pinch)).toBe('zoom')
    expect(classifyWheel(pinch, [], 'pan')).toBe('zoom')
  })

  it('zooms on a mouse wheel', () => {
    // Firefox: lines.
    expect(classifyWheel(ev({ deltaY: 3, deltaMode: 1 }))).toBe('zoom')
    expect(classifyWheel(ev({ deltaY: 1, deltaMode: 2 }))).toBe('zoom')
    // Chrome on Windows: 100 px a notch, wheelDeltaY -120.
    expect(classifyWheel(ev({ deltaY: 100, wheelDeltaY: -120 }))).toBe('zoom')
    // Chrome at 110% page zoom: a fractional step, still 120.
    expect(classifyWheel(ev({ deltaY: 90.9090909, wheelDeltaY: -120 }))).toBe('zoom')
    // No wheelDeltaY, but a large whole step.
    expect(classifyWheel(ev({ deltaY: -102 }))).toBe('zoom')
  })

  it('pans on a trackpad', () => {
    expect(classifyWheel(ev({ deltaY: 3.5 }))).toBe('pan')
    expect(classifyWheel(ev({ deltaY: 4, wheelDeltaY: -12 }))).toBe('pan')
    expect(classifyWheel(ev({ deltaX: 2, deltaY: 5 }))).toBe('pan')
    expect(classifyWheel(ev({ deltaX: -7, deltaY: 0 }))).toBe('pan')
    // Large but not a notch: a fast flick.
    expect(classifyWheel(ev({ deltaY: 60, wheelDeltaY: -180 }))).toBe('pan')
  })

  it('keeps panning through a trackpad flick whose steps grow large', () => {
    const flick = [2, 6, 18, 40, 120, 160, 90, 30].map((d, i) => ev({ deltaY: d, wheelDeltaY: -3 * d, timeStamp: 1000 + i * 16 }))
    expect(run(flick)).toEqual(Array(8).fill('pan'))
  })

  it('starts fresh after a pause', () => {
    const events = [ev({ deltaY: 4, timeStamp: 0 }), ev({ deltaY: 100, wheelDeltaY: -120, timeStamp: 1000 })]
    expect(run(events)).toEqual(['pan', 'zoom'])
  })

  it('lets lines or pages break into a trackpad gesture', () => {
    const events = [ev({ deltaY: 4, timeStamp: 0 }), ev({ deltaY: 3, deltaMode: 1, timeStamp: 10 })]
    expect(run(events)).toEqual(['pan', 'zoom'])
  })

  it('keeps a spinning mouse wheel zooming through a small step', () => {
    const events = [ev({ deltaY: 100, wheelDeltaY: -120, timeStamp: 0 }), ev({ deltaY: 8, timeStamp: 30 })]
    expect(run(events)).toEqual(['zoom', 'zoom'])
  })

  it('follows the Mouse wheel setting for everything but a pinch', () => {
    expect(run([ev({ deltaY: 100, wheelDeltaY: -120 })], 'pan')).toEqual(['pan'])
    expect(run([ev({ deltaY: 3.5 })], 'zoom')).toEqual(['zoom'])
  })

  it('remembers only the last few events', () => {
    let history: WheelHistory = []
    for (let i = 0; i < 20; i++) history = rememberWheel(history, ev({ deltaY: 1, timeStamp: i }))
    expect(history).toHaveLength(8)
    expect(history[7]).toEqual({ time: 19, device: 'trackpad' })
    expect(wheelDevice(ev({ deltaY: 1 }), [], 5)).toBe('trackpad')
  })
})

describe('wheel amounts', () => {
  it('zooms in for an upward wheel and out for a downward one', () => {
    expect(wheelZoomFactor(-100, 0, false)).toBeGreaterThan(1)
    expect(wheelZoomFactor(100, 0, false)).toBeLessThan(1)
    expect(wheelZoomFactor(100, 0, false) * wheelZoomFactor(-100, 0, false)).toBeCloseTo(1, 9)
    expect(wheelZoomFactor(0, 0, false)).toBe(1)
  })

  it('makes a pinch count for more per pixel, scales lines, and caps each step', () => {
    expect(wheelZoomFactor(-5, 0, true)).toBeGreaterThan(wheelZoomFactor(-5, 0, false))
    expect(wheelZoomFactor(3, 1, false)).toBeCloseTo(wheelZoomFactor(48, 0, false), 9)
    expect(wheelZoomFactor(-10000, 0, false)).toBe(2)
    expect(wheelZoomFactor(10000, 0, true)).toBe(0.5)
  })

  it('pans the content with the fingers', () => {
    expect(wheelPanDelta({ deltaX: 10, deltaY: -5, deltaMode: 0 })).toEqual({ dx: -10, dy: 5 })
    expect(wheelPanDelta({ deltaX: 0, deltaY: 2, deltaMode: 1 })).toEqual({ dx: 0, dy: -32 })
  })
})
