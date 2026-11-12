import 'server-only'
import { eq } from 'drizzle-orm'
import { weddingMembers } from '../db/schema'
import type { Db } from '../locks'
import type { Role } from './access'

/** The user's own role in each wedding they belong to, by wedding id (the home page shows it on each card). */
export async function memberRoles(db: Db, userId: string): Promise<Map<string, Role>> {
  const rows = await db
    .select({ weddingId: weddingMembers.weddingId, role: weddingMembers.role })
    .from(weddingMembers)
    .where(eq(weddingMembers.userId, userId))
  return new Map(rows.map((r) => [r.weddingId, r.role]))
}
