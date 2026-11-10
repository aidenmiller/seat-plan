import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { buildFloorplanPrompt, floorplanJsonSchema, parseDraftReply, type PromptInput } from '@/domain/floorplan/draft-schema'
import type { FloorplanImportErrorCode, FloorplanImportLine } from '@/shared/api'

/**
 * The floor plan import's call to the Anthropic API (spec section 5 steps 3
 * and 4, PLAN changes 20 to 22, research_anthropic.json). Server only: the
 * key never reaches the browser, and nothing here logs the key or the image.
 *
 *  - new Anthropic() reads ANTHROPIC_API_KEY and honours ANTHROPIC_BASE_URL.
 *  - The model comes from FLOORPLAN_MODEL, default claude-sonnet-5-5.
 *  - The image goes as base64 with oversized_image 'error', so the API
 *    refuses rather than quietly shrinking it (the reply's pixels would then
 *    no longer match ours). The prompt and the JSON schema come from
 *    src/domain/floorplan/draft-schema.ts.
 *  - Structured outputs (output_config.format json_schema): current models
 *    refuse a forced tool choice. Effort high, max_tokens 64000, streamed,
 *    one retry. The schema is passed as is (not through the SDK's helpers,
 *    which would move enums into descriptions).
 *  - One deadline of about 280 s, joined with the browser's request signal,
 *    keeps the call inside the route's 300 s.
 *  - stop_reason is checked before the text is read; the text is then parsed
 *    and checked with the Zod draft schema. Every failure is a plain sentence.
 *  - Every failure is also logged on the server (console.error, which Vercel
 *    keeps): the error's status, the API's error type, code and message, and
 *    the request id. Never the request, its headers, the key or the image.
 *    A 400 names the image only when the API's message does; otherwise the
 *    person sees that the request was refused, with its id.
 */

export const DEFAULT_FLOORPLAN_MODEL = 'claude-sonnet-5-5'
export const IMPORT_DEADLINE_MS = 280_000
export const PROGRESS_INTERVAL_MS = 2_000
const MAX_TOKENS = 64_000

export function floorplanModel(): string {
  return process.env.FLOORPLAN_MODEL?.trim() || DEFAULT_FLOORPLAN_MODEL
}

/** True when the server can call the API. */
export function importConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
}

export type FloorplanImportInput = {
  image: { contentType: 'image/png' | 'image/jpeg'; bytes: Uint8Array }
  prompt: PromptInput
}

export type FloorplanImportOptions = {
  /** The browser's request signal: when it aborts, the call stops and nothing more is sent. */
  requestSignal?: AbortSignal
  deadlineMs?: number
  progressMs?: number
}

type ErrorLine = Extract<FloorplanImportLine, { type: 'error' }>
type FinalLine = Extract<FloorplanImportLine, { type: 'draft' | 'error' }>

function failure(code: FloorplanImportErrorCode, message: string): ErrorLine {
  return { type: 'error', code, message }
}

const TIMEOUT_MESSAGE = 'The import took too long and was stopped. Try again, or crop the plan to the rooms you need.'

/**
 * What the server log gets for a failed call. Only the reply's own fields:
 * the request (with the key and the image) is never included.
 */
export function errorLogFields(err: unknown): Record<string, string | number | null> {
  if (err instanceof Anthropic.APIError) {
    return {
      status: err.status ?? null,
      type: err.type ?? null,
      code: err.errorCode ?? null,
      message: (err.apiMessage ?? err.message).slice(0, 500),
      requestId: err.requestID ?? null,
      timeout: err instanceof Anthropic.APIConnectionTimeoutError ? 1 : null,
    }
  }
  if (err instanceof Error) return { name: err.name, message: err.message.slice(0, 500) }
  return { name: typeof err, message: null }
}

/** The API refused a request because of the image itself (too large, unreadable), going by its own message. */
function aboutTheImage(err: InstanceType<typeof Anthropic.APIError>): boolean {
  return /\bimage\b|oversized/i.test(err.apiMessage ?? err.message)
}

/** A plain sentence for an error thrown by the SDK or the stream. */
function describeError(err: unknown, timedOut: boolean): ErrorLine {
  if (timedOut) return failure('timeout', TIMEOUT_MESSAGE)
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return failure('auth', 'The server could not sign in to the AI service. Check ANTHROPIC_API_KEY on the server.')
  }
  if (err instanceof Anthropic.RateLimitError) {
    return failure('busy', 'The AI service is busy right now. Wait a minute and try again.')
  }
  if (err instanceof Anthropic.NotFoundError) {
    return failure('bad_request', `The AI service does not know the model ${floorplanModel()}. Check FLOORPLAN_MODEL on the server.`)
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.UnprocessableEntityError) {
    if (aboutTheImage(err)) return failure('bad_request', 'The AI service could not take this plan. Try a smaller image or a simpler page.')
    const id = err.requestID ? ` (request ${err.requestID})` : ''
    return failure('bad_request', `The AI service refused the request${id}. The server log says why.`)
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) return failure('timeout', TIMEOUT_MESSAGE)
  if (err instanceof Anthropic.APIConnectionError) {
    return failure('unavailable', 'Could not reach the AI service. Try again in a moment.')
  }
  if (err instanceof Anthropic.APIError) {
    return failure('unavailable', 'The AI service had a problem. Try again in a moment.')
  }
  return failure('failed', 'The import failed. Try again.')
}

/** What the finished message means: a checked draft, or a plain error. */
export function readFinalMessage(message: Anthropic.Message): FinalLine {
  switch (message.stop_reason) {
    case 'end_turn':
    case 'stop_sequence':
      break
    case 'refusal':
      return failure('refusal', 'The AI model declined to read this plan. Try again, or draw the walls by hand.')
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return failure('max_tokens', 'The plan holds too much detail for one reply, and the reply was cut off. Try again, or crop the plan.')
    default:
      return failure('failed', 'The AI reply stopped before it was finished. Try again.')
  }
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const parsed = parseDraftReply(text)
  if (!parsed.ok) return failure('invalid_reply', 'The AI reply did not come back in the draft format. Try again.')
  return { type: 'draft', draft: parsed.draft, model: message.model, outputTokens: message.usage.output_tokens }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

/**
 * Runs the import and answers with NDJSON: a progress line at once and about
 * every 2 seconds ({ type: 'progress', elapsedMs, outputTokens }), then one
 * { type: 'draft' } or { type: 'error' } line. When the browser goes away,
 * the call is stopped and the stream simply ends.
 */
export function floorplanImportStream(input: FloorplanImportInput, options: FloorplanImportOptions = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const deadline = new AbortController()
  const signals = [deadline.signal, ...(options.requestSignal ? [options.requestSignal] : [])]
  const signal = AbortSignal.any(signals)
  let timer: ReturnType<typeof setInterval> | undefined
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now()
      let reportedTokens = 0
      let streamedChars = 0
      const send = (line: FloorplanImportLine) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))
        } catch {
          closed = true
        }
      }
      const finish = () => {
        clearInterval(timer)
        clearTimeout(deadlineTimer)
        if (closed) return
        closed = true
        try {
          controller.close()
        } catch {
          // Already closed by a cancel.
        }
      }
      // Output tokens arrive as a count only at the end; until then the text
      // streamed so far gives an estimate (about 4 characters a token).
      const progress = () =>
        send({ type: 'progress', elapsedMs: Date.now() - started, outputTokens: Math.max(reportedTokens, Math.round(streamedChars / 4)) })

      deadlineTimer = setTimeout(() => deadline.abort(), options.deadlineMs ?? IMPORT_DEADLINE_MS)
      progress()
      timer = setInterval(progress, options.progressMs ?? PROGRESS_INTERVAL_MS)

      try {
        const client = new Anthropic({ maxRetries: 1 })
        const stream = client.messages.stream(
          {
            model: floorplanModel(),
            max_tokens: MAX_TOKENS,
            output_config: { effort: 'high', format: { type: 'json_schema', schema: floorplanJsonSchema() } },
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: { type: 'base64', media_type: input.image.contentType, data: toBase64(input.image.bytes) },
                    transformations: { oversized_image: 'error' },
                  },
                  { type: 'text', text: buildFloorplanPrompt(input.prompt) },
                ],
              },
            ],
          },
          { signal },
        )
        for await (const event of stream) {
          if (event.type === 'message_start') reportedTokens = event.message.usage.output_tokens
          else if (event.type === 'message_delta') reportedTokens = event.usage.output_tokens
          else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') streamedChars += event.delta.text.length
            else if (event.delta.type === 'thinking_delta') streamedChars += event.delta.thinking.length
          }
        }
        const message = await stream.finalMessage()
        reportedTokens = message.usage.output_tokens
        const final = readFinalMessage(message)
        if (final.type === 'error') {
          console.error('Floor plan import: reply not used', { code: final.code, stopReason: message.stop_reason, model: message.model, messageId: message.id, outputTokens: message.usage.output_tokens })
        }
        send(final)
      } catch (err) {
        if (!options.requestSignal?.aborted) {
          console.error('Floor plan import failed', { model: floorplanModel(), deadline: deadline.signal.aborted, ...errorLogFields(err) })
          send(describeError(err, deadline.signal.aborted))
        }
      } finally {
        finish()
      }
    },
    cancel() {
      // The browser went away: stop the call and the timers.
      closed = true
      clearInterval(timer)
      clearTimeout(deadlineTimer)
      deadline.abort()
    },
  })
}
