import 'server-only'
import { asc, isNull, sql } from 'drizzle-orm'
import type { VenueSummary } from '@/shared/api'
import { venueTemplates } from '../db/schema'
import type { Db } from '../locks'

/** Live venue templates (shared by all weddings, PLAN change 5), by name. */
export async function listVenues(db: Db): Promise<VenueSummary[]> {
  const rows = await db
    .select({
      id: venueTemplates.id,
      name: venueTemplates.name,
      updatedAt: venueTemplates.updatedAt,
      // Explicit table names: in a select from one table, drizzle prints
      // columns inside sql`` without their table.
      usedBy: sql<number>`(
        select count(*)::int from "layouts" l
        join "weddings" w on w."id" = l."wedding_id"
        where l."venue_template_id" = "venue_templates"."id"
          and l."deleted_at" is null
          and w."deleted_at" is null
      )`,
    })
    .from(venueTemplates)
    .where(isNull(venueTemplates.deletedAt))
    .orderBy(asc(sql`lower(${venueTemplates.name})`), asc(venueTemplates.id))
  return rows.map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt.toISOString(), usedBy: Number(r.usedBy) }))
}
