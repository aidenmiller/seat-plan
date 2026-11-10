import { describe, expect, it } from 'vitest'
import { makeRoomPdf, PT_PER_M, ROOM } from './__fixtures__/plans'
import { readFirstPage } from './__fixtures__/pdfjs-node'
import {
  assignSegmentIds,
  capSegments,
  chainSegments,
  cleanupSegments,
  doorSwingHints,
  extractWallSegments,
  joinEndpoints,
  mergeCollinear,
  pairParallelLines,
  pickWallCandidates,
  snapAngles,
  type CleanSegment,
  type RawSegment,
} from './cleanup'
import type { VectorSegment } from './pdf-vectors'
import { chooseScale, measureDimensionLines } from './scale'

const len = (s: { x1: number; y1: number; x2: number; y2: number }) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1)
const raw = (x1: number, y1: number, x2: number, y2: number, thickness = 4): RawSegment => ({ x1, y1, x2, y2, thickness, source: 'stroke' })
const vec = (x1: number, y1: number, x2: number, y2: number, width: number, path: number, layer: string | null = null): VectorSegment => ({
  x1,
  y1,
  x2,
  y2,
  width,
  source: 'stroke',
  path,
  layer,
})

/** Wall lengths in meters at the scale the page's own dimension label gives. */
async function wallsInMeters(options: Parameters<typeof makeRoomPdf>[0]) {
  const page = await readFirstPage(await makeRoomPdf(options))
  const walls = extractWallSegments(page)
  const scale = chooseScale(measureDimensionLines(page.texts, page.segments))
  expect(scale.status).toBe('agree')
  const cmPerPx = scale.cmPerPx!
  const wallPx = ROOM.wall * PT_PER_M * page.pxPerPt
  const thick = walls.segments.filter((s) => s.thickness >= wallPx * 0.99)
  return { page, walls, cmPerPx, thick, metres: thick.map((s) => (len(s) * cmPerPx) / 100) }
}

describe('extractWallSegments on the generated room', () => {
  for (const rotate of [0, 90] as const) {
    it(`gives the walls at their real lengths within 1 cm (page rotated ${rotate})`, async () => {
      const { walls, cmPerPx, thick, metres } = await wallsInMeters({ rotate })
      // Five outer wall pieces with the door gap kept, at 20 cm.
      expect(metres.sort((a, b) => a - b).map((m) => m.toFixed(2))).toEqual(['4.00', '5.10', '8.00', '8.00', '10.00'])
      for (const m of metres) expect(Math.abs(m * 100 - Math.round(m * 10) * 10)).toBeLessThan(1)
      for (const s of thick) expect(Math.abs(s.thickness * cmPerPx - 20)).toBeLessThan(1)
      // The partition from the form XObject.
      const partition = walls.segments.find((s) => Math.abs((len(s) * cmPerPx) / 100 - ROOM.partition.length) < 0.01)
      expect(partition).toBeDefined()
      // Hatching, dimension lines and the curve never get here.
      expect(walls.segments.length).toBeLessThanOrEqual(7)
      expect(walls.dropped.thin).toBeGreaterThan(0)
      // Every id is unique and in order.
      expect(walls.segments.map((s) => s.id)).toEqual(walls.segments.map((_, i) => `s${i + 1}`))
    })
  }

  it('keeps the 0.9 m door opening between the two bottom wall pieces', async () => {
    const { thick, cmPerPx } = await wallsInMeters({})
    const bottom = thick.filter((s) => s.y1 === s.y2 && Math.max(...thick.map((t) => t.y1)) === s.y1)
    expect(bottom).toHaveLength(2)
    const [left, right] = bottom.sort((a, b) => a.x1 - b.x1)
    expect(((right.x1 - left.x2) * cmPerPx) / 100).toBeCloseTo(ROOM.doorTo - ROOM.doorFrom, 2)
  })

  it('reads the same with a crop box and with solid walls', async () => {
    for (const options of [{ crop: true }, { solidWalls: true }]) {
      const { metres } = await wallsInMeters(options)
      expect(metres.sort((a, b) => a - b).map((m) => m.toFixed(2))).toEqual(['4.00', '5.10', '8.00', '8.00', '10.00'])
    }
  })

  it('keeps every long line when one pen draws everything (walls as two thin faces)', async () => {
    const page = await readFirstPage(await makeRoomPdf({ doubleLineWalls: true }))
    const walls = extractWallSegments(page)
    expect(walls.thresholds.widthFilter).toBe(false)
    // Both faces of the top wall are there: 10.2 m outside, 9.8 m inside.
    const scale = PT_PER_M * page.pxPerPt
    const lengths = walls.segments.map((s) => Math.round((len(s) / scale) * 100) / 100)
    expect(lengths).toContain(10.2)
    expect(lengths).toContain(9.8)
  })

  it('finds the door swing as a hint', async () => {
    const page = await readFirstPage(await makeRoomPdf())
    const scale = PT_PER_M * page.pxPerPt
    const hints = doorSwingHints(page.curves, 0.5 * scale, 2 * scale)
    expect(hints).toHaveLength(1)
    expect(hints[0].radius / scale).toBeCloseTo(0.9, 2)
    expect(hints[0].sweep).toBeCloseTo(90, 0)
  })
})

describe('pickWallCandidates', () => {
  const page = (segments: VectorSegment[]) => ({ width: 1000, height: 1000, pxPerPt: 1, segments })

  it('drops short and thin lines, keeps thick long ones', () => {
    const r = pickWallCandidates(
      page([
        vec(0, 0, 500, 0, 10, 0),
        vec(0, 100, 500, 100, 1, 1),
        vec(0, 200, 500, 200, 1, 2),
        vec(0, 300, 5, 300, 10, 3),
        vec(0, 400, 500, 400, 1, 4),
      ]),
    )
    expect(r.candidates.map((s) => s.y1)).toEqual([0])
    expect(r.dropped).toEqual({ layer: 0, short: 1, thin: 3 })
    expect(r.thresholds.widthFilter).toBe(true)
  })

  it('uses CAD layer names when there are any', () => {
    const r = pickWallCandidates(
      page([vec(0, 0, 500, 0, 10, 0, 'A-DIMS'), vec(0, 100, 500, 100, 1, 1, 'A-WALL'), vec(0, 200, 500, 200, 1, 2), vec(0, 300, 500, 300, 10, 3)]),
    )
    expect(r.candidates.map((s) => s.y1)).toEqual([100, 300])
    expect(r.dropped.layer).toBe(1)
  })

  it('does not filter by width when the thick lines are a tiny share (a heavy title block border)', () => {
    const segments = [vec(0, 0, 100, 0, 10, 0)]
    for (let i = 0; i < 30; i++) segments.push(vec(0, 100 + i * 20, 900, 100 + i * 20, 1, i + 1))
    const r = pickWallCandidates(page(segments))
    expect(r.thresholds.widthFilter).toBe(false)
    expect(r.candidates).toHaveLength(31)
  })
})

describe('cleanup steps', () => {
  it('makes lines within 1 degree exactly level or plumb, and leaves others', () => {
    const [h, v, d] = snapAngles([raw(0, 0, 100, 1), raw(0, 0, 1, 100), raw(0, 0, 100, 5)])
    expect([h.y1, h.y2]).toEqual([0.5, 0.5])
    expect([v.x1, v.x2]).toEqual([0.5, 0.5])
    expect([d.y1, d.y2]).toEqual([0, 5])
  })

  it('joins nearby end points and keeps axis lines exact', () => {
    const [h, v] = joinEndpoints([raw(0, 10, 100, 10), raw(101, 12, 101, 200)], 3)
    expect([h.x2, h.y2]).toEqual([101, 10])
    expect([v.x1, v.y1]).toEqual([101, 10])
    // Far ends stay put.
    expect([h.x1, v.y2]).toEqual([0, 200])
  })

  it('does not chain a run of close points into one far-moving cluster', () => {
    const segs = [raw(0, 0, 0, 50), raw(2, 0, 2, 50), raw(4, 0, 4, 50), raw(6, 0, 6, 50)]
    const joined = joinEndpoints(segs, 2.5)
    const xs = joined.map((s) => s.x1)
    // Each line stays within the tolerance of where it was.
    xs.forEach((x, i) => expect(Math.abs(x - segs[i].x1)).toBeLessThanOrEqual(2.5))
  })

  it('merges overlapping collinear pieces but never bridges a gap', () => {
    const merged = mergeCollinear([raw(0, 0, 60, 0), raw(50, 0, 100, 0), raw(140, 0, 300, 0)], 2, 1, 2)
    expect(merged.map((s) => [s.x1, s.x2])).toEqual([
      [0, 100],
      [140, 300],
    ])
  })

  it('merges touching thick pieces of the same thickness, but not thin ones (a door threshold in line with a wall)', () => {
    const thick = mergeCollinear([raw(0, 0, 100, 0, 10), raw(100.5, 0, 200, 0, 10)], 2, 1, 5)
    expect(thick).toHaveLength(1)
    const thin = mergeCollinear([raw(0, 0, 100, 0, 1), raw(100, 0, 190, 0, 1), raw(190, 0, 300, 0, 1)], 2, 1, 5)
    expect(thin).toHaveLength(3)
  })

  it('merges collinear pieces on a slant too, including ones drawn in opposite directions', () => {
    const merged = mergeCollinear([raw(0, 0, 100, 100), raw(150, 150, 80, 80)], 2, 1)
    expect(merged).toHaveLength(1)
    expect(len(merged[0])).toBeCloseTo(150 * Math.SQRT2)
  })

  it('drops what is still short after cleanup', () => {
    expect(cleanupSegments([raw(0, 0, 5, 0), raw(0, 10, 100, 10)], { snapTol: 2, mergeGap: 1, minLength: 10 })).toHaveLength(1)
  })

  it('caps the count, keeping the longest and thickest', () => {
    const segs = Array.from({ length: 2000 }, (_, i) => raw(0, i * 10, 10 + i, i * 10, 1))
    const capped = capSegments(segs, 1500)
    expect(capped).toHaveLength(1500)
    expect(Math.min(...capped.map(len))).toBe(510)
  })

  it('gives stable ids in reading order whatever order the lines come in', () => {
    const segs = [raw(0, 100, 50, 100), raw(10, 0, 60, 0), raw(80, 50, 0, 50)]
    const a = assignSegmentIds(segs)
    const b = assignSegmentIds([...segs].reverse())
    expect(a).toEqual(b)
    expect(a.map((s) => [s.id, s.y1])).toEqual([
      ['s1', 0],
      ['s2', 50],
      ['s3', 100],
    ])
    // Lines run left to right.
    expect(a[1].x1).toBe(0)
  })
})

describe('double lines and chains', () => {
  const seg = (x1: number, y1: number, x2: number, y2: number, thickness = 1): CleanSegment => ({ id: '', x1, y1, x2, y2, thickness, source: 'stroke' })

  it('pairs two thin faces into one centre line with the gap as thickness', () => {
    // An L-shaped wall 20 thick: outer faces to the outer corner, inner faces to the inner corner.
    const out = pairParallelLines([seg(0, 0, 200, 0), seg(20, 20, 200, 20), seg(0, 0, 0, 200), seg(20, 20, 20, 200)], 30)
    expect(out).toHaveLength(2)
    const h = out.find((s) => s.y1 === s.y2)!
    const v = out.find((s) => s.x1 === s.x2)!
    expect(h).toMatchObject({ x1: 10, y1: 10, x2: 200, y2: 10, thickness: 20 })
    expect(v).toMatchObject({ x1: 10, y1: 10, x2: 10, y2: 200, thickness: 20 })
  })

  it('leaves thick walls side by side and far lines unpaired', () => {
    expect(pairParallelLines([seg(0, 0, 100, 0, 15), seg(0, 20, 100, 20, 15)], 30)).toHaveLength(2)
    expect(pairParallelLines([seg(0, 0, 100, 0), seg(0, 80, 100, 80)], 30)).toHaveLength(2)
  })

  it('chains pieces into polylines and closes loops', () => {
    const square = chainSegments([seg(0, 0, 100, 0, 5), seg(100, 0, 100, 100, 5), seg(0, 100, 100, 100, 5), seg(0, 0, 0, 100, 5)], 1)
    expect(square).toHaveLength(1)
    expect(square[0].closed).toBe(true)
    expect(square[0].points).toHaveLength(5)
    expect(square[0].points[0]).toEqual(square[0].points[4])
  })

  it('stops chains at junctions and at thickness changes, and drops straight-on points', () => {
    const t = chainSegments([seg(0, 0, 50, 0, 5), seg(50, 0, 100, 0, 5), seg(50, 0, 50, 80, 5)], 1)
    expect(t).toHaveLength(3)
    const line = chainSegments([seg(0, 0, 50, 0, 5), seg(50, 0, 100, 0, 5)], 1)
    expect(line).toHaveLength(1)
    expect(line[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ])
    const change = chainSegments([seg(0, 0, 50, 0, 5), seg(50, 0, 50, 50, 20)], 1)
    expect(change).toHaveLength(2)
  })
})

describe('a large drawing', () => {
  it('handles 60,000 lines and caps what goes to the model at 1,500', () => {
    let seed = 11
    const rand = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const segments: VectorSegment[] = []
    for (let i = 0; i < 60_000; i++) {
      const x = rand() * 2000
      const y = rand() * 1500
      const level = rand() < 0.5
      const length = rand() < 0.3 ? 20 + rand() * 400 : rand() * 20
      segments.push(vec(x, y, level ? x + length : x, level ? y : y + length, rand() < 0.2 ? 8 : 1, i % 5000))
    }
    const start = performance.now()
    const out = extractWallSegments({ width: 2184, height: 1687, pxPerPt: 2.76, segments })
    const ms = performance.now() - start
    expect(out.segments.length).toBeLessThanOrEqual(1500)
    expect(out.dropped.cap).toBeGreaterThan(0)
    expect(new Set(out.segments.map((s) => s.id)).size).toBe(out.segments.length)
    expect(ms).toBeLessThan(3000)
  })
})
