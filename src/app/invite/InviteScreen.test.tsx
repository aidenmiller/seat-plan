/**
 * The invite page: each state it can show, and a read of its source (and the
 * reset page's) that fails if either ever puts the token in an address it
 * fetches or goes to. The token itself is read from the #fragment
 * (src/client/accounts/link-token.ts) and sent only in a JSON body
 * (src/client/accounts-api.test.ts).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inviteProblemMessage } from '@/domain/account-wording'
import { InviteScreen, InviteView, type OpenInvite } from './InviteScreen'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const TOKEN = 'Qq7_-Qq7_-Qq7_-Qq7_-Qq7_-Qq7_-Qq7_-Qq7_-Qq7'

const weddingInvite: OpenInvite = {
  status: 'ok',
  kind: 'wedding',
  weddingName: 'Rosa & Ben',
  role: 'editor',
  inviterName: 'Olive',
  email: null,
  expiresAt: '2026-11-18T12:00:00.000Z',
}

const plannerInvite: OpenInvite = { ...weddingInvite, kind: 'planner', weddingName: null, role: null, inviterName: 'Ada' }

type ViewProps = Parameters<typeof InviteView>[0]

function view(phase: ViewProps['phase'], signedIn: ViewProps['signedIn'] = null): string {
  return renderToStaticMarkup(<InviteView phase={phase} token={TOKEN} signedIn={signedIn} onPhase={() => {}} />)
}

const PAT = { displayName: 'Pat', email: 'pat@example.com' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('InviteScreen', () => {
  it('shows only that it is opening the invite on the server, which never sees the token, and asks nothing yet', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const markup = renderToStaticMarkup(<InviteScreen signedIn={null} />)
    expect(markup).toContain('Opening your invite…')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('InviteView', () => {
  it('says plainly when the link is cut short, unknown, or cannot be used any more', () => {
    expect(view({ kind: 'missing' })).toContain('This invite link is not complete')
    expect(view({ kind: 'unknown' })).toContain('This invite link does not work')
    for (const problem of ['used', 'expired', 'revoked', 'wedding-gone', 'inviter-disabled', 'email-mismatch'] as const) {
      const markup = view({ kind: 'unusable', problem })
      expect(markup, problem).toContain('This invite cannot be used')
      expect(markup, problem).toContain(inviteProblemMessage(problem).replace(/'/g, '&#x27;'))
    }
    // A used link offers to sign in, to someone signed out.
    expect(view({ kind: 'unusable', problem: 'used' })).toContain('href="/login"')
    expect(view({ kind: 'unusable', problem: 'used' }, PAT)).not.toContain('href="/login"')
    expect(view({ kind: 'unusable', problem: 'revoked' })).not.toContain('href="/login"')
    expect(view({ kind: 'failed', message: 'Too many tries. Try again in 14 minutes.' })).toContain('Too many tries. Try again in 14 minutes.')
  })

  it('shows who invited you to what, and the form to make an account', () => {
    const markup = view({ kind: 'ready', invite: weddingInvite })
    expect(markup).toContain('Join Rosa &amp; Ben')
    expect(markup).toContain('Olive invited you to Rosa &amp; Ben as an editor.')
    expect(markup).toContain('Create your account')
    expect(markup).toContain('I already have an account')
    expect(markup).not.toContain('readOnly')
    expect(markup).not.toContain('readonly')
    expect(markup).toContain('At least 10 characters.')
    expect(markup).not.toContain(TOKEN)
    expect(view({ kind: 'ready', invite: { ...weddingInvite, role: 'owner' } })).toContain('as an owner.')
  })

  it('fills in and locks the email when the invite is for one address', () => {
    const markup = view({ kind: 'ready', invite: { ...weddingInvite, email: 'kim@example.com' } })
    expect(markup).toMatch(/<input[^>]*readOnly=""[^>]*value="kim@example.com"|<input[^>]*value="kim@example.com"[^>]*readOnly=""/i)
    expect(markup).toContain('This invite is for this email only.')
  })

  it('offers a signed-in person the Accept button, or to sign out when the invite is not for their account', () => {
    const accept = view({ kind: 'ready', invite: weddingInvite }, PAT)
    expect(accept).toContain('You are signed in as <strong class="font-semibold">Pat</strong> (pat@example.com).')
    expect(accept).toContain('Accept invite')
    expect(accept).toContain('Not you? Sign out')
    expect(accept).not.toContain('Create your account')

    // Locked to Pat's email, in another case: still Pat's.
    expect(view({ kind: 'ready', invite: { ...weddingInvite, email: 'PAT@example.com' } }, PAT)).toContain('Accept invite')

    const wrong = view({ kind: 'ready', invite: { ...weddingInvite, email: 'kim@example.com' } }, PAT)
    expect(wrong).toContain('This invite is for kim@example.com.')
    expect(wrong).not.toContain('Accept invite')
    expect(wrong).toContain('Sign out')

    const planner = view({ kind: 'ready', invite: plannerInvite }, PAT)
    expect(planner).toContain('Make your account')
    expect(planner).toContain('Ada invited you to plan weddings with Something Blueprint.')
    expect(planner).toContain('This invite makes a new account.')
    expect(planner).not.toContain('Accept invite')
  })
})

describe('the invite and reset pages never put the token in an address', () => {
  const read = (file: string) => readFileSync(path.join(__dirname, '..', file), 'utf8')
  const files = ['invite/InviteScreen.tsx', 'reset/ResetForm.tsx']

  it('read the token from the fragment and send it only through the typed calls', () => {
    for (const file of files) {
      const source = read(file)
      expect(source, file).toMatch(/useLinkToken\(\)/)
      expect(source, file).not.toMatch(/\bfetch\s*\(/)
      expect(source, file).not.toMatch(/location\.(href|assign|replace|search)|window\.open\(/)
      expect(source, file).not.toMatch(/searchParams|URLSearchParams/)
      // A token never sits inside a template string or a path.
      expect(source, file).not.toMatch(/`[^`]*\$\{token\}[^`]*`/)
    }
  })

  it('go only to fixed places: the wedding the server named (checked), home, the sign-in page', () => {
    const invite = read('invite/InviteScreen.tsx')
    expect([...invite.matchAll(/router\.(?:push|replace)\((.+)\)\s*$/gm)].map((m) => m[1])).toEqual(['afterInvitePath(redirect)'])
    expect([...invite.matchAll(/href=(\{[^}]*\}|"[^"]*")/g)].map((m) => m[1])).toEqual(['"/login"'])
    const reset = read('reset/ResetForm.tsx')
    expect(reset).not.toMatch(/router\.(push|replace)\(/)
    expect([...reset.matchAll(/history\.\w+\(([^)]*)\)/g)].map((m) => m[1])).toEqual([`null, '', '/reset'`])
    expect([...reset.matchAll(/href=(\{[^}]*\}|"[^"]*")/g)].map((m) => m[1])).toEqual(['"/login"'])
  })
})
