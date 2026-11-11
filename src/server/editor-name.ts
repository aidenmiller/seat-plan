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
