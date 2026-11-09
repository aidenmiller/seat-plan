/**
 * Postgres connection settings shared by the app, scripts and tests.
 * No 'server-only' import: scripts and Vitest use this file too.
 */
import { Pool, type PoolConfig } from 'pg'

/**
 * pg treats sslmode=require as verify-full and prints a warning about it.
 * Neon's certificates are publicly trusted, so ask for verify-full directly.
 */
export function normalizeDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.searchParams.get('sslmode') === 'require') {
      parsed.searchParams.set('sslmode', 'verify-full')
    }
    parsed.searchParams.delete('channel_binding')
    return parsed.toString()
  } catch {
    return url
  }
}

export function requireDatabaseUrl(kind: 'pooled' | 'direct' = 'pooled'): string {
  const url =
    kind === 'direct'
      ? process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
      : process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      process.env.VERCEL
        ? 'DATABASE_URL is not set. In Vercel, open Storage, connect the Neon database to this environment, then redeploy.'
        : 'DATABASE_URL is not set. Copy env.example to .env.local and fill it in.',
    )
  }
  return normalizeDatabaseUrl(url)
}

export function createPool(url: string, extra: PoolConfig = {}): Pool {
  const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 5000, connectionTimeoutMillis: 10_000, ...extra })
  // Without a listener, a dropped idle connection (Neon restarting, a network
  // reset) would surface as an uncaught error and stop the whole process.
  pool.on('error', (err) => console.error('Postgres pool: idle client error:', err.message))
  return pool
}
