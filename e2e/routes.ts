/**
 * Every page and API route the app has, as templates with `:wedding`,
 * `:layout` and so on standing for ids, shared by the signed-out check
 * (signed-out.spec.ts) and the cross-user check (isolation.spec.ts). A new
 * route joins API_ROUTES when it is added (src/server/auth/route-auth.test.ts
 * lists the same routes by file). The pages and routes that are public by
 * design have their own lists (PUBLIC_PAGE_PATHS, PUBLIC_API_ROUTES); a share
 * link's page and routes are walked with a real link.
 */
import { randomBytes } from 'node:crypto'
import { emptyCanvas } from '../src/domain/canvas-schema'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export const NO_ID = '00000000-0000-4000-8000-000000000000'

/**
 * Every page that needs a session and answers "Not found" to someone who may
 * not open it (an outsider to the wedding or venue, a non-admin on the admin
 * pages), with `:wedding`, `:layout` and `:venue` standing for ids, and the
 * sample guest file.
 */
export const PAGE_PATHS = [
  '/',
  '/w/:wedding',
  '/w/:wedding/layouts',
  '/w/:wedding/guests',
  '/w/:wedding/guests/import',
  '/w/:wedding/groups',
  '/w/:wedding/rules',
  '/w/:wedding/venues',
  '/w/:wedding/links',
  '/w/:wedding/people',
  '/w/:wedding/layouts/:layout',
  '/venues/:venue',
  '/venues/:venue?from=:wedding',
  // The admin area: admins only, anyone else signed in gets the Not found page.
  '/admin',
  '/admin/weddings',
  '/admin/weddings/:wedding',
  '/admin/users',
  '/admin/venues',
  '/admin/backups',
  '/samples/guests-sample.csv',
]

/**
 * Pages about the signed-in person alone: signed out they go to the sign-in
 * page, but signed in they open for anyone, so the cross-user check leaves
 * them out.
 */
export const ACCOUNT_PAGE_PATHS = ['/account']

/**
 * Pages for people who are not signed in, and what each answers with no
 * cookie (setup answers 404 because every run starts with accounts). The
 * proxy lets them through; each page runs its own checks.
 */
export const PUBLIC_PAGE_PATHS: { path: string; status: number }[] = [
  { path: '/login', status: 200 },
  { path: '/setup', status: 404 },
  { path: '/invite', status: 200 },
  { path: '/reset', status: 200 },
]

/** One row of an import, as the column step sends it. */
const IMPORT_ROW = { rowNumber: 2, firstName: 'Sneaky', lastName: 'Guest', groups: [], extraNotes: [] }

/** A made-up one-time token, the right shape (43 base64url characters) for an invite or reset link. */
const MADE_UP_TOKEN = randomBytes(32).toString('base64url')

/** A template save, as the template editor sends it. */
const VENUE_SAVE = { baseVersion: 1, saveId: NO_ID, editedBy: 'Noa' }

/** A share link password made up for this run. */
export const LINK_PASSWORD = `sneaky-${randomBytes(6).toString('hex')}`

/** Restore step 1, as the browser sends it, for a wedding named Sneaky. */
const RESTORE_START = {
  format: 'seat-plan-backup',
  version: 1,
  jobId: NO_ID,
  wedding: { id: NO_ID, name: 'Sneaky', date: null, unit: 'ft', minGapCm: 152.4 },
  guests: [],
  groups: [],
  groupMembers: [],
  rules: [],
  ruleGuests: [],
}

/**
 * The API routes anyone may call, for people who cannot have a session yet
 * (src/server/auth/route-auth.test.ts lists them too), and what each answers
 * with no cookie given a made-up token. Sign-in is left out: wrong guesses
 * count against the address, and the sign-in specs own that. A share link's
 * own login and data routes are walked with a real link.
 */
export const PUBLIC_API_ROUTES: { method: Method; path: string; body: unknown; status: number }[] = [
  // A first account can be made only while none exists.
  { method: 'POST', path: '/api/setup', status: 404, body: { sitePassword: 'x', email: 'sneaky@example.test', displayName: 'Sneaky', password: 'sneaky-password-1' } },
  // An unknown invite or reset link is 404, whatever the token says.
  { method: 'POST', path: '/api/invites/lookup', status: 404, body: { token: MADE_UP_TOKEN } },
  {
    method: 'POST',
    path: '/api/invites/register',
    status: 404,
    body: { token: MADE_UP_TOKEN, email: 'sneaky@example.test', displayName: 'Sneaky', password: 'sneaky-password-1' },
  },
  { method: 'POST', path: '/api/auth/reset', status: 404, body: { token: MADE_UP_TOKEN } },
]

/**
 * Every API route but the public ones above (and sign-in), with a body where
 * the route takes one; `:guest`, `:group`, `:image`, `:revision`, `:link`,
 * `:job`, `:user`, `:invite`, `:backup` and `:session` stand for ids too.
 */
export const API_ROUTES: { method: Method; path: string; body?: unknown }[] = [
  { method: 'GET', path: '/api/weddings' },
  { method: 'POST', path: '/api/weddings', body: { name: 'Sneaky' } },
  { method: 'GET', path: '/api/weddings/:wedding' },
  { method: 'PATCH', path: '/api/weddings/:wedding', body: { name: 'Sneaky' } },
  { method: 'DELETE', path: '/api/weddings/:wedding', body: { confirm: 'delete' } },
  { method: 'GET', path: '/api/weddings/:wedding/delete-summary' },
  { method: 'GET', path: '/api/weddings/:wedding/layouts' },
  {
    method: 'POST',
    path: '/api/weddings/:wedding/layouts',
    body: { name: 'Sneaky', kind: 'reception', venueTemplateId: null, editedBy: 'Noa' },
  },
  { method: 'GET', path: '/api/layouts/:layout' },
  { method: 'PUT', path: '/api/layouts/:layout', body: { baseVersion: 1 } },
  { method: 'PATCH', path: '/api/layouts/:layout', body: { name: 'Sneaky' } },
  { method: 'DELETE', path: '/api/layouts/:layout', body: { confirm: 'delete' } },
  { method: 'GET', path: '/api/layouts/:layout/delete-summary' },
  { method: 'GET', path: '/api/layouts/:layout/version' },
  { method: 'POST', path: '/api/layouts/:layout/duplicate', body: { editedBy: 'Noa' } },
  { method: 'POST', path: '/api/auth/logout' },
  // Guests (milestone 4).
  { method: 'GET', path: '/api/weddings/:wedding/guests' },
  { method: 'POST', path: '/api/weddings/:wedding/guests', body: { firstName: 'Sneaky', lastName: 'Guest' } },
  { method: 'POST', path: '/api/weddings/:wedding/guests/bulk', body: { guests: [{ firstName: 'Sneaky', lastName: 'Guest' }] } },
  { method: 'GET', path: '/api/weddings/:wedding/guests/export' },
  { method: 'POST', path: '/api/weddings/:wedding/guests/import/preview', body: { rows: [IMPORT_ROW] } },
  { method: 'POST', path: '/api/weddings/:wedding/guests/import/commit', body: { rows: [IMPORT_ROW], removeMissing: true } },
  { method: 'PATCH', path: '/api/guests/:guest', body: { firstName: 'Sneaky' } },
  { method: 'DELETE', path: '/api/guests/:guest' },
  { method: 'GET', path: '/api/guests/:guest/delete-summary' },
  // Groups (milestone 4).
  { method: 'GET', path: '/api/weddings/:wedding/groups' },
  { method: 'POST', path: '/api/weddings/:wedding/groups', body: { name: 'Sneaky' } },
  { method: 'PATCH', path: '/api/groups/:group', body: { name: 'Sneaky' } },
  { method: 'DELETE', path: '/api/groups/:group' },
  { method: 'POST', path: '/api/groups/:group/members', body: { guestIds: [NO_ID] } },
  { method: 'DELETE', path: '/api/groups/:group/members/:guest' },
  // Rules (milestone 6).
  { method: 'GET', path: '/api/weddings/:wedding/rules' },
  { method: 'POST', path: '/api/weddings/:wedding/rules', body: { kind: 'apart', guestIds: [NO_ID, NO_ID.replace(/0$/, '1')] } },
  { method: 'PATCH', path: '/api/rules/:rule', body: { enabled: false } },
  { method: 'DELETE', path: '/api/rules/:rule' },
  { method: 'PATCH', path: '/api/rules/couple', body: { guestIds: [NO_ID, NO_ID.replace(/0$/, '1')], enabled: false } },
  // Seated guests across a wedding's layouts.
  { method: 'GET', path: '/api/weddings/:wedding/guests/seats' },
  // Venue templates (milestone 7).
  { method: 'GET', path: '/api/venues' },
  { method: 'POST', path: '/api/venues', body: { name: 'Sneaky' } },
  { method: 'GET', path: '/api/venues/:venue' },
  { method: 'PUT', path: '/api/venues/:venue', body: { ...VENUE_SAVE, fixedItems: [], reference: null } },
  { method: 'PATCH', path: '/api/venues/:venue', body: { name: 'Sneaky' } },
  { method: 'DELETE', path: '/api/venues/:venue', body: { confirm: 'delete' } },
  { method: 'GET', path: '/api/venues/:venue/delete-summary' },
  { method: 'POST', path: '/api/venues/:venue/duplicate', body: { name: 'Sneaky' } },
  { method: 'GET', path: '/api/venues/:venue/wall-check' },
  { method: 'GET', path: '/api/venues/:venue/revisions' },
  { method: 'POST', path: '/api/venues/:venue/revisions/:revision/restore', body: VENUE_SAVE },
  // Floor plan images and the AI import (milestone 7).
  { method: 'POST', path: '/api/venues/:venue/images', body: 'not an image' },
  { method: 'GET', path: '/api/venues/:venue/images/:image' },
  { method: 'POST', path: '/api/venues/:venue/import', body: { imageId: NO_ID, imageWidth: 1000, imageHeight: 700 } },
  {
    method: 'POST',
    path: '/api/venues/:venue/accept-import',
    body: { ...VENUE_SAVE, fixedItems: [], imageId: NO_ID, reference: { scaleCmPerPx: 1, offsetX: 0, offsetY: 0, rotation: 0, opacity: 0.5 }, importedBy: 'ai' },
  },
  // Share links (milestone 10).
  { method: 'GET', path: '/api/weddings/:wedding/share-links' },
  { method: 'GET', path: '/api/layouts/:layout/share-links' },
  { method: 'POST', path: '/api/layouts/:layout/share-links', body: { password: LINK_PASSWORD } },
  { method: 'PATCH', path: '/api/share-links/:link', body: { enabled: false, password: LINK_PASSWORD } },
  { method: 'DELETE', path: '/api/share-links/:link' },
  // Backup and the restore steps (milestone 10).
  { method: 'GET', path: '/api/weddings/:wedding/backup' },
  { method: 'POST', path: '/api/weddings/restore', body: RESTORE_START },
  {
    method: 'POST',
    path: '/api/weddings/restore/:job/templates',
    body: { id: NO_ID, name: 'Sneaky', fixedItems: [], reference: null, importedBy: 'hand', imageId: null },
  },
  { method: 'PUT', path: '/api/weddings/restore/:job/templates/:venue/image', body: 'not an image' },
  {
    method: 'POST',
    path: '/api/weddings/restore/:job/layouts',
    body: { id: NO_ID, name: 'Sneaky', kind: 'reception', venueTemplateId: null, editedBy: 'Noa', canvas: emptyCanvas() },
  },
  // Members and invites: any member sees who belongs, owners change it.
  { method: 'GET', path: '/api/weddings/:wedding/members' },
  { method: 'PATCH', path: '/api/weddings/:wedding/members/:user', body: { role: 'owner' } },
  { method: 'DELETE', path: '/api/weddings/:wedding/members/:user' },
  { method: 'GET', path: '/api/weddings/:wedding/invites' },
  { method: 'POST', path: '/api/weddings/:wedding/invites', body: { role: 'owner' } },
  { method: 'DELETE', path: '/api/invites/:invite' },
  // Accepting an invite needs a session; the token is the proof.
  { method: 'POST', path: '/api/invites/accept', body: { token: MADE_UP_TOKEN } },
  // Stored backups: a wedding's owners.
  { method: 'GET', path: '/api/weddings/:wedding/backups' },
  { method: 'POST', path: '/api/weddings/:wedding/backups' },
  { method: 'GET', path: '/api/weddings/:wedding/backups/:backup' },
  { method: 'POST', path: '/api/weddings/:wedding/backups/:backup/restore' },
  // The nightly job: Vercel's bearer secret, no cookie.
  { method: 'GET', path: '/api/cron/backups' },
  { method: 'POST', path: '/api/cron/backups' },
  // The signed-in person's own account (account.spec.ts).
  { method: 'PATCH', path: '/api/account', body: { displayName: 'Sneaky' } },
  { method: 'POST', path: '/api/account/password', body: { current: 'x', next: 'sneaky-password-1' } },
  { method: 'GET', path: '/api/account/sessions' },
  { method: 'DELETE', path: '/api/account/sessions/:session' },
  { method: 'POST', path: '/api/account/sessions/revoke-others' },
  // The admin area: admins only.
  { method: 'GET', path: '/api/admin/users' },
  { method: 'PATCH', path: '/api/admin/users/:user', body: { disabled: true } },
  { method: 'POST', path: '/api/admin/users/:user/reset-link' },
  { method: 'POST', path: '/api/admin/users/:user/sign-out' },
  { method: 'GET', path: '/api/admin/invites' },
  { method: 'POST', path: '/api/admin/invites', body: {} },
  { method: 'DELETE', path: '/api/admin/invites/:invite' },
  { method: 'GET', path: '/api/admin/weddings' },
  { method: 'POST', path: '/api/admin/weddings/:wedding/claim' },
  { method: 'POST', path: '/api/admin/weddings/:wedding/undelete' },
  { method: 'POST', path: '/api/admin/weddings/:wedding/members', body: { userId: NO_ID, role: 'owner' } },
  { method: 'POST', path: '/api/admin/weddings/:wedding/transfer', body: { userId: NO_ID } },
  { method: 'PATCH', path: '/api/admin/venues/:venue', body: { isLibrary: true } },
  { method: 'GET', path: '/api/admin/backups' },
  { method: 'POST', path: '/api/admin/backups/run' },
  { method: 'GET', path: '/api/admin/backups/:backup' },
  { method: 'POST', path: '/api/admin/backups/:backup/restore' },
]

export type Ids = {
  wedding: string
  layout: string
  guest: string
  group: string
  rule: string
  venue: string
  image: string
  revision: string
  link: string
  job: string
  user: string
  invite: string
  backup: string
  session: string
}
export const NO_IDS: Ids = {
  wedding: NO_ID,
  layout: NO_ID,
  guest: NO_ID,
  group: NO_ID,
  rule: NO_ID,
  venue: NO_ID,
  image: NO_ID,
  revision: NO_ID,
  link: NO_ID,
  job: NO_ID,
  user: NO_ID,
  invite: NO_ID,
  backup: NO_ID,
  session: NO_ID,
}

export function fill(path: string, ids: Ids): string {
  return path.replace(/:(wedding|layout|guest|group|rule|venue|image|revision|link|job|user|invite|backup|session)\b/g, (_, key: keyof Ids) => ids[key])
}

/** The page paths with the ids put in. */
export function pagePaths(ids: Ids): string[] {
  return PAGE_PATHS.map((path) => fill(path, ids))
}

/**
 * Who may call a route, by its policy (src/server/auth/route-auth.test.ts):
 * 'editor' and 'owner' are the least wedding role; 'venue-read' and
 * 'venue-write' are venue template access; 'user' is any signed-in user (the
 * route is about the caller, not one wedding: a list of their own, or a new
 * thing of their own); 'account' acts only on the caller's own account or
 * sessions, so the cross-user check leaves it to account.spec.ts; 'admin' is
 * admins only (404 to anyone else signed in); 'cron' takes Vercel's bearer
 * secret and no session (401 without it); 'session' ends the caller's session.
 */
export type Access = 'editor' | 'owner' | 'venue-read' | 'venue-write' | 'user' | 'account' | 'admin' | 'cron' | 'session'

export type ApiCall = { method: Method; path: string; body?: unknown; template: string; access: Access }

const OWNER_ONLY = new Set([
  'PATCH /api/weddings/:wedding',
  'DELETE /api/weddings/:wedding',
  'GET /api/weddings/:wedding/delete-summary',
  'GET /api/weddings/:wedding/backup',
  'POST /api/layouts/:layout/share-links',
  'PATCH /api/share-links/:link',
  'DELETE /api/share-links/:link',
  'POST /api/weddings/restore/:job/templates',
  'PUT /api/weddings/restore/:job/templates/:venue/image',
  'POST /api/weddings/restore/:job/layouts',
  'PATCH /api/weddings/:wedding/members/:user',
  'GET /api/weddings/:wedding/invites',
  'POST /api/weddings/:wedding/invites',
  'DELETE /api/invites/:invite',
  'GET /api/weddings/:wedding/backups',
  'POST /api/weddings/:wedding/backups',
  'GET /api/weddings/:wedding/backups/:backup',
  'POST /api/weddings/:wedding/backups/:backup/restore',
])
const USER_ONLY = new Set([
  'GET /api/weddings',
  'POST /api/weddings',
  'GET /api/venues',
  'POST /api/venues',
  'POST /api/weddings/restore',
  'POST /api/invites/accept',
])

export function accessOf(method: Method, path: string): Access {
  const key = `${method} ${path}`
  if (key === 'POST /api/auth/logout') return 'session'
  if (USER_ONLY.has(key)) return 'user'
  if (path.startsWith('/api/admin/')) return 'admin'
  if (path.startsWith('/api/account')) return 'account'
  if (path.startsWith('/api/cron/')) return 'cron'
  if (OWNER_ONLY.has(key)) return 'owner'
  if (path.startsWith('/api/venues/')) return method === 'GET' || path.endsWith('/duplicate') ? 'venue-read' : 'venue-write'
  return 'editor'
}

/** Every API route with the ids put in, and who may call it. */
export function apiCalls(ids: Ids): ApiCall[] {
  return API_ROUTES.map(({ method, path, body }) => ({ method, path: fill(path, ids), body, template: path, access: accessOf(method, path) }))
}
