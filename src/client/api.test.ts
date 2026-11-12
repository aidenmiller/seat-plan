import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addGroupMembers,
  ApiRequestError,
  commitGuestImport,
  createGroup,
  createGuest,
  createWedding,
  deleteGuest,
  deleteLayout,
  errorMessage,
  getLayout,
  guestsExportUrl,
  listGuests,
  listVenues,
  removeGroupMember,
  updateGuest,
  updateWedding,
} from './api'

function reply(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api helpers', () => {
  it('send JSON and return the parsed reply', async () => {
    const fetchMock = vi.fn(async () => reply(201, { id: 'w1', name: 'Noa & Aiden' }))
    vi.stubGlobal('fetch', fetchMock)
    const wedding = await createWedding({ name: 'Noa & Aiden', unit: 'ft' })
    expect(wedding).toEqual({ id: 'w1', name: 'Noa & Aiden' })
    // Sent through appFetch (src/client/http.ts), which hands fetch a Headers object.
    expect(fetchMock).toHaveBeenCalledWith('/api/weddings', {
      method: 'POST',
      headers: expect.any(Headers),
      body: JSON.stringify({ name: 'Noa & Aiden', unit: 'ft' }),
      cache: 'no-store',
      credentials: 'same-origin',
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({ 'content-type': 'application/json' })
  })

  it('deletes send the typed word', async () => {
    const fetchMock = vi.fn(async () => reply(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await deleteLayout('l1')
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe('/api/layouts/l1')
    expect(init.method).toBe('DELETE')
    expect(init.body).toBe(JSON.stringify({ confirm: 'delete' }))
  })

  it('throws ApiRequestError with the status and body on a non-2xx reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(404, { error: 'not_found' })))
    const error = await getLayout('missing').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status: 404, body: { error: 'not_found' } })
  })

  it('throws with status 0 when the server cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const error = await listVenues('w1').catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 0 })
  })
})

describe('errorMessage', () => {
  it('gives a plain sentence for each kind of failure', () => {
    expect(errorMessage(new ApiRequestError(0, null, 'x'))).toMatch(/Could not reach the server/)
    expect(errorMessage(new ApiRequestError(401, null, 'x'))).toMatch(/signed out/)
    expect(errorMessage(new ApiRequestError(404, null, 'x'))).toMatch(/deleted/)
    expect(errorMessage(new ApiRequestError(500, null, 'x'))).toMatch(/server had a problem/)
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Try again.')
  })

  it('shows the plain message a 409 or 413 carries', () => {
    const taken = new ApiRequestError(409, { error: 'name_taken', message: 'A group with that name already exists.' }, 'x')
    expect(errorMessage(taken)).toBe('A group with that name already exists.')
    const big = new ApiRequestError(413, { error: 'too_large', message: 'Send at most 5,000 rows at a time.' }, 'x')
    expect(errorMessage(big)).toBe('Send at most 5,000 rows at a time.')
    expect(errorMessage(new ApiRequestError(409, { error: 'id_taken' }, 'x'))).toBe('Something went wrong. Try again.')
  })

  it('reads the first issue of a 422', () => {
    const error = new ApiRequestError(422, { error: 'invalid', issues: ['name: Names cannot be empty'] }, 'x')
    expect(errorMessage(error)).toBe('Names cannot be empty.')
  })
})

describe('guest and group helpers', () => {
  it('call the routes in src/app/api with the method and body each expects', async () => {
    const fetchMock = vi.fn(async () => reply(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    const W = 'w 1'
    await listGuests(W)
    await createGuest(W, { id: 'g1', firstName: 'Ann', lastName: 'Lee' })
    await updateGuest('g1', { meal: 'Fish' })
    await deleteGuest('g1')
    await commitGuestImport(W, { rows: [], removeMissing: false })
    await createGroup(W, { name: 'Book Club', guestIds: ['g1'] })
    await addGroupMembers('gr1', { guestIds: ['g1'] })
    await removeGroupMember('gr1', 'g1')
    const calls = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(([path, init]) => [
      init.method,
      path,
      init.body === undefined ? undefined : JSON.parse(String(init.body)),
    ])
    expect(calls).toEqual([
      ['GET', '/api/weddings/w%201/guests', undefined],
      ['POST', '/api/weddings/w%201/guests', { id: 'g1', firstName: 'Ann', lastName: 'Lee' }],
      ['PATCH', '/api/guests/g1', { meal: 'Fish' }],
      ['DELETE', '/api/guests/g1', undefined],
      ['POST', '/api/weddings/w%201/guests/import/commit', { rows: [], removeMissing: false }],
      ['POST', '/api/weddings/w%201/groups', { name: 'Book Club', guestIds: ['g1'] }],
      ['POST', '/api/groups/gr1/members', { guestIds: ['g1'] }],
      ['DELETE', '/api/groups/gr1/members/g1', undefined],
    ])
    expect(guestsExportUrl(W)).toBe('/api/weddings/w%201/guests/export')
  })
})

describe('partner names and sides', () => {
  it('send the partner names with a wedding, and a guest side as its code', async () => {
    const fetchMock = vi.fn(async () => reply(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    await createWedding({ name: 'Sam & Alex', partner1Name: 'Sam', partner2Name: 'Alex' })
    await updateWedding('w1', { partner2Name: null })
    await updateGuest('g1', { side: 'partner2' })
    const bodies = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(([path, init]) => [path, JSON.parse(String(init.body))])
    expect(bodies).toEqual([
      ['/api/weddings', { name: 'Sam & Alex', partner1Name: 'Sam', partner2Name: 'Alex' }],
      ['/api/weddings/w1', { partner2Name: null }],
      ['/api/guests/g1', { side: 'partner2' }],
    ])
  })
})
