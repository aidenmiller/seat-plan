import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { EMAIL_MAX, PASSWORD_MAX, PASSWORD_MIN, cleanDisplayName, isPlausibleEmail, normalizeEmail } from '@/domain/accounts'
import { json, notFound, readBody } from '@/server/api-route'
import { publicRoute } from '@/server/auth/guards'
import { hashUserPassword } from '@/server/auth/passwords'
import { clearLegacySiteCookie, setSessionCookie } from '@/server/auth/session'
import { checkBootstrapEmail, completeSetup, setupOpen, setupPasswordMatches } from '@/server/auth/setup'
import { addressKey, attemptSucceeded, beginAttempt, clientAddress, wrongGuessDelay } from '@/server/auth/throttle'
import { getDb } from '@/server/db/client'
import { createSession } from '@/server/repo/sessions'

const setupBody = z.object({
  sitePassword: z.string().max(1000),
  email: z
    .string()
    .max(EMAIL_MAX + 50)
    .transform(normalizeEmail)
    .refine(isPlausibleEmail, 'Enter an email address'),
  displayName: z
    .string()
    .max(500)
    .transform((name, ctx) => {
      const cleaned = cleanDisplayName(name)
      if (cleaned === null) {
        ctx.addIssue({ code: 'custom', message: 'Names are 1 to 60 characters' })
        return z.NEVER
      }
      return cleaned
    }),
  password: z
    .string()
    .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
    .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters`),
})

const SETUP_SCOPE = 'setup'

/**
 * First-run setup (src/server/auth/setup.ts): 404 unless SITE_PASSWORD is set
 * and no account exists yet. The site password is counted (PLAN change 23)
 * and compared in constant time; on Vercel (production and previews) the
 * email must also be BOOTSTRAP_ADMIN_EMAIL. The new admin is signed in on success.
 */
export const POST = publicRoute('First-run setup: makes the first account while none exists', async (req: NextRequest) => {
  const db = getDb()
  if (!(await setupOpen(db))) return notFound()
  const body = await readBody(req, setupBody)
  if (!body.ok) return body.response
  const { sitePassword, email, displayName, password } = body.data

  const ipKey = addressKey(clientAddress(req.headers))
  const verdict = await beginAttempt(db, SETUP_SCOPE, ipKey)
  if (!verdict.allowed) {
    const res = json({ error: 'too_many_attempts', retryAfterSeconds: verdict.retryAfterSeconds }, 429)
    res.headers.set('Retry-After', String(verdict.retryAfterSeconds))
    return res
  }
  if (!setupPasswordMatches(sitePassword)) {
    await wrongGuessDelay()
    return json({ error: 'wrong_password' }, 401)
  }

  // Checked only after the site password, so it cannot be used to guess the address.
  const bootstrap = checkBootstrapEmail(email)
  if (bootstrap === 'not-configured') {
    return json(
      {
        error: 'bootstrap_email_missing',
        message: 'Set BOOTSTRAP_ADMIN_EMAIL in the Vercel project’s settings to the first admin’s email, redeploy, then try again.',
      },
      403,
    )
  }
  if (bootstrap === 'mismatch') {
    return json(
      { error: 'bootstrap_email_mismatch', message: 'On Vercel the first account must use the email set in BOOTSTRAP_ADMIN_EMAIL.' },
      403,
    )
  }

  // Hashed before the transaction, so the setup lock is held only briefly.
  const passwordHash = await hashUserPassword(password)
  const result = await completeSetup(db, { email, displayName, passwordHash })
  if (result.status !== 'created') return notFound()

  await attemptSucceeded(db, SETUP_SCOPE, ipKey)
  const session = await createSession(db, result.user.id, { userAgent: req.headers.get('user-agent') })
  const res = json({ ok: true, redirect: '/' })
  setSessionCookie(res, req, session.cookieValue, session.expiresAt)
  clearLegacySiteCookie(res, req)
  return res
})
