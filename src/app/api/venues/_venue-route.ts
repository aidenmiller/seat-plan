import 'server-only'
import type { NextRequest, NextResponse } from 'next/server'
import { uuid, type SaveVenueConflict, type SaveVenueFailure, type SaveVenueOk } from '@/shared/api'
import { json, notFound } from '@/server/api-route'
import type { TemplateSaveResult } from '@/server/repo/venues'

/**
 * Helpers shared by the venue route handlers (not a route: Next.js only
 * serves files named route.ts).
 */

/** A route param when it is a uuid, lower-cased; null otherwise (the caller answers 404). */
export function uuidParam(value: string | undefined): string | null {
  return value !== undefined && uuid.safeParse(value).success ? value.toLowerCase() : null
}

/** The reply to a template save, accepted import or restore. */
export function saveReply(result: TemplateSaveResult): NextResponse {
  switch (result.status) {
    case 'saved':
    case 'already-saved': {
      const reply: SaveVenueOk = {
        status: result.status,
        version: result.version,
        updatedAt: result.updatedAt.toISOString(),
        editedBy: result.editedBy,
      }
      return json(reply)
    }
    case 'conflict': {
      const who = result.editedBy ?? 'Someone'
      const reply: SaveVenueConflict = {
        error: 'conflict',
        message: `${who} saved this venue after you opened it. Load their version to go on.`,
        version: result.version,
        updatedAt: result.updatedAt.toISOString(),
        editedBy: result.editedBy,
        lastSaveId: result.lastSaveId,
      }
      return json(reply, 409)
    }
    case 'gone': {
      const reply: SaveVenueFailure = { error: 'gone' }
      return json(reply, 410)
    }
  }
}

/** 422 with one issue, in the "field: message" form of every 422 reply. */
export function invalid(issue: string): NextResponse {
  return json({ error: 'invalid', issues: [issue] }, 422)
}

export type CappedBody = { ok: true; bytes: Uint8Array } | { ok: false; reason: 'too-large' | 'empty' }

/**
 * Reads a raw request body, giving up as soon as it passes `max` bytes, so an
 * oversized upload is never held in memory whole.
 */
export async function readCappedBody(req: NextRequest, max: number): Promise<CappedBody> {
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > max) return { ok: false, reason: 'too-large' }
  if (!req.body) return { ok: false, reason: 'empty' }
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      return { ok: false, reason: 'too-large' }
    }
    chunks.push(value)
  }
  if (total === 0) return { ok: false, reason: 'empty' }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, bytes }
}

export { notFound }
