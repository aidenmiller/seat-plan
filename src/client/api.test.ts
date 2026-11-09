import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError, createWedding, deleteLayout, errorMessage, getLayout, listVenues } from './api'

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
    expect(fetchMock).toHaveBeenCalledWith('/api/weddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Noa & Aiden', unit: 'ft' }),
      cache: 'no-store',
      credentials: 'same-origin',
    })
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
    const error = await listVenues().catch((e: unknown) => e)
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

  it('reads the first issue of a 422', () => {
    const error = new ApiRequestError(422, { error: 'invalid', issues: ['name: Names cannot be empty'] }, 'x')
    expect(errorMessage(error)).toBe('Names cannot be empty.')
  })
})
