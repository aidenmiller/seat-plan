'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * What the signed-in person may do in the wedding they have open, as the
 * wedding layouts hand it down. This only decides what the screens show: the
 * server refuses an owner-only change from an editor on its own (403).
 */
export type WeddingAccessValue = { role: 'owner' | 'editor'; viaAdmin: boolean }

/** The check the wedding layouts ran (requireWeddingPage), cut to what the screens need. */
export type WeddingAccessSource = { role: 'owner' | 'editor' | null; viaAdmin: boolean; user: { isAdmin: boolean } }

/**
 * An admin acts as an owner in every wedding, member or not; a member acts
 * with their own role. Nobody else gets this far (they see the 404 page).
 */
export function weddingAccessValue(access: WeddingAccessSource): WeddingAccessValue {
  return { role: access.user.isAdmin ? 'owner' : (access.role ?? 'owner'), viaAdmin: access.viaAdmin }
}

const WeddingAccessContext = createContext<WeddingAccessValue | null>(null)

/** Wraps a wedding's screens. */
export function WeddingAccessProvider({ access, children }: { access: WeddingAccessValue; children: ReactNode }) {
  return <WeddingAccessContext value={access}>{children}</WeddingAccessContext>
}

/** The role and admin flag for this wedding. Only for components inside WeddingAccessProvider. */
export function useWeddingAccess(): WeddingAccessValue {
  const access = useContext(WeddingAccessContext)
  if (!access) throw new Error('useWeddingAccess needs WeddingAccessProvider')
  return access
}

/** True for an owner (and an admin): wedding settings, backup, deleting the wedding and share links. */
export function useCanManageWedding(): boolean {
  return useWeddingAccess().role === 'owner'
}

/**
 * A slim strip for an admin who is looking at a wedding they are not a member
 * of. It sits above the wedding's header, or above the editor's top bar, and
 * never takes the place of either.
 */
export function AdminViewBanner() {
  const { viaAdmin } = useWeddingAccess()
  if (!viaAdmin) return null
  return (
    <p
      role="note"
      data-testid="admin-view-banner"
      className="shrink-0 border-b border-amber-300 bg-amber-100 px-3 py-1 text-center text-xs leading-snug text-amber-950"
    >
      Admin view: you are not a member of this wedding. Changes are logged.
    </p>
  )
}
