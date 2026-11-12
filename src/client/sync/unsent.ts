/**
 * What a user's databases on this device still hold that the server may not
 * have: layout drafts with edits (or with a save that never answered), and
 * queued guest and group edits. Signing out reads this before it deletes
 * those databases (src/client/sign-out.ts), so it can say what would be lost,
 * whoever left it there: this tab, a tab that is closed, crashed or frozen,
 * or a move of edits from before accounts.
 *
 * Reading never makes a database. A database that is there but cannot be
 * read rejects: what it holds is unknown, and the caller must not take that
 * as nothing.
 */
import { readExistingStore } from './idb'
import { isDraftSnapshot } from './outbox'
import { isStoredRow } from './row-save'
import { DRAFT_STORE_NAME, draftDbName, ROW_STORE_NAME, rowDbName } from './storage-names'

export type UnsentOnDevice = {
  /** Layouts with at least one draft holding edits. */
  layouts: number
  /** Guests with queued edits. */
  guests: number
  /** Groups with queued edits. */
  groups: number
}

export async function unsentOnDevice(userId: string): Promise<UnsentOnDevice> {
  if (typeof indexedDB === 'undefined') return { layouts: 0, guests: 0, groups: 0 }
  const [drafts, rows] = await Promise.all([
    readExistingStore(draftDbName(userId), DRAFT_STORE_NAME),
    readExistingStore(rowDbName(userId), ROW_STORE_NAME),
  ])
  const layouts = new Set<string>()
  for (const { value } of drafts) {
    // A draft the app cannot read is never sent, so it is not counted (outbox.ts reports it).
    if (isDraftSnapshot(value) && value.userId === userId && (value.dirty || value.inFlight !== null)) layouts.add(value.layoutId)
  }
  const guests = new Set<string>()
  const groups = new Set<string>()
  for (const { value } of rows) {
    if (!isStoredRow(value) || value.userId !== userId) continue
    ;(value.kind === 'guest' ? guests : groups).add(value.id)
  }
  return { layouts: layouts.size, guests: guests.size, groups: groups.size }
}
