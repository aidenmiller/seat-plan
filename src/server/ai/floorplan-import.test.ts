/**
 * floorplanImportStream against a local stand-in for the Messages API: the
 * deadline stops a call that hangs, a browser that goes away ends the stream
 * without an error line, and progress lines count output as it streams.
 */
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Socket } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyDraft } from '@/domain/floorplan/draft-schema'
import type { FloorplanImportLine } from '@/shared/api'
import { DEFAULT_FLOORPLAN_MODEL, errorLogFields, floorplanImportStream, floorplanModel, importConfigured, readFinalMessage } from './floorplan-import'

let server: Server
let baseUrl = ''
let handle: (res: ServerResponse) => void = () => undefined
const sockets = new Set<Socket>()

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume()
    req.on('end', () => handle(res))
  })
  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  for (const s of sockets) s.destroy()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
beforeEach(() => {
  vi.stubEnv('ANTHROPIC_BASE_URL', baseUrl)
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test-not-a-real-key')
  vi.stubEnv('FLOORPLAN_MODEL', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function event(res: ServerResponse, data: Record<string, unknown>) {
  res.write(`event: ${String(data.type)}\ndata: ${JSON.stringify(data)}\n\n`)
}

function start(res: ServerResponse) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  event(res, {
    type: 'message_start',
    message: {
      id: 'msg_x',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      stop_details: null,
      usage: { input_tokens: 10, output_tokens: 1 },
    },
  })
}

const input = {
  image: { contentType: 'image/png' as const, bytes: new Uint8Array([1, 2, 3]) },
  prompt: { width: 100, height: 80, kind: 'raster' as const },
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<FloorplanImportLine[]> {
  const text = await new Response(stream).text()
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as FloorplanImportLine)
}

describe('floorplanImportStream', () => {
  it('stops a call that runs past the deadline with a plain message', async () => {
    handle = (res) => start(res) // then never finishes
    const out = await readAll(floorplanImportStream(input, { deadlineMs: 300, progressMs: 50 }))
    expect(out.filter((l) => l.type === 'progress').length).toBeGreaterThanOrEqual(3)
    expect(out.at(-1)).toEqual({
      type: 'error',
      code: 'timeout',
      message: 'The import took too long and was stopped. Try again, or crop the plan to the rooms you need.',
    })
  })

  it('ends without an error line when the browser goes away', async () => {
    handle = (res) => start(res)
    const browser = new AbortController()
    setTimeout(() => browser.abort(), 150)
    const out = await readAll(floorplanImportStream(input, { requestSignal: browser.signal, progressMs: 40 }))
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((l) => l.type === 'progress')).toBe(true)
  })

  it('counts output in progress lines while the reply streams', async () => {
    const text = JSON.stringify(emptyDraft())
    handle = async (res) => {
      start(res)
      event(res, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '', citations: null } })
      for (let i = 0; i < text.length; i += 40) {
        event(res, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 40) } })
        await sleep(25)
      }
      event(res, { type: 'content_block_stop', index: 0 })
      event(res, { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 77 } })
      event(res, { type: 'message_stop' })
      res.end()
    }
    const out = await readAll(floorplanImportStream(input, { progressMs: 20 }))
    const counts = out.flatMap((l) => (l.type === 'progress' ? [l.outputTokens] : []))
    expect(Math.max(...counts)).toBeGreaterThan(1)
    expect(counts).toEqual([...counts].sort((a, b) => a - b))
    expect(out.at(-1)).toEqual({ type: 'draft', draft: emptyDraft(), model: 'claude-sonnet-5-5', outputTokens: 77 })
  })
})

describe('a refused request', () => {
  function refuse(message: string) {
    handle = (res) => {
      res.writeHead(400, { 'content-type': 'application/json', 'request-id': 'req_test_123' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }))
    }
  }

  it('says the request was refused, with its id, and logs why without the key or the image', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      refuse('output_config.format.schema: Schema is too complex for compilation')
      const out = await readAll(floorplanImportStream(input, { progressMs: 1000 }))
      expect(out.at(-1)).toEqual({ type: 'error', code: 'bad_request', message: 'The AI service refused the request (request req_test_123). The server log says why.' })
      expect(log).toHaveBeenCalledTimes(1)
      const [title, fields] = log.mock.calls[0] as [string, Record<string, unknown>]
      expect(title).toBe('Floor plan import failed')
      expect(fields).toMatchObject({
        model: DEFAULT_FLOORPLAN_MODEL,
        status: 400,
        type: 'invalid_request_error',
        message: 'output_config.format.schema: Schema is too complex for compilation',
        requestId: 'req_test_123',
      })
      const logged = JSON.stringify(log.mock.calls)
      expect(logged).not.toContain('sk-test-not-a-real-key')
      expect(logged).not.toContain(Buffer.from(input.image.bytes).toString('base64'))
    } finally {
      log.mockRestore()
    }
  })

  it('points at the image only when the API names it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      refuse('messages.0.content.0.image: image exceeds the maximum allowed size (oversized_image)')
      const out = await readAll(floorplanImportStream(input, { progressMs: 1000 }))
      expect(out.at(-1)).toEqual({ type: 'error', code: 'bad_request', message: 'The AI service could not take this plan. Try a smaller image or a simpler page.' })
    } finally {
      log.mockRestore()
    }
  })

  it('logs errors that are not from the API by name and message', () => {
    expect(errorLogFields(new TypeError('bad'))).toEqual({ name: 'TypeError', message: 'bad' })
    expect(errorLogFields('x')).toEqual({ name: 'string', message: null })
  })
})

describe('settings and the final message', () => {
  it('reads the model and the key from the environment', () => {
    expect(floorplanModel()).toBe(DEFAULT_FLOORPLAN_MODEL)
    expect(DEFAULT_FLOORPLAN_MODEL).toBe('claude-sonnet-5-5')
    vi.stubEnv('FLOORPLAN_MODEL', ' claude-opus-5-5 ')
    expect(floorplanModel()).toBe('claude-opus-5-5')
    expect(importConfigured()).toBe(true)
    vi.stubEnv('ANTHROPIC_API_KEY', '  ')
    expect(importConfigured()).toBe(false)
  })

  it('treats any stop other than a finished turn as an error', () => {
    const message = (stop_reason: string, text = '{}') =>
      ({
        id: 'm',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5-5',
        content: [{ type: 'text', text, citations: null }],
        stop_reason,
        stop_sequence: null,
        stop_details: null,
        usage: { input_tokens: 1, output_tokens: 2 },
      }) as unknown as Parameters<typeof readFinalMessage>[0]
    expect(readFinalMessage(message('model_context_window_exceeded'))).toMatchObject({ type: 'error', code: 'max_tokens' })
    expect(readFinalMessage(message('pause_turn'))).toMatchObject({ type: 'error', code: 'failed' })
    expect(readFinalMessage(message('tool_use'))).toMatchObject({ type: 'error', code: 'failed' })
    expect(readFinalMessage(message('end_turn', JSON.stringify(emptyDraft())))).toMatchObject({ type: 'draft', outputTokens: 2 })
  })
})
