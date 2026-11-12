import { json } from '@/server/api-route'
import { withUser } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { listUserSessions } from '@/server/repo/sessions'
import type { AccountSession } from '@/shared/accounts-api'

/** AccountSession[]: the signed-in user's own live sessions, most recently used first, marking this one. */
export const GET = withUser(async (_req, _ctx, user) => {
  const sessions = await listUserSessions(getDb(), user.id)
  const reply: AccountSession[] = sessions.map((s) => ({
    id: s.id,
    userAgent: s.userAgent,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    current: s.id === user.sessionId,
  }))
  return json(reply)
})
