import type { NextRequest } from 'next/server'
import {
  deleteBody,
  saveLayoutBody,
  updateLayoutBody,
  type SaveLayoutConflict,
  type SaveLayoutFailure,
  type SaveLayoutOk,
} from '@/shared/api'
import { idParam, json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { toDroppedSeats } from '@/server/canvas-write'
import { getDb } from '@/server/db/client'
import { getLayoutDetail, saveLayout, softDeleteLayout, updateLayout } from '@/server/repo/layouts'

/** LayoutDetail: the layout, its canvas and its template. */
export const GET = withSiteAuth(async (_req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const layout = await getLayoutDetail(getDb(), id)
  return layout ? json(layout) : notFound()
})

/**
 * Saves the canvas (PLAN section 5, "Saving layouts").
 * 200 SaveLayoutOk, 409 SaveLayoutConflict, 410 { error: 'gone' }, 422 { error: 'invalid', issues }.
 * Text Postgres refuses is a 422 too, never a 500 the browser would retry forever.
 */
export const PUT = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, saveLayoutBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => saveLayout(getDb(), id, body.data))
  if (!write.ok) return write.response
  const result = write.value
  switch (result.status) {
    case 'saved':
    case 'already-saved': {
      const reply: SaveLayoutOk = {
        status: result.status,
        version: result.version,
        updatedAt: result.updatedAt.toISOString(),
        editedBy: result.editedBy,
        droppedSeats: toDroppedSeats(result.dropped),
      }
      return json(reply)
    }
    case 'conflict': {
      const reply: SaveLayoutConflict = {
        error: 'conflict',
        version: result.version,
        updatedAt: result.updatedAt.toISOString(),
        editedBy: result.editedBy,
        lastSaveId: result.lastSaveId,
        recentSaveIds: result.recentSaveIds,
      }
      return json(reply, 409)
    }
    case 'gone': {
      const reply: SaveLayoutFailure = { error: 'gone' }
      return json(reply, 410)
    }
    case 'invalid': {
      const reply: SaveLayoutFailure = { error: 'invalid', issues: result.issues }
      return json(reply, 422)
    }
  }
})

/** Rename, or change the template. Leaves the version alone. Replies with the LayoutDetail. */
export const PATCH = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, updateLayoutBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => updateLayout(getDb(), id, body.data))
  if (!write.ok) return write.response
  const result = write.value
  switch (result.status) {
    case 'updated':
      return json(result.layout)
    case 'bad-template':
      return json({ error: 'invalid', issues: ['venueTemplateId: That venue no longer exists'] }, 422)
    case 'not-found':
      return notFound()
  }
})

/** Needs { confirm: "delete" }. Other layouts stay exactly as they are. */
export const DELETE = withSiteAuth(async (req: NextRequest, ctx: IdContext) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, deleteBody)
  if (!body.ok) return body.response
  return (await softDeleteLayout(getDb(), id)) ? json({ ok: true }) : notFound()
})
