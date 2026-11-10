/**
 * A small local stand-in for the Anthropic Messages API, for the floor plan
 * import tests (PLAN section 9: the SDK honours ANTHROPIC_BASE_URL, so the
 * app talks to this server and the tests need no key). Global setup starts
 * it on port 4210 (E2E_STAND_IN_PORT); playwright.config.ts points the app at
 * it with ANTHROPIC_BASE_URL and a dummy ANTHROPIC_API_KEY.
 *
 * POST /v1/messages answers the way the real API streams a reply
 * (server-sent events: message_start, a thinking block, the text in pieces,
 * message_delta with the stop reason, message_stop), after checking the
 * request has the shape the app must send: a key, a model, stream true,
 * structured outputs (output_config.format json_schema) and one user message
 * holding a base64 image and the prompt. Anything else gets a 400, as the
 * real API would give, so a broken request fails the test.
 *
 * What it answers depends on the prompt, so one server serves every test:
 *  - The venue name holds REFUSAL_MARKER: a refusal (stop_reason "refusal").
 *  - The prompt lists numbered PDF lines (a vector PDF, PLAN change 21):
 *    every listed line labelled a wall by its id, with no coordinates, plus
 *    the room the lines enclose. Walls must then come from the PDF's own
 *    lines.
 *  - Anything else: the recorded draft in fixtures/floorplan-draft.json, for
 *    the plan fixtures/floorplan-png.ts draws. A picture of another size is
 *    refused with a 400, so a resize in the browser shows up as a failure.
 *
 * GET /__stand-in/requests lists what each call held (model, image size in
 * bytes, the prompt, the PDF line ids, what was answered), for the tests to
 * check what the app sent. Never logs or stores a key.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'

export const DEFAULT_STAND_IN_PORT = 4210

/** A venue whose name holds this gets a refusal. */
export const REFUSAL_MARKER = 'Refusal check'

/** The recorded reply for the PNG plan, and the picture size it was recorded for. */
export const RECORDED_DRAFT_FILE = path.join(__dirname, 'fixtures', 'floorplan-draft.json')

export type RecordedDraft = { imageWidth: number; imageHeight: number; draft: Record<string, unknown> }

export type SeenSegment = { id: string; x1: number; y1: number; x2: number; y2: number; thickness: number }

/** One call, as GET /__stand-in/requests lists it. */
export type StandInCall = {
  at: string
  model: string
  imageMediaType: string
  imageBytes: number
  imageSha256: string
  prompt: string
  /** "W by H pixels" from the prompt. */
  imageWidth: number | null
  imageHeight: number | null
  /** The numbered PDF lines the prompt listed (vector PDFs only). */
  segments: SeenSegment[]
  schemaType: string | null
  answer: 'recorded draft' | 'pdf walls' | 'refusal' | 'bad request'
  error?: string
}

type Json = Record<string, unknown>

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => (raw += chunk))
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'request-id': 'req_stand_in' })
  res.end(JSON.stringify(body))
}

/** A 400 in the API's error shape. */
function badRequest(res: ServerResponse, message: string): void {
  sendJson(res, 400, { type: 'error', error: { type: 'invalid_request_error', message } })
}

/** Streams a finished message the way the Messages API does. */
function streamMessage(res: ServerResponse, model: string, text: string, stopReason: 'end_turn' | 'refusal'): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'request-id': 'req_stand_in' })
  const event = (data: Json) => res.write(`event: ${String(data.type)}\ndata: ${JSON.stringify(data)}\n\n`)
  event({
    type: 'message_start',
    message: {
      id: 'msg_stand_in',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 4800, output_tokens: 1 },
    },
  })
  event({ type: 'ping' })
  event({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } })
  event({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Reading the plan.' } })
  event({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'stand-in' } })
  event({ type: 'content_block_stop', index: 0 })
  event({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '', citations: null } })
  const size = Math.max(1, Math.ceil(text.length / 5))
  for (let i = 0; i < text.length; i += size) {
    event({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(i, i + size) } })
  }
  event({ type: 'content_block_stop', index: 1 })
  event({
    type: 'message_delta',
    delta: {
      stop_reason: stopReason,
      stop_sequence: null,
      stop_details: stopReason === 'refusal' ? { type: 'refusal', category: 'cyber', explanation: null } : null,
    },
    usage: { output_tokens: Math.max(1, Math.round(text.length / 4)) },
  })
  event({ type: 'message_stop' })
  res.end()
}

/** The numbered lines after "Lines:" in the prompt: `id x1 y1 x2 y2 thickness`. */
export function promptSegments(prompt: string): SeenSegment[] {
  const at = prompt.indexOf('\nLines:\n')
  if (at < 0) return []
  const out: SeenSegment[] = []
  for (const line of prompt.slice(at + '\nLines:\n'.length).split('\n')) {
    const m = /^(\S+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)$/.exec(line.trim())
    if (!m) break
    out.push({ id: m[1], x1: Number(m[2]), y1: Number(m[3]), x2: Number(m[4]), y2: Number(m[5]), thickness: Number(m[6]) })
  }
  return out
}

const sure = { unsure: false, unsure_note: '' }

function emptyDraft(): Json {
  return { walls: [], rooms: [], zones: [], patio_edges: [], doors: [], windows: [], columns: [], stairs: [], bars: [], labels: [], dimension_labels: [] }
}

function distanceToSegment(p: { x: number; y: number }, s: SeenSegment): number {
  const dx = s.x2 - s.x1
  const dy = s.y2 - s.y1
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / len2))
  return Math.hypot(p.x - (s.x1 + t * dx), p.y - (s.y1 + t * dy))
}

/**
 * What the model answers for a vector PDF (PLAN change 21): it labels the
 * listed lines by id and never retypes their coordinates. Lines drawn with a
 * real pen width (at least a fifth of the thickest) are walls, one wall per
 * line; a thin line (a door leaf) is a door at its end on a wall. Plus one
 * room round all the walls.
 */
export function pdfWallsDraft(segments: readonly SeenSegment[]): Json {
  const thickest = Math.max(...segments.map((s) => s.thickness))
  const walls = segments.filter((s) => s.thickness >= thickest / 5)
  const thin = segments.filter((s) => s.thickness < thickest / 5)
  const wallId = new Map(walls.map((s, i) => [s.id, `w${i + 1}`]))
  const xs = walls.flatMap((s) => [s.x1, s.x2])
  const ys = walls.flatMap((s) => [s.y1, s.y2])
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const doors = thin.map((leaf) => {
    // The leaf's hinge is the end that sits on a wall.
    const ends = [
      { x: leaf.x1, y: leaf.y1 },
      { x: leaf.x2, y: leaf.y2 },
    ]
    let best = { at: ends[0], wall: walls[0], d: Infinity }
    for (const at of ends) {
      for (const w of walls) {
        const d = distanceToSegment(at, w)
        if (d < best.d) best = { at, wall: w, d }
      }
    }
    const rotation = (Math.atan2(best.wall.y2 - best.wall.y1, best.wall.x2 - best.wall.x1) * 180) / Math.PI
    return {
      position: best.at,
      width_px: Math.hypot(leaf.x2 - leaf.x1, leaf.y2 - leaf.y1),
      rotation: ((Math.round(rotation) % 180) + 180) % 180,
      wall_id: wallId.get(best.wall.id) ?? '',
      segment_ids: [leaf.id],
      swing: 'left',
      ...sure,
    }
  })
  return {
    ...emptyDraft(),
    walls: walls.map((s) => ({ id: wallId.get(s.id), segment_ids: [s.id], points: [], thickness_px: 0, ...sure })),
    doors,
    rooms: [
      {
        name: 'Main Room',
        points: [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
        ],
        ...sure,
      },
    ],
  }
}

export function readRecordedDraft(): RecordedDraft {
  return JSON.parse(readFileSync(RECORDED_DRAFT_FILE, 'utf8')) as RecordedDraft
}

/** Checks the request the app sent; returns what is wrong, or the parts the answer needs. */
function readRequest(
  req: IncomingMessage,
  body: Json,
): { ok: false; error: string } | { ok: true; model: string; media: string; data: string; prompt: string; schemaType: string } {
  if (!req.headers['x-api-key'] && !req.headers['authorization']) return { ok: false, error: 'No API key was sent.' }
  if (!req.headers['anthropic-version']) return { ok: false, error: 'No anthropic-version header was sent.' }
  const model = typeof body.model === 'string' ? body.model : ''
  if (!/^claude-/.test(model)) return { ok: false, error: `model: ${JSON.stringify(body.model)} is not a Claude model.` }
  if (body.stream !== true) return { ok: false, error: 'stream: the import must stream.' }
  if (!(typeof body.max_tokens === 'number' && body.max_tokens > 0)) return { ok: false, error: 'max_tokens: missing.' }
  if ('tool_choice' in body) return { ok: false, error: 'tool_choice: type "tool" and "any" are not supported for this model.' }
  const config = body.output_config as Json | undefined
  const format = config?.format as Json | undefined
  if (format?.type !== 'json_schema' || typeof format.schema !== 'object' || format.schema === null) {
    return { ok: false, error: 'output_config.format: the import must ask for structured outputs (json_schema).' }
  }
  const messages = body.messages as Json[] | undefined
  if (!Array.isArray(messages) || messages.length !== 1 || messages[0].role !== 'user' || !Array.isArray(messages[0].content)) {
    return { ok: false, error: 'messages: one user message with content blocks is expected.' }
  }
  const blocks = messages[0].content as Json[]
  const image = blocks.find((b) => b.type === 'image')
  const source = image?.source as Json | undefined
  const media = typeof source?.media_type === 'string' ? source.media_type : ''
  if (source?.type !== 'base64' || !['image/png', 'image/jpeg'].includes(media) || typeof source.data !== 'string' || source.data === '') {
    return { ok: false, error: 'messages.0.content: a base64 PNG or JPEG image block is expected.' }
  }
  const prompt = blocks
    .filter((b) => b.type === 'text')
    .map((b) => String(b.text ?? ''))
    .join('\n')
  if (prompt.trim() === '') return { ok: false, error: 'messages.0.content: the prompt text is missing.' }
  return { ok: true, model, media, data: source.data, prompt, schemaType: String(format.type) }
}

export type StandIn = { url: string; close(): Promise<void> }

/** Starts the stand-in on 127.0.0.1:port. */
export async function startStandIn(port = DEFAULT_STAND_IN_PORT): Promise<StandIn> {
  const calls: StandInCall[] = []
  const recorded = readRecordedDraft()

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://stand-in')
      if (url.pathname === '/__stand-in/requests') {
        if (req.method === 'DELETE') calls.length = 0
        return sendJson(res, 200, calls)
      }
      if (req.method !== 'POST' || url.pathname !== '/v1/messages') {
        return sendJson(res, 404, { type: 'error', error: { type: 'not_found_error', message: `${req.method} ${url.pathname} is not served here.` } })
      }
      let body: Json
      try {
        body = JSON.parse(await readBody(req)) as Json
      } catch {
        return badRequest(res, 'The body is not JSON.')
      }
      const read = readRequest(req, body)
      if (!read.ok) {
        calls.push({
          at: new Date().toISOString(),
          model: String(body.model ?? ''),
          imageMediaType: '',
          imageBytes: 0,
          imageSha256: '',
          prompt: '',
          imageWidth: null,
          imageHeight: null,
          segments: [],
          schemaType: null,
          answer: 'bad request',
          error: read.error,
        })
        return badRequest(res, read.error)
      }
      const bytes = Buffer.from(read.data, 'base64')
      const size = /(\d+) by (\d+) pixels/.exec(read.prompt)
      const segments = promptSegments(read.prompt)
      const call: StandInCall = {
        at: new Date().toISOString(),
        model: read.model,
        imageMediaType: read.media,
        imageBytes: bytes.byteLength,
        imageSha256: createHash('sha256').update(bytes).digest('hex'),
        prompt: read.prompt,
        imageWidth: size ? Number(size[1]) : null,
        imageHeight: size ? Number(size[2]) : null,
        segments,
        schemaType: read.schemaType,
        answer: 'recorded draft',
      }
      calls.push(call)

      if (read.prompt.includes(REFUSAL_MARKER)) {
        call.answer = 'refusal'
        return streamMessage(res, read.model, '', 'refusal')
      }
      if (segments.length > 0) {
        call.answer = 'pdf walls'
        return streamMessage(res, read.model, JSON.stringify(pdfWallsDraft(segments)), 'end_turn')
      }
      if (call.imageWidth !== recorded.imageWidth || call.imageHeight !== recorded.imageHeight) {
        call.answer = 'bad request'
        call.error = `The recorded draft is for a ${recorded.imageWidth} by ${recorded.imageHeight} picture, not ${call.imageWidth} by ${call.imageHeight}.`
        return badRequest(res, call.error)
      }
      return streamMessage(res, read.model, JSON.stringify(recorded.draft), 'end_turn')
    })().catch((err: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { type: 'error', error: { type: 'api_error', message: String(err) } })
      else res.end()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

// ---------------------------------------------------------------- for the tests

function standInUrl(): string {
  const url = process.env.E2E_STAND_IN_URL
  if (!url) throw new Error('E2E_STAND_IN_URL is not set; run through playwright.config.ts')
  return url
}

/** Every call the stand-in has had this run (both projects share it). */
export async function standInCalls(): Promise<StandInCall[]> {
  const res = await fetch(`${standInUrl()}/__stand-in/requests`)
  if (!res.ok) throw new Error(`The stand-in answered ${res.status}`)
  return (await res.json()) as StandInCall[]
}

/** The calls whose prompt names this venue. */
export async function standInCallsFor(venueName: string): Promise<StandInCall[]> {
  return (await standInCalls()).filter((c) => c.prompt.includes(venueName))
}
