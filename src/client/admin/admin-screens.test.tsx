import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AdminUser, AdminWedding, InviteSummary } from '@/shared/accounts-api'
import { AdminUsersScreen } from './AdminUsersScreen'
import { AdminWeddingsScreen } from './AdminWeddingsScreen'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('@/client/ui/Dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
  DialogActions: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

const ADA = '11111111-1111-4111-8111-111111111111'
const PIP = '22222222-2222-4222-8222-222222222222'
const KIT = '33333333-3333-4333-8333-333333333333'

const user = (id: string, displayName: string, extra: Partial<AdminUser> = {}): AdminUser => ({
  id,
  email: `${displayName.toLowerCase()}@example.com`,
  displayName,
  isAdmin: false,
  disabled: false,
  createdAt: '2026-10-01T12:00:00.000Z',
  disabledAt: null,
  lastLoginAt: '2026-11-10T12:00:00.000Z',
  lastSeenAt: '2026-11-11T12:00:00.000Z',
  weddingCount: 1,
  ...extra,
})

const plannerInvite: InviteSummary = {
  id: '55555555-5555-4555-8555-555555555555',
  weddingId: null,
  role: null,
  email: null,
  note: null,
  invitedBy: { id: ADA, name: 'Ada' },
  acceptedBy: null,
  state: 'pending',
  createdAt: '2026-11-10T12:00:00.000Z',
  expiresAt: '2026-11-17T12:00:00.000Z',
  acceptedAt: null,
}

/** The markup of one table row, found by the user's id. */
function row(markup: string, id: string): string {
  const start = markup.indexOf(`data-user-id="${id}"`)
  return markup.slice(start, markup.indexOf('</tr>', start))
}

describe('AdminUsersScreen', () => {
  const markup = renderToStaticMarkup(
    <AdminUsersScreen
      meId={ADA}
      initialUsers={[
        user(ADA, 'Ada', { isAdmin: true }),
        user(PIP, 'Pip'),
        user(KIT, 'Kit', { disabled: true, disabledAt: '2026-11-11T10:00:00.000Z', lastLoginAt: null }),
      ]}
      initialInvites={[plannerInvite]}
    />,
  )

  it('lists everyone with their status, and never offers to turn off or sign out your own account', () => {
    const me = row(markup, ADA)
    expect(me).toContain('Ada<span class="font-normal text-stone-600"> (you)</span>')
    expect(me).toContain('Admin')
    expect(me).not.toContain('Turn off')
    expect(me).not.toContain('Sign out everywhere')
    expect(me).toContain('Reset link')

    const pip = row(markup, PIP)
    expect(pip).toContain('Active')
    expect(pip).toContain('Turn off')
    expect(pip).toContain('Sign out everywhere')

    const kit = row(markup, KIT)
    expect(kit).toContain('Turned off')
    expect(kit).toContain('Turn on')
    expect(kit).toContain('Never')
  })

  it('invites new planners and lists the invites nobody has used', () => {
    expect(markup).toContain('Invite a new planner')
    expect(markup).toContain('Planner invite')
    expect(markup).toContain('For anyone with the link')
    expect(markup).toContain('Made by Ada')
  })
})

describe('AdminWeddingsScreen', () => {
  const wedding = (id: string, name: string, extra: Partial<AdminWedding> = {}): AdminWedding => ({
    id,
    name,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-11-10T12:00:00.000Z',
    deletedAt: null,
    guestCount: 120,
    layoutCount: 2,
    members: [],
    ...extra,
  })
  const owned = wedding('66666666-6666-4666-8666-666666666666', 'Rosa & Ben', {
    members: [
      { userId: PIP, displayName: 'Pip', email: 'pip@example.com', role: 'owner' },
      { userId: KIT, displayName: 'Kit', email: 'kit@example.com', role: 'editor' },
    ],
  })
  const ownerless = wedding('77777777-7777-4777-8777-777777777777', 'Mia & Leo')
  const deleted = wedding('88888888-8888-4888-8888-888888888888', 'Old one', { deletedAt: '2026-11-01T12:00:00.000Z' })
  const markup = renderToStaticMarkup(<AdminWeddingsScreen initialWeddings={[owned, ownerless, deleted]} />)

  function weddingRow(id: string): string {
    const start = markup.indexOf(`data-wedding-id="${id}"`)
    return markup.slice(start, markup.indexOf('</tr>', start))
  }

  it('shows owners, people and counts, with Open for live weddings and Claim only where there is no owner', () => {
    const first = weddingRow(owned.id)
    expect(first).toContain('Rosa &amp; Ben')
    expect(first).toContain('>Pip<')
    expect(first).toContain('>2<')
    expect(first).toContain('>120<')
    expect(first).toContain(`href="/w/${owned.id}/layouts"`)
    expect(first).not.toContain('Claim')

    const second = weddingRow(ownerless.id)
    expect(second).toContain('No owner')
    expect(second).toContain('Claim')
    expect(second).toContain('Open')

    const third = weddingRow(deleted.id)
    expect(third).toContain('Deleted')
    expect(third).not.toContain('Open')
    expect(third).toContain('Claim')
  })
})
