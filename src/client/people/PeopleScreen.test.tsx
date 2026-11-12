import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LAST_OWNER_LEAVE_MESSAGE } from '@/domain/account-wording'
import type { InviteSummary, WeddingMember } from '@/shared/accounts-api'
import { CurrentUserProvider } from '../current-user'
import { WeddingAccessProvider, type WeddingAccessValue } from '../wedding-access'
import { PeopleScreen } from './PeopleScreen'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))
// The real dialog renders into a portal, which needs a browser.
vi.mock('@/client/ui/Dialog', () => ({
  Dialog: ({ open, title, children }: { open: boolean; title: string; children?: ReactNode }) =>
    open ? (
      <div role="dialog" data-title={title}>
        {children}
      </div>
    ) : null,
  DialogActions: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

const WEDDING = '44444444-4444-4444-8444-444444444444'
const OLIVE = '11111111-1111-4111-8111-111111111111'
const EDDIE = '22222222-2222-4222-8222-222222222222'
const ADA = '33333333-3333-4333-8333-333333333333'

const member = (userId: string, displayName: string, role: 'owner' | 'editor'): WeddingMember => ({
  userId,
  email: `${displayName.toLowerCase()}@example.com`,
  displayName,
  role,
  disabled: false,
  addedAt: '2026-11-01T12:00:00.000Z',
})

const members = [member(OLIVE, 'Olive', 'owner'), member(EDDIE, 'Eddie', 'editor')]

const invite: InviteSummary = {
  id: '55555555-5555-4555-8555-555555555555',
  weddingId: WEDDING,
  role: 'editor',
  email: 'kim@example.com',
  note: 'The planner',
  invitedBy: { id: OLIVE, name: 'Olive' },
  acceptedBy: null,
  state: 'pending',
  createdAt: '2026-11-10T12:00:00.000Z',
  expiresAt: '2026-11-17T12:00:00.000Z',
  acceptedAt: null,
}

function render(me: string, access: WeddingAccessValue, list = members, invites: InviteSummary[] = []): string {
  return renderToStaticMarkup(
    <CurrentUserProvider user={{ id: me, displayName: 'Me', email: 'me@example.com', isAdmin: access.viaAdmin }}>
      <WeddingAccessProvider access={access}>
        <PeopleScreen weddingId={WEDDING} initialMembers={list} initialInvites={invites} />
      </WeddingAccessProvider>
    </CurrentUserProvider>,
  )
}

describe('PeopleScreen', () => {
  it('gives an owner the role controls, Remove for everyone else, invites, and pending invites', () => {
    const markup = render(OLIVE, { role: 'owner', viaAdmin: false }, members, [invite])
    expect(markup).toContain('Olive<span class="font-normal text-stone-600"> (you)</span>')
    expect(markup).toContain('aria-label="Role of Olive"')
    expect(markup).toContain('aria-label="Role of Eddie"')
    expect(markup).toContain('aria-label="Remove Eddie"')
    expect(markup).not.toContain('aria-label="Remove Olive"')
    expect(markup).toContain('Invite someone')
    expect(markup).toContain('Invites waiting')
    expect(markup).toContain('Editor invite')
    expect(markup).toContain('For kim@example.com')
    expect(markup).toContain('The planner')
    expect(markup).toContain('Cancel invite')
    expect(markup).not.toContain('people-owners-only')
  })

  it('stops the only owner leaving, with the reason, and lets one of two owners leave', () => {
    const alone = render(OLIVE, { role: 'owner', viaAdmin: false })
    expect(alone).toContain(LAST_OWNER_LEAVE_MESSAGE)
    expect(alone).toMatch(/<button[^>]*disabled=""[^>]*>Leave this wedding<\/button>/)
    const two = render(OLIVE, { role: 'owner', viaAdmin: false }, [...members, member(ADA, 'Ada', 'owner')])
    expect(two).not.toContain(LAST_OWNER_LEAVE_MESSAGE)
    expect(two).toMatch(/<button[^>]*>Leave this wedding<\/button>/)
    expect(two).not.toMatch(/<button[^>]*disabled=""[^>]*>Leave this wedding<\/button>/)
  })

  it('shows an editor the members read only, no invites, and lets them leave', () => {
    const markup = render(EDDIE, { role: 'editor', viaAdmin: false }, members, [])
    expect(markup).toContain('Only owners can invite people or change who is here.')
    expect(markup).toContain('Eddie<span class="font-normal text-stone-600"> (you)</span>')
    expect(markup).not.toContain('Role of')
    expect(markup).not.toContain('Remove')
    expect(markup).not.toContain('Invite someone')
    expect(markup).not.toContain('Invites waiting')
    expect(markup.match(/data-testid="member-role"[^>]*>(Owner|Editor)</g)).toHaveLength(2)
    expect(markup).toMatch(/<button[^>]*>Leave this wedding<\/button>/)
    expect(markup).not.toMatch(/disabled=""[^>]*>Leave this wedding/)
  })

  it('treats an admin who is not a member as an owner, with nothing to leave', () => {
    const markup = render(ADA, { role: 'owner', viaAdmin: true }, members, [])
    expect(markup).toContain('Invite someone')
    expect(markup).toContain('aria-label="Remove Olive"')
    expect(markup).toContain('No invites waiting.')
    expect(markup).not.toContain('Leave this wedding')
    expect(markup).not.toContain('(you)')
  })

  it('says when a member’s account is turned off', () => {
    const markup = render(OLIVE, { role: 'owner', viaAdmin: false }, [members[0]!, { ...members[1]!, disabled: true }])
    expect(markup).toContain('This account is turned off.')
  })
})
