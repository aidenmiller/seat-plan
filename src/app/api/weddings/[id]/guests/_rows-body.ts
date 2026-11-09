import 'server-only'
import type { NextRequest } from 'next/server'
import type { z } from 'zod'
import { MAX_GUEST_ROWS } from '@/shared/api'
import { json, type BodyResult } from '@/server/api-route'
import { zodIssues } from '@/server/canvas-write'

/**
 * Like readBody (400 bad JSON, 422 with issues), but a body whose `key`
 * array holds more than MAX_GUEST_ROWS entries gets 413 before any checking.
 */
export async function readRowsBody<S extends z.ZodType>(
  req: NextRequest,
  schema: S,
  key: string,
): Promise<BodyResult<z.output<S>>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return { ok: false, response: json({ error: 'bad_json' }, 400) }
  }
  const list = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : undefined
  if (Array.isArray(list) && list.length > MAX_GUEST_ROWS) {
    return {
      ok: false,
      response: json(
        { error: 'too_large', message: `Send at most ${MAX_GUEST_ROWS.toLocaleString('en-US')} rows at a time.` },
        413,
      ),
    }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, response: json({ error: 'invalid', issues: zodIssues(parsed.error) }, 422) }
  }
  return { ok: true, data: parsed.data }
}
