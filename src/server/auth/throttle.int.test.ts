import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'
import { PER_ADDRESS_LIMIT, SCOPE_LIMIT, attemptSucceeded, beginAttempt } from './throttle'

const { pool, db } = makeTestDb()

beforeEach(async () => {
  await truncateAll(pool)
})
afterAll(async () => {
  await pool.end()
})

describe('login throttle', () => {
  it(`allows ${PER_ADDRESS_LIMIT} attempts from one address, then blocks it`, async () => {
    for (let i = 0; i < PER_ADDRESS_LIMIT; i++) {
      expect((await beginAttempt(db, 'site', 'addr-a')).allowed).toBe(true)
    }
    const verdict = await beginAttempt(db, 'site', 'addr-a')
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.retryAfterSeconds).toBeGreaterThan(60)
    // Another address is unaffected.
    expect((await beginAttempt(db, 'site', 'addr-b')).allowed).toBe(true)
  })

  it('lets exactly the limit through when guesses arrive all at once', async () => {
    const verdicts = await Promise.all(Array.from({ length: 40 }, () => beginAttempt(db, 'site', 'addr-burst')))
    expect(verdicts.filter((v) => v.allowed)).toHaveLength(PER_ADDRESS_LIMIT)
  })

  it('clears an address after a right password', async () => {
    for (let i = 0; i < PER_ADDRESS_LIMIT - 1; i++) await beginAttempt(db, 'site', 'addr-d')
    await attemptSucceeded(db, 'site', 'addr-d')
    for (let i = 0; i < PER_ADDRESS_LIMIT; i++) {
      expect((await beginAttempt(db, 'site', 'addr-d')).allowed).toBe(true)
    }
  })

  it(`blocks new sign-ins after ${SCOPE_LIMIT} attempts from all addresses together`, async () => {
    for (let i = 0; i < SCOPE_LIMIT; i++) {
      expect((await beginAttempt(db, 'site', `spray-${i}`)).allowed).toBe(true)
    }
    expect((await beginAttempt(db, 'site', 'spray-new')).allowed).toBe(false)
    // Share links keep their own count.
    expect((await beginAttempt(db, 'share:link-1', 'spray-new')).allowed).toBe(true)
  })

  it('lifts an address block after 15 minutes, with a fresh count', async () => {
    for (let i = 0; i <= PER_ADDRESS_LIMIT; i++) await beginAttempt(db, 'site', 'addr-f')
    expect((await beginAttempt(db, 'site', 'addr-f')).allowed).toBe(false)
    await db.execute(sql`update login_attempts set blocked_until = now() - interval '1 second' where ip_key = 'addr-f'`)
    for (let i = 0; i < PER_ADDRESS_LIMIT; i++) {
      expect((await beginAttempt(db, 'site', 'addr-f')).allowed).toBe(true)
    }
  })

  it('lifts the all-addresses block after 15 minutes', async () => {
    for (let i = 0; i <= SCOPE_LIMIT; i++) await beginAttempt(db, 'site', `spray-${i}`)
    expect((await beginAttempt(db, 'site', 'late-1')).allowed).toBe(false)
    await db.execute(sql`update login_attempts set blocked_until = now() - interval '1 second' where ip_key = '*'`)
    expect((await beginAttempt(db, 'site', 'late-2')).allowed).toBe(true)
  })

  it('does not let right passwords use up the all-addresses count', async () => {
    for (let i = 0; i < SCOPE_LIMIT + 10; i++) {
      expect((await beginAttempt(db, 'site', `owner-${i}`)).allowed).toBe(true)
      await attemptSucceeded(db, 'site', `owner-${i}`)
    }
    const rows = await db.execute<{ failures: number }>(sql`select failures from login_attempts where ip_key = '*'`)
    expect(rows.rows[0]?.failures).toBe(0)
  })

  it('starts a fresh window once the old one has passed', async () => {
    for (let i = 0; i < PER_ADDRESS_LIMIT; i++) await beginAttempt(db, 'site', 'addr-e')
    await db.execute(sql`update login_attempts set window_start = now() - interval '16 minutes' where ip_key = 'addr-e'`)
    expect((await beginAttempt(db, 'site', 'addr-e')).allowed).toBe(true)
  })
})
