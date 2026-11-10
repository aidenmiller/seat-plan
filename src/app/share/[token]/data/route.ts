import { shareJson, withShareAuth } from '@/server/auth/share'
import { getDb } from '@/server/db/client'
import { shareViewData, touchShareLink } from '@/server/repo/share-links'

/**
 * ShareView: the link's one layout, built on the server from the link's
 * switches (PLAN change 24), so hidden parts never reach the viewer. Needs the
 * site cookie or this link's cookie. Opening it with the link's cookie updates
 * the link's last opened time.
 */
export const GET = withShareAuth(async (_req, access) => {
  const db = getDb()
  const view = await shareViewData(db, access.link)
  if (!view) return shareJson({ error: 'not_found' }, 404)
  if (access.via === 'link') await touchShareLink(db, access.link.id)
  return shareJson(view)
})
