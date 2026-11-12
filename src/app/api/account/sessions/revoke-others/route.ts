import { json } from '@/server/api-route'
import { withUser } from '@/server/auth/guards'
import { getDb } from '@/server/db/client'
import { endUserSessions } from '@/server/repo/sessions'

/** Signs the user out everywhere but this browser. 200 { ended }: how many sessions ended. */
export const POST = withUser(async (_req, _ctx, user) => {
  const ended = await endUserSessions(getDb(), user.id, { except: user.sessionId })
  return json({ ended })
})
