import { describe, expect, it } from 'vitest'
import { WRITE_KINDS, activityKind, activityLabel, counterHour, counterKey, dayLabel, isWriteKind, routeLabel } from './activity'

const ID = '0b7f4c8e-2d4a-4c1e-9f3b-6a5d7e8f9a01'
const OTHER = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D'

describe('routeLabel', () => {
  it('writes every id as [id], so one route has one label', () => {
    expect(routeLabel('put', `/api/layouts/${ID}`)).toBe('PUT /api/layouts/[id]')
    expect(routeLabel('DELETE', `/api/groups/${ID}/members/${OTHER}`)).toBe('DELETE /api/groups/[id]/members/[id]')
    expect(routeLabel('POST', `/api/venues/${ID}/revisions/${OTHER}/restore`)).toBe('POST /api/venues/[id]/revisions/[id]/restore')
  })

  it('reads a route’s own placeholders, as tests send them, and long tokens, the same way', () => {
    expect(routeLabel('PATCH', '/api/weddings/[id]/members/[userId]')).toBe('PATCH /api/weddings/[id]/members/[id]')
    expect(routeLabel('PATCH', '/api/weddings/%5Bid%5D')).toBe('PATCH /api/weddings/[id]')
    expect(routeLabel('GET', `/share/${'x'.repeat(43)}/data`)).toBe('GET /share/[id]/data')
  })

  it('drops a query and a trailing slash, and stays short', () => {
    expect(routeLabel('GET', `/api/venues/?weddingId=${ID}`)).toBe('GET /api/venues')
    expect(routeLabel('POST', '/')).toBe('POST /')
    expect(routeLabel('POST', `/api/${'a/'.repeat(300)}`).length).toBeLessThanOrEqual(200)
  })
})

describe('activityKind', () => {
  const kind = (method: string, path: string) => activityKind(routeLabel(method, path))

  it('counts the changes planners make, by what they change', () => {
    expect(kind('PUT', `/api/layouts/${ID}`)).toBe('write.layout')
    expect(kind('PATCH', `/api/layouts/${ID}`)).toBe('write.layout')
    expect(kind('DELETE', `/api/layouts/${ID}`)).toBe('write.layout')
    expect(kind('POST', `/api/layouts/${ID}/duplicate`)).toBe('write.layout')
    expect(kind('POST', `/api/weddings/${ID}/layouts`)).toBe('write.layout')
    expect(kind('POST', `/api/weddings/${ID}/guests`)).toBe('write.guests')
    expect(kind('POST', `/api/weddings/${ID}/guests/bulk`)).toBe('write.guests')
    expect(kind('POST', `/api/weddings/${ID}/guests/import/commit`)).toBe('write.guests')
    expect(kind('PATCH', `/api/guests/${ID}`)).toBe('write.guests')
    expect(kind('POST', `/api/weddings/${ID}/groups`)).toBe('write.groups')
    expect(kind('DELETE', `/api/groups/${ID}/members/${OTHER}`)).toBe('write.groups')
    expect(kind('POST', `/api/weddings/${ID}/rules`)).toBe('write.rules')
    expect(kind('PATCH', '/api/rules/couple')).toBe('write.rules')
    expect(kind('POST', `/api/layouts/${ID}/share-links`)).toBe('write.share')
    expect(kind('PATCH', `/api/share-links/${ID}`)).toBe('write.share')
    expect(kind('POST', '/api/venues')).toBe('write.venue')
    expect(kind('PUT', `/api/venues/${ID}`)).toBe('write.venue')
    expect(kind('POST', `/api/venues/${ID}/accept-import`)).toBe('write.venue')
    expect(kind('POST', `/api/venues/${ID}/images`)).toBe('write.venue')
    expect(kind('PATCH', `/api/weddings/${ID}`)).toBe('write.wedding')
  })

  it('counts nothing for reads', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) expect(kind(method, `/api/layouts/${ID}`)).toBeNull()
  })

  it('leaves out changes that log an event of their own, change nothing, or are not about a wedding or venue', () => {
    expect(kind('POST', '/api/weddings')).toBeNull()
    expect(kind('DELETE', `/api/weddings/${ID}`)).toBeNull()
    expect(kind('POST', '/api/weddings/restore')).toBeNull()
    expect(kind('POST', `/api/weddings/restore/${ID}/layouts`)).toBeNull()
    expect(kind('PATCH', `/api/weddings/${ID}/members/${OTHER}`)).toBeNull()
    expect(kind('POST', `/api/weddings/${ID}/invites`)).toBeNull()
    expect(kind('DELETE', `/api/invites/${ID}`)).toBeNull()
    expect(kind('POST', '/api/invites/accept')).toBeNull()
    expect(kind('POST', `/api/weddings/${ID}/guests/import/preview`)).toBeNull()
    expect(kind('POST', `/api/venues/${ID}/import`)).toBeNull()
    expect(kind('POST', '/api/auth/logout')).toBeNull()
    expect(kind('PATCH', '/api/account')).toBeNull()
    expect(kind('POST', `/api/admin/weddings/${ID}/transfer`)).toBeNull()
    expect(kind('POST', '/api/admin/backups')).toBeNull()
    expect(kind('POST', `/share/${'x'.repeat(43)}/login`)).toBeNull()
  })

  it('counts any other change as write.other, so a new route is never missed', () => {
    expect(kind('POST', `/api/weddings/${ID}/something-new`)).toBe('write.other')
    expect(activityKind('nonsense')).toBeNull()
  })

  it('only ever answers a counter kind', () => {
    expect(WRITE_KINDS.every(isWriteKind)).toBe(true)
    expect(isWriteKind('login')).toBe(false)
  })
})

describe('counter keys', () => {
  it('are one per UTC hour, person, wedding (or none) and kind', () => {
    const at = new Date('2026-11-11T14:59:59.999Z')
    expect(counterHour(at)).toBe('2026-11-11T14')
    expect(counterKey('write.layout', 'u', 'w', at)).toBe('write.layout:u:w:2026-11-11T14')
    expect(counterKey('write.venue', 'u', null, at)).toBe('write.venue:u:-:2026-11-11T14')
    expect(counterKey('write.layout', 'u', 'w', new Date('2026-11-11T15:00:00.000Z'))).not.toBe(counterKey('write.layout', 'u', 'w', at))
  })
})

describe('words', () => {
  it('names each kind, and an admin’s change apart from a look', () => {
    expect(activityLabel('write.layout')).toBe('Layout edits')
    expect(activityLabel('admin_access', { write: false })).toBe('Opened it as an admin')
    expect(activityLabel('user_admin_changed', { admin: true })).toBe('Made someone an admin')
    expect(activityLabel('user_admin_changed', { admin: false })).toBe('Removed someone’s admin access')
    expect(activityLabel('user_admin_changed')).toBe('Changed someone’s admin access')
    expect(activityLabel('admin_access', { write: true })).toBe('Changed it as an admin')
    expect(activityLabel('something_new')).toBe('something_new')
    for (const k of WRITE_KINDS) expect(activityLabel(k)).not.toBe(k)
  })

  it('writes a day the same way everywhere', () => {
    expect(dayLabel('2026-11-11')).toBe('Wed, Nov 11')
    expect(dayLabel('2027-01-01')).toBe('Fri, Jan 1')
    expect(dayLabel('not a day')).toBe('not a day')
  })
})
