/**
 * Usage counting for the admin pages. Pure: which route a change went
 * through, what kind of edit that counts as, the key of the hourly counter
 * row it adds to, and the words the admin pages use for each kind of event.
 *
 * Changes are counted per hour, not per request: the layout editor saves
 * every few seconds while someone works, so one row per hour per person per
 * wedding per kind (src/server/repo/activity.ts, countWrite) keeps the log
 * small. Changes that already log an event of their own (signing in, members
 * and invites, making, deleting or restoring a wedding, the AI import) are
 * not counted again.
 */

/** The admin pages show days and times in the couple's and the planners' time zone. */
export const ADMIN_TIME_ZONE = 'America/Toronto'

/** The hourly counters, one per kind of edit. */
export const WRITE_KINDS = [
  'write.layout',
  'write.guests',
  'write.groups',
  'write.rules',
  'write.venue',
  'write.share',
  'write.wedding',
  'write.other',
] as const

export type WriteKind = (typeof WRITE_KINDS)[number]

const WRITE_KIND_SET = new Set<string>(WRITE_KINDS)

export function isWriteKind(kind: string): kind is WriteKind {
  return WRITE_KIND_SET.has(kind)
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A route's own placeholder, as a test may send it: [id], or %5Bid%5D. */
const PLACEHOLDER = /^(\[|%5b)[^/]*(\]|%5d)$/i
/** A long opaque token (a share link's): never kept in a label. */
const TOKEN = /^[A-Za-z0-9_-]{32,}$/

/** Labels are short; a path longer than this is cut. */
const MAX_LABEL = 200

/**
 * "PUT /api/layouts/[id]": the method and the path with every id (a uuid, a
 * placeholder or a long token) written as [id], so every request to one
 * route gets the same label.
 */
export function routeLabel(method: string, pathname: string): string {
  const path = pathname
    .split('?')[0]!
    .split('/')
    .map((segment) => (UUID.test(segment) || PLACEHOLDER.test(segment) || TOKEN.test(segment) ? '[id]' : segment))
    .join('/')
    .replace(/\/+$/, '')
  return `${method.toUpperCase()} ${path || '/'}`.slice(0, MAX_LABEL)
}

/**
 * Which counter a route adds to, first match wins. Null: not counted, because
 * the change logs an event of its own, changes nothing, or is not about a
 * wedding or a venue (accounts, sign-in, the admin pages).
 */
const RULES: [RegExp, WriteKind | null][] = [
  [/^\/api\/(auth|account|admin|setup|invites)(\/|$)/, null],
  [/^\/share(\/|$)/, null],
  // wedding_created, wedding_restored and wedding_deleted (below) are logged by their routes.
  [/^\/api\/weddings$/, null],
  [/^\/api\/weddings\/restore(\/|$)/, null],
  // member_* and invite_* events.
  [/^\/api\/weddings\/\[id\]\/(members|invites)(\/|$)/, null],
  // Reads the file and answers what an import would do; changes nothing.
  [/^\/api\/weddings\/\[id\]\/guests\/import\/preview$/, null],
  // venue.ai_import, logged by the import quota.
  [/^\/api\/venues\/\[id\]\/import$/, null],
  [/^\/api\/weddings\/\[id\]\/guests(\/|$)/, 'write.guests'],
  [/^\/api\/guests(\/|$)/, 'write.guests'],
  [/^\/api\/weddings\/\[id\]\/groups(\/|$)/, 'write.groups'],
  [/^\/api\/groups(\/|$)/, 'write.groups'],
  [/^\/api\/weddings\/\[id\]\/rules(\/|$)/, 'write.rules'],
  [/^\/api\/rules(\/|$)/, 'write.rules'],
  [/^\/api\/layouts\/\[id\]\/share-links$/, 'write.share'],
  [/^\/api\/share-links(\/|$)/, 'write.share'],
  [/^\/api\/weddings\/\[id\]\/layouts$/, 'write.layout'],
  [/^\/api\/layouts(\/|$)/, 'write.layout'],
  [/^\/api\/venues(\/|$)/, 'write.venue'],
]

/** The counter for a change through the route routeLabel named, or null for one that is not counted (see RULES). */
export function activityKind(label: string): WriteKind | null {
  const space = label.indexOf(' ')
  if (space <= 0) return null
  const method = label.slice(0, space)
  const path = label.slice(space + 1)
  if (SAFE_METHODS.has(method)) return null
  if (/^\/api\/weddings\/\[id\]$/.test(path)) return method === 'DELETE' ? null : 'write.wedding'
  for (const [pattern, kind] of RULES) if (pattern.test(path)) return kind
  return 'write.other'
}

/** The UTC hour a counter row covers, as "2026-11-11T14". Toronto is a whole number of hours from UTC, so each row falls in one Toronto day. */
export function counterHour(at: Date): string {
  return at.toISOString().slice(0, 13)
}

/** The once-only key of the counter row a change at `at` adds to. */
export function counterKey(kind: WriteKind, userId: string, weddingId: string | null, at: Date): string {
  return `${kind}:${userId}:${weddingId ?? '-'}:${counterHour(at)}`
}

/** What each kind of event says on the admin pages. */
const KIND_LABELS: Record<string, string> = {
  setup_completed: 'Set up the site',
  login: 'Signed in',
  logout: 'Signed out',
  password_changed: 'Changed their password',
  reset_link_created: 'Made a reset link',
  reset_used: 'Used a reset link',
  invite_created: 'Made an invite link',
  invite_accepted: 'Joined through an invite',
  invite_revoked: 'Cancelled an invite',
  member_added: 'Added someone',
  member_role_changed: 'Changed someone’s role',
  member_removed: 'Took someone out',
  user_disabled: 'Turned an account off',
  user_enabled: 'Turned an account on',
  wedding_created: 'Made the wedding',
  wedding_deleted: 'Deleted the wedding',
  wedding_restored: 'Restored it from a backup',
  wedding_undeleted: 'Undeleted the wedding',
  ownership_transferred: 'Changed the owner',
  admin_access: 'Opened it as an admin',
  'write.layout': 'Layout edits',
  'write.guests': 'Guest edits',
  'write.groups': 'Group edits',
  'write.rules': 'Rule edits',
  'write.venue': 'Venue edits',
  'write.share': 'Share link changes',
  'write.wedding': 'Wedding details',
  'write.other': 'Other edits',
  'venue.ai_import': 'AI floor plan import',
  venue_library_changed: 'Changed the venue library',
  venue_owner_changed: 'Changed a venue’s owner',
  activity_pruned: 'Cleared old activity',
}

export function activityLabel(kind: string, detail: Record<string, unknown> = {}): string {
  if (kind === 'admin_access' && detail.write === true) return 'Changed it as an admin'
  return KIND_LABELS[kind] ?? kind
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Wed, Nov 11" for the day "2026-11-11". The same on the server and in every browser. */
export function dayLabel(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return day
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`
}
