import 'server-only'
import { sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

/**
 * Who last edited a layout or venue template, as a display name. The new
 * edited_by_name column holds any name; the old edited_by column only ever
 * held 'Noa' or 'Aiden'. Rows written before the accounts change have only the
 * old one, so read the new column and fall back to it.
 */
export const editorName = (t: { editedBy: PgColumn; editedByName: PgColumn }) =>
  sql<string | null>`coalesce(${t.editedByName}, ${t.editedBy})`

/**
 * Who made a write: the signed-in user, from the session. Request bodies
 * never name the editor. Writes store both columns (edited_by_user_id and
 * edited_by_name) and clear the old edited_by.
 */
export type Editor = { userId: string; name: string }

/** A write that knows only a name: a layout restored from a backup keeps the name the file gives, with no user. */
export type NamedEditor = { userId: null; name: string | null }

/** The route guard's user as the editor of a write. */
export function editorOf(user: { id: string; displayName: string }): Editor {
  return { userId: user.id, name: user.displayName }
}
