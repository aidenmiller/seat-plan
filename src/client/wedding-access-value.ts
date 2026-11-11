/**
 * What the signed-in person may do in the wedding they have open, as the
 * wedding layouts hand it down (src/client/wedding-access.tsx). This only
 * decides what the screens show: the server refuses an owner-only change from
 * an editor on its own (403).
 *
 * Kept apart from the context file because that one is a client module, and a
 * server component cannot call a function exported from a client module.
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
