import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { isJsonRequest, readBody } from './api-route'

const schema = z.object({ name: z.string() })

function post(body: string, contentType?: string): NextRequest {
  return new NextRequest('https://seat.example/api/x', {
    method: 'POST',
    body,
    headers: contentType === undefined ? {} : { 'content-type': contentType },
  })
}

describe('isJsonRequest', () => {
  it('takes application/json, with or without parameters, in any case', () => {
    for (const type of ['application/json', 'application/json; charset=utf-8', 'Application/JSON;charset=UTF-8', ' application/json ']) {
      expect(isJsonRequest({ headers: new Headers({ 'content-type': type }) }), type).toBe(true)
    }
  })

  it('refuses everything a plain form or another site could send without asking first', () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonx', 'text/json', '']) {
      expect(isJsonRequest({ headers: new Headers({ 'content-type': type }) }), type).toBe(false)
    }
    expect(isJsonRequest({ headers: new Headers() })).toBe(false)
  })
})

describe('readBody', () => {
  it('answers 415 to a body not sent as JSON, before reading it', async () => {
    for (const type of [undefined, 'text/plain', 'application/x-www-form-urlencoded']) {
      const result = await readBody(post('{"name":"x"}', type), schema)
      expect(result.ok, String(type)).toBe(false)
      if (result.ok) continue
      expect(result.response.status).toBe(415)
      expect(await result.response.json()).toEqual({ error: 'unsupported_type', message: 'Send the request body as JSON.' })
    }
  })

  it('reads JSON, and answers 400 to bad JSON and 422 to a body that does not fit', async () => {
    expect(await readBody(post('{"name":"x"}', 'application/json; charset=utf-8'), schema)).toEqual({ ok: true, data: { name: 'x' } })
    const bad = await readBody(post('not json', 'application/json'), schema)
    expect(bad.ok ? 0 : bad.response.status).toBe(400)
    const unfit = await readBody(post('{"name":1}', 'application/json'), schema)
    expect(unfit.ok ? 0 : unfit.response.status).toBe(422)
  })
})
