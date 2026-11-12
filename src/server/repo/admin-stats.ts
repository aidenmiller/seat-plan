import 'server-only'
import { sql, type SQL } from 'drizzle-orm'
import { ADMIN_TIME_ZONE } from '@/domain/activity'
import type { AdminActivity, AdminDay, AdminOverview, AdminPersonStats, AdminPick, AdminTotals, AdminWeddingStats } from '@/shared/admin-api'
import type { Db } from '../locks'

/**
 * The numbers on the admin pages. Only admins reach these (the admin pages
 * check). Edits are the sum of the hourly usage counters (activity_events
 * rows whose kind starts "write.", detail { count }); sign-ins are the login
 * events. Days are days in ADMIN_TIME_ZONE.
 *
 * Plain SQL with explicit table names throughout, as in weddings.ts. Times
 * come back as ISO text (iso() below), so they read the same whatever the
 * driver does with timestamps.
 */

const DAY_MS = 86_400_000

const iso = (column: SQL) => sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`

const since = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS).toISOString()

/** The overview's totals, and edits and sign-ins for each of the last 30 days (newest first, days with nothing included). */
export async function adminOverview(db: Db, now = new Date()): Promise<AdminOverview> {
  const totals = await db.execute<{
    active: number
    off: number
    admins: number
    live_weddings: number
    deleted_weddings: number
    guests: number
    layouts: number
    library: number
    private: number
    no_owner: number
    share_links: number
  }>(sql`
    select
      (select count(*)::int from "users" where "disabled_at" is null) as active,
      (select count(*)::int from "users" where "disabled_at" is not null) as off,
      (select count(*)::int from "users" where "is_admin" and "disabled_at" is null) as admins,
      (select count(*)::int from "weddings" where "deleted_at" is null) as live_weddings,
      (select count(*)::int from "weddings" where "deleted_at" is not null) as deleted_weddings,
      (select count(*)::int from "guests" g join "weddings" w on w."id" = g."wedding_id"
        where g."deleted_at" is null and w."deleted_at" is null) as guests,
      (select count(*)::int from "layouts" l join "weddings" w on w."id" = l."wedding_id"
        where l."deleted_at" is null and w."deleted_at" is null) as layouts,
      (select count(*)::int from "venue_templates" where "deleted_at" is null and "is_library") as library,
      (select count(*)::int from "venue_templates"
        where "deleted_at" is null and not "is_library" and "owner_user_id" is not null) as private,
      (select count(*)::int from "venue_templates"
        where "deleted_at" is null and not "is_library" and "owner_user_id" is null) as no_owner,
      (select count(*)::int from "share_links" s
        join "layouts" l on l."id" = s."layout_id" and l."wedding_id" = s."wedding_id"
        join "weddings" w on w."id" = s."wedding_id"
        where s."revoked_at" is null and l."deleted_at" is null and w."deleted_at" is null) as share_links
  `)
  const t = totals.rows[0]!
  const summary: AdminTotals = {
    people: { active: Number(t.active), off: Number(t.off), admins: Number(t.admins) },
    weddings: { live: Number(t.live_weddings), deleted: Number(t.deleted_weddings) },
    guests: Number(t.guests),
    layouts: Number(t.layouts),
    venues: { library: Number(t.library), private: Number(t.private), noOwner: Number(t.no_owner) },
    shareLinks: Number(t.share_links),
  }
  return { totals: summary, days: await activityByDay(db, now, 30) }
}

/** Edits and sign-ins per day in ADMIN_TIME_ZONE, for the `days` days up to and including today there, newest first. */
export async function activityByDay(db: Db, now: Date, days: number): Promise<AdminDay[]> {
  const result = await db.execute<{ day: string; edits: number; sign_ins: number }>(sql`
    with today as (select (${now.toISOString()}::timestamptz at time zone ${ADMIN_TIME_ZONE})::date as d),
    days as (
      select (today.d - n)::date as day from today, generate_series(0, ${days - 1}::int) as n
    ),
    events as (
      select (e."occurred_at" at time zone ${ADMIN_TIME_ZONE})::date as day, e."kind", e."detail"
      from "activity_events" e
      where (e."kind" like 'write.%' or e."kind" = 'login')
        and e."occurred_at" >= ${since(now, days + 1)}::timestamptz
    )
    select to_char(days.day, 'YYYY-MM-DD') as day,
      coalesce(sum((events."detail" ->> 'count')::int) filter (where events."kind" like 'write.%'), 0)::int as edits,
      (count(*) filter (where events."kind" = 'login'))::int as sign_ins
    from days left join events on events.day = days.day
    group by days.day
    order by days.day desc
  `)
  return result.rows.map((r) => ({ day: r.day, edits: Number(r.edits), signIns: Number(r.sign_ins) }))
}

/**
 * For every wedding (deleted ones too), by id: the last edit and who made it,
 * edits in the last 30 days, and its share links. The last edit comes from
 * the usage counters, which name the signed-in person and cover every kind of
 * change; a wedding with no counted change yet (from before the counters)
 * falls back to its newest live layout's save. With `weddingId`, that one only.
 */
export async function weddingStats(db: Db, now = new Date(), weddingId?: string): Promise<Record<string, AdminWeddingStats>> {
  const result = await db.execute<{
    id: string
    edits30: number
    edit_at: string | null
    edit_by: string | null
    layout_at: string | null
    layout_by: string | null
    links: number
    last_opened: string | null
  }>(sql`
    select w."id",
      (select coalesce(sum((e."detail" ->> 'count')::int), 0)::int from "activity_events" e
        where e."wedding_id" = w."id" and e."kind" like 'write.%' and e."occurred_at" > ${since(now, 30)}::timestamptz) as edits30,
      ${iso(sql`le."occurred_at"`)} as edit_at, le."display_name" as edit_by,
      ${iso(sql`ll."updated_at"`)} as layout_at, ll."edited_by_name" as layout_by,
      (select count(*)::int from "share_links" s
        join "layouts" l on l."id" = s."layout_id" and l."wedding_id" = s."wedding_id"
        where s."wedding_id" = w."id" and s."revoked_at" is null and l."deleted_at" is null) as links,
      (select ${iso(sql`max(s."last_opened_at")`)} from "share_links" s where s."wedding_id" = w."id") as last_opened
    from "weddings" w
    left join lateral (
      select e."occurred_at", u."display_name" from "activity_events" e
      left join "users" u on u."id" = e."user_id"
      where e."wedding_id" = w."id" and e."kind" like 'write.%'
      order by e."occurred_at" desc limit 1
    ) le on true
    left join lateral (
      select l."updated_at", l."edited_by_name" from "layouts" l
      where l."wedding_id" = w."id" and l."deleted_at" is null
      order by l."updated_at" desc limit 1
    ) ll on true
    ${weddingId === undefined ? sql`` : sql`where w."id" = ${weddingId}`}
  `)
  const out: Record<string, AdminWeddingStats> = {}
  for (const r of result.rows) {
    const lastEdited: AdminWeddingStats['lastEdited'] = r.edit_at
      ? { at: r.edit_at, by: r.edit_by, source: 'activity' }
      : r.layout_at
        ? { at: r.layout_at, by: r.layout_by, source: 'layout' }
        : null
    out[r.id] = {
      lastEdited,
      edits30: Number(r.edits30),
      shareLinks: { active: Number(r.links), lastOpenedAt: r.last_opened },
    }
  }
  return out
}

/** For everyone, by id: live weddings they own and edit, their edits in the last 7 and 30 days, and their AI imports in the last 30. */
export async function personStats(db: Db, now = new Date()): Promise<Record<string, AdminPersonStats>> {
  const result = await db.execute<{ id: string; owned: number; editing: number; edits7: number; edits30: number; ai30: number }>(sql`
    select u."id",
      (select count(*)::int from "wedding_members" m join "weddings" w on w."id" = m."wedding_id"
        where m."user_id" = u."id" and m."role" = 'owner' and w."deleted_at" is null) as owned,
      (select count(*)::int from "wedding_members" m join "weddings" w on w."id" = m."wedding_id"
        where m."user_id" = u."id" and m."role" = 'editor' and w."deleted_at" is null) as editing,
      (select coalesce(sum((e."detail" ->> 'count')::int), 0)::int from "activity_events" e
        where e."user_id" = u."id" and e."kind" like 'write.%' and e."occurred_at" > ${since(now, 7)}::timestamptz) as edits7,
      (select coalesce(sum((e."detail" ->> 'count')::int), 0)::int from "activity_events" e
        where e."user_id" = u."id" and e."kind" like 'write.%' and e."occurred_at" > ${since(now, 30)}::timestamptz) as edits30,
      (select count(*)::int from "activity_events" e
        where e."user_id" = u."id" and e."kind" = 'venue.ai_import' and e."occurred_at" > ${since(now, 30)}::timestamptz) as ai30
    from "users" u
  `)
  const out: Record<string, AdminPersonStats> = {}
  for (const r of result.rows) {
    out[r.id] = {
      owned: Number(r.owned),
      editing: Number(r.editing),
      edits7: Number(r.edits7),
      edits30: Number(r.edits30),
      aiImports30: Number(r.ai30),
    }
  }
  return out
}

/** The newest events about one wedding, newest first. */
export async function weddingActivity(db: Db, weddingId: string, limit = 50): Promise<AdminActivity[]> {
  const result = await db.execute<{
    id: string
    at: string
    kind: string
    user_id: string | null
    user_name: string | null
    detail: Record<string, unknown>
  }>(sql`
    select e."id", ${iso(sql`e."occurred_at"`)} as at, e."kind", e."user_id", u."display_name" as user_name, e."detail"
    from "activity_events" e
    left join "users" u on u."id" = e."user_id"
    where e."wedding_id" = ${weddingId}
    order by e."occurred_at" desc, e."id"
    limit ${limit}
  `)
  return result.rows.map((r) => {
    const detail = r.detail ?? {}
    const count = r.kind.startsWith('write.') && typeof detail.count === 'number' ? detail.count : null
    return { id: r.id, at: r.at, kind: r.kind, userId: r.user_id, userName: r.user_name, count, write: detail.write === true }
  })
}

/** Everyone, by name, for the admin's pickers. */
export async function adminPicks(db: Db): Promise<AdminPick[]> {
  const result = await db.execute<{ id: string; display_name: string; email: string; disabled: boolean }>(sql`
    select "id", "display_name", "email", "disabled_at" is not null as disabled
    from "users" order by lower("display_name"), "email", "id"
  `)
  return result.rows.map((r) => ({ id: r.id, displayName: r.display_name, email: r.email, disabled: r.disabled }))
}
