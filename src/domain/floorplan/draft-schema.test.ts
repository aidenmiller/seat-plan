import { describe, expect, it } from 'vitest'
import type { CleanSegment } from './cleanup'
import {
  buildFloorplanPrompt,
  checkSchemaLimits,
  emptyDraft,
  floorplanDraftSchema,
  floorplanJsonSchema,
  formatSegmentList,
  parseDraftReply,
  type FloorplanDraft,
} from './draft-schema'

type Node = { [key: string]: unknown }

function walk(node: unknown, visit: (n: Node, path: string) => void, path = '$') {
  if (Array.isArray(node)) return node.forEach((n, i) => walk(n, visit, `${path}[${i}]`))
  if (!node || typeof node !== 'object') return
  visit(node as Node, path)
  for (const [k, v] of Object.entries(node as Node)) walk(v, visit, `${path}.${k}`)
}

function sampleDraft(): FloorplanDraft {
  const p = (x: number, y: number) => ({ x, y })
  const ok = { unsure: false, unsure_note: '' }
  return {
    walls: [{ id: 'w1', segment_ids: ['s1', 's2'], points: [], thickness_px: 30, ...ok }],
    rooms: [{ name: 'Main Room', points: [p(0, 0), p(100, 0), p(100, 80)], ...ok }],
    zones: [{ name: 'Patio', points: [p(0, 0), p(10, 0), p(10, 10)], unsure: true, unsure_note: 'Edge is faint' }],
    patio_edges: [{ points: [p(0, 0), p(10, 0)], ...ok }],
    doors: [{ position: p(50, 0), width_px: 20, rotation: 0, wall_id: 'w1', segment_ids: [], swing: 'left', ...ok }],
    windows: [{ position: p(0, 40), width_px: 30, rotation: 90, wall_id: '', segment_ids: ['s9'], ...ok }],
    columns: [{ center: p(60, 40), width_px: 6, height_px: 6, rotation: 0, shape: 'round', ...ok }],
    stairs: [{ center: p(10, 70), width_px: 20, height_px: 10, rotation: 0, ...ok }],
    bars: [{ center: p(80, 70), width_px: 30, height_px: 8, rotation: 0, label: 'Bar', ...ok }],
    labels: [{ text: 'KITCHEN', position: p(20, 20), height_px: 5, ...ok }],
    dimension_labels: [{ text: '10.00 m', value_cm: 1000, from: p(0, -10), to: p(100, -10), ...ok }],
  }
}

describe('the JSON schema sent to the API', () => {
  const schema = floorplanJsonSchema()

  it('stays well inside the structured outputs limits: no optional and no union properties', () => {
    const report = checkSchemaLimits(schema)
    expect(report).toEqual({ optional: 0, unions: 0, problems: [] })
  })

  it('has no $schema key and additionalProperties false on every object', () => {
    expect(schema.$schema).toBeUndefined()
    walk(schema, (n, path) => {
      if (n.type === 'object') {
        expect(n.additionalProperties, path).toBe(false)
        // Every property is required.
        expect([...(n.required as string[])].sort(), path).toEqual(Object.keys(n.properties as Node).sort())
      }
    })
  })

  it('holds no number, length or item count limits, and no tuples', () => {
    walk(schema, (n, path) => {
      for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'maxItems', 'prefixItems', 'anyOf', 'oneOf', 'allOf']) {
        expect(k in n, `${path}.${k}`).toBe(false)
      }
      if ('minItems' in n) expect(n.minItems as number, path).toBeLessThanOrEqual(1)
    })
  })

  it('uses lower case enums and lists every top level part', () => {
    const enums: string[] = []
    walk(schema, (n) => {
      if (Array.isArray(n.enum)) enums.push(...(n.enum as string[]))
    })
    expect(enums.length).toBeGreaterThan(0)
    for (const e of enums) expect(e).toBe(e.toLowerCase())
    expect(Object.keys(schema.properties as Node).sort()).toEqual(
      ['bars', 'columns', 'dimension_labels', 'doors', 'labels', 'patio_edges', 'rooms', 'stairs', 'walls', 'windows', 'zones'].sort(),
    )
  })

  it('counts what it is asked to', () => {
    const report = checkSchemaLimits({
      type: 'object',
      properties: { a: { type: 'string' }, b: { anyOf: [{ type: 'string' }, { type: 'null' }] }, c: { type: ['string', 'null'] } },
      required: ['b'],
    })
    expect(report.optional).toBe(2)
    expect(report.unions).toBe(2)
    expect(report.problems).toContain('$: additionalProperties is not false')
    expect(checkSchemaLimits({ type: 'number', minimum: 0 }).problems).toEqual(['$: minimum'])
  })
})

describe('parseDraftReply', () => {
  it('accepts a reply in the draft format', () => {
    const r = parseDraftReply(JSON.stringify(sampleDraft()))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.draft).toEqual(sampleDraft())
  })

  it('lower-cases enum values, since the API does not promise their case', () => {
    const d = sampleDraft() as unknown as { doors: { swing: string }[]; columns: { shape: string }[] }
    d.doors[0].swing = 'Left'
    d.columns[0].shape = 'ROUND'
    const r = parseDraftReply(JSON.stringify(d))
    expect(r.ok && r.draft.doors[0].swing).toBe('left')
    expect(r.ok && r.draft.columns[0].shape).toBe('round')
  })

  it('refuses a reply cut off or in another shape', () => {
    const text = JSON.stringify(sampleDraft())
    expect(parseDraftReply(text.slice(0, text.length - 20))).toEqual({ ok: false, error: 'The reply is not valid JSON.' })
    const missing = { ...sampleDraft() } as Partial<FloorplanDraft>
    delete missing.walls
    const r = parseDraftReply(JSON.stringify(missing))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('walls')
    const bad = sampleDraft() as unknown as { doors: { swing: string }[] }
    bad.doors[0].swing = 'sideways'
    expect(parseDraftReply(JSON.stringify(bad)).ok).toBe(false)
  })

  it('has an empty draft that passes its own check', () => {
    expect(floorplanDraftSchema.safeParse(emptyDraft()).success).toBe(true)
  })
})

describe('buildFloorplanPrompt', () => {
  const segments: CleanSegment[] = [
    { id: 's1', x1: 10.4, y1: 20, x2: 500.6, y2: 20, thickness: 31.27, source: 'stroke' },
    { id: 's2', x1: 10, y1: 20, x2: 10, y2: 400, thickness: 31.27, source: 'fill' },
  ]

  it('lists the PDF lines by id for a vector plan and asks for ids, not coordinates', () => {
    const text = buildFloorplanPrompt({ width: 2184, height: 1687, kind: 'vector', segments, texts: [{ text: '10.00 m', center: { x: 1001.2, y: 175 } }] })
    expect(text).toContain('2184 by 1687 pixels')
    expect(text).toContain('s1 10 20 501 20 31.3\ns2 10 20 10 400 31.3')
    expect(text).toContain('never retype their coordinates')
    expect(text).toContain('segment_ids')
    expect(text).toContain('"10.00 m" at 1001 175')
    expect(text).toContain('unsure')
    expect(text).not.toMatch(/—|!/)
  })

  it('asks for points when the plan is a picture', () => {
    const text = buildFloorplanPrompt({ width: 1600, height: 1200, kind: 'raster' })
    expect(text).toContain('points along its centre line')
    expect(text).not.toContain('Lines:')
  })

  it('formats one row per line', () => {
    expect(formatSegmentList(segments).split('\n')).toHaveLength(2)
  })
})
