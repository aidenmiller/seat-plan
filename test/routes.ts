/**
 * Calling route handlers in integration tests, the way Next.js would: a
 * NextRequest with the cookie, a JSON body and the client address, and the
 * params promise. Nothing in the app imports this file.
 */
import { NextRequest } from 'next/server'
import { SESSION_COOKIE } from '../src/server/auth/tokens'
import { USER_HEADER } from '../src/shared/user-header'

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>

export type CallOptions = {
  /** A Cookie header (`sp_session=…`), or none. */
  cookie?: string | null
  body?: unknown
  params?: Record<string, string>
  /** Sent as x-real-ip, the address the throttle counts by. */
  ip?: string
  /** Sent as Origin, as a browser page does; `userHeader` then decides whether the page names its user. */
  origin?: string
  userHeader?: string
  path?: string
}

export type CallResult = {
  status: number
  // Replies are checked field by field in the tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
  /** The raw reply, for checking that no token shows up in it. */
  text: string
  headers: Headers
}

export async function callRoute(mod: Record<string, unknown>, method: string, opts: CallOptions = {}): Promise<CallResult> {
  const handler = mod[method] as Handler | undefined
  if (typeof handler !== 'function') throw new Error(`the route has no ${method} handler`)
  const headers: Record<string, string> = { 'user-agent': 'vitest browser' }
  if (opts.cookie) headers.cookie = opts.cookie
  if (opts.ip) headers['x-real-ip'] = opts.ip
  if (opts.origin) headers.origin = opts.origin
  if (opts.userHeader) headers[USER_HEADER] = opts.userHeader
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const req = new NextRequest(`https://seat.example${opts.path ?? '/api/test'}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  })
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body, text, headers: res.headers }
}

/** The session cookie a reply set, as a Cookie header (`sp_session=…`), or null; '' when it was cleared. */
export function sessionCookieFrom(res: { headers: Headers }): string | null {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))
  if (raw === undefined) return null
  const value = raw.slice(SESSION_COOKIE.length + 1, raw.indexOf(';'))
  return value ? `${SESSION_COOKIE}=${value}` : ''
}

let addressCount = 0
/** A made-up address no other test in the file uses, so the throttle counts start at zero. */
export function freshAddress(): string {
  addressCount += 1
  return `203.0.${Math.floor(addressCount / 250)}.${(addressCount % 250) + 1}`
}
