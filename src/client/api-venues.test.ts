import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiRequestError, errorMessage, runFloorplanImport, saveVenue, uploadVenueImage, venueConflictOf, venueImageUrl } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A streamed reply whose chunks split lines in awkward places. */
function ndjson(chunks: string[], status = 200) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(body, { status, headers: { 'content-type': 'application/x-ndjson' } })
}

describe('venue api helpers', () => {
  it('uploads an image as the raw body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'img' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const blob = new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' })
    expect(await uploadVenueImage('v1', blob)).toEqual({ id: 'img' })
    // Sent through appFetch (src/client/http.ts), which hands fetch a Headers object.
    expect(fetchMock).toHaveBeenCalledWith('/api/venues/v1/images', {
      method: 'POST',
      headers: expect.any(Headers),
      body: blob,
      cache: 'no-store',
      credentials: 'same-origin',
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({ 'content-type': 'image/png' })
  })

  it('shows the server sentence for a refused upload and a save conflict', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'unsupported_type', message: 'Upload a PNG or JPEG image.' }), { status: 415 }))
    const upload = await uploadVenueImage('v1', new Blob(['x'])).catch((e: unknown) => e)
    expect(upload).toBeInstanceOf(ApiRequestError)
    expect(errorMessage(upload)).toBe('Upload a PNG or JPEG image.')

    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'conflict', message: 'Aiden saved this venue after you opened it.' }), { status: 409 }))
    const save = await saveVenue('v1', { baseVersion: 1, saveId: 'x', editedBy: 'Noa', fixedItems: [], reference: null }).catch((e: unknown) => e)
    expect(errorMessage(save)).toBe('Aiden saved this venue after you opened it.')
    expect(venueImageUrl('a b', 'c')).toBe('/api/venues/a%20b/images/c')
  })

  it('reads the import stream: progress lines, then the draft', async () => {
    const lines = [
      JSON.stringify({ type: 'progress', elapsedMs: 0, outputTokens: 0 }),
      JSON.stringify({ type: 'progress', elapsedMs: 2000, outputTokens: 120 }),
      JSON.stringify({ type: 'draft', draft: { walls: [] }, model: 'claude-sonnet-5-5', outputTokens: 900 }),
    ].join('\n')
    vi.stubGlobal('fetch', async () => ndjson([lines.slice(0, 10), lines.slice(10, 61), lines.slice(61), '\n']))
    const progress: number[] = []
    const result = await runFloorplanImport('v1', { imageId: 'i', imageWidth: 10, imageHeight: 10 }, { onProgress: (p) => progress.push(p.outputTokens) })
    expect(progress).toEqual([0, 120])
    expect(result).toEqual({ type: 'draft', draft: { walls: [] }, model: 'claude-sonnet-5-5', outputTokens: 900 })
  })

  it('returns an error line, and throws when the server refuses to start or the stream drops', async () => {
    vi.stubGlobal('fetch', async () => ndjson([`${JSON.stringify({ type: 'error', code: 'refusal', message: 'Declined.' })}\n`]))
    expect(await runFloorplanImport('v1', { imageId: 'i', imageWidth: 1, imageHeight: 1 })).toEqual({ type: 'error', code: 'refusal', message: 'Declined.' })

    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: 'not_configured', message: 'The floor plan import needs ANTHROPIC_API_KEY set on the server.' }), {
          status: 503,
        }),
    )
    const refused = await runFloorplanImport('v1', { imageId: 'i', imageWidth: 1, imageHeight: 1 }).catch((e: unknown) => e)
    expect(refused).toMatchObject({ status: 503 })
    expect(errorMessage(refused)).toBe('The floor plan import needs ANTHROPIC_API_KEY set on the server.')

    vi.stubGlobal('fetch', async () => ndjson([`${JSON.stringify({ type: 'progress', elapsedMs: 0, outputTokens: 0 })}\n`]))
    const dropped = await runFloorplanImport('v1', { imageId: 'i', imageWidth: 1, imageHeight: 1 }).catch((e: unknown) => e)
    expect(dropped).toMatchObject({ status: 0 })
  })
})

describe('venue conflict replies', () => {
  const conflict = (over: Record<string, unknown>) =>
    new ApiRequestError(409, { error: 'conflict', message: 'm', version: 6, updatedAt: 'x', lastSaveId: null, ...over }, 'x')

  it('keeps a name besides Noa and Aiden, with its id', () => {
    const id = '0b9f6a3e-6c1d-4c8e-9f57-2a1d6f1e7a10'
    expect(venueConflictOf(conflict({ editedBy: 'Dayna K.', editedById: id }))).toMatchObject({ editedBy: 'Dayna K.', editedById: id })
  })

  it('reads a missing or malformed editor as nobody', () => {
    expect(venueConflictOf(conflict({}))).toMatchObject({ editedBy: null, editedById: null })
    expect(venueConflictOf(conflict({ editedBy: 4, editedById: 4 }))).toMatchObject({ editedBy: null, editedById: null })
  })
})
