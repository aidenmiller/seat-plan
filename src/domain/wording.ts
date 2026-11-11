/**
 * The short sentences the screens show: counts, dates, "Edited 5 minutes ago
 * by Noa", the delete dialog's summary and the save conflict message. Pure,
 * so every wording rule has a test. Times use the device's own time zone.
 */
import type { LayoutDeleteSummary, LayoutKind, WeddingDeleteSummary } from '@/shared/api'

/** A person's display name. Any name, not only Noa and Aiden. */
type Person = string

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "1 guest", "142 guests". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "a", "a and b", "a, b and c". */
export function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** "Saturday, June 12, 2027" from "2027-06-12". Reads the parts, so no time zone can shift the day. */
export function formatWeddingDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return ymd
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  return `${weekday}, ${MONTHS[month - 1]} ${day}, ${year}`
}

/** "142 guests · 6 layouts" for a wedding card. */
export function weddingCounts(guests: number, layouts: number): string {
  return `${plural(guests, 'guest')} · ${plural(layouts, 'layout')}`
}

export function layoutKindLabel(kind: LayoutKind): string {
  return kind === 'ceremony' ? 'Ceremony' : 'Reception'
}

export function defaultLayoutName(kind: LayoutKind): string {
  return kind === 'ceremony' ? 'Ceremony plan' : 'Reception plan'
}

const MAX_NAME = 200

/** "Reception plan (Noa's copy)", for "Keep mine as a new copy". Shortens a long name so the copy fits. */
export function copyLayoutName(name: string, author: Person): string {
  const suffix = ` (${author}'s copy)`
  return `${name.slice(0, MAX_NAME - suffix.length).trimEnd()}${suffix}`
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function shortDate(date: Date, now: Date): string {
  const base = `${MONTHS[date.getMonth()].slice(0, 3)} ${date.getDate()}`
  return date.getFullYear() === now.getFullYear() ? base : `${base}, ${date.getFullYear()}`
}

/** "3:42 pm", in this device's time zone. */
export function clockTime(date: Date): string {
  const h = date.getHours()
  const m = String(date.getMinutes()).padStart(2, '0')
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'am' : 'pm'}`
}

/** "at 3:42 pm", "yesterday at 3:42 pm" or "on Nov 3 at 3:42 pm". */
export function whenText(date: Date, now: Date): string {
  const time = clockTime(date)
  if (sameDay(date, now)) return `at ${time}`
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (sameDay(date, yesterday)) return `yesterday at ${time}`
  return `on ${shortDate(date, now)} at ${time}`
}

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", "4 days ago", "Nov 3". */
export function relativeTime(iso: string, nowMs: number): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const seconds = Math.round((nowMs - then) / 1000)
  // A clock a little ahead of the server's still reads as now.
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${plural(hours, 'hour')} ago`
  const date = new Date(then)
  const now = new Date(nowMs)
  // Whole calendar days, so 30 hours ago late at night still reads as yesterday.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfThen = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.max(1, Math.round((startOfToday - startOfThen) / 86_400_000))
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return shortDate(date, now)
}

/** "Edited 5 minutes ago by Noa". */
export function editedLine(updatedAt: string, editedBy: Person | null, nowMs: number): string {
  const when = relativeTime(updatedAt, nowMs)
  return editedBy ? `Edited ${when} by ${editedBy}` : `Edited ${when}`
}

/** The delete dialog's sentence for a wedding (spec section 10, "Deleting"). Leaves out counts of zero. */
export function weddingDeleteMessage(s: WeddingDeleteSummary): string {
  const parts = [
    s.layouts > 0 ? plural(s.layouts, 'layout') : null,
    s.guests > 0 ? plural(s.guests, 'guest') : null,
    s.groups > 0 ? plural(s.groups, 'group') : null,
    s.rules > 0 ? plural(s.rules, 'rule') : null,
  ].filter((p): p is string => p !== null)
  const question = `Delete the wedding '${s.name}'?`
  return parts.length > 0 ? `${question} This also deletes ${joinAnd(parts)}.` : question
}

/** The delete dialog's sentence for a layout. Guests stay on the guest list; other layouts stay as they are. */
export function layoutDeleteMessage(s: LayoutDeleteSummary): string {
  const parts = [
    s.tables > 0 ? plural(s.tables, 'table') : null,
    s.notes > 0 ? plural(s.notes, 'note') : null,
    s.seatedGuests > 0 ? `the seats of ${plural(s.seatedGuests, 'guest')}` : null,
  ].filter((p): p is string => p !== null)
  let text = `Delete the layout '${s.name}'?`
  if (parts.length > 0) text += ` This also deletes ${joinAnd(parts)}.`
  if (s.seatedGuests > 0) text += ` The guests stay on the guest list.`
  if (s.shareLinks > 0) text += ` ${s.shareLinks === 1 ? '1 share link stops' : `${s.shareLinks} share links stop`} working.`
  return `${text} Other layouts stay as they are.`
}

/**
 * The save conflict message (PLAN section 5, "Answers"): "Aiden changed this
 * layout at 3:42 pm." When the name is this device's own, the change came from
 * another tab or device.
 */
export function conflictMessage(editedBy: Person | null, updatedAt: string, me: Person | null, now: Date): string {
  const date = new Date(updatedAt)
  const when = Number.isFinite(date.getTime()) ? ` ${whenText(date, now)}` : ''
  if (editedBy === null) return `Someone changed this layout${when}.`
  if (editedBy === me) return `${editedBy} changed this layout from another tab or device${when}.`
  return `${editedBy} changed this layout${when}.`
}

/**
 * Where the changes at stake in a conflict came from. 'save': this tab's edits
 * met a newer version. 'recovery': a closed tab on this device left edits made
 * on an older version. 'recovery-partly-saved': as 'recovery', but that tab's
 * last save landed, so only the edits after it are missing.
 */
export type ConflictSource = 'save' | 'recovery' | 'recovery-partly-saved'

/**
 * The conflict dialog's text under "Aiden changed this layout at 3:42 pm.":
 * what is not saved, and plainly what each button does with it.
 */
export function conflictChoiceMessage(source: ConflictSource): string {
  switch (source) {
    case 'save':
      return (
        'Your latest changes are not saved yet. ' +
        'Load their version to drop your changes here, or keep yours as a new copy of this layout.'
      )
    case 'recovery':
      return (
        'Changes made on this device earlier were not saved before that. ' +
        'Load their version to drop the changes made on this device earlier, or keep them as a new copy.'
      )
    case 'recovery-partly-saved':
      return (
        'Changes made on this device earlier were saved, apart from the last ones. ' +
        "Load their version to drop those last changes, or keep this device's version as a new copy."
      )
  }
}

/** The notice after quietly loading a newer version: "Loaded Aiden's changes". */
export function loadedChangesMessage(editedBy: Person | null, me: Person | null): string {
  if (editedBy === null) return 'Loaded the latest changes'
  if (editedBy === me) return 'Loaded changes from another tab or device'
  return `Loaded ${editedBy}'s changes`
}
