import { describe, expect, it } from 'vitest'
import { productionSettingsProblems } from './vercel-build'

const SECRET = 'a'.repeat(32)
const DATABASE_URL = 'postgres://user:pass@db.example/app'

describe('productionSettingsProblems', () => {
  it('passes with AUTH_SECRET and DATABASE_URL, and no site password', () => {
    expect(productionSettingsProblems({ AUTH_SECRET: SECRET, DATABASE_URL })).toEqual([])
    expect(productionSettingsProblems({ AUTH_SECRET: SECRET, DATABASE_URL, SITE_PASSWORD: 'set' })).toEqual([])
  })

  it('names a missing or short AUTH_SECRET and a missing DATABASE_URL, never a value', () => {
    const problems = productionSettingsProblems({ AUTH_SECRET: 'short-secret-value' })
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/^AUTH_SECRET is missing or shorter than 32 characters/)
    expect(problems[1]).toMatch(/^DATABASE_URL is not set/)
    expect(problems.join(' ')).not.toContain('short-secret-value')
    expect(productionSettingsProblems({ DATABASE_URL })).toEqual([expect.stringMatching(/^AUTH_SECRET/)])
  })
})
