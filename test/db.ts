/**
 * Test database helpers. Integration tests run against TEST_DATABASE_URL, a
 * local Postgres database that these helpers empty between files.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/node-postgres'
import { createPool } from '../src/server/db/connection'
import * as schema from '../src/server/db/schema'

/** Set TEST_DB_SUFFIX (for example "_b") to use a second set made by scripts/create-test-dbs.ts. */
const SUFFIX = (process.env.TEST_DB_SUFFIX ?? '').replace(/[^a-z0-9_]/gi, '')

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `postgres://seating:seating@127.0.0.1:5432/seating_test${SUFFIX}`

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

/** Refuses any database that is not on this machine, so a test can never wipe real data. */
export function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to use a non-local database for tests (${host}).`)
  }
}

export function makeTestDb() {
  assertLocalDatabase(TEST_DATABASE_URL)
  const pool = createPool(TEST_DATABASE_URL, { max: 20 })
  const db = drizzle({ client: pool, schema, casing: 'snake_case' })
  return { pool, db }
}

export const ALL_TABLES = [
  'backups',
  'backup_images',
  'backup_runs',
  'activity_events',
  'password_resets',
  'invites',
  'sessions',
  'wedding_members',
  'users',
  'login_attempts',
  'share_links',
  'layout_seats',
  'layouts',
  'venue_template_revisions',
  'venue_images',
  'venue_templates',
  'rule_guests',
  'rules',
  'group_members',
  'groups',
  'guests',
  'weddings',
] as const

/**
 * Empties every table, then puts back the rows migrations own (the empty
 * Toronto Beach Club template, in the shared library), so tests see what
 * production starts with.
 */
export async function truncateAll(pool: { query: (sql: string) => Promise<unknown> }): Promise<void> {
  await pool.query(`truncate ${ALL_TABLES.join(', ')} restart identity cascade`)
  await pool.query(readFileSync(path.resolve(process.cwd(), 'drizzle/0001_toronto_beach_club_template.sql'), 'utf8'))
  // The same statement migration 0006 runs (the library flag is part of what migrations leave behind).
  await pool.query(
    `update venue_templates set is_library = true where name = 'Toronto Beach Club' and owner_user_id is null and deleted_at is null`,
  )
}
