import { describe, expect, it } from 'vitest'
import { makeRoomPdf, ORIGIN_PT, PAGE_PT, PT_PER_M, ROOM } from './__fixtures__/plans'
import { loadPdfjs, readFirstPage } from './__fixtures__/pdfjs-node'
import {
  applyMatrix,
  clipSegment,
  DRAW_OPS,
  joinTextRuns,
  matrixScale,
  multiply,
  readPageVectors,
  readTextItems,
  thinPolygonCenterline,
  type PageText,
  type VectorSegment,
} from './pdf-vectors'

const len = (s: { x1: number; y1: number; x2: number; y2: number }) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1)

describe('matrices', () => {
  it('multiplies like pdf.js Util.transform (the second applies first)', () => {
    const scale = [2, 0, 0, 2, 0, 0]
    const move = [1, 0, 0, 1, 10, 5]
    // Scale then move: (1, 1) -> (2, 2) -> (12, 7).
    expect(applyMatrix(multiply(move, scale), 1, 1)).toEqual({ x: 12, y: 7 })
    // Move then scale: (1, 1) -> (11, 6) -> (22, 12).
    expect(applyMatrix(multiply(scale, move), 1, 1)).toEqual({ x: 22, y: 12 })
    expect(matrixScale([3, 0, 0, -3, 0, 100])).toBe(3)
  })

  it('clips segments to the page', () => {
    expect(clipSegment({ x: -10, y: 5 }, { x: 20, y: 5 }, 0, 0, 10, 10)).toEqual([
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ])
    expect(clipSegment({ x: -10, y: -5 }, { x: 20, y: -5 }, 0, 0, 10, 10)).toBeNull()
  })

  it('turns a long thin filled rectangle into its centre line, and leaves squares alone', () => {
    const c = thinPolygonCenterline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 10 },
        { x: 0, y: 10 },
      ],
      20,
    )
    expect(c).not.toBeNull()
    expect(c!.thickness).toBeCloseTo(10)
    expect(Math.hypot(c!.b.x - c!.a.x, c!.b.y - c!.a.y)).toBeCloseTo(100)
    expect((c!.a.y + c!.b.y) / 2).toBeCloseTo(5)
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(thinPolygonCenterline(square, 5)).toBeNull()
    // An L shape is not a rectangle.
    const ell = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 90, y: 100 },
      { x: 90, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(thinPolygonCenterline(ell, 5)).toBeNull()
  })
})

describe('readPageVectors on a hand-made operator list', () => {
  it('tracks save, restore, transform, line width, forms, hidden layers and pictures', async () => {
    const { OPS } = await loadPdfjs()
    const path = (paint: number, ...data: number[]) => [paint, [new Float32Array(data)], new Float32Array(4)]
    const fnArray: number[] = []
    const argsArray: unknown[] = []
    const op = (fn: number, args: unknown = null) => {
      fnArray.push(fn)
      argsArray.push(args)
    }
    op(OPS.setLineWidth, [2])
    op(OPS.save)
    op(OPS.transform, [2, 0, 0, 2, 10, 0])
    // Under scale 2 and a move of 10: (0,0)-(10,0) lands at (10,0)-(30,0), width 4.
    op(OPS.constructPath, path(OPS.stroke, DRAW_OPS.moveTo, 0, 0, DRAW_OPS.lineTo, 10, 0))
    op(OPS.restore)
    // Back to no transform; the width comes from a graphics state dictionary.
    op(OPS.setGState, [[['LW', 3]]])
    op(OPS.constructPath, path(OPS.stroke, DRAW_OPS.moveTo, 0, 50, DRAW_OPS.lineTo, 40, 50))
    // A form with its own matrix acts as save plus transform.
    op(OPS.paintFormXObjectBegin, [new Float32Array([1, 0, 0, 1, 0, 100]), null])
    op(OPS.constructPath, path(OPS.stroke, DRAW_OPS.moveTo, 0, 0, DRAW_OPS.lineTo, 0, 40))
    op(OPS.paintFormXObjectEnd)
    // A hidden layer draws nothing.
    op(OPS.beginMarkedContentProps, ['OC', { type: 'OCG', id: 'hidden' }])
    op(OPS.constructPath, path(OPS.stroke, DRAW_OPS.moveTo, 0, 0, DRAW_OPS.lineTo, 90, 90))
    op(OPS.endMarkedContent)
    // A named, visible layer.
    op(OPS.beginMarkedContentProps, ['OC', { type: 'OCG', id: 'w' }])
    op(OPS.constructPath, path(OPS.stroke, DRAW_OPS.moveTo, 0, 150, DRAW_OPS.lineTo, 60, 150))
    op(OPS.endMarkedContent)
    // A clip-only path, a fill-only square and a curve.
    op(OPS.constructPath, path(OPS.endPath, DRAW_OPS.moveTo, 0, 0, DRAW_OPS.lineTo, 200, 0))
    op(OPS.constructPath, path(OPS.fill, DRAW_OPS.moveTo, 0, 0, DRAW_OPS.lineTo, 5, 0, DRAW_OPS.lineTo, 5, 5, DRAW_OPS.lineTo, 0, 5, DRAW_OPS.closePath))
    op(OPS.constructPath, path(OPS.stroke, DRAW_OPS.moveTo, 100, 100, DRAW_OPS.curveTo, 100, 120, 120, 140, 140, 140))
    // A picture over a quarter of the page, then four tiles of a sixteenth each.
    op(OPS.save)
    op(OPS.transform, [100, 0, 0, 100, 0, 0])
    op(OPS.paintImageXObject, ['img1', 1, 1])
    op(OPS.restore)
    op(OPS.paintImageXObjectRepeat, ['img2', 50, 50, [100, 100, 150, 100, 100, 150, 150, 150]])
    // An empty path.
    op(OPS.constructPath, [OPS.stroke, [null], null])
    // A solid wall drawn filled and outlined: its centre line, not its four edges.
    op(OPS.constructPath, path(OPS.fillStroke, DRAW_OPS.moveTo, 0, 180, DRAW_OPS.lineTo, 100, 180, DRAW_OPS.lineTo, 100, 186, DRAW_OPS.lineTo, 0, 186, DRAW_OPS.closePath))

    const page = readPageVectors({
      operatorList: { fnArray, argsArray },
      ops: OPS,
      transform: [1, 0, 0, 1, 0, 0],
      width: 200,
      height: 200,
      layerNames: new Map([['w', 'A-WALL']]),
      isLayerVisible: (g) => (g as { id: string }).id !== 'hidden',
    })
    const strokes = page.segments.filter((s) => s.source === 'stroke')
    expect(strokes).toHaveLength(4)
    expect(strokes[0]).toMatchObject({ x1: 10, y1: 0, x2: 30, y2: 0, width: 4 })
    expect(strokes[1]).toMatchObject({ x1: 0, y1: 50, x2: 40, y2: 50, width: 3 })
    expect(strokes[2]).toMatchObject({ x1: 0, y1: 100, x2: 0, y2: 140, width: 3 })
    expect(strokes[3]).toMatchObject({ x1: 0, y1: 150, x2: 60, y2: 150, layer: 'A-WALL' })
    expect(page.curves).toHaveLength(1)
    expect(page.curves[0].points[0]).toEqual({ x: 100, y: 100 })
    expect(page.curves[0].points.at(-1)).toEqual({ x: 140, y: 140 })
    expect(page.segments.filter((s) => s.source === 'fill')).toEqual([{ x1: 0, y1: 183, x2: 100, y2: 183, width: 6, source: 'fill', path: 6, layer: null }])
    expect(page.stats.otherFills).toBe(1)
    expect(page.stats.images).toBe(5)
    expect(page.stats.imageCoverage).toBeCloseTo(0.25 + 4 * 0.0625)
  })
})

describe('readPdfPage on generated plans', () => {
  it('keeps the operator list format this reader expects (pdfjs-dist 6.5.438)', async () => {
    const { OPS, version } = await loadPdfjs()
    expect(version).toBe('6.5.438')
    const page = await readFirstPage(await makeRoomPdf())
    const i = page.operatorList.fnArray.indexOf(OPS.constructPath)
    expect(i).toBeGreaterThanOrEqual(0)
    const [paintOp, holder, minMax] = page.operatorList.argsArray[i] as [number, [Float32Array], Float32Array]
    expect(typeof paintOp).toBe('number')
    expect(holder[0]).toBeInstanceOf(Float32Array)
    expect(holder[0][0]).toBe(DRAW_OPS.moveTo)
    expect(minMax).toBeInstanceOf(Float32Array)
  })

  it('reads the room in the pixels of the rendered page', async () => {
    const page = await readFirstPage(await makeRoomPdf())
    // Letter landscape at the model's largest size.
    expect([page.width, page.height]).toEqual([2184, 1687])
    expect(page.pxPerPt).toBeCloseTo(page.scale)
    const px = (xm: number, ym: number) => ({
      x: (ORIGIN_PT.x + xm * PT_PER_M) * page.scale,
      y: (PAGE_PT.height - (ORIGIN_PT.y + ym * PT_PER_M)) * page.scale,
    })
    const wallWidth = ROOM.wall * PT_PER_M * page.scale
    const walls = page.segments.filter((s) => Math.abs(s.width - wallWidth) < 0.01)
    expect(walls).toHaveLength(5)
    const top = walls.find((s) => Math.abs(s.y1 - px(0, ROOM.depth).y) < 0.05 && Math.abs(s.y2 - s.y1) < 0.05)
    expect(top).toBeDefined()
    expect(len(top!)).toBeCloseTo(ROOM.width * PT_PER_M * page.scale, 1)
    // The partition, from inside the half-width form: 100 pt long, 6 pt pen squeezed to 4.24 pt.
    const partition = page.segments.find((s) => Math.abs(len(s) - 100 * page.scale) < 0.5)
    expect(partition).toBeDefined()
    expect(partition!.width).toBeCloseTo(6 * Math.SQRT1_2 * page.scale, 2)
    expect(partition!.x1).toBeCloseTo(px(ROOM.partition.x, 0).x, 1)
    // The door swing is a curve, kept apart.
    expect(page.curves).toHaveLength(1)
    // Text, with positions.
    const dim = page.texts.find((t) => t.text === '10.00 m')
    expect(dim).toBeDefined()
    expect(dim!.angle).toBeCloseTo(0)
    expect(dim!.from.y).toBeCloseTo((PAGE_PT.height - (ORIGIN_PT.y + ROOM.depth * PT_PER_M + 21)) * page.scale, 1)
    expect(page.texts.map((t) => t.text)).toContain('MAIN ROOM')
    expect(page.stats.imageCoverage).toBe(0)
  })

  it('applies the page rotation, so a 90 degree page reads upright in pixels', async () => {
    const flat = await readFirstPage(await makeRoomPdf())
    const turned = await readFirstPage(await makeRoomPdf({ rotate: 90 }))
    expect(turned.rotate).toBe(90)
    expect(turned.width).toBeLessThan(turned.height)
    // The same lines, turned: the long wall now runs down the page.
    const longest = (segs: VectorSegment[]) => segs.reduce((a, b) => (len(b) > len(a) ? b : a))
    const a = longest(flat.segments)
    const b = longest(turned.segments)
    expect(len(b) / turned.scale).toBeCloseTo(len(a) / flat.scale, 2)
    expect(Math.abs(a.x2 - a.x1)).toBeGreaterThan(Math.abs(a.y2 - a.y1))
    expect(Math.abs(b.y2 - b.y1)).toBeGreaterThan(Math.abs(b.x2 - b.x1))
    const dim = turned.texts.find((t) => t.text === '10.00 m')!
    expect(Math.abs(dim.angle)).toBeCloseTo(90)
  })

  it('reads solid walls as centre lines with their thickness', async () => {
    const page = await readFirstPage(await makeRoomPdf({ solidWalls: true }))
    const fills = page.segments.filter((s) => s.source === 'fill')
    expect(fills).toHaveLength(5)
    const scale = PT_PER_M * page.scale
    expect(fills.map((s) => Math.round((len(s) / scale) * 100) / 100).sort((p, q) => p - q)).toEqual([4, 5.1, 8, 8, 10])
    for (const s of fills) expect(s.width / scale).toBeCloseTo(ROOM.wall, 3)
  })
})

describe('text', () => {
  const text = (t: string, x: number, h = 10): PageText => ({
    text: t,
    from: { x, y: 100 },
    to: { x: x + t.length * 6, y: 100 },
    center: { x: x + t.length * 3, y: 95 },
    height: h,
    angle: 0,
  })

  it('joins pieces on one baseline', () => {
    const runs = joinTextRuns([text('m', 130), text('10.00', 98)])
    expect(runs.map((r) => r.text)).toEqual(['10.00 m'])
    expect(runs[0].from.x).toBe(98)
    expect(runs[0].to.x).toBe(136)
  })

  it('keeps apart text on other lines or far along', () => {
    const far = joinTextRuns([text('A', 0), text('B', 200)])
    expect(far).toHaveLength(2)
    const other = joinTextRuns([text('A', 0), { ...text('B', 7), from: { x: 7, y: 140 }, to: { x: 13, y: 140 } }])
    expect(other).toHaveLength(2)
  })

  it('reads text items through the viewport, skipping marked content', () => {
    const out = readTextItems(
      [{ type: 'beginMarkedContent' }, { str: '  ', transform: [8, 0, 0, 8, 0, 0], width: 5, height: 8 }, { str: '5 m', transform: [8, 0, 0, 8, 100, 500], width: 20, height: 8 }],
      [2, 0, 0, -2, 0, 1224],
    )
    expect(out).toHaveLength(1)
    expect(out[0].from).toEqual({ x: 200, y: 224 })
    expect(out[0].to).toEqual({ x: 240, y: 224 })
    expect(out[0].height).toBe(16)
    // Half the height above the baseline, which is up on the page and up on screen.
    expect(out[0].center).toEqual({ x: 220, y: 216 })
  })
})
