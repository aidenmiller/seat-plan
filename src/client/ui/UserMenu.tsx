'use client'

/**
 * The signed-in person, in the app header and the editors' top bars: a round
 * button with their initial (and their name beside it on wider screens) that
 * opens a small menu with their name and email, Account, Admin (admins only)
 * and Log out. Log out goes through src/client/sign-out.ts, which sends what
 * is waiting first and asks before dropping anything unsaved.
 *
 * The button says who is signed in to screen readers too; the menu takes the
 * arrow keys and Esc (ContextMenu) and gives focus back to the button.
 */
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { markOtherUser } from '../auth-channel'
import { useCurrentUser, type CurrentUser } from '../current-user'
import { SIGN_OUT_FAILED, signOut } from '../sign-out'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'

/** The first letter of the name (a whole emoji or accented letter), upper-cased; "?" for an empty name. */
export function userInitial(displayName: string): string {
  const first = Array.from(displayName.trim())[0]
  return first ? first.toLocaleUpperCase() : '?'
}

/** The menu's items for this person: Account, Admin for admins, Log out. */
export function userMenuItems(
  user: Pick<CurrentUser, 'isAdmin'>,
  actions: { go(path: string): void; signOut(): void },
  signingOut = false,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [{ id: 'account', label: 'Account', onSelect: () => actions.go('/account') }]
  if (user.isAdmin) items.push({ id: 'admin', label: 'Admin', onSelect: () => actions.go('/admin/users') })
  items.push({ id: 'logout', label: signingOut ? 'Logging out…' : 'Log out', onSelect: actions.signOut, disabled: signingOut })
  return items
}

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const user = useCurrentUser()
  const router = useRouter()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The press that closed the menu was on this button: that click must not open it again. */
  const closedByPress = useRef(false)

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 6000)
    return () => clearTimeout(timer)
  }, [error])

  function open() {
    const r = buttonRef.current?.getBoundingClientRect()
    if (!r) return
    // Under the button, lined up with its right edge (the menu moves left when it would run off).
    setAt({ x: r.right, y: r.bottom + 4 })
  }

  async function logOut() {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await signOut(user.id)
    // 'signed-out' is leaving the page.
    if (result === 'signed-out') return
    setBusy(false)
    if (result === 'failed') setError(SIGN_OUT_FAILED)
    if (result === 'other-user') markOtherUser()
  }

  const items = userMenuItems(user, { go: (path) => router.push(path), signOut: () => void logOut() }, busy)
  const initial = userInitial(user.displayName)

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={at !== null}
        aria-label={`Signed in as ${user.displayName}. Account menu`}
        title={user.displayName}
        data-testid="user-menu"
        onPointerDown={() => {
          closedByPress.current = at !== null
        }}
        onClick={() => {
          if (closedByPress.current) {
            closedByPress.current = false
            return
          }
          if (at) setAt(null)
          else open()
        }}
        className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium text-stone-800 outline-none hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-blue-700/50 ${
          compact ? '' : 'sm:rounded-lg sm:pl-1.5 sm:pr-3'
        }`}
      >
        <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-900 text-sm font-semibold text-white" data-testid="user-initial">
          {initial}
        </span>
        {!compact && (
          <span className="hidden max-w-40 truncate sm:inline" aria-hidden="true">
            {user.displayName}
          </span>
        )}
      </button>
      <ContextMenu
        at={at}
        items={items}
        label={`Account menu for ${user.displayName}`}
        onClose={() => setAt(null)}
        returnFocus={buttonRef}
        testId="user-menu-panel"
        header={
          <>
            <p className="truncate text-sm font-semibold text-stone-900" data-testid="user-menu-name">
              {user.displayName}
            </p>
            <p className="truncate text-sm text-stone-600" data-testid="user-menu-email">
              {user.email}
            </p>
          </>
        }
      />
      {error && (
        <p role="alert" className="fixed right-4 top-16 z-50 max-w-[calc(100vw-32px)] rounded-lg bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">
          {error}
        </p>
      )}
    </>
  )
}
