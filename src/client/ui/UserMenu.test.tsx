import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CurrentUserProvider, type CurrentUser } from '../current-user'
import { UserMenu, userInitial, userMenuItems } from './UserMenu'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const DAYNA: CurrentUser = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Dayna', email: 'dayna@example.com', isAdmin: false }

function render(user: CurrentUser, compact = false) {
  return renderToStaticMarkup(
    <CurrentUserProvider user={user}>
      <UserMenu compact={compact} />
    </CurrentUserProvider>,
  )
}

describe('UserMenu', () => {
  it('shows the signed-in person as their initial, with their name beside it on wider screens', () => {
    const html = render(DAYNA)
    expect(html).toContain('aria-label="Signed in as Dayna. Account menu"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toMatch(/data-testid="user-initial"[^>]*>D</)
    expect(html).toMatch(/class="hidden[^"]*sm:inline"[^>]*>Dayna</)
    // Closed: no menu in the page.
    expect(html).not.toContain('role="menu"')
  })

  it('shows only the initial in the editors’ top bars', () => {
    const html = render(DAYNA, true)
    expect(html).toMatch(/data-testid="user-initial"[^>]*>D</)
    expect(html).not.toMatch(/>Dayna</)
  })

  it('is a 44 px target', () => {
    expect(render(DAYNA)).toMatch(/data-testid="user-menu"[^>]*class="[^"]*min-h-11 min-w-11/)
  })

  it('offers Account and Log out to everyone, and Admin only to admins', () => {
    const go = vi.fn()
    const signOut = vi.fn()
    const plain = userMenuItems(DAYNA, { go, signOut })
    expect(plain.map((i) => i.label)).toEqual(['Account', 'Log out'])
    const admin = userMenuItems({ ...DAYNA, isAdmin: true }, { go, signOut })
    expect(admin.map((i) => i.label)).toEqual(['Account', 'Admin', 'Log out'])
    admin[0]!.onSelect()
    admin[1]!.onSelect()
    admin[2]!.onSelect()
    expect(go.mock.calls).toEqual([['/account'], ['/admin/users']])
    expect(signOut).toHaveBeenCalledTimes(1)
    // While signing out, Log out says so and cannot be pressed again.
    expect(userMenuItems(DAYNA, { go, signOut }, true).at(-1)).toMatchObject({ label: 'Logging out…', disabled: true })
  })

  it('takes the first letter of any name', () => {
    expect(userInitial('dayna')).toBe('D')
    expect(userInitial('  Émile ')).toBe('É')
    expect(userInitial('🎂 Cake')).toBe('🎂')
    expect(userInitial('')).toBe('?')
  })
})
