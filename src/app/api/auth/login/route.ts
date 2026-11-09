import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/server/db/client'
import { safeNextPath } from '@/server/auth/paths'
import { authCookieOptions } from '@/server/auth/require'
import { addressKey, attemptSucceeded, beginAttempt, clientAddress, wrongGuessDelay } from '@/server/auth/throttle'
import { COOKIE_MAX_AGE_SECONDS, SITE_COOKIE, createSiteToken, sitePasswordMatches } from '@/server/auth/tokens'

const bodySchema = z.object({
  password: z.string().max(1000),
  next: z.string().max(2000).optional(),
})

const noStore = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest) {
  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json())
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400, headers: noStore })
  }

  const db = getDb()
  const ipKey = addressKey(clientAddress(req.headers))
  const verdict = await beginAttempt(db, 'site', ipKey)
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: 'too_many_attempts', retryAfterSeconds: verdict.retryAfterSeconds },
      { status: 429, headers: { ...noStore, 'Retry-After': String(verdict.retryAfterSeconds) } },
    )
  }

  if (!sitePasswordMatches(body.password)) {
    await wrongGuessDelay()
    return NextResponse.json({ error: 'wrong_password' }, { status: 401, headers: noStore })
  }

  await attemptSucceeded(db, 'site', ipKey)
  const res = NextResponse.json({ ok: true, redirect: safeNextPath(body.next) }, { headers: noStore })
  res.cookies.set(SITE_COOKIE, createSiteToken(), authCookieOptions(req, COOKIE_MAX_AGE_SECONDS))
  return res
}
