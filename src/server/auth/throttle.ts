/**
 * Slow-down after wrong guesses (PLAN change 23). Server functions do not share
 * memory, so the counts live in Postgres.
 *
 * Each attempt is counted before the password is compared, in one statement,
 * so a burst of parallel guesses cannot all slip in before the first failure
 * is written. A right password then clears the count for that address.
 */
import { createHmac } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

export const PER_ADDRESS_LIMIT = 10
export const PER_ADDRESS_WINDOW_MINUTES = 15
export const SCOPE_LIMIT = 50
export const SCOPE_WINDOW_MINUTES = 60
export const BLOCK_MINUTES = 15
const ALL_ADDRESSES = '*'

// Any drizzle Postgres database or transaction will do.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = NodePgDatabase<any>

/** The client address as Vercel reports it, or the first forwarded address. */
export function clientAddress(headers: Headers): string {
  const real = headers.get('x-real-ip')?.trim()
  if (real) return real
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || 'unknown'
}

/**
 * IPv6 addresses count by their first 64 bits, since one home controls all of
 * those. The result is hashed so raw addresses never reach the database.
 */
export function addressKey(address: string, secret: string = process.env.AUTH_SECRET ?? ''): string {
  let normalized = address.toLowerCase()
  if (normalized.includes(':') && !normalized.includes('.')) {
    normalized = ipv6Prefix64(normalized)
  }
  return createHmac('sha256', secret).update(normalized).digest('hex').slice(0, 32)
}

function ipv6Prefix64(address: string): string {
  const [head = '', tail = ''] = address.split('::')
  const headParts = head ? head.split(':') : []
  const tailParts = tail ? tail.split(':') : []
  const missing = address.includes('::') ? 8 - headParts.length - tailParts.length : 0
  const full = [...headParts, ...Array<string>(Math.max(missing, 0)).fill('0'), ...tailParts]
  return full
    .slice(0, 4)
    .map((part) => part.replace(/^0+(?=.)/, ''))
    .join(':')
}

export type AttemptVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number }

async function countAttempt(db: AnyDb, scope: string, ipKey: string, windowMinutes: number, limit: number) {
  const result = await db.execute<{ failures: number; blocked_until: Date | null; now: Date }>(sql`
    insert into login_attempts (scope, ip_key, failures, window_start, blocked_until, updated_at)
    values (${scope}, ${ipKey}, 1, now(), null, now())
    on conflict (scope, ip_key) do update set
      -- A window that has run out, or a block that has ended, starts a fresh count.
      failures = case
        when login_attempts.window_start < now() - make_interval(mins => ${windowMinutes})
          or login_attempts.blocked_until <= now() then 1
        else login_attempts.failures + 1 end,
      window_start = case
        when login_attempts.window_start < now() - make_interval(mins => ${windowMinutes})
          or login_attempts.blocked_until <= now() then now()
        else login_attempts.window_start end,
      blocked_until = case
        when login_attempts.blocked_until <= now() then null
        else login_attempts.blocked_until end,
      updated_at = now()
    returning failures, blocked_until, now() as now
  `)
  const row = result.rows[0]
  if (!row) return { blocked: false, retryAfterSeconds: 0 }
  const now = new Date(row.now).getTime()
  const blockedUntil = row.blocked_until ? new Date(row.blocked_until).getTime() : 0
  if (blockedUntil > now) {
    return { blocked: true, retryAfterSeconds: Math.ceil((blockedUntil - now) / 1000) }
  }
  if (row.failures > limit) {
    await db.execute(sql`
      update login_attempts
      set blocked_until = now() + make_interval(mins => ${BLOCK_MINUTES}), failures = 0, window_start = now()
      where scope = ${scope} and ip_key = ${ipKey}
    `)
    return { blocked: true, retryAfterSeconds: BLOCK_MINUTES * 60 }
  }
  return { blocked: false, retryAfterSeconds: 0 }
}

/**
 * Counts this attempt and says whether it may go ahead. Call before comparing.
 *
 * `scopeWide: false` skips the all-addresses count. Account sign-in uses it:
 * there, a count across every address would let anyone lock every user (or,
 * per account, any one user) out just by guessing.
 */
export async function beginAttempt(
  db: AnyDb,
  scope: string,
  ipKey: string,
  { scopeWide = true }: { scopeWide?: boolean } = {},
): Promise<AttemptVerdict> {
  const perAddress = await countAttempt(db, scope, ipKey, PER_ADDRESS_WINDOW_MINUTES, PER_ADDRESS_LIMIT)
  if (perAddress.blocked) return { allowed: false, retryAfterSeconds: perAddress.retryAfterSeconds }
  if (!scopeWide) return { allowed: true }
  const perScope = await countAttempt(db, scope, ALL_ADDRESSES, SCOPE_WINDOW_MINUTES, SCOPE_LIMIT)
  if (perScope.blocked) return { allowed: false, retryAfterSeconds: perScope.retryAfterSeconds }
  return { allowed: true }
}

/** After a right password: clear this address and take the attempt back off the scope count. */
export async function attemptSucceeded(db: AnyDb, scope: string, ipKey: string): Promise<void> {
  await db.execute(sql`delete from login_attempts where scope = ${scope} and ip_key = ${ipKey}`)
  await db.execute(sql`
    update login_attempts set failures = greatest(failures - 1, 0), updated_at = now()
    where scope = ${scope} and ip_key = ${ALL_ADDRESSES}
  `)
}

/** About a second, plus a little noise, before answering a wrong guess. */
export function wrongGuessDelay(): Promise<void> {
  const ms = 900 + Math.floor(Math.random() * 300)
  return new Promise((resolve) => setTimeout(resolve, ms))
}
