import { describe, expect, it } from 'vitest'
import { classifyPath, safeNextPath } from './paths'

const TOKEN = 'A'.repeat(20) + '_-' + 'b'.repeat(21)

describe('classifyPath', () => {
  it('lets only the login page and the login route through', () => {
    expect(classifyPath('/login')).toBe('public')
    expect(classifyPath('/api/auth/login')).toBe('public')
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
    ]) {
      expect(classifyPath(path), path).toBe('protected')
    }
  })
})

describe('safeNextPath', () => {
  it('keeps paths on this site, with their query and hash', () => {
    expect(safeNextPath('/w/abc/layouts?tab=1#x')).toBe('/w/abc/layouts?tab=1#x')
    expect(safeNextPath('/')).toBe('/')
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
      '/\u0000x',
      42,
    ]) {
      expect(safeNextPath(next), String(next)).toBe('/')
    }
  })
})
