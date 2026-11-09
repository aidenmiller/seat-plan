import { describe, expect, it } from 'vitest'
import { initialLevel, levelForZoom, nextLevel, seatScreenPx, type DetailLevel } from './detail-level'

describe('detail levels (PLAN section 6)', () => {
  it('measures a seat in screen pixels', () => {
    expect(seatScreenPx(1)).toBe(45)
    expect(seatScreenPx(0.1)).toBeCloseTo(4.5, 9)
    expect(seatScreenPx(8)).toBe(360)
  })

  it('goes up at 22 and 36 px', () => {
    expect(nextLevel('far', 21.9)).toBe('far')
    expect(nextLevel('far', 22)).toBe('middle')
    expect(nextLevel('far', 36)).toBe('close')
    expect(nextLevel('middle', 35.9)).toBe('middle')
    expect(nextLevel('middle', 36)).toBe('close')
  })

  it('goes down below 30 and 18 px', () => {
    expect(nextLevel('close', 30)).toBe('close')
    expect(nextLevel('close', 29.9)).toBe('middle')
    expect(nextLevel('close', 17.9)).toBe('far')
    expect(nextLevel('middle', 18)).toBe('middle')
    expect(nextLevel('middle', 17.9)).toBe('far')
  })

  it('starts from the going-up points', () => {
    expect(initialLevel(25)).toBe('middle')
    expect(initialLevel(20)).toBe('far')
    expect(levelForZoom(null, 1)).toBe('close')
    expect(levelForZoom('close', 0.6)).toBe('middle')
  })

  it('shows names, then initials, then circles from 800% down to 10%, each once (acceptance 8)', () => {
    const seen: DetailLevel[] = []
    let level: DetailLevel = levelForZoom(null, 8)
    for (let zoom = 8; zoom >= 0.1; zoom *= 0.97) {
      level = levelForZoom(level, zoom)
      if (seen[seen.length - 1] !== level) seen.push(level)
    }
    expect(seen).toEqual(['close', 'middle', 'far'])
    const up: DetailLevel[] = []
    for (let zoom = 0.1; zoom <= 8; zoom *= 1.03) {
      level = levelForZoom(level, zoom)
      if (up[up.length - 1] !== level) up.push(level)
    }
    expect(up).toEqual(['far', 'middle', 'close'])
  })

  it('changes at most once while the zoom wiggles round a switch point', () => {
    for (const point of [18, 22, 30, 36]) {
      // Arrive at the point zooming in from far out, and zooming out from close in.
      for (const from of [1, 100]) {
        let level = initialLevel(from)
        const steps = 50
        for (let i = 0; i <= steps; i++) level = nextLevel(level, from + ((point - from) * i) / steps)
        let changes = 0
        for (let i = 0; i < 40; i++) {
          const next = nextLevel(level, point + (i % 2 === 0 ? 1.5 : -1.5))
          if (next !== level) changes++
          level = next
        }
        expect(changes, `${point} px from ${from} px`).toBeLessThanOrEqual(1)
      }
    }
  })
})
