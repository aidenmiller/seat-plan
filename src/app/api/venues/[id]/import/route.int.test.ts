/**
 * The AI floor plan import route against the test database and a local
 * stand-in for the Messages API that streams replies the way the real one
 * does (server-sent events). Covers a good draft, a refusal, a reply cut off
 * at max_tokens, a reply that fails the draft schema, an API error, the
 * request the server sends, the checks before any call, and a missing key.
 * The template never changes.
 */
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_DATABASE_URL } from '../../../../../../test/db'
import { makeGridPng } from '@/domain/floorplan/__fixtures__/plans'
import { emptyDraft, floorplanJsonSchema, type FloorplanDraft } from '@/domain/floorplan/draft-schema'
import { SITE_COOKIE, createSiteToken } from '@/server/auth/tokens'
import type { FloorplanImportLine, VenueDetail, VenueImageInfo } from '@/shared/api'

// ---------------------------------------------------------------- the stand-in Messages API

type Reply = (req: IncomingMessage, res: ServerResponse) => void
type Seen = { path: string; headers: IncomingMessage['headers']; body: Record<string, unknown> }

let server: Server
let baseUrl = ''
let reply: Reply = () => undefined
const seen: Seen[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => (raw += chunk))
    req.on('end', () => {
      seen.push({ path: req.url ?? '', headers: req.headers, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} })
      reply(req, res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const DUMMY_KEY = 'sk-test-not-a-real-key'

beforeEach(() => {
  seen.length = 0
  vi.stubEnv('AUTH_SECRET', 'import-route-test-secret-32-chars-plus')
  vi.stubEnv('SITE_PASSWORD', 'import-route-made-up-password')
  vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL)
  vi.stubEnv('ANTHROPIC_BASE_URL', baseUrl)
  vi.stubEnv('ANTHROPIC_API_KEY', DUMMY_KEY)
  vi.stubEnv('FLOORPLAN_MODEL', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

/** A streamed message: a thinking block, the text in a few pieces, then the stop reason. */
function streamReply(text: string, stopReason: string, extra: { stopDetails?: unknown; outputTokens?: number } = {}): Reply {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'request-id': 'req_test' })
    const event = (data: Record<string, unknown>) => res.write(`event: ${String(data.type)}\ndata: ${JSON.stringify(data)}\n\n`)
    event({
      type: 'message_start',
      message: {
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        stop_details: null,
        usage: { input_tokens: 5200, output_tokens: 1 },
      },
    })
    event({ type: 'ping' })
    event({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } })
    event({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } })
    event({ type: 'content_block_stop', index: 0 })
    event({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '', citations: null } })
    const size = Math.max(1, Math.ceil(text.length / 4))
    for (let i = 0; i < text.length; i += size) {
      event({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(i, i + size) } })
    }
    event({ type: 'content_block_stop', index: 1 })
    event({
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null, stop_details: extra.stopDetails ?? null },
      usage: { output_tokens: extra.outputTokens ?? 1234 },
    })
    event({ type: 'message_stop' })
    res.end()
  }
}

function errorReply(status: number, type: string, message: string): Reply {
  return (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json', 'retry-after-ms': '1' })
    res.end(JSON.stringify({ type: 'error', error: { type, message } }))
  }
}

// ---------------------------------------------------------------- the app side

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>

async function postImport(id: string, body: unknown) {
  const route = (await import('./route')) as Record<string, unknown>
  const req = new NextRequest(`https://seat.example/api/venues/${id}/import`, {
    method: 'POST',
    headers: { cookie: `${SITE_COOKIE}=${createSiteToken()}`, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const res = await (route.POST as Handler)(req, { params: Promise.resolve({ id }) })
  const text = await res.text()
  return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), text }
}

function lines(text: string): FloorplanImportLine[] {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as FloorplanImportLine)
}

const PNG = makeGridPng(400, 300)

/** A template with one uploaded image. */
async function setup(): Promise<{ id: string; image: VenueImageInfo }> {
  const venues = (await import('../../route')) as Record<string, unknown>
  const images = (await import('../images/route')) as Record<string, unknown>
  const cookie = `${SITE_COOKIE}=${createSiteToken()}`
  const createReq = new NextRequest('https://seat.example/api/venues', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Import Hall' }),
  })
  const venue = (await (await (venues.POST as (r: NextRequest) => Promise<Response>)(createReq)).json()) as VenueDetail
  const uploadReq = new NextRequest(`https://seat.example/api/venues/${venue.id}/images`, { method: 'POST', headers: { cookie }, body: new Uint8Array(PNG) })
  const image = (await (await (images.POST as Handler)(uploadReq, { params: Promise.resolve({ id: venue.id }) })).json()) as VenueImageInfo
  return { id: venue.id, image }
}

async function templateVersion(id: string): Promise<number> {
  const { getTemplate } = await import('@/server/repo/venues')
  const { getDb } = await import('@/server/db/client')
  return (await getTemplate(getDb(), id))!.version
}

const flags = { unsure: false, unsure_note: '' }

function goodDraft(): FloorplanDraft {
  return {
    ...emptyDraft(),
    walls: [
      { id: 'w1', segment_ids: ['s1', 's2'], points: [], thickness_px: 6, ...flags },
      { id: 'w2', segment_ids: [], points: [{ x: 10, y: 10 }, { x: 10, y: 290 }], thickness_px: 0, unsure: true, unsure_note: 'Faint line' },
    ],
    rooms: [{ name: 'Main Room', points: [{ x: 10, y: 10 }, { x: 390, y: 10 }, { x: 390, y: 290 }, { x: 10, y: 290 }], ...flags }],
    doors: [
      { position: { x: 200, y: 10 }, width_px: 30, rotation: 0, wall_id: 'w1', segment_ids: [], swing: 'left', ...flags },
    ],
    dimension_labels: [{ text: "40'-0\"", value_cm: 1219.2, from: { x: 10, y: 5 }, to: { x: 390, y: 5 }, ...flags }],
  }
}

describe('POST /api/venues/[id]/import', () => {
  it('streams progress, then the checked draft; sends the image, prompt and schema; never touches the template', async () => {
    const { id, image } = await setup()
    // The model wrote an enum in capitals: the server lower-cases it before the check.
    const draft = goodDraft()
    const replyText = JSON.stringify(draft).replace('"swing":"left"', '"swing":"LEFT"')
    reply = streamReply(replyText, 'end_turn', { outputTokens: 2345 })

    const segments = [
      { id: 's1', x1: 10, y1: 10, x2: 390, y2: 10, thickness: 6, source: 'stroke' },
      { id: 's2', x1: 390, y1: 10, x2: 390, y2: 290, thickness: 6, source: 'fill' },
    ]
    const res = await postImport(id, {
      imageId: image.id,
      imageWidth: 400,
      imageHeight: 300,
      segments,
      labels: [{ text: 'Main Room', center: { x: 200, y: 150 } }],
    })
    expect(res.status).toBe(200)
    expect(res.type).toBe('application/x-ndjson; charset=utf-8')
    expect(res.cache).toBe('no-store')
    const out = lines(res.text)
    expect(out[0]).toEqual({ type: 'progress', elapsedMs: expect.any(Number), outputTokens: 0 })
    expect(out.slice(0, -1).every((l) => l.type === 'progress')).toBe(true)
    expect(out.at(-1)).toEqual({ type: 'draft', draft, model: 'claude-sonnet-5-5', outputTokens: 2345 })

    // What the server sent.
    expect(seen).toHaveLength(1)
    const sent = seen[0]!
    expect(sent.path).toBe('/v1/messages')
    // SDK 1.x sends the key as a bearer token.
    expect(sent.headers.authorization).toBe(`Bearer ${DUMMY_KEY}`)
    expect(sent.body).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 64000,
      stream: true,
      output_config: { effort: 'high', format: { type: 'json_schema', schema: floorplanJsonSchema() } },
    })
    for (const key of ['temperature', 'top_p', 'top_k', 'tools', 'tool_choice']) expect(sent.body).not.toHaveProperty(key)
    const content = (sent.body.messages as { role: string; content: Record<string, unknown>[] }[])[0]!.content
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: Buffer.from(PNG).toString('base64') },
      transformations: { oversized_image: 'error' },
    })
    expect(content[1]!.type).toBe('text')
    const prompt = String(content[1]!.text)
    expect(prompt).toContain('Import Hall, 400 by 300 pixels')
    expect(prompt).toContain('s1 10 10 390 10 6')
    expect(prompt).toContain('"Main Room" at 200 150')

    expect(await templateVersion(id)).toBe(1)
  })

  it('reads a picture without lines, and uses FLOORPLAN_MODEL when set', async () => {
    const { id, image } = await setup()
    vi.stubEnv('FLOORPLAN_MODEL', 'claude-opus-5-5')
    reply = streamReply(JSON.stringify(emptyDraft()), 'end_turn')
    const out = lines((await postImport(id, { imageId: image.id, imageWidth: 400, imageHeight: 300 })).text)
    expect(out.at(-1)).toMatchObject({ type: 'draft', draft: emptyDraft() })
    expect(seen[0]!.body.model).toBe('claude-opus-5-5')
    const prompt = String(((seen[0]!.body.messages as { content: { text?: string }[] }[])[0]!.content[1]!).text)
    expect(prompt).toContain('The plan is a picture with no line data')
    expect(prompt).not.toContain('Lines:')
  })

  it('turns a refusal into a plain message', async () => {
    const { id, image } = await setup()
    reply = streamReply('', 'refusal', { stopDetails: { type: 'refusal', category: 'cyber', explanation: null } })
    const out = lines((await postImport(id, { imageId: image.id, imageWidth: 400, imageHeight: 300 })).text)
    expect(out.at(-1)).toEqual({
      type: 'error',
      code: 'refusal',
      message: 'The AI model declined to read this plan. Try again, or draw the walls by hand.',
    })
    expect(await templateVersion(id)).toBe(1)
  })

  it('turns a reply cut off at max_tokens into a plain message', async () => {
    const { id, image } = await setup()
    reply = streamReply(JSON.stringify(goodDraft()).slice(0, 80), 'max_tokens', { outputTokens: 64000 })
    const out = lines((await postImport(id, { imageId: image.id, imageWidth: 400, imageHeight: 300 })).text)
    expect(out.at(-1)).toEqual({
      type: 'error',
      code: 'max_tokens',
      message: 'The plan holds too much detail for one reply, and the reply was cut off. Try again, or crop the plan.',
    })
  })

  it('refuses a reply that does not match the draft schema', async () => {
    const { id, image } = await setup()
    const broken = { ...goodDraft(), walls: [{ id: 'w1', points: 'not a list' }] }
    reply = streamReply(JSON.stringify(broken), 'end_turn')
    const out = lines((await postImport(id, { imageId: image.id, imageWidth: 400, imageHeight: 300 })).text)
    expect(out.at(-1)).toEqual({
      type: 'error',
      code: 'invalid_reply',
      message: 'The AI reply did not come back in the draft format. Try again.',
    })

    reply = streamReply('this is not JSON', 'end_turn')
    const notJson = lines((await postImport(id, { imageId: image.id, imageWidth: 400, imageHeight: 300 })).text)
    expect(notJson.at(-1)).toMatchObject({ type: 'error', code: 'invalid_reply' })
  })

  it('turns API errors into plain messages, retrying a server error once', async () => {
    const { id, image } = await setup()
    reply = errorReply(401, 'authentication_error', 'invalid x-api-key')
    const auth = lines((await postImport(id, { imageId: image.id, imageWidth: 400, imageHeight: 300 })).text)
    expect(auth.at(-1)).toEqual({
      type: 'error',
      code: 'auth',
      message: 'The server could not sign in to the AI service. Check ANTHROPIC_API_KEY on the server.',
    })
    expect(seen).toHaveLength(1)

    seen.length = 0
    reply = errorReply(529, 'overloaded_error', 'Overloaded')
    const busy = lines((await postImport(id, { imageId: image.id, imageWidth: 400, imageHeight: 300 })).text)
    expect(busy.at(-1)).toEqual({ type: 'error', code: 'unavailable', message: 'The AI service had a problem. Try again in a moment.' })
    expect(seen).toHaveLength(2)
    // Nothing the server says carries the key.
    expect(JSON.stringify([auth, busy])).not.toContain(DUMMY_KEY)
  })

  it('checks the template, the image and the body before calling the API', async () => {
    const { id, image } = await setup()
    const other = await setup()
    reply = streamReply(JSON.stringify(emptyDraft()), 'end_turn')

    expect((await postImport('not-a-uuid', {})).status).toBe(404)
    expect((await postImport(randomUUID(), { imageId: image.id, imageWidth: 400, imageHeight: 300 })).status).toBe(404)
    expect((await postImport(id, '{oops')).status).toBe(400)
    expect((await postImport(id, { imageId: image.id })).status).toBe(422)
    const foreign = await postImport(id, { imageId: other.image.id, imageWidth: 400, imageHeight: 300 })
    expect(foreign.status).toBe(422)
    expect(JSON.parse(foreign.text)).toEqual({ error: 'invalid', issues: ['imageId: That image was not uploaded to this venue'] })
    const wrongSize = await postImport(id, { imageId: image.id, imageWidth: 800, imageHeight: 600 })
    expect(JSON.parse(wrongSize.text)).toEqual({ error: 'invalid', issues: ['imageWidth: The stored image is 400 by 300 pixels'] })
    const twice = await postImport(id, {
      imageId: image.id,
      imageWidth: 400,
      imageHeight: 300,
      segments: [
        { id: 's1', x1: 0, y1: 0, x2: 1, y2: 1, thickness: 1, source: 'stroke' },
        { id: 's1', x1: 0, y1: 0, x2: 2, y2: 2, thickness: 1, source: 'stroke' },
      ],
    })
    expect(twice.status).toBe(422)

    // An image larger than the model reads at full size.
    const { addTemplateImage } = await import('@/server/repo/venues')
    const { getDb } = await import('@/server/db/client')
    const large = await addTemplateImage(getDb(), id, makeGridPng(3000, 1000))
    if (large.status !== 'created') throw new Error(large.status)
    const tooLarge = await postImport(id, { imageId: large.image.id, imageWidth: 3000, imageHeight: 1000 })
    expect(tooLarge.status).toBe(422)

    expect(seen).toHaveLength(0)
  })

  it('answers 503 with a plain message when the server has no API key', async () => {
    const { id, image } = await setup()
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const res = await postImport(id, { imageId: image.id, imageWidth: 400, imageHeight: 300 })
    expect(res.status).toBe(503)
    expect(JSON.parse(res.text)).toEqual({
      error: 'not_configured',
      message: 'The floor plan import needs ANTHROPIC_API_KEY set on the server.',
    })
    expect(seen).toHaveLength(0)
  })
})
