import { describe, expect, it } from 'vitest'
import { normalizeDatabaseUrl } from './connection'

describe('normalizeDatabaseUrl', () => {
  it('asks for full certificate checks where Neon says sslmode=require', () => {
    const url = normalizeDatabaseUrl('postgres://u:p@ep-x-pooler.neon.tech/db?sslmode=require&channel_binding=require')
    expect(url).toContain('sslmode=verify-full')
    expect(url).not.toContain('channel_binding')
  })

  it('leaves local URLs alone', () => {
    expect(normalizeDatabaseUrl('postgres://u:p@127.0.0.1:5432/db')).toBe('postgres://u:p@127.0.0.1:5432/db')
  })
})
