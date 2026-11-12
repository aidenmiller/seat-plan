/**
 * A cookie the way the shared-password days signed it (sp_site): a 'site'
 * payload signed with a key from AUTH_SECRET and SITE_PASSWORD. The app no
 * longer makes or accepts one, so this builds it by hand, for the tests that
 * show such a cookie opens nothing. Nothing in the app imports this file.
 */
import { createHash, createHmac, hkdfSync } from 'node:crypto'

export function legacySiteCookieValue(
  authSecret = process.env.AUTH_SECRET ?? '',
  sitePassword = process.env.SITE_PASSWORD ?? 'old site password',
  expMs = Date.now() + 30 * 24 * 3600 * 1000,
): string {
  const salt = createHash('sha256').update(sitePassword, 'utf8').digest()
  const key = Buffer.from(hkdfSync('sha256', authSecret, salt, 'seat-plan site cookie v1', 32))
  const body = Buffer.from(JSON.stringify({ typ: 'site', exp: expMs }), 'utf8').toString('base64url')
  return `${body}.${createHmac('sha256', key).update(body, 'utf8').digest('base64url')}`
}
