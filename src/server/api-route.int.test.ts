/**
 * The backstop for text Postgres refuses (api-route.ts): real errors from the
 * test database, found through drizzle's wrapper, become 422 replies.
 */
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { makeTestDb } from '../../test/db'
import { UNSTORABLE_TEXT_ISSUE, isUnstorableTextError, refuseUnstorableText } from './api-route'

const { pool, db } = makeTestDb()
afterAll(async () => {
  await pool.end()
})

async function errorOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (err) {
    return err
  }
  throw new Error('expected the query to fail')
}

describe('refuseUnstorableText', () => {
  it('recognises NUL in jsonb (22P05), NUL in text (22021) and a lone surrogate in json (22P02)', async () => {
    const errors = [
      await errorOf(() => db.execute(sql`select ${JSON.stringify({ t: 'a\u0000b' })}::jsonb`)),
      await errorOf(() => db.execute(sql`select ${'a\u0000b'}::text`)),
      await errorOf(() => db.execute(sql`select ${JSON.stringify({ t: 'cake \ud83c' })}::jsonb`)),
    ]
    expect(errors.map((e) => (e as { cause?: { code?: string } }).cause?.code)).toEqual(['22P05', '22021', '22P02'])
    for (const err of errors) expect(isUnstorableTextError(err)).toBe(true)
  })

  it('answers 422 with an issue for such an error, inside a transaction too', async () => {
    const result = await refuseUnstorableText(() =>
      db.transaction((tx) => tx.execute(sql`select ${JSON.stringify({ t: '\u0000' })}::jsonb`)),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(422)
    expect(result.response.headers.get('cache-control')).toBe('no-store')
    expect(await result.response.json()).toEqual({ error: 'invalid', issues: [UNSTORABLE_TEXT_ISSUE] })
  })

  it('passes results through and rethrows every other error', async () => {
    expect(await refuseUnstorableText(async () => 7)).toEqual({ ok: true, value: 7 })
    const divide = () => db.execute(sql`select 1 / 0`)
    const err = await errorOf(divide)
    expect(isUnstorableTextError(err)).toBe(false)
    const rethrown = await errorOf(() => refuseUnstorableText(divide))
    expect((rethrown as { cause?: { code?: string } }).cause?.code).toBe('22012')
    expect(isUnstorableTextError(null)).toBe(false)
    expect(isUnstorableTextError({ code: 22021 })).toBe(false)
  })
})
