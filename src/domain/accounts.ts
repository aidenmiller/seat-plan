/**
 * Account rules the browser and the server share: how an email is stored, and
 * the limits on passwords and names. Pure.
 */
import { wellFormedText } from './canvas-schema'

/** Passwords are at least 10 characters. Long passphrases are welcome, up to 200. */
export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 200
/** The users table refuses longer names (users_display_name_length). */
export const DISPLAY_NAME_MAX = 60
/** The longest address a mail server accepts (RFC 5321). */
export const EMAIL_MAX = 254

/**
 * Emails are stored trimmed and lower case (the users_email_normalized and
 * invites_email_normalized checks), and every lookup goes through this first,
 * so "Pat@Example.com " and "pat@example.com" are one account.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * A loose shape check on a normalized email: one @ with something on each
 * side, a dot in the domain, plain printable ASCII and no spaces. The routes
 * check more strictly; this stops nonsense reaching the database.
 */
export function isPlausibleEmail(email: string): boolean {
  if (email.length < 3 || email.length > EMAIL_MAX) return false
  if (!/^[\x21-\x7e]+$/.test(email)) return false
  const at = email.indexOf('@')
  if (at <= 0 || at !== email.lastIndexOf('@')) return false
  const domain = email.slice(at + 1)
  return domain.length >= 3 && domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.')
}

/** A display name as stored: text Postgres can keep, trimmed, 1 to 60 characters. Null when it does not fit. */
export function cleanDisplayName(name: string): string | null {
  const trimmed = wellFormedText(name).trim()
  return trimmed.length >= 1 && trimmed.length <= DISPLAY_NAME_MAX ? trimmed : null
}
