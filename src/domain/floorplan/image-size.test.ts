import { describe, expect, it } from 'vitest'
import {
  fitsModel,
  largestModelSize,
  MODEL_MAX_EDGE,
  MODEL_MAX_TOKENS,
  modelImageSize,
  pageRenderScale,
  shrinkForBytes,
  storedImageSize,
  visualTokens,
} from './image-size'

describe('model image size', () => {
  it('counts visual tokens in 28 px tiles', () => {
    expect(visualTokens(28, 28)).toBe(1)
    expect(visualTokens(29, 28)).toBe(2)
    expect(visualTokens(2184, 1687)).toBe(78 * 61)
  })

  it('knows what the model reads without shrinking', () => {
    expect(fitsModel(2576, 1449)).toBe(true)
    expect(fitsModel(2577, 1000)).toBe(false)
    expect(fitsModel(2300, 2300)).toBe(false)
  })

  it('matches the sizes the vision docs give for common shapes', () => {
    expect(modelImageSize(7016, 4961)).toEqual({ width: 2296, height: 1623 })
    expect(modelImageSize(1100 * 4, 850 * 4)).toEqual({ width: 2184, height: 1688 })
    expect(modelImageSize(1600 * 3, 900 * 3)).toEqual({ width: 2576, height: 1449 })
    expect(modelImageSize(4000, 4000)).toEqual({ width: 1932, height: 1932 })
    expect(modelImageSize(4000, 3000)).toEqual({ width: 2212, height: 1659 })
    // Portrait is the same turned.
    expect(modelImageSize(4961, 7016)).toEqual({ width: 1623, height: 2296 })
  })

  it('never grows a small image, and every answer fits', () => {
    expect(modelImageSize(800, 600)).toEqual({ width: 800, height: 600 })
    for (const [w, h] of [
      [9000, 100],
      [100, 9000],
      [3000, 2999],
      [12345, 6789],
    ]) {
      const s = modelImageSize(w, h)
      expect(fitsModel(s.width, s.height)).toBe(true)
      expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(MODEL_MAX_EDGE)
      expect(visualTokens(s.width, s.height)).toBeLessThanOrEqual(MODEL_MAX_TOKENS)
    }
  })

  it('grows a small drawing to the largest size that fits', () => {
    expect(largestModelSize(792, 612)).toEqual({ width: 2184, height: 1688 })
  })

  it('picks a render scale whose whole-pixel canvas fits', () => {
    const letter = pageRenderScale(792, 612)
    expect([letter.width, letter.height]).toEqual([2184, 1687])
    expect(letter.scale).toBeCloseTo(2.7576, 4)
    expect(fitsModel(letter.width, letter.height)).toBe(true)
    const a1 = pageRenderScale(2384, 1684)
    expect(fitsModel(a1.width, a1.height)).toBe(true)
    expect(a1.width).toBe(Math.floor(2384 * a1.scale))
  })
})

describe('stored image size', () => {
  it('keeps the long edge at most 2,576 px and never grows', () => {
    expect(storedImageSize(6000, 1000).width).toBeLessThanOrEqual(2576)
    expect(storedImageSize(1200, 900)).toEqual({ width: 1200, height: 900 })
  })

  it('suggests a smaller size when the encoded image is over 3 MB', () => {
    expect(shrinkForBytes({ width: 2000, height: 1500 }, 2_000_000)).toBeNull()
    const next = shrinkForBytes({ width: 2000, height: 1500 }, 12_000_000)!
    expect(next.width).toBe(Math.floor(2000 * Math.sqrt(0.25) * 0.9))
    expect(next.width / next.height).toBeCloseTo(2000 / 1500, 2)
  })
})
