/**
 * Straight to the end-to-end database, for setting up many guests in one
 * statement (the speed test's 400). Tests that need a few guests can also
 * use the guest routes (e2e/guest-list.ts). Local databases only.
 */
import { randomUUID } from 'node:crypto'
import { hash, type Algorithm } from '@node-rs/argon2'
import pg from 'pg'
import { cleanDisplayName, isPlausibleEmail, normalizeEmail } from '../src/domain/accounts'
import { nameKey } from '../src/domain/names'
import { assertLocalDatabase } from '../test/db'

/** Adds guests to a wedding and returns their ids, in order. */
export async function dbAddGuests(weddingId: string, names: readonly (readonly [first: string, last: string])[]): Promise<string[]> {
  const url = process.env.E2E_DATABASE_URL
  if (!url) throw new Error('E2E_DATABASE_URL is not set; run through playwright.config.ts')
  assertLocalDatabase(url)
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    // One statement for any number of guests, with ids made here so their order is known.
    const ids = names.map(() => randomUUID())
    await client.query(
      `insert into guests (id, wedding_id, first_name, last_name, name_key)
       select id, $1, f, l, k from unnest($2::uuid[], $3::text[], $4::text[], $5::text[]) as n(id, f, l, k)`,
      [weddingId, ids, names.map((n) => n[0]), names.map((n) => n[1]), names.map(([f, l]) => nameKey(f, l))],
    )
    return ids
  } finally {
    await client.end()
  }
}

/**
 * The settings src/server/auth/passwords.ts hashes with (argon2id, 19 MiB, two
 * passes, one lane). That module cannot be loaded here: it is server-only.
 * The hash records its settings, so the app checks it like one of its own.
 */
const ARGON2ID = 2 as Algorithm
const PASSWORD_HASH_OPTIONS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 }

/** Adds an account that can sign in, and returns its id. */
export async function dbCreateUser(
  email: string,
  displayName: string,
  password: string,
  { admin = false }: { admin?: boolean } = {},
): Promise<string> {
  const url = process.env.E2E_DATABASE_URL
  if (!url) throw new Error('E2E_DATABASE_URL is not set; run through playwright.config.ts')
  assertLocalDatabase(url)
  const normalized = normalizeEmail(email)
  const name = cleanDisplayName(displayName)
  if (!isPlausibleEmail(normalized) || name === null) throw new Error(`dbCreateUser: bad email or name (${email}, ${displayName})`)
  const passwordHash = await hash(password, PASSWORD_HASH_OPTIONS)
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const result = await client.query<{ id: string }>(
      'insert into users (email, display_name, password_hash, is_admin) values ($1, $2, $3, $4) returning id',
      [normalized, name, passwordHash, admin],
    )
    return result.rows[0]!.id
  } finally {
    await client.end()
  }
}

/**
 * Marks a venue template deleted while layouts still use it, as restoring a
 * wedding from the database can leave things (DECISIONS 29). The app itself
 * refuses that delete.
 */
export async function dbMarkTemplateDeleted(templateId: string): Promise<void> {
  const url = process.env.E2E_DATABASE_URL
  if (!url) throw new Error('E2E_DATABASE_URL is not set; run through playwright.config.ts')
  assertLocalDatabase(url)
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query('update venue_templates set deleted_at = now() where id = $1', [templateId])
  } finally {
    await client.end()
  }
}
