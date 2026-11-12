import { describe, expect, it } from 'vitest'
import { classifyPath, hidesReferrer, safeNextPath } from './paths'

const TOKEN = 'A'.repeat(20) + '_-' + 'b'.repeat(21)

describe('classifyPath', () => {
  it('lets only sign-in, setup, invite, reset and the tab icons through', () => {
    for (const path of [
      '/login',
      '/api/auth/login',
      '/setup',
      '/api/setup',
      '/invite',
      '/reset',
      '/api/invites/lookup',
      '/api/invites/register',
      '/api/auth/reset',
      '/icon.svg',
      '/apple-icon.png',
      '/manifest.webmanifest',
    ]) {
      expect(classifyPath(path), path).toBe('public')
    }
    expect(classifyPath('/api/auth/logout')).toBe('protected')
  })

  it('sends share paths with a well-formed token to their own check', () => {
    expect(TOKEN).toHaveLength(43)
    expect(classifyPath(`/share/${TOKEN}`)).toBe('share')
    expect(classifyPath(`/share/${TOKEN}/data`)).toBe('share')
    expect(classifyPath(`/share/${TOKEN}/login`)).toBe('share')
  })

  it('protects everything else', () => {
    for (const path of [
      '/',
      '/login/',
      '/loginx',
      '/api/auth',
      '/api/auth/login/x',
      '/api/weddings',
      '/w/abc/layouts',
      '/share',
      '/share/',
      '/share/short',
      `/share/${TOKEN}x`,
      `/sharex/${TOKEN}`,
      '/api/share-links/1',
      '/setup/x',
      '/api/setup/x',
      '/api/invites',
      '/api/invites/lookup/x',
      '/api/auth/reset/x',
      '/resetx',
      '/api/admin/users',
    ]) {
      expect(classifyPath(path), path).toBe('protected')
    }
  })
})

describe('hidesReferrer', () => {
  it('covers the invite and reset pages, which carry one-time tokens', () => {
    for (const path of ['/invite', '/reset', '/invite/x', '/reset/x']) expect(hidesReferrer(path), path).toBe(true)
    for (const path of ['/', '/login', '/setup', '/invites', '/resetx', '/api/auth/reset']) expect(hidesReferrer(path), path).toBe(false)
  })
})

describe('safeNextPath', () => {
  it('keeps paths on this site, with their query and hash', () => {
    expect(safeNextPath('/w/abc/layouts?tab=1#x')).toBe('/w/abc/layouts?tab=1#x')
    expect(safeNextPath('/')).toBe('/')
    expect(safeNextPath('/setups')).toBe('/setups')
  })

  it('sends anything else home', () => {
    for (const next of [
      undefined,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/login',
      '/login?next=/w/a',
      '/setup',
      '/reset',
      '/reset/abc',
      '/invite',
      '/invite?t=abc',
      '/\u0000x',
      '/.//evil.example',
      '/..//evil.example',
      '/%2e//evil.example',
      '/a/..//evil.example',
      42,
    ]) {
      expect(safeNextPath(next), String(next)).toBe('/')
    }
  })
})
