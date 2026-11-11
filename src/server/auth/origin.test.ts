import { describe, expect, it } from 'vitest'
import { USER_HEADER, originAllowed, userHeaderMatches } from './origin'

function req(method: string, headers: Record<string, string>) {
  return { method, headers: new Headers(headers) }
}

describe('originAllowed', () => {
  it('lets safe methods through whatever they carry', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(originAllowed(req(method, { origin: 'https://evil.example', host: 'seat.example', 'sec-fetch-site': 'cross-site' }))).toBe(true)
    }
  })

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    describe(method, () => {
      it('allows an Origin on this host', () => {
        expect(originAllowed(req(method, { origin: 'https://seat.example', host: 'seat.example' }))).toBe(true)
        expect(originAllowed(req(method, { origin: 'http://localhost:3000', host: 'localhost:3000' }))).toBe(true)
        expect(originAllowed(req(method, { origin: 'https://Seat.Example', host: 'SEAT.example' }))).toBe(true)
      })

      it('refuses an Origin on another host, port or subdomain', () => {
        expect(originAllowed(req(method, { origin: 'https://evil.example', host: 'seat.example' }))).toBe(false)
        expect(originAllowed(req(method, { origin: 'http://localhost:4000', host: 'localhost:3000' }))).toBe(false)
        expect(originAllowed(req(method, { origin: 'https://other.seat.example', host: 'seat.example' }))).toBe(false)
        expect(originAllowed(req(method, { origin: 'https://seat.example.evil.example', host: 'seat.example' }))).toBe(false)
      })

      it('refuses Origin: null and an Origin that is not a URL', () => {
        expect(originAllowed(req(method, { origin: 'null', host: 'seat.example' }))).toBe(false)
        expect(originAllowed(req(method, { origin: 'seat.example', host: 'seat.example' }))).toBe(false)
        expect(originAllowed(req(method, { origin: '', host: 'seat.example' }))).toBe(false)
      })

      it('refuses an Origin when it cannot tell which host was asked for', () => {
        expect(originAllowed(req(method, { origin: 'https://seat.example' }))).toBe(false)
      })

      it('compares with the first X-Forwarded-Host entry when a proxy sets it', () => {
        const headers = { origin: 'https://seat.example', host: 'internal.vercel', 'x-forwarded-host': 'seat.example' }
        expect(originAllowed(req(method, headers))).toBe(true)
        expect(originAllowed(req(method, { ...headers, 'x-forwarded-host': 'seat.example, internal.vercel' }))).toBe(true)
        expect(originAllowed(req(method, { ...headers, 'x-forwarded-host': 'other.example' }))).toBe(false)
        // X-Forwarded-Host wins over Host: an Origin that only matches Host is refused.
        expect(originAllowed(req(method, { origin: 'https://internal.vercel', host: 'internal.vercel', 'x-forwarded-host': 'seat.example' }))).toBe(false)
      })

      it('without an Origin, goes by Sec-Fetch-Site', () => {
        expect(originAllowed(req(method, { host: 'seat.example' }))).toBe(true)
        expect(originAllowed(req(method, { host: 'seat.example', 'sec-fetch-site': 'same-origin' }))).toBe(true)
        expect(originAllowed(req(method, { host: 'seat.example', 'sec-fetch-site': 'none' }))).toBe(true)
        expect(originAllowed(req(method, { host: 'seat.example', 'sec-fetch-site': 'same-site' }))).toBe(false)
        expect(originAllowed(req(method, { host: 'seat.example', 'sec-fetch-site': 'cross-site' }))).toBe(false)
      })
    })
  }
})

describe('userHeaderMatches', () => {
  const id = '6f1c1d3e-0000-4000-8000-000000000001'
  it('is true only for this user id', () => {
    expect(userHeaderMatches({ headers: new Headers({ [USER_HEADER]: id }) }, id)).toBe(true)
    expect(userHeaderMatches({ headers: new Headers({ [USER_HEADER]: id.toUpperCase() }) }, id)).toBe(true)
    expect(userHeaderMatches({ headers: new Headers({ [USER_HEADER]: '6f1c1d3e-0000-4000-8000-000000000002' }) }, id)).toBe(false)
    expect(userHeaderMatches({ headers: new Headers({ [USER_HEADER]: '' }) }, id)).toBe(false)
    expect(userHeaderMatches({ headers: new Headers() }, id)).toBe(false)
  })
})
