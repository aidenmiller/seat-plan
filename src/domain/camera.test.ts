import { describe, expect, it } from 'vitest'
import {
  centerOn,
  clampZoom,
  fitToContent,
  MAX_ZOOM,
  MIN_ZOOM,
  nextZoomStep,
  panBy,
  parseCamera,
  relativeTransform,
  screenToWorld,
  stepZoom,
  visibleWorldBox,
  worldToScreen,
  zoomAt,
  zoomPercent,
  ZOOM_STEPS,
  zoomTo,
  type Camera,
} from './camera'

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const viewport = { width: 1000, height: 800 }

describe('camera math', () => {
  it('draws 1 cm as 1 px at 100%', () => {
    const cam: Camera = { zoom: 1, x: 10, y: 20 }
    expect(worldToScreen(cam, { x: 152.4, y: 0 })).toEqual({ x: 162.4, y: 20 })
  })

  it('goes from world to screen and back', () => {
    const random = rng(50)
    for (let i = 0; i < 200; i++) {
      const cam = { zoom: 0.1 + random() * 7.9, x: random() * 2000 - 1000, y: random() * 2000 - 1000 }
      const p = { x: random() * 10000 - 5000, y: random() * 10000 - 5000 }
      const back = screenToWorld(cam, worldToScreen(cam, p))
      expect(back.x).toBeCloseTo(p.x, 6)
      expect(back.y).toBeCloseTo(p.y, 6)
    }
  })

  it('keeps zoom between 10% and 800%', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
    expect(clampZoom(20)).toBe(MAX_ZOOM)
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom(2.5)).toBe(2.5)
  })

  it('zooms toward the pointer, keeping the point under it still', () => {
    const random = rng(51)
    for (let i = 0; i < 200; i++) {
      const cam = { zoom: 0.1 + random() * 7.9, x: random() * 2000 - 1000, y: random() * 2000 - 1000 }
      const pointer = { x: random() * 1000, y: random() * 800 }
      const before = screenToWorld(cam, pointer)
      const next = zoomAt(cam, pointer, 0.2 + random() * 3)
      expect(next.zoom).toBeGreaterThanOrEqual(MIN_ZOOM)
      expect(next.zoom).toBeLessThanOrEqual(MAX_ZOOM)
      const after = screenToWorld(next, pointer)
      expect(after.x).toBeCloseTo(before.x, 6)
      expect(after.y).toBeCloseTo(before.y, 6)
    }
    const cam = { zoom: 1, x: 0, y: 0 }
    expect(zoomAt(cam, { x: 0, y: 0 }, -1)).toBe(cam)
    expect(zoomTo(cam, { x: 0, y: 0 }, 100).zoom).toBe(MAX_ZOOM)
  })

  it('pans by screen pixels', () => {
    expect(panBy({ zoom: 2, x: 5, y: 5 }, 10, -20)).toEqual({ zoom: 2, x: 15, y: -15 })
  })
})

describe('zoom buttons', () => {
  it('step through the button levels', () => {
    expect(ZOOM_STEPS).toEqual([0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8])
    expect(nextZoomStep(1, 1)).toBe(1.5)
    expect(nextZoomStep(1, -1)).toBe(0.75)
    expect(nextZoomStep(1.2, 1)).toBe(1.5)
    expect(nextZoomStep(1.2, -1)).toBe(1)
    expect(nextZoomStep(8, 1)).toBe(8)
    expect(nextZoomStep(0.1, -1)).toBe(0.1)
  })

  it('zoom about the viewport center', () => {
    const cam = { zoom: 1, x: 0, y: 0 }
    const center = { x: 500, y: 400 }
    const before = screenToWorld(cam, center)
    const next = stepZoom(cam, viewport, 1)
    expect(next.zoom).toBe(1.5)
    const after = screenToWorld(next, center)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('show the zoom as a whole percent', () => {
    expect(zoomPercent(0.75)).toBe('75%')
    expect(zoomPercent(1.234)).toBe('123%')
  })
})

describe('fit to content', () => {
  it('fits and centers the box with padding', () => {
    const box = { minX: -1000, minY: -500, maxX: 3000, maxY: 1500 }
    const cam = fitToContent(box, viewport, 50)
    // 4000 wide into 900 px; 2000 high into 700 px: width decides.
    expect(cam.zoom).toBeCloseTo(900 / 4000, 9)
    const c = worldToScreen(cam, { x: 1000, y: 500 })
    expect(c.x).toBeCloseTo(500, 9)
    expect(c.y).toBeCloseTo(400, 9)
    const left = worldToScreen(cam, { x: -1000, y: 0 })
    expect(left.x).toBeCloseTo(50, 9)
  })

  it('does not blow one small table up past 200%, or shrink a huge plan past 10%', () => {
    expect(fitToContent({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, viewport).zoom).toBe(2)
    expect(fitToContent({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, viewport, 48, { maxZoom: 8 }).zoom).toBeCloseTo(7.04, 9)
    expect(fitToContent({ minX: 0, minY: 0, maxX: 1e6, maxY: 10 }, viewport).zoom).toBe(MIN_ZOOM)
  })

  it('shows the origin at 100% for an empty canvas', () => {
    const cam = fitToContent(null, viewport)
    expect(cam).toEqual({ zoom: 1, x: 500, y: 400 })
  })
})

describe('other views', () => {
  it('centers on a point', () => {
    const cam = centerOn({ zoom: 2, x: 0, y: 0 }, { x: 100, y: 50 }, viewport)
    expect(worldToScreen(cam, { x: 100, y: 50 })).toEqual({ x: 500, y: 400 })
    expect(centerOn(cam, { x: 0, y: 0 }, viewport, 0.5).zoom).toBe(0.5)
  })

  it('knows what the viewport shows', () => {
    expect(visibleWorldBox({ zoom: 2, x: 100, y: 0 }, viewport)).toEqual({ minX: -50, minY: 0, maxX: 450, maxY: 400 })
  })

  it('maps the old drawing onto the new camera during a gesture', () => {
    const random = rng(52)
    for (let i = 0; i < 50; i++) {
      const from = { zoom: 0.1 + random() * 4, x: random() * 500, y: random() * 500 }
      const to = { zoom: 0.1 + random() * 4, x: random() * 500, y: random() * 500 }
      const t = relativeTransform(from, to)
      const p = { x: random() * 1000, y: random() * 1000 }
      const a = worldToScreen(from, p)
      const b = worldToScreen(to, p)
      expect(a.x * t.scale + t.x).toBeCloseTo(b.x, 6)
      expect(a.y * t.scale + t.y).toBeCloseTo(b.y, 6)
    }
  })

  it('reads a stored camera only when it is one', () => {
    expect(parseCamera({ zoom: 0.5, x: 1, y: 2 })).toEqual({ zoom: 0.5, x: 1, y: 2 })
    expect(parseCamera({ zoom: 50, x: 1, y: 2 })).toEqual({ zoom: MAX_ZOOM, x: 1, y: 2 })
    expect(parseCamera({ zoom: 0, x: 1, y: 2 })).toBeNull()
    expect(parseCamera({ zoom: 1, x: '1', y: 2 })).toBeNull()
    expect(parseCamera({ zoom: 1, x: Infinity, y: 2 })).toBeNull()
    expect(parseCamera(null)).toBeNull()
    expect(parseCamera('camera')).toBeNull()
  })
})
