/**
 * Where this browser keeps a signed-in user's unsaved edits, and the old
 * shared places they lived before accounts.
 *
 * Each user has two IndexedDB databases of their own: their layout drafts
 * (outbox.ts) and their queued guest and group edits (row-save.ts). On a
 * shared device the next person to sign in opens their own, so they never see
 * or send the previous person's edits. Signing out deletes the user's two
 * databases (src/client/sign-out.ts); a session that merely ran out keeps
 * them, so the edits go out once the same person signs in again.
 *
 * Device preferences (the camera per layout, Edit or View, the mouse wheel
 * setting, the venue unit) stay shared by everyone on the device.
 */

/** idb-keyval keeps one object store per database; these are their names. */
export const DRAFT_STORE_NAME = 'drafts'
export const ROW_STORE_NAME = 'rows'

/** A user's layout drafts. */
export function draftDbName(userId: string): string {
  return `seat-plan-u-${userId}`
}

/** A user's queued guest and group edits. */
export function rowDbName(userId: string): string {
  return `seat-plan-rows-u-${userId}`
}

/** The databases every person on the device shared before accounts (legacy-drafts.ts moves them). */
export const LEGACY_DRAFT_DB_NAME = 'seat-plan'
export const LEGACY_ROW_DB_NAME = 'seat-plan-rows'

/** The editor's copied items (src/client/editor/clipboard.ts): cleared on sign-out, as it can hold guest names. */
export const CLIPBOARD_STORAGE_KEY = 'seat-plan:clipboard'

/** The Noa / Aiden switch's old choice, removed wherever it is still found. */
export const LEGACY_AUTHOR_KEY = 'seat-plan:author'
