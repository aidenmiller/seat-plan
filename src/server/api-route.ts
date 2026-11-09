import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import type { z } from 'zod'
import { uuid } from '@/shared/api'
import { zodIssues } from './canvas-write'

/**
 * Small helpers shared by the JSON route handlers. Every reply carries
 * Cache-Control: no-store, and every error reply has an `error` field
 * (ApiError in src/shared/api.ts).
 */

const NO_STORE = { 'Cache-Control': 'no-store' }

/** The context Next.js passes to a handler under a [id] folder. */
export type IdContext = { params: Promise<{ id: string }> }

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE })
}

export function notFound(): NextResponse {
  return json({ error: 'not_found' }, 404)
}

/** The [id] param when it is a uuid; anything else is answered with 404 by the caller. */
export async function idParam(ctx: IdContext): Promise<string | null> {
  const { id } = await ctx.params
  return uuid.safeParse(id).success ? id.toLowerCase() : null
}

export type BodyResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse }

/** Reads and checks a JSON body: 400 when it is not JSON, 422 with the issues when it does not fit. */
export async function readBody<S extends z.ZodType>(req: NextRequest, schema: S): Promise<BodyResult<z.output<S>>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return { ok: false, response: json({ error: 'bad_json' }, 400) }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, response: json({ error: 'invalid', issues: zodIssues(parsed.error) }, 422) }
  }
  return { ok: true, data: parsed.data }
}

/**
 * Postgres error codes for text it will not store: 22P05 (an escape jsonb
 * refuses, such as \u0000), 22021 (a NUL byte in a text column) and 22P02
 * (input it cannot read, such as a lone surrogate inside JSON).
 */
const UNSTORABLE_TEXT_CODES = new Set(['22P05', '22021', '22P02'])

/** True when Postgres refused the text in a write. Looks through drizzle's wrapper to the pg error. */
export function isUnstorableTextError(err: unknown): boolean {
  let current: unknown = err
  for (let depth = 0; depth < 5 && current !== null && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && UNSTORABLE_TEXT_CODES.has(code)) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export const UNSTORABLE_TEXT_ISSUE = 'Some text holds characters that cannot be saved'

/**
 * Runs a write. The schemas already clean text (cleanText in canvas-schema.ts);
 * if Postgres still refuses some, the reply is 422 { error: 'invalid', issues }
 * rather than 500, so the browser stops retrying a save that can never land.
 */
export async function refuseUnstorableText<T>(
  write: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, value: await write() }
  } catch (err) {
    if (!isUnstorableTextError(err)) throw err
    return { ok: false, response: json({ error: 'invalid', issues: [UNSTORABLE_TEXT_ISSUE] }, 422) }
  }
}
