import { describe, expect, it } from 'vitest'
import { addressKey, clientAddress } from './throttle'

describe('clientAddress', () => {
  it('prefers x-real-ip, then the first x-forwarded-for address', () => {
    expect(clientAddress(new Headers({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' }))).toBe('1.2.3.4')
    expect(clientAddress(new Headers({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' }))).toBe('5.6.7.8')
    expect(clientAddress(new Headers())).toBe('unknown')
  })
})

describe('addressKey', () => {
  const secret = 'x'.repeat(32)

  it('hashes the address so raw addresses never reach the database', () => {
    const key = addressKey('1.2.3.4', secret)
    expect(key).toMatch(/^[0-9a-f]{32}$/)
    expect(key).not.toContain('1.2.3.4')
    expect(addressKey('1.2.3.5', secret)).not.toBe(key)
  })

  it('counts IPv6 addresses by their first 64 bits', () => {
    const a = addressKey('2001:db8:abcd:12:1::1', secret)
    expect(addressKey('2001:db8:abcd:12:ffff:ffff:ffff:ffff', secret)).toBe(a)
    expect(addressKey('2001:0db8:abcd:0012::9', secret)).toBe(a)
    expect(addressKey('2001:db8:abcd:13::1', secret)).not.toBe(a)
  })
})
