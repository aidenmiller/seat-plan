import type { NextRequest } from 'next/server'
import { coupleRuleBody, type CoupleRuleReply, type GuestConflict } from '@/shared/api'
import { json, notFound, readBody } from '@/server/api-route'
import { withSiteAuth } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { setCoupleRule } from '@/server/repo/rules'

/**
 * CoupleRuleReply: switches a couple rule on or off on both partners (PLAN
 * change 8). 409 GuestConflict when the two are no longer partners.
 */
export const PATCH = withSiteAuth(async (req: NextRequest) => {
  const body = await readBody(req, coupleRuleBody)
  if (!body.ok) return body.response
  const result = await setCoupleRule(getDb(), body.data.guestIds, body.data.enabled)
  switch (result.status) {
    case 'updated': {
      const reply: CoupleRuleReply = { guests: result.guests }
      return json(reply)
    }
    case 'conflict': {
      const reply: GuestConflict = { error: 'conflict', message: result.message, guests: result.guests }
      return json(reply, 409)
    }
    case 'not-found':
      return notFound()
  }
})
