import type { NextRequest } from 'next/server'
import { duplicateLayoutBody } from '@/shared/api'
import { idParam, json, notFound, readBody, refuseUnstorableText, type IdContext } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byLayoutId } from '@/server/auth/resolvers'
import { getDb } from '@/server/db/client'
import { editorOf } from '@/server/editor-name'
import { duplicateLayout } from '@/server/repo/layouts'

/**
 * 201 LayoutDetail. Copies the layout, seats included, or, for "keep mine as a
 * new copy", stores the canvas in the body instead. With a canvas, the source
 * layout may be deleted ("Save as a copy" after a 410); its wedding must be
 * live. The copy stays in the source's wedding, edited by the signed-in user. Any member.
 */
export const POST = withWeddingRole(byLayoutId, 'editor', async (req: NextRequest, ctx: IdContext, access) => {
  const id = await idParam(ctx)
  if (!id) return notFound()
  const body = await readBody(req, duplicateLayoutBody)
  if (!body.ok) return body.response
  const write = await refuseUnstorableText(() => duplicateLayout(getDb(), access.weddingId, id, body.data, editorOf(access.user)))
  if (!write.ok) return write.response
  const result = write.value
  switch (result.status) {
    case 'created':
      return json(result.layout, 201)
    case 'invalid':
      return json({ error: 'invalid', issues: result.issues }, 422)
    case 'bad-template':
      return json({ error: 'invalid', issues: ['venueTemplateId: That venue no longer exists'] }, 422)
    case 'id-taken':
      return json({ error: 'id_taken' }, 409)
    case 'not-found':
      return notFound()
  }
})
