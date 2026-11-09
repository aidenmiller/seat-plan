import { describe, expect, it } from 'vitest'
import { backoffDelay, baseDelay } from './backoff'

describe('backoff', () => {
  it('doubles from 1 s and stops at 30 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20, 1000].map(baseDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000,
    ])
  })

  it('treats attempts below 1 as the first', () => {
    expect(baseDelay(0)).toBe(1000)
    expect(baseDelay(-3)).toBe(1000)
  })

  it('adds no jitter when random is in the middle', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, () => 0.5))).toEqual([1000, 2000, 4000, 8000, 16000, 30000])
  })

  it('moves the delay by up to 20% either way', () => {
    expect(backoffDelay(1, () => 0)).toBe(800)
    expect(backoffDelay(1, () => 0.999999)).toBe(1200)
    expect(backoffDelay(4, () => 0)).toBe(6400)
    expect(backoffDelay(4, () => 0.75)).toBe(8800)
    expect(backoffDelay(5, () => 0.999999)).toBe(19200)
  })

  it('never passes the 30 s cap', () => {
    expect(backoffDelay(6, () => 0)).toBe(24000)
    expect(backoffDelay(6, () => 0.999999)).toBe(30000)
    expect(backoffDelay(50, () => 0.9)).toBe(30000)
  })

  it('stays within bounds for any random value', () => {
    for (let i = 0; i < 200; i++) {
      const attempt = 1 + (i % 8)
      const d = backoffDelay(attempt)
      const base = baseDelay(attempt)
      expect(d).toBeGreaterThanOrEqual(Math.round(base * 0.8))
      expect(d).toBeLessThanOrEqual(Math.min(30000, Math.round(base * 1.2)))
    }
  })
})
