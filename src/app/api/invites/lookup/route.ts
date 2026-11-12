import type { NextRequest } from 'next/server'
import { json, notFound, readBody } from '@/server/api-route'
import { INVITE_SCOPE, requestAddressKey, tooManyAttempts } from '@/server/accounts-route'
import { publicRoute } from '@/server/auth/guards'
import { beginAttempt, wrongGuessDelay } from '@/server/auth/throttle'
import { getDb } from '@/server/db/client'
import { lookupInvite } from '@/server/repo/invites'
import { inviteTokenBody, type InviteLookup } from '@/shared/accounts-api'

/**
 * What the invite page shows for a link: who sent it, for which wedding and
 * role, and whether it still works. The token comes in the body (the page
 * reads it from the address's #fragment, which never reaches the server).
 *
 * Every lookup is counted for the address before the token is looked at
 * (INVITE_SCOPE), and an unknown token is answered after about a second, so
 * guessing is slow. A link that cannot be used any more says only why: no
 * names, no wedding, no email. 404 for a token that matches no invite.
 */
export const POST = publicRoute('Opening an invite link: the person may not have an account yet', async (req: NextRequest) => {
  const body = await readBody(req, inviteTokenBody)
  if (!body.ok) return body.response
  const db = getDb()
  const verdict = await beginAttempt(db, INVITE_SCOPE, requestAddressKey(req), { scopeWide: false })
  if (!verdict.allowed) return tooManyAttempts(verdict.retryAfterSeconds)

  const info = await lookupInvite(db, body.data.token)
  if (!info) {
    await wrongGuessDelay()
    return notFound()
  }
  const reply: InviteLookup =
    info.status === 'ok'
      ? {
          status: 'ok',
          kind: info.weddingId === null ? 'planner' : 'wedding',
          weddingName: info.weddingName,
          role: info.role,
          inviterName: info.inviterName,
          email: info.email,
          expiresAt: info.expiresAt,
        }
      : { status: info.status }
  return json(reply)
})
