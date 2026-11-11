/**
 * The two plain checks behind first-run setup: the site password, compared
 * in constant time, and the BOOTSTRAP_ADMIN_EMAIL rule, which holds on every
 * Vercel deployment (previews too), not only in production.
 */
import { describe, expect, it } from 'vitest'
import { checkBootstrapEmail, setupPasswordMatches } from './setup'

describe('setupPasswordMatches', () => {
  it('matches only SITE_PASSWORD, and fails closed when it is not set', () => {
    const env = { SITE_PASSWORD: 'correct horse' }
    expect(setupPasswordMatches('correct horse', env)).toBe(true)
    expect(setupPasswordMatches('correct horse ', env)).toBe(false)
    expect(setupPasswordMatches('wrong', env)).toBe(false)
    expect(setupPasswordMatches('', {})).toBe(false)
    expect(setupPasswordMatches('', { SITE_PASSWORD: '' })).toBe(false)
  })
})

describe('checkBootstrapEmail', () => {
  it('takes any email off Vercel (local runs and tests)', () => {
    expect(checkBootstrapEmail('anyone@example.com', {})).toBe('ok')
    expect(checkBootstrapEmail('anyone@example.com', { VERCEL: '', VERCEL_ENV: 'production' })).toBe('ok')
  })

  it('needs BOOTSTRAP_ADMIN_EMAIL on every Vercel deployment, previews included', () => {
    for (const vercelEnv of ['production', 'preview', 'development', undefined]) {
      const env = { VERCEL: '1', VERCEL_ENV: vercelEnv }
      expect(checkBootstrapEmail('anyone@example.com', env), String(vercelEnv)).toBe('not-configured')
      expect(checkBootstrapEmail('anyone@example.com', { ...env, BOOTSTRAP_ADMIN_EMAIL: '  ' }), String(vercelEnv)).toBe('not-configured')
      const named = { ...env, BOOTSTRAP_ADMIN_EMAIL: ' The-Owner@Example.com ' }
      expect(checkBootstrapEmail('someone-else@example.com', named), String(vercelEnv)).toBe('mismatch')
      expect(checkBootstrapEmail('THE-OWNER@example.com', named), String(vercelEnv)).toBe('ok')
    }
  })
})
