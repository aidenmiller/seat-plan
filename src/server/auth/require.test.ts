import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { authCookieOptions } from './require'

describe('authCookieOptions', () => {
  it('is Secure everywhere except plain http on this machine', () => {
    expect(authCookieOptions(new NextRequest('https://seat.example/x'), 60).secure).toBe(true)
    expect(authCookieOptions(new NextRequest('http://seat.example/x'), 60).secure).toBe(true)
    expect(authCookieOptions(new NextRequest('https://localhost:3000/x'), 60).secure).toBe(true)
    expect(authCookieOptions(new NextRequest('http://localhost:3000/x'), 60).secure).toBe(false)
    expect(authCookieOptions(new NextRequest('http://127.0.0.1:3000/x'), 60).secure).toBe(false)
  })

  it('is HttpOnly and SameSite=Lax, with the given lifetime and path', () => {
    const opts = authCookieOptions(new NextRequest('https://seat.example/x'), 123, '/share/abc')
    expect(opts).toMatchObject({ httpOnly: true, sameSite: 'lax', maxAge: 123, path: '/share/abc' })
  })
})
