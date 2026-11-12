/**
 * The invite and reset calls send the token in a JSON body to a fixed path,
 * never in the address, which servers and proxies write to their logs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptInvite, completeReset, lookupInvite, lookupReset, registerWithInvite } from './accounts-api'

const TOKEN = 'Zz9_-Zz9_-Zz9_-Zz9_-Zz9_-Zz9_-Zz9_-Zz9_-Zz9'

describe('the calls that carry a token', () => {
  const sent = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

  beforeEach(() => {
    sent.mockReset().mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', sent)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('post it in the body, to a path without it', async () => {
    await lookupInvite(TOKEN)
    await registerWithInvite({ token: TOKEN, email: 'pat@example.com', displayName: 'Pat', password: 'a long password' })
    await acceptInvite(TOKEN)
    await lookupReset(TOKEN)
    await completeReset(TOKEN, 'a long password')
    expect(sent.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/invites/lookup',
      '/api/invites/register',
      '/api/invites/accept',
      '/api/auth/reset',
      '/api/auth/reset',
    ])
    for (const [url, init] of sent.mock.calls) {
      expect(String(url)).not.toContain(TOKEN)
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
      expect((JSON.parse(String(init?.body)) as { token: string }).token).toBe(TOKEN)
      for (const value of new Headers(init?.headers).values()) expect(value).not.toContain(TOKEN)
    }
    expect(JSON.parse(String(sent.mock.calls[4]![1]?.body))).toEqual({ token: TOKEN, password: 'a long password' })
  })
})
