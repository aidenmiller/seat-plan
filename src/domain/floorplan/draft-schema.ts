/**
 * The model's reply for the floor plan import (spec section 5 step 4, PLAN
 * changes 20 and 21), its JSON schema for structured outputs, and the prompt.
 *
 * Every coordinate is in pixels of the image as sent, origin top left, x to
 * the right and y down. Every property is required: no optional and no
 * nullable fields, so the schema has no unions. An unknown text is '', an
 * unknown number 0 and an unknown kind 'unknown'. Enums are lower case. The
 * schema holds no number or length limits (the API refuses them); the reply
 * is checked after it arrives, and to-fixed-items.ts drops what cannot be
 * drawn.
 *
 * For a vector PDF the PDF's own lines go to the model as a numbered list,
 * and the model answers with their ids: a wall lists the ids of the lines
 * that draw it, a door or window the ids of its lines, and any line it leaves
 * out is ignored. It never types those coordinates again. Walls the lines do
 * not cover, and every wall of a scanned plan or picture, come as points.
 */
import { z } from 'zod'
import type { CleanSegment, DoorHint } from './cleanup'
import type { PageText } from './pdf-vectors'

const px = (description: string) => z.number().describe(description)
const point = z.object({ x: z.number(), y: z.number() }).describe('A point in image pixels')
const points = (description: string) => z.array(point).describe(description)
const flags = {
  unsure: z.boolean().describe('True when you are not sure of this item'),
  unsure_note: z.string().describe('A few words on what is unclear, or "" when sure'),
}

export const swingValues = ['left', 'right', 'double', 'none', 'unknown'] as const
export const columnShapeValues = ['rect', 'round', 'unknown'] as const

export const draftWallSchema = z.object({
  id: z.string().describe('Your own id for this wall, such as w1; doors and windows refer to it'),
  segment_ids: z.array(z.string()).describe('Ids of the numbered PDF lines that draw this wall; [] when it has none'),
  points: points('Only for a wall no numbered line draws: its centre line, in order; [] otherwise'),
  thickness_px: px('Wall thickness in pixels; 0 when unknown'),
  ...flags,
})

const area = {
  name: z.string().describe('The name printed on the plan, or "" when there is none'),
  points: points('The outline, corners in order, not closed'),
  ...flags,
}

const opening = {
  position: point.describe('The middle of the opening, in image pixels'),
  width_px: px('Width of the opening along the wall, in pixels'),
  rotation: z.number().describe('Direction of the wall at the opening in degrees: 0 along x, 90 along y'),
  wall_id: z.string().describe('The id of the wall it sits in, or ""'),
  segment_ids: z.array(z.string()).describe('Ids of the numbered PDF lines that draw it; [] when none'),
}

const box = {
  center: point,
  width_px: px('Size along its own x axis, in pixels'),
  height_px: px('Size along its own y axis, in pixels'),
  rotation: z.number().describe('Degrees clockwise; 0 when it lines up with the image'),
}

export const floorplanDraftSchema = z.object({
  walls: z.array(draftWallSchema).describe('Every wall, inside and outside'),
  rooms: z.array(z.object(area)).describe('Rooms with walls round them'),
  zones: z.array(z.object(area)).describe('Named areas without full walls, such as a patio, terrace or lawn'),
  patio_edges: z
    .array(z.object({ points: points('The edge, in order'), ...flags }))
    .describe('Edges of outdoor areas that are not walls, such as a railing line or a deck edge'),
  doors: z.array(z.object({ ...opening, swing: z.enum(swingValues).describe('Which way the leaf opens, seen from inside the wall, or unknown'), ...flags })),
  windows: z.array(z.object({ ...opening, ...flags })),
  columns: z.array(z.object({ ...box, shape: z.enum(columnShapeValues), ...flags })),
  stairs: z.array(z.object({ ...box, ...flags })),
  bars: z.array(z.object({ ...box, label: z.string().describe('Text on it, or ""'), ...flags })).describe('Built-in bars and counters'),
  labels: z
    .array(
      z.object({
        text: z.string(),
        position: point.describe('The middle of the text'),
        height_px: px('Height of the letters in pixels'),
        ...flags,
      }),
    )
    .describe('Other text worth keeping, such as Kitchen, Stage or Entrance. Not dimensions'),
  dimension_labels: z
    .array(
      z.object({
        text: z.string().describe('The text exactly as printed'),
        value_cm: z.number().describe('The length it states in centimeters; 0 when you cannot read it'),
        from: point.describe('One end of the line the dimension measures'),
        to: point.describe('The other end'),
        ...flags,
      }),
    )
    .describe('Every dimension printed on the plan'),
})

export type FloorplanDraft = z.infer<typeof floorplanDraftSchema>
export type DraftWall = FloorplanDraft['walls'][number]
export type DraftDoor = FloorplanDraft['doors'][number]
export type DraftWindow = FloorplanDraft['windows'][number]

/** An empty draft: every list empty. */
export function emptyDraft(): FloorplanDraft {
  return { walls: [], rooms: [], zones: [], patio_edges: [], doors: [], windows: [], columns: [], stairs: [], bars: [], labels: [], dimension_labels: [] }
}

// ---------------------------------------------------------------- JSON schema for the API

type JsonSchema = { [key: string]: unknown }

/** Keywords the structured outputs grammar does not accept (it refuses the request). */
const UNSUPPORTED = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
  'uniqueItems',
  'prefixItems',
  'contains',
  'minProperties',
  'maxProperties',
  'patternProperties',
  'if',
  'then',
  'else',
  'not',
] as const

function forceClosedObjects(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(forceClosedObjects)
  if (!node || typeof node !== 'object') return node
  const out: JsonSchema = {}
  for (const [k, v] of Object.entries(node as JsonSchema)) out[k] = forceClosedObjects(v)
  if (out.type === 'object' || out.properties) out.additionalProperties = false
  return out
}

/**
 * The JSON schema sent as output_config.format.schema: made by Zod, with
 * $schema removed and additionalProperties false on every object.
 */
export function floorplanJsonSchema(): JsonSchema {
  const raw = z.toJSONSchema(floorplanDraftSchema, { io: 'output' }) as JsonSchema
  const { $schema: _drop, ...rest } = raw
  void _drop
  return forceClosedObjects(rest) as JsonSchema
}

export type SchemaReport = {
  /** Properties not listed in their object's required list. The API allows 24 per request. */
  optional: number
  /** Properties whose type is a union (anyOf, oneOf, or a list of types such as nullable). The API allows 16. */
  unions: number
  /** Other things the API would refuse. */
  problems: string[]
}

/** Structured outputs limits (research_anthropic.json): at most 24 optional and 16 union properties. */
export const MAX_OPTIONAL_PROPERTIES = 24
export const MAX_UNION_PROPERTIES = 16

/** Counts what the API limits in a JSON schema, and lists anything it would refuse. */
export function checkSchemaLimits(schema: unknown): SchemaReport {
  const report: SchemaReport = { optional: 0, unions: 0, problems: [] }
  const isUnion = (s: JsonSchema) => Array.isArray(s.anyOf) || Array.isArray(s.oneOf) || Array.isArray(s.type)
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((n, i) => walk(n, `${path}[${i}]`))
      return
    }
    if (!node || typeof node !== 'object') return
    const s = node as JsonSchema
    for (const k of UNSUPPORTED) if (k in s) report.problems.push(`${path}: ${k}`)
    if (typeof s.minItems === 'number' && s.minItems > 1) report.problems.push(`${path}: minItems ${s.minItems}`)
    if (Array.isArray(s.oneOf)) report.problems.push(`${path}: oneOf`)
    if (typeof s.$ref === 'string' && !s.$ref.startsWith('#')) report.problems.push(`${path}: remote $ref`)
    if (s.type === 'object' || s.properties) {
      if (s.additionalProperties !== false) report.problems.push(`${path}: additionalProperties is not false`)
      const props = (s.properties ?? {}) as JsonSchema
      const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : [])
      for (const [name, prop] of Object.entries(props)) {
        if (!required.has(name)) report.optional++
        if (prop && typeof prop === 'object' && isUnion(prop as JsonSchema)) report.unions++
      }
    }
    for (const [k, v] of Object.entries(s)) {
      if (k === 'enum' || k === 'const' || k === 'required' || k === 'description') continue
      walk(v, `${path}.${k}`)
    }
  }
  walk(schema, '$')
  if (report.optional > MAX_OPTIONAL_PROPERTIES) report.problems.push(`${report.optional} optional properties (limit ${MAX_OPTIONAL_PROPERTIES})`)
  if (report.unions > MAX_UNION_PROPERTIES) report.problems.push(`${report.unions} union properties (limit ${MAX_UNION_PROPERTIES})`)
  return report
}

// ---------------------------------------------------------------- reading the reply

const ENUM_FIELDS = new Set(['swing', 'shape'])

/** Lower-cases enum values: the API does not promise their case. */
function lowerEnums(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(lowerEnums)
  if (!node || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    out[k] = ENUM_FIELDS.has(k) && typeof v === 'string' ? v.trim().toLowerCase() : lowerEnums(v)
  }
  return out
}

export type DraftParse = { ok: true; draft: FloorplanDraft } | { ok: false; error: string }

/** Reads the model's text reply: JSON, enum case fixed, then checked with Zod. */
export function parseDraftReply(text: string): DraftParse {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'The reply is not valid JSON.' }
  }
  const parsed = floorplanDraftSchema.safeParse(lowerEnums(json))
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: `The reply does not match the draft format at ${first?.path.join('.') || 'the top'}: ${first?.message ?? 'unknown problem'}` }
  }
  return { ok: true, draft: parsed.data }
}

// ---------------------------------------------------------------- prompt

export type PromptInput = {
  /** The image's size in pixels, as sent. */
  width: number
  height: number
  /** 'vector': a PDF with lines (send them as `segments`); 'raster': a scan or picture. */
  kind: 'vector' | 'raster'
  segments?: readonly CleanSegment[]
  /** Text the PDF holds, for the model to match with what it sees. At most 300 are listed. */
  texts?: readonly Pick<PageText, 'text' | 'center'>[]
  /** Curves that look like door swings. */
  doorHints?: readonly DoorHint[]
  /** The venue's name, when known. */
  venueName?: string
}

const r1 = (v: number) => Math.round(v * 10) / 10
const r0 = (v: number) => Math.round(v)

/** One line per segment: id x1 y1 x2 y2 thickness, whole pixels. */
export function formatSegmentList(segments: readonly CleanSegment[]): string {
  return segments.map((s) => `${s.id} ${r0(s.x1)} ${r0(s.y1)} ${r0(s.x2)} ${r0(s.y2)} ${r1(s.thickness)}`).join('\n')
}

/** The user message text that goes with the image. */
export function buildFloorplanPrompt(input: PromptInput): string {
  const { width, height } = input
  const parts: string[] = []
  const venue = input.venueName?.trim() ? ` of ${input.venueName.trim()}` : ''
  parts.push(
    `The image is a floor plan${venue}, ${width} by ${height} pixels. We seat wedding guests at tables in this venue, so we need its walls, rooms, doors and the other fixed things exactly where they are.`,
    `Give every coordinate in pixels of this image: x from the left edge, y from the top edge, origin at the top left corner. Use whole or decimal pixel values, never fractions of the image.`,
  )
  if (input.kind === 'vector' && input.segments && input.segments.length > 0) {
    parts.push(
      [
        `The plan comes from a PDF, and its lines are listed below, numbered. Each row is: id x1 y1 x2 y2 thickness, in pixels of this image.`,
        `Label the lines by id and never retype their coordinates:`,
        `- A wall lists the ids of every line that draws it in segment_ids, and its points stay [].`,
        `- A door or window lists the ids of the lines that draw it in its segment_ids.`,
        `- Leave out every other line (furniture, dimension lines, hatching, text, grid, title block). Lines left out are ignored.`,
        `- Add a wall with points only when you can see a wall that no listed line draws.`,
        ``,
        `Lines:`,
        formatSegmentList(input.segments),
      ].join('\n'),
    )
  } else {
    parts.push(
      `The plan is a picture with no line data. Give each wall as points along its centre line, corner to corner, with segment_ids []. Put a corner wherever the wall turns, and end a wall where it meets a door opening.`,
    )
  }
  if (input.texts && input.texts.length > 0) {
    const listed = input.texts.slice(0, 300).map((t) => `"${t.text.replace(/"/g, "'")}" at ${r0(t.center.x)} ${r0(t.center.y)}`)
    parts.push(`Text in the PDF, with the middle of each in pixels:\n${listed.join('\n')}`)
  }
  if (input.doorHints && input.doorHints.length > 0) {
    const listed = input.doorHints.slice(0, 200).map((d) => `hinge ${r0(d.hinge.x)} ${r0(d.hinge.y)}, radius ${r0(d.radius)}`)
    parts.push(`Arcs in the PDF that may be door swings:\n${listed.join('\n')}`)
  }
  parts.push(
    [
      `Rules for the reply:`,
      `- Fill every list; use [] when there is nothing of that kind. Use "" for text you cannot read and 0 for a number you do not know.`,
      `- Walls: one item per straight run or per connected run; give each an id such as w1. thickness_px is the wall's thickness.`,
      `- Rooms: areas closed by walls, with their name as printed ("" when unnamed), outline corners in order.`,
      `- Zones: named areas without full walls, such as a patio, terrace, lawn or dance floor marked on the plan.`,
      `- Patio edges: outdoor edges that are not walls, such as a deck edge or railing.`,
      `- Doors and windows: position is the middle of the opening, width_px its width along the wall, rotation the wall's direction (0 along x, 90 along y), wall_id the id of the wall it sits in ("" when none).`,
      `- Columns, stairs and built-in bars: the centre, the size and the rotation of each.`,
      `- Labels: room names and other useful text, not dimensions.`,
      `- Dimension labels: every dimension you can read, the text as printed, value_cm the length it states in centimeters (12'-6" is 381, 10.00 m is 1000), and from and to the two ends of the line it measures.`,
      `- Leave out loose furniture: tables, chairs, sofas, beds, plants.`,
      `- Do not invent anything you cannot see. When you are not sure of an item, still include it, set unsure to true and say why in a few words in unsure_note. Otherwise unsure is false and unsure_note is "".`,
    ].join('\n'),
  )
  return parts.join('\n\n')
}
