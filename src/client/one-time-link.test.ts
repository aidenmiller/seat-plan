import { describe, expect, it } from 'vitest'
import { afterInvitePath, invitePath, resetPath, tokenFromHash } from './one-time-link'

const TOKEN = 'Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab3_-Ab3'

describe('tokenFromHash', () => {
  it('reads a whole token from the fragment, with or without the #', () => {
    expect(TOKEN).toHaveLength(43)
    expect(tokenFromHash(`#${TOKEN}`)).toBe(TOKEN)
    expect(tokenFromHash(TOKEN)).toBe(TOKEN)
    expect(tokenFromHash(`# ${TOKEN} `)).toBe(TOKEN)
  })

  it('gives null for no token, or one cut short or with more on the end', () => {
    expect(tokenFromHash('')).toBeNull()
    expect(tokenFromHash('#')).toBeNull()
    expect(tokenFromHash(`#${TOKEN.slice(0, 40)}`)).toBeNull()
    expect(tokenFromHash(`#${TOKEN}.`)).toBeNull()
    expect(tokenFromHash(`#${TOKEN}x`)).toBeNull()
    expect(tokenFromHash(`#${TOKEN.slice(0, 42)}=`)).toBeNull()
    expect(tokenFromHash('#token=abc')).toBeNull()
  })
})

describe('the links', () => {
  it('keep the token in the fragment, never the path or the query', () => {
    expect(invitePath(TOKEN)).toBe(`/invite#${TOKEN}`)
    expect(resetPath(TOKEN)).toBe(`/reset#${TOKEN}`)
    for (const path of [invitePath(TOKEN), resetPath(TOKEN)]) {
      const url = new URL(path, 'https://seat.example')
      expect(url.pathname + url.search).not.toContain(TOKEN)
      expect(url.hash).toBe(`#${TOKEN}`)
    }
  })
})

describe('afterInvitePath', () => {
  it('goes to the wedding the server named, or home', () => {
    expect(afterInvitePath('/w/44444444-4444-4444-8444-444444444444/layouts')).toBe('/w/44444444-4444-4444-8444-444444444444/layouts')
    expect(afterInvitePath('/')).toBe('/')
  })

  it('goes home for anything else, so the page never leaves for another site or an address with the token', () => {
    for (const odd of [undefined, null, 42, '', '//evil.example', 'https://evil.example', `/invite#${TOKEN}`, `/w/x/layouts?t=${TOKEN}`, '/w/44444444-4444-4444-8444-444444444444/layouts#x']) {
      expect(afterInvitePath(odd), String(odd)).toBe('/')
    }
  })
})
