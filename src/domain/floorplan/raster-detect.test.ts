import { describe, expect, it } from 'vitest'
import { makeRoomPdf, makeScanPdf } from './__fixtures__/plans'
import { readFirstPage } from './__fixtures__/pdfjs-node'
import { classifyCounts, classifyPage, isBlankPicture } from './raster-detect'

describe('classifyPage', () => {
  it('calls a page that is one picture a raster plan', async () => {
    const page = await readFirstPage(await makeScanPdf())
    expect(page.stats.images).toBe(1)
    expect(page.segments).toHaveLength(0)
    expect(classifyPage(page)).toEqual({ kind: 'raster', reason: 'picture', imageCoverage: 1, longSegments: 0 })
  })

  it('calls the generated room a vector plan', async () => {
    for (const rotate of [0, 90] as const) {
      const c = classifyPage(await readFirstPage(await makeRoomPdf({ rotate })))
      expect(c.kind).toBe('vector')
      expect(c.imageCoverage).toBe(0)
      expect(c.longSegments).toBeGreaterThanOrEqual(15)
    }
  })

  it('weighs pictures against lines', () => {
    expect(classifyCounts(0.9, 10).kind).toBe('raster')
    // A scan with a drawn border and title block on top is still a scan.
    expect(classifyCounts(0.6, 49).kind).toBe('raster')
    // Many lines over a background picture: the lines are the plan.
    expect(classifyCounts(0.6, 400).kind).toBe('vector')
    // A blank or text-only page has nothing to read as lines.
    expect(classifyCounts(0, 2)).toEqual({ kind: 'raster', reason: 'too few lines' })
    expect(classifyCounts(0.1, 30).kind).toBe('vector')
  })
})

describe('isBlankPicture', () => {
  const picture = (pixels: number[][]) => Uint8ClampedArray.from(pixels.flat())

  it('calls an all white or see-through picture blank', () => {
    expect(isBlankPicture(picture([[255, 255, 255, 255], [250, 251, 252, 255], [0, 0, 0, 0]]))).toBe(true)
    expect(isBlankPicture(new Uint8ClampedArray(0))).toBe(true)
  })

  it('finds a single dark pixel', () => {
    expect(isBlankPicture(picture([[255, 255, 255, 255], [255, 255, 255, 255], [0, 0, 0, 255]]))).toBe(false)
    expect(isBlankPicture(picture([[255, 120, 255, 255]]))).toBe(false)
  })
})
