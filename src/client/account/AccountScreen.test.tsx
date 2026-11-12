import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AccountSession } from '@/shared/accounts-api'
import { AccountScreen } from './AccountScreen'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

const session = (id: string, userAgent: string | null, current: boolean): AccountSession => ({
  id,
  userAgent,
  createdAt: '2026-11-01T12:00:00.000Z',
  lastSeenAt: '2026-11-11T12:00:00.000Z',
  current,
})

const account = { id: '11111111-1111-4111-8111-111111111111', email: 'pat@example.com', displayName: 'Pat' }

function render(sessions: AccountSession[]): string {
  return renderToStaticMarkup(<AccountScreen account={account} initialSessions={sessions} />)
}

describe('AccountScreen', () => {
  it('shows your name, the password form and each device, marking this one', () => {
    const markup = render([session('a', CHROME_WINDOWS, true), session('b', SAFARI_IPHONE, false)])
    expect(markup).toContain('value="Pat"')
    expect(markup).toContain('You sign in as pat@example.com.')
    expect(markup).toContain('Current password')
    expect(markup).toContain('Confirm new password')
    expect(markup).toContain('Chrome on Windows<span class="font-normal text-stone-600"> · This device</span>')
    expect(markup).toContain('Safari on iPhone')
    // Only the other device gets a Sign out button, and there is one for everywhere else.
    expect(markup.match(/>Sign out<\/button>/g)).toHaveLength(1)
    expect(markup).toContain('Sign out everywhere else')
    expect(markup).not.toContain('Mozilla/5.0')
  })

  it('offers nothing to sign out when this is the only device', () => {
    const markup = render([session('a', null, true)])
    expect(markup).toContain('Unknown browser')
    expect(markup).not.toContain('>Sign out</button>')
    expect(markup).not.toContain('Sign out everywhere else')
  })
})
