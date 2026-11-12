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
import { withWeddingRole } from '@/server/auth/guards'
import { byLayoutId } from '@/server/auth/resolvers'
import { toDroppedSeats } from '@/server/canvas-write'
import { getDb } from '@/server/db/client'
import { getLayoutDetail, saveLayout, softDeleteLayout, updateLayout } from '@/server/repo/layouts'

/*
 * Every handler here is for any member of the layout's wedding. The guard
 * finds the wedding from the layout (deleted layouts too, so a save to one
 * answers 410); each call below is held to that wedding.
 */

/** LayoutDetail: the layout, its canvas and its template. */
export const GET = withWeddingRole(byLayoutId, 'editor', async (_req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const layout = await getLayoutDetail(getDb(), access.weddingId, id)
  return layout ? json(layout) : notFound()
})

/**
 * Saves the canvas (PLAN section 5, "Saving layouts").
 * 200 SaveLayoutOk, 409 SaveLayoutConflict, 410 { error: 'gone' }, 422 { error: 'invalid', issues }.
 * Text Postgres refuses is a 422 too, never a 500 the browser would retry forever.
 */
export const PUT = withWeddingRole(byLayoutId, 'editor', async (req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, saveLayoutBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => saveLayout(getDb(), access.weddingId, id, body.data))
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
        editedById: result.editedById,
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
        editedById: result.editedById,
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

/**
 * Rename, or change the template. Leaves the version alone. Replies with the
 * LayoutDetail. The venue must be one the caller may use in this wedding (the
 * library, their own, or one the wedding already uses); any other is the
 * same 422 as a deleted one.
 */
export const PATCH = withWeddingRole(byLayoutId, 'editor', async (req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, updateLayoutBody)
  if (!body.ok) return body.response
  const viewer = { userId: access.user.id, isAdmin: access.user.isAdmin }
  const write = await refuseUnstorableText(() => updateLayout(getDb(), access.weddingId, id, body.data, viewer))
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
export const DELETE = withWeddingRole(byLayoutId, 'editor', async (req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, deleteBody)
  if (!body.ok) return body.response
  return (await softDeleteLayout(getDb(), access.weddingId, id)) ? json({ ok: true }) : notFound()
})
