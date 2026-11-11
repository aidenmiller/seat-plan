/**
 * The accounts tables: what the database itself refuses (checks, unique keys,
 * the last-owner trigger) and what happens to related rows when one is deleted.
 */
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, truncateAll } from '../../../test/db'

const { pool } = makeTestDb()

const HASH = 'a'.repeat(64)

beforeEach(async () => {
  await truncateAll(pool)
})
afterAll(async () => {
  await pool.end()
})

async function addUser(email = `${randomUUID()}@example.com`): Promise<string> {
  const res = await pool.query(`insert into users (email, display_name, password_hash) values ($1, 'Pat', 'x') returning id`, [email])
  return res.rows[0].id
}

async function addWedding(): Promise<string> {
  const res = await pool.query(`insert into weddings (name) values ('W') returning id`)
  return res.rows[0].id
}

async function addMember(weddingId: string, userId: string, role: 'owner' | 'editor'): Promise<void> {
  await pool.query(`insert into wedding_members (wedding_id, user_id, role) values ($1, $2, $3)`, [weddingId, userId, role])
}

/** Runs the statements in one transaction and commits. */
async function inTransaction(work: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    try {
      await work(client)
      await client.query('commit')
    } catch (err) {
      await client.query('rollback')
      throw err
    }
  } finally {
    client.release()
  }
}

/** Expects the promise to fail with this Postgres error code (23514 check, 23505 unique, 23503 foreign key). */
async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code })
}

describe('users', () => {
  it('refuses an email that is not lower case and trimmed', async () => {
    await expectCode(pool.query(`insert into users (email, display_name, password_hash) values ('Pat@Example.com', 'Pat', 'x')`), '23514')
    await expectCode(pool.query(`insert into users (email, display_name, password_hash) values (' pat@example.com', 'Pat', 'x')`), '23514')
  })

  it('refuses a second user with the same email', async () => {
    await addUser('pat@example.com')
    await expectCode(addUser('pat@example.com'), '23505')
  })

  it('refuses a blank or over-long display name', async () => {
    await expectCode(pool.query(`insert into users (email, display_name, password_hash) values ('a@example.com', '   ', 'x')`), '23514')
    await expectCode(pool.query(`insert into users (email, display_name, password_hash) values ('b@example.com', $1, 'x')`, ['n'.repeat(61)]), '23514')
    await pool.query(`insert into users (email, display_name, password_hash) values ('c@example.com', $1, 'x')`, ['n'.repeat(60)])
  })
})

describe('sessions, invites and password resets', () => {
  it('refuses a token hash that is not 64 characters, and a repeated one', async () => {
    const userId = await addUser()
    const insert = (hash: string) =>
      pool.query(`insert into sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')`, [userId, hash])
    await expectCode(insert('short'), '23514')
    await insert(HASH)
    await expectCode(insert(HASH), '23505')

    await expectCode(
      pool.query(`insert into password_resets (token_hash, user_id, expires_at) values ('short', $1, now())`, [userId]),
      '23514',
    )
    await expectCode(
      pool.query(`insert into invites (token_hash, invited_by_user_id, expires_at) values ('short', $1, now())`, [userId]),
      '23514',
    )
  })

  it('refuses a session user agent over 200 characters', async () => {
    const userId = await addUser()
    await expectCode(
      pool.query(`insert into sessions (user_id, token_hash, user_agent, expires_at) values ($1, $2, $3, now())`, [userId, HASH, 'u'.repeat(201)]),
      '23514',
    )
  })

  it('keeps wedding and role together on an invite', async () => {
    const userId = await addUser()
    const weddingId = await addWedding()
    const insert = (hash: string, wedding: string | null, role: string | null) =>
      pool.query(
        `insert into invites (token_hash, wedding_id, role, invited_by_user_id, expires_at) values ($1, $2, $3, $4, now() + interval '1 day')`,
        [hash, wedding, role, userId],
      )
    await insert('1'.repeat(64), weddingId, 'editor')
    await insert('2'.repeat(64), null, null) // an admin's "new planner" invite
    await expectCode(insert('3'.repeat(64), weddingId, null), '23514')
    await expectCode(insert('4'.repeat(64), null, 'editor'), '23514')
    await expectCode(insert('5'.repeat(64), weddingId, 'admin'), '23514')
  })

  it('refuses an invite email that is not lower case', async () => {
    const userId = await addUser()
    await expectCode(
      pool.query(`insert into invites (token_hash, email, invited_by_user_id, expires_at) values ($1, 'Pat@Example.com', $2, now())`, [HASH, userId]),
      '23514',
    )
  })
})

describe('wedding_members', () => {
  it('refuses a role other than owner or editor', async () => {
    const [userId, weddingId] = [await addUser(), await addWedding()]
    await expectCode(addMember(weddingId, userId, 'viewer' as never), '23514')
  })

  it('refuses the same person twice in one wedding', async () => {
    const [userId, weddingId] = [await addUser(), await addWedding()]
    await addMember(weddingId, userId, 'owner')
    await expectCode(addMember(weddingId, userId, 'editor'), '23505')
  })
})

describe('the last owner', () => {
  it('cannot be removed', async () => {
    const [userId, weddingId] = [await addUser(), await addWedding()]
    await addMember(weddingId, userId, 'owner')
    await expectCode(pool.query(`delete from wedding_members where wedding_id = $1`, [weddingId]), '23514')
    const left = await pool.query(`select 1 from wedding_members where wedding_id = $1`, [weddingId])
    expect(left.rowCount).toBe(1)
  })

  it('cannot be demoted, even with an editor present', async () => {
    const [owner, editor, weddingId] = [await addUser(), await addUser(), await addWedding()]
    await addMember(weddingId, owner, 'owner')
    await addMember(weddingId, editor, 'editor')
    await expectCode(pool.query(`update wedding_members set role = 'editor' where wedding_id = $1 and user_id = $2`, [weddingId, owner]), '23514')
  })

  it('fails at COMMIT, not at the statement', async () => {
    const [userId, weddingId] = [await addUser(), await addWedding()]
    await addMember(weddingId, userId, 'owner')
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(`delete from wedding_members where wedding_id = $1`, [weddingId]) // does not throw yet
      await expectCode(client.query('commit'), '23514')
    } finally {
      await client.query('rollback')
      client.release()
    }
  })

  it('can be handed over inside one transaction', async () => {
    const [from, to, weddingId] = [await addUser(), await addUser(), await addWedding()]
    await addMember(weddingId, from, 'owner')
    await addMember(weddingId, to, 'editor')
    await inTransaction(async (client) => {
      await client.query(`update wedding_members set role = 'editor' where wedding_id = $1 and user_id = $2`, [weddingId, from])
      await client.query(`update wedding_members set role = 'owner' where wedding_id = $1 and user_id = $2`, [weddingId, to])
    })
    const roles = await pool.query(`select user_id, role from wedding_members where wedding_id = $1`, [weddingId])
    expect(Object.fromEntries(roles.rows.map((r) => [r.user_id, r.role]))).toEqual({ [from]: 'editor', [to]: 'owner' })
  })

  it('lets one owner leave while another remains', async () => {
    const [a, b, weddingId] = [await addUser(), await addUser(), await addWedding()]
    await addMember(weddingId, a, 'owner')
    await addMember(weddingId, b, 'owner')
    await pool.query(`delete from wedding_members where wedding_id = $1 and user_id = $2`, [weddingId, a])
    // b is now the last owner
    await expectCode(pool.query(`update wedding_members set role = 'editor' where wedding_id = $1 and user_id = $2`, [weddingId, b]), '23514')
  })

  it('lets an editor be removed or promoted freely', async () => {
    const [owner, editor, weddingId] = [await addUser(), await addUser(), await addWedding()]
    await addMember(weddingId, owner, 'owner')
    await addMember(weddingId, editor, 'editor')
    await pool.query(`delete from wedding_members where wedding_id = $1 and user_id = $2`, [weddingId, editor])
  })

  it('goes away with its wedding', async () => {
    const [owner, editor, weddingId] = [await addUser(), await addUser(), await addWedding()]
    await addMember(weddingId, owner, 'owner')
    await addMember(weddingId, editor, 'editor')
    await pool.query(`delete from weddings where id = $1`, [weddingId])
    const left = await pool.query(`select 1 from wedding_members where wedding_id = $1`, [weddingId])
    expect(left.rowCount).toBe(0)
  })

  it('does not touch a wedding that never had members', async () => {
    const weddingId = await addWedding()
    await pool.query(`update weddings set name = 'Renamed' where id = $1`, [weddingId])
    await pool.query(`delete from weddings where id = $1`, [weddingId])
  })
})

describe('deleting a user', () => {
  it('removes their sessions and password resets', async () => {
    const userId = await addUser()
    await pool.query(`insert into sessions (user_id, token_hash, expires_at) values ($1, $2, now())`, [userId, HASH])
    await pool.query(`insert into password_resets (token_hash, user_id, expires_at) values ($1, $2, now())`, ['b'.repeat(64), userId])
    await pool.query(`delete from users where id = $1`, [userId])
    expect((await pool.query(`select 1 from sessions`)).rowCount).toBe(0)
    expect((await pool.query(`select 1 from password_resets`)).rowCount).toBe(0)
  })

  it('is refused while they belong to a wedding', async () => {
    const [userId, weddingId] = [await addUser(), await addWedding()]
    await addMember(weddingId, userId, 'owner')
    await expectCode(pool.query(`delete from users where id = $1`, [userId]), '23503')
  })

  it('clears who edited a layout or template and who added a member', async () => {
    const [userId, other, weddingId] = [await addUser(), await addUser(), await addWedding()]
    const layout = await pool.query(
      `insert into layouts (wedding_id, name, kind, canvas, edited_by_user_id, edited_by_name) values ($1, 'L', 'reception', '{}'::jsonb, $2, 'Pat') returning id`,
      [weddingId, userId],
    )
    const template = await pool.query(
      `insert into venue_templates (name, edited_by_user_id, owner_user_id) values ('T', $1, $1) returning id`,
      [userId],
    )
    await pool.query(`insert into wedding_members (wedding_id, user_id, role, added_by_user_id) values ($1, $2, 'owner', $3)`, [weddingId, other, userId])
    await pool.query(`delete from users where id = $1`, [userId])

    const l = await pool.query(`select edited_by_user_id, edited_by_name from layouts where id = $1`, [layout.rows[0].id])
    expect(l.rows[0]).toEqual({ edited_by_user_id: null, edited_by_name: 'Pat' })
    const t = await pool.query(`select edited_by_user_id, owner_user_id from venue_templates where id = $1`, [template.rows[0].id])
    expect(t.rows[0]).toEqual({ edited_by_user_id: null, owner_user_id: null })
    const m = await pool.query(`select added_by_user_id from wedding_members where user_id = $1`, [other])
    expect(m.rows[0].added_by_user_id).toBeNull()
  })

  it('removes the invites they sent, and clears who accepted one', async () => {
    const [sender, accepter] = [await addUser(), await addUser()]
    await pool.query(
      `insert into invites (token_hash, invited_by_user_id, accepted_by_user_id, expires_at) values ($1, $2, $3, now())`,
      [HASH, sender, accepter],
    )
    await pool.query(`delete from users where id = $1`, [accepter])
    expect((await pool.query(`select accepted_by_user_id from invites`)).rows[0].accepted_by_user_id).toBeNull()
    await pool.query(`delete from users where id = $1`, [sender])
    expect((await pool.query(`select 1 from invites`)).rowCount).toBe(0)
  })
})

describe('activity_events', () => {
  const insert = (dedupeKey: string | null, detail = '{}') =>
    pool.query(`insert into activity_events (kind, dedupe_key, detail) values ('test', $1, $2::jsonb)`, [dedupeKey, detail])

  it('refuses a repeated dedupe key but allows any number without one', async () => {
    await insert('once')
    await expectCode(insert('once'), '23505')
    await insert(null)
    await insert(null)
    expect((await pool.query(`select 1 from activity_events`)).rowCount).toBe(3)
  })

  it('wants the detail to be an object', async () => {
    await expectCode(insert(null, '[]'), '23514')
    await expectCode(insert(null, '"text"'), '23514')
    await insert(null, '{"a":1}')
  })

  it('outlives the wedding and user it mentions', async () => {
    const [userId, weddingId] = [await addUser(), await addWedding()]
    await pool.query(`insert into activity_events (kind, user_id, wedding_id, subject_id) values ('test', $1, $2, $3)`, [userId, weddingId, randomUUID()])
    await pool.query(`delete from weddings where id = $1`, [weddingId])
    await pool.query(`delete from users where id = $1`, [userId])
    const row = (await pool.query(`select user_id, wedding_id from activity_events`)).rows[0]
    expect(row.user_id).toBeNull()
    expect(row.wedding_id).toBe(weddingId)
  })
})
