/**
 * The user header on every change the browser sends (src/client/http.ts):
 * the helper itself, and a scan of the browser code that fails if anything
 * sends a request without going through it, apart from the few files listed
 * below with their reason.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { USER_HEADER } from '@/shared/user-header'
import { CurrentUserProvider, currentUserId } from './current-user'
import { appFetch, appFetchAs, isStalePage } from './http'

const USER = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Pat', email: 'pat@example.com', isAdmin: false }

describe('appFetch', () => {
  const sent = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

  beforeEach(() => {
    sent.mockReset().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', sent)
    vi.stubGlobal('window', {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function headersOf(call: number): Headers {
    return new Headers(sent.mock.calls[call]![1]?.headers)
  }

  it('sends the page’s user with every change, keeping the other headers and options', async () => {
    // The provider notes the user while it renders, before any child can send anything.
    CurrentUserProvider({ user: USER, children: null })
    expect(currentUserId()).toBe(USER.id)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
      sent.mockClear()
      await appFetch('/api/x', { method, headers: { 'content-type': 'application/json' }, body: '{}', keepalive: true })
      const headers = headersOf(0)
      expect(headers.get(USER_HEADER), method).toBe(USER.id)
      expect(headers.get('content-type')).toBe('application/json')
      expect(sent.mock.calls[0]![1]).toMatchObject({ method, body: '{}', keepalive: true })
    }
  })

  it('leaves reads alone', async () => {
    CurrentUserProvider({ user: USER, children: null })
    await appFetch('/api/x')
    await appFetch('/api/x', { method: 'GET', headers: { accept: 'application/json' } })
    expect(sent.mock.calls[0]![1]).toEqual({})
    expect(headersOf(1).get(USER_HEADER)).toBeNull()
  })

  it('takes the method of a Request passed in', async () => {
    CurrentUserProvider({ user: USER, children: null })
    await appFetch(new Request('https://seat.example/api/x', { method: 'DELETE', headers: { 'x-a': '1' } }))
    expect(headersOf(0).get(USER_HEADER)).toBe(USER.id)
    expect(headersOf(0).get('x-a')).toBe('1')
  })

  it('appFetchAs names its own user whoever the page was rendered for, and only on changes', async () => {
    CurrentUserProvider({ user: { ...USER, id: '22222222-2222-4222-8222-222222222222' }, children: null })
    const asPat = appFetchAs(USER.id)
    await asPat('/api/x', { method: 'PUT', body: '{}' })
    expect(headersOf(0).get(USER_HEADER)).toBe(USER.id)
    await asPat('/api/x')
    expect(sent.mock.calls[1]![1]).toEqual({})
  })

  it('tells a stale page refusal from a plain sign-out', () => {
    expect(isStalePage(401, { error: 'stale_page' })).toBe(true)
    expect(isStalePage(401, { error: 'unauthorized' })).toBe(false)
    expect(isStalePage(401, null)).toBe(false)
    expect(isStalePage(403, { error: 'stale_page' })).toBe(false)
  })

  it('follows the user the page was last rendered for', async () => {
    CurrentUserProvider({ user: USER, children: null })
    CurrentUserProvider({ user: { ...USER, id: '22222222-2222-4222-8222-222222222222' }, children: null })
    await appFetch('/api/x', { method: 'POST' })
    expect(headersOf(0).get(USER_HEADER)).toBe('22222222-2222-4222-8222-222222222222')
  })
})

describe('the user is never noted on the server', () => {
  it('ignores a render outside the browser', async () => {
    vi.resetModules()
    const fresh = await import('./current-user')
    fresh.CurrentUserProvider({ user: USER, children: null })
    expect(fresh.currentUserId()).toBeNull()
  })
})

// ---------- The scan ----------

const SRC = path.resolve(__dirname, '..')

/**
 * Files that may call fetch themselves, and why. 'public': a route with no
 * signed-in user (and no user guard), so there is no header to send.
 * 'reads': GET requests only, which need no header.
 */
const ALLOWED: Record<string, 'helper' | 'public' | 'reads'> = {
  'client/http.ts': 'helper',
  'app/login/LoginForm.tsx': 'public',
  'app/setup/SetupForm.tsx': 'public',
  'client/share/SharePasswordForm.tsx': 'public',
  'client/share/ShareViewer.tsx': 'reads',
  'client/export/pdf.ts': 'reads',
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

/** A call to fetch itself: fetch(…), globalThis.fetch(…), window.fetch(…) or self.fetch(…), but not appFetch or fetchFn. */
const BARE_FETCH = /(?:^|[^\w$.])(?:(?:globalThis|window|self)\s*\.\s*)?fetch\s*\(/
/** Other ways a page can send a request that would skip the helper. */
const OTHER_SENDERS = /XMLHttpRequest|sendBeacon|<form[^>]*\bmethod=|formAction=|['"]use server['"]/
const UNSAFE_METHOD = /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i

/** Reading every file is slow on a busy machine: allow for it. */
const SCAN_TIMEOUT_MS = 60_000

describe('browser code sends changes only through appFetch', { timeout: SCAN_TIMEOUT_MS }, () => {
  const files = [...sourceFiles(path.join(SRC, 'client')), ...sourceFiles(path.join(SRC, 'app'))].map((f) =>
    path.relative(SRC, f).split(path.sep).join('/'),
  )
  const sources = new Map<string, string>()
  /** A file's text, read once. */
  const read = (file: string): string => {
    let text = sources.get(file)
    if (text === undefined) {
      text = readFileSync(path.join(SRC, file), 'utf8')
      sources.set(file, text)
    }
    return text
  }

  it('finds the browser code and every listed file', () => {
    expect(files).toContain('client/api.ts')
    expect(files).toContain('client/sync/layout-saver.ts')
    for (const file of Object.keys(ALLOWED)) expect(files, file).toContain(file)
  })

  it('has no bare fetch outside the listed files', () => {
    const offenders = files.filter((file) => !ALLOWED[file] && BARE_FETCH.test(read(file)))
    expect(offenders, 'call appFetch (src/client/http.ts) instead of fetch').toEqual([])
  })

  it('has no other way of sending a request', () => {
    const offenders = files.filter((file) => OTHER_SENDERS.test(read(file)))
    expect(offenders).toEqual([])
  })

  it('keeps the read-only files to reads', () => {
    for (const [file, why] of Object.entries(ALLOWED)) {
      if (why !== 'reads') continue
      expect(read(file), file).not.toMatch(UNSAFE_METHOD)
    }
  })

  it('sends the public forms only to public routes', () => {
    const targets: Record<string, RegExp> = {
      'app/login/LoginForm.tsx': /fetch\('\/api\/auth\/login'/,
      'app/setup/SetupForm.tsx': /fetch\('\/api\/setup'/,
      'client/share/SharePasswordForm.tsx': /fetch\(`\/share\/\$\{token\}\/login`/,
    }
    for (const [file, why] of Object.entries(ALLOWED)) {
      if (why !== 'public') continue
      const source = read(file)
      expect(source, file).toMatch(targets[file]!)
      expect(source.match(new RegExp(BARE_FETCH.source, 'g'))?.length, `${file} sends one request`).toBe(1)
    }
  })

  it('sends with appFetch by default in the save engines, bound to the user they were made for', () => {
    expect(read('client/sync/layout-saver.ts')).toMatch(/options\.fetch \?\? appFetchAs\(userId\)/)
    expect(read('client/sync/row-save.ts')).toMatch(/options\.fetch \?\? \(options\.userId \? appFetchAs\(options\.userId\) : appFetch\)/)
    expect(read('client/sync/remote-version.ts')).toMatch(/options\.fetch \?\? appFetch/)
  })
})
