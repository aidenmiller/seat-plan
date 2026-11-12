import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AdminUser, AdminWedding, InviteSummary } from '@/shared/accounts-api'
import type { AdminOverview, AdminVenue } from '@/shared/admin-api'
import { AdminOverviewScreen } from './AdminOverviewScreen'
import { AdminUsersScreen } from './AdminUsersScreen'
import { AdminVenuesScreen } from './AdminVenuesScreen'
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
      stats={{ [PIP]: { owned: 2, editing: 1, edits7: 3, edits30: 41, aiImports30: 4 } }}
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
    expect(kit).toContain('never signed in')
  })

  it('shows each person’s weddings, edits and AI imports, and zeros for someone with none', () => {
    const pip = row(markup, PIP)
    expect(pip).toContain('2 owned')
    expect(pip).toContain('1 as editor')
    expect(pip).toMatch(/data-testid="admin-user-edits">3 \/ 41</)
    expect(pip).toMatch(/data-testid="admin-user-ai-imports">4</)
    const kit = row(markup, KIT)
    expect(kit).toMatch(/data-testid="admin-user-weddings"><span class="text-stone-500">None</)
    expect(kit).toMatch(/data-testid="admin-user-edits">0 \/ 0</)
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
  const markup = renderToStaticMarkup(
    <AdminWeddingsScreen
      initialWeddings={[owned, ownerless, deleted]}
      stats={{
        [owned.id]: {
          lastEdited: { at: '2026-11-11T12:00:00.000Z', by: 'Kit', source: 'activity' },
          edits30: 57,
          shareLinks: { active: 2, lastOpenedAt: null },
        },
      }}
    />,
  )

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
    expect(first).toContain(`href="/admin/weddings/${owned.id}"`)
    expect(first).not.toContain('Claim')
    // Last edited by whom, edits in 30 days, share links.
    expect(first).toContain('by Kit')
    expect(first).toMatch(/data-testid="admin-wedding-edits">57</)
    expect(first).toContain('2 on')
    expect(first).toContain('never opened')

    const second = weddingRow(ownerless.id)
    expect(second).toContain('No owner')
    expect(second).toContain('Claim')
    expect(second).toContain('Open')
    expect(second).toContain('Never')
    expect(second).toMatch(/data-testid="admin-wedding-edits">0</)
  })

  it('lists deleted weddings apart, with Undelete and no Open', () => {
    const heading = markup.indexOf('Deleted weddings')
    expect(heading).toBeGreaterThan(markup.indexOf(`data-wedding-id="${ownerless.id}"`))
    expect(markup.indexOf(`data-wedding-id="${deleted.id}"`)).toBeGreaterThan(heading)
    const third = weddingRow(deleted.id)
    expect(third).not.toContain('Open')
    expect(third).toContain('Undelete')
    expect(third).toContain('Claim')
  })
})

describe('AdminOverviewScreen', () => {
  const overview: AdminOverview = {
    totals: {
      people: { active: 4, off: 1, admins: 1 },
      weddings: { live: 3, deleted: 1 },
      guests: 412,
      layouts: 9,
      venues: { library: 2, private: 3, noOwner: 1 },
      shareLinks: 2,
    },
    days: [
      { day: '2026-11-11', edits: 12, signIns: 2 },
      { day: '2026-11-10', edits: 0, signIns: 0 },
      { day: '2026-11-09', edits: 30, signIns: 1 },
    ],
  }
  const markup = renderToStaticMarkup(<AdminOverviewScreen overview={overview} />)

  it('shows the totals', () => {
    expect(markup).toMatch(/data-testid="total-people-value">5</)
    expect(markup).toContain('4 active, 1 turned off, 1 admin')
    expect(markup).toMatch(/data-testid="total-weddings-value">3</)
    expect(markup).toContain('1 deleted')
    expect(markup).toMatch(/data-testid="total-guests-value">412</)
    expect(markup).toMatch(/data-testid="total-venues-value">6</)
    expect(markup).toContain('2 in the library, 3 private, 1 with no owner')
    expect(markup).toMatch(/data-testid="total-share-links-value">2</)
  })

  it('lists the days with activity in a table, and draws every day in the strip', () => {
    expect(markup).toContain('42 edits and 3 sign-ins')
    expect(markup).toContain('data-day="2026-11-11"')
    expect(markup).toContain('data-day="2026-11-09"')
    expect(markup).not.toContain('data-day="2026-11-10"')
    expect(markup).toContain('Wed, Nov 11')
    expect(markup.match(/<title>/g)).toHaveLength(3)
    expect(markup).toContain('Busiest day: 30 edits')
  })
})

describe('AdminVenuesScreen', () => {
  const venue = (id: string, name: string, extra: Partial<AdminVenue>): AdminVenue => ({
    id,
    name,
    status: 'private',
    isLibrary: false,
    owner: { id: PIP, displayName: 'Pip' },
    importedBy: 'hand',
    layouts: 0,
    weddings: 0,
    updatedAt: '2026-11-10T12:00:00.000Z',
    ...extra,
  })
  const library = venue('a1111111-1111-4111-8111-111111111111', 'Beach Club', { status: 'library', isLibrary: true, owner: null, layouts: 3, weddings: 2 })
  const mine = venue('a2222222-2222-4222-8222-222222222222', 'Pip hall', { layouts: 1, weddings: 1 })
  const old = venue('a3333333-3333-4333-8333-333333333333', 'Old hall', { status: 'no-owner', owner: null })
  const markup = renderToStaticMarkup(<AdminVenuesScreen initialVenues={[library, mine, old]} people={[]} />)

  function venueRow(id: string): string {
    const start = markup.indexOf(`data-venue-id="${id}"`)
    return markup.slice(start, markup.indexOf('</tr>', start))
  }

  it('shows where each venue is, its owner and its use, with the library action that fits', () => {
    const first = venueRow(library.id)
    expect(first).toContain('>Library<')
    expect(first).toContain('Nobody')
    expect(first).toContain('3 layouts in 2 weddings')
    expect(first).toContain('Remove from library')
    expect(first).toContain(`href="/venues/${library.id}"`)

    const second = venueRow(mine.id)
    expect(second).toContain('>Private<')
    expect(second).toContain('>Pip<')
    expect(second).toContain('1 layout in 1 wedding')
    expect(second).toContain('Add to library')

    const third = venueRow(old.id)
    expect(third).toContain('No owner')
    expect(third).toContain('Not used')
    expect(third).toContain('Change owner')
  })
})
