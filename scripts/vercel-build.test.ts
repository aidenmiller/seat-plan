import { describe, expect, it } from 'vitest'
import { productionSettingsProblems } from './vercel-build'

const SECRET = 'a'.repeat(32)
const DATABASE_URL = 'postgres://user:pass@db.example/app'
const CRON_SECRET = '0123456789abcdef0123456789ABCDEF'
const BACKUPS = { CRON_SECRET, BLOB_STORE_ID: 'store_abc123' }

describe('productionSettingsProblems', () => {
  it('passes with AUTH_SECRET, DATABASE_URL, CRON_SECRET and a Blob store, and no site password', () => {
    expect(productionSettingsProblems({ AUTH_SECRET: SECRET, DATABASE_URL, ...BACKUPS })).toEqual([])
    expect(productionSettingsProblems({ AUTH_SECRET: SECRET, DATABASE_URL, ...BACKUPS, SITE_PASSWORD: 'set' })).toEqual([])
    // A read-write token instead of the store id the connection adds.
    expect(productionSettingsProblems({ AUTH_SECRET: SECRET, DATABASE_URL, CRON_SECRET, BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x' })).toEqual([])
  })

  it('names a missing or short AUTH_SECRET and a missing DATABASE_URL, never a value', () => {
    const problems = productionSettingsProblems({ AUTH_SECRET: 'short-secret-value', ...BACKUPS })
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/^AUTH_SECRET is missing or shorter than 32 characters/)
    expect(problems[1]).toMatch(/^DATABASE_URL is not set/)
    expect(problems.join(' ')).not.toContain('short-secret-value')
    expect(productionSettingsProblems({ DATABASE_URL, ...BACKUPS })).toEqual([expect.stringMatching(/^AUTH_SECRET/)])
  })

  it('needs a CRON_SECRET of at least 32 letters and digits, never naming its value', () => {
    const base = { AUTH_SECRET: SECRET, DATABASE_URL, BLOB_STORE_ID: 'store_abc123' }
    for (const bad of [undefined, '', 'a'.repeat(31), `${'a'.repeat(32)} `, `${'a'.repeat(32)}-x`, `${'a'.repeat(32)}\n`, `${'b'.repeat(40)}/+=`]) {
      const problems = productionSettingsProblems({ ...base, CRON_SECRET: bad })
      expect(problems, JSON.stringify(bad)).toEqual([expect.stringMatching(/^CRON_SECRET is missing, shorter than 32 characters/)])
      if (bad) expect(problems.join(' ')).not.toContain(bad.trim())
    }
    expect(productionSettingsProblems({ ...base, CRON_SECRET: 'a'.repeat(64) })).toEqual([])
  })

  it('needs a Blob store (its store id, or a read-write token), and refuses a local backup folder', () => {
    const base = { AUTH_SECRET: SECRET, DATABASE_URL, CRON_SECRET }
    expect(productionSettingsProblems(base)).toEqual([expect.stringMatching(/^No Blob store is connected/)])
    expect(productionSettingsProblems({ ...base, BLOB_STORE_ID: '' })).toEqual([expect.stringMatching(/^No Blob store is connected/)])
    expect(productionSettingsProblems({ ...base, BLOB_STORE_ID: 'store_x', BACKUP_STORE_DIR: '.backups' })).toEqual([
      expect.stringMatching(/^BACKUP_STORE_DIR is for local runs only/),
    ])
  })
})
