import { describe, expect, it } from 'vitest'
import { makeRoomPdf, PT_PER_M, ROOM } from './__fixtures__/plans'
import { readFirstPage } from './__fixtures__/pdfjs-node'
import type { PageText, VectorSegment } from './pdf-vectors'
import {
  chooseScale,
  findLengths,
  measureDimensionLines,
  parseDimension,
  scaleCandidates,
  scaleFromTwoPoints,
  scaleSpreadPercent,
  type DimensionLabel,
} from './scale'

describe('parseDimension', () => {
  const cases: [string, number][] = [
    [`12'-6"`, 381],
    [`12' 6"`, 381],
    [`12'6"`, 381],
    [`12ft 6in`, 381],
    [`12 ft 6 in`, 381],
    [`12′-6″`, 381],
    [`12’-6”`, 381],
    [`12' - 6"`, 381],
    [`12'-6 1/2"`, 382.27],
    [`12'-6½"`, 382.27],
    [`12'-0"`, 365.76],
    [`0'-6"`, 15.24],
    [`12'`, 365.76],
    [`12 ft`, 365.76],
    [`12 feet`, 365.76],
    [`150"`, 381],
    [`150 in`, 381],
    [`150 inches`, 381],
    [`6 1/2"`, 16.51],
    [`10.00 m`, 1000],
    [`10m`, 1000],
    [`10 meters`, 1000],
    [`10,5 m`, 1050],
    [`350 cm`, 350],
    [`3500 mm`, 350],
    [`3,500 mm`, 350],
    [`(12'-6")`, 381],
    [`12'-6" TYP`, 381],
  ]
  for (const [text, cm] of cases) {
    it(`reads ${text} as ${cm} cm`, () => {
      expect(parseDimension(text)).toBeCloseTo(cm, 2)
    })
  }

  it('refuses text that is not one length', () => {
    expect(parseDimension('MAIN ROOM')).toBeNull()
    expect(parseDimension(`12' x 14'`)).toBeNull()
    expect(parseDimension(`MAIN ROOM 12'`)).toBeNull()
    expect(parseDimension('3500')).toBeNull()
    expect(parseDimension('')).toBeNull()
    expect(parseDimension('0 m')).toBeNull()
    expect(parseDimension('6 inside')).toBeNull()
    expect(parseDimension('5 mins')).toBeNull()
  })

  it('reads bare numbers only in the unit it is told', () => {
    expect(parseDimension('3500', 'mm')).toBe(350)
    expect(parseDimension('12', 'ft')).toBeCloseTo(365.76)
  })

  it('finds every length in a piece of text, left to right', () => {
    expect(findLengths(`LIVING 12'-6" x 14'-0"`).map((f) => f.cm)).toEqual([381, 426.72])
    expect(findLengths(`10' 20'`).map((f) => f.cm)).toEqual([304.8, 609.6])
    expect(findLengths('4.5 m by 300 cm').map((f) => f.cm)).toEqual([450, 300])
  })
})

describe('scale from labels', () => {
  const label = (valueCm: number, px: number, text = ''): DimensionLabel => ({ text, valueCm, from: { x: 0, y: 0 }, to: { x: px, y: 0 } })

  it('gives one candidate per usable label', () => {
    const c = scaleCandidates([label(1000, 500), label(0, 500), label(300, 3), label(381, 190.5)])
    expect(c.map((x) => x.cmPerPx)).toEqual([2, 2])
  })

  it('picks the length-weighted scale when the labels agree within 2%', () => {
    const choice = chooseScale([label(1000, 500), label(400, 198)])
    expect(choice.status).toBe('agree')
    expect(choice.spreadPercent).toBeCloseTo((400 / 198 / 2 - 1) * 100)
    expect(choice.cmPerPx).toBeCloseTo(1400 / 698)
  })

  it('asks for two points when the labels disagree by more than 2%', () => {
    const choice = chooseScale([label(1000, 500), label(1000, 500), label(1000, 450)])
    expect(choice.status).toBe('disagree')
    expect(choice.cmPerPx).toBeNull()
    expect(choice.spreadPercent).toBeCloseTo((1000 / 450 / 2 - 1) * 100)
    // Two of three agree.
    expect(choice.consensus).toMatchObject({ cmPerPx: 2, count: 2 })
    expect(choice.consensus?.candidates).toHaveLength(2)
  })

  it('asks for two points when there are no labels', () => {
    expect(chooseScale([])).toMatchObject({ status: 'none', cmPerPx: null, consensus: null })
    expect(scaleSpreadPercent([])).toBe(0)
  })

  it('works out a scale from two points and a real distance', () => {
    expect(scaleFromTwoPoints({ x: 0, y: 0 }, { x: 300, y: 400 }, 1000)).toBe(2)
    expect(scaleFromTwoPoints({ x: 5, y: 5 }, { x: 5, y: 5 }, 1000)).toBeNull()
    expect(scaleFromTwoPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toBeNull()
  })
})

describe('measureDimensionLines', () => {
  const text = (t: string, cx: number, cy: number, h = 10): PageText => ({
    text: t,
    from: { x: cx - t.length * 3, y: cy + h / 2 },
    to: { x: cx + t.length * 3, y: cy + h / 2 },
    center: { x: cx, y: cy },
    height: h,
    angle: 0,
  })
  const line = (x1: number, y1: number, x2: number, y2: number, width = 0.5): VectorSegment => ({ x1, y1, x2, y2, width, source: 'stroke', path: 0, layer: null })
  const tick = (x: number, y = 100) => line(x, y - 6, x, y + 6)

  it('measures chained dimensions between their ticks', () => {
    const segments = [line(0, 100, 600, 100), tick(0), tick(200), tick(500), tick(600)]
    const out = measureDimensionLines([text('2.00 m', 100, 90), text('3.00 m', 350, 90), text('1.00 m', 550, 90)], segments)
    expect(out.map((d) => [d.valueCm, d.from.x, d.to.x])).toEqual([
      [200, 0, 200],
      [300, 200, 500],
      [100, 500, 600],
    ])
  })

  it('ends a line that runs past its ticks at the ticks', () => {
    const out = measureDimensionLines([text('6.00 m', 300, 90)], [line(-20, 100, 620, 100), tick(0), tick(600)])
    expect([out[0].from.x, out[0].to.x]).toEqual([0, 600])
  })

  it('joins a line broken around its text', () => {
    const out = measureDimensionLines([text(`19'-8"`, 300, 100)], [line(0, 100, 280, 100), line(320, 100, 600, 100), tick(0), tick(600)])
    expect(out).toHaveLength(1)
    expect([out[0].from.x, out[0].to.x]).toEqual([0, 600])
    expect(out[0].valueCm).toBeCloseTo(599.44)
  })

  it('skips text that is not a length, and text with no line near it', () => {
    expect(measureDimensionLines([text('KITCHEN', 300, 90)], [line(0, 100, 600, 100)])).toEqual([])
    expect(measureDimensionLines([text('6.00 m', 300, 90)], [line(0, 400, 600, 400)])).toEqual([])
  })

  for (const rotate of [0, 90] as const) {
    it(`finds the generated plan's 10.00 m line (page rotated ${rotate}) and its scale`, async () => {
      const page = await readFirstPage(await makeRoomPdf({ rotate }))
      const dims = measureDimensionLines(page.texts, page.segments)
      expect(dims).toHaveLength(1)
      expect(dims[0].text).toBe(ROOM.dimension.text)
      expect(dims[0].valueCm).toBe(ROOM.dimension.valueCm)
      const px = Math.hypot(dims[0].to.x - dims[0].from.x, dims[0].to.y - dims[0].from.y)
      expect(px).toBeCloseTo(ROOM.width * PT_PER_M * page.pxPerPt, 1)
      const choice = chooseScale(dims)
      expect(choice.cmPerPx).toBeCloseTo(100 / (PT_PER_M * page.pxPerPt), 6)
    })
  }
})
