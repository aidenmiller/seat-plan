import { describe, expect, it } from 'vitest'
import { effectiveRole, needsAdminPower, roleAtLeast, type Role } from './access'
import { templateRights } from './venue-access'

const ROLES: (Role | null)[] = [null, 'editor', 'owner']

describe('roleAtLeast', () => {
  it('orders editor below owner, and no role below both', () => {
    const table = ROLES.map((role) => [role, roleAtLeast(role, 'editor'), roleAtLeast(role, 'owner')])
    expect(table).toEqual([
      [null, false, false],
      ['editor', true, false],
      ['owner', true, true],
    ])
    expect(roleAtLeast(undefined, 'editor')).toBe(false)
  })
})

describe('effectiveRole', () => {
  it('is the member role for everyone but an admin, who acts as an owner member or not', () => {
    const table = ROLES.flatMap((role) => [false, true].map((isAdmin) => [role, isAdmin, effectiveRole(role, isAdmin)]))
    expect(table).toEqual([
      [null, false, null],
      [null, true, 'owner'],
      ['editor', false, 'editor'],
      ['editor', true, 'owner'],
      ['owner', false, 'owner'],
      ['owner', true, 'owner'],
    ])
  })
})

describe('needsAdminPower', () => {
  it('is true only when an admin goes beyond their own membership', () => {
    const table = ROLES.flatMap((role) =>
      [false, true].map((isAdmin) => [role, isAdmin, needsAdminPower(role, isAdmin, 'editor'), needsAdminPower(role, isAdmin, 'owner')]),
    )
    expect(table).toEqual([
      [null, false, false, false],
      [null, true, true, true],
      ['editor', false, false, false],
      ['editor', true, false, true],
      ['owner', false, false, false],
      ['owner', true, false, false],
    ])
  })
})

describe('templateRights', () => {
  const me = { userId: 'me', isAdmin: false }
  const admin = { userId: 'admin', isAdmin: true }
  const cases = [
    { name: 'library', facts: { isLibrary: true, ownerUserId: null, usedByViewer: false }, me: [true, false] },
    { name: 'library, made by me', facts: { isLibrary: true, ownerUserId: 'me', usedByViewer: false }, me: [true, false] },
    { name: 'mine', facts: { isLibrary: false, ownerUserId: 'me', usedByViewer: false }, me: [true, true] },
    { name: "someone else's, used by me", facts: { isLibrary: false, ownerUserId: 'other', usedByViewer: true }, me: [true, false] },
    { name: "someone else's, not used", facts: { isLibrary: false, ownerUserId: 'other', usedByViewer: false }, me: [false, false] },
    { name: 'no owner, used by me', facts: { isLibrary: false, ownerUserId: null, usedByViewer: true }, me: [true, false] },
    { name: 'no owner, not used', facts: { isLibrary: false, ownerUserId: null, usedByViewer: false }, me: [false, false] },
  ]
  for (const c of cases) {
    it(`${c.name}: read ${c.me[0]}, change ${c.me[1]}; an admin may do both`, () => {
      expect(templateRights(me, c.facts)).toEqual({ read: c.me[0], edit: c.me[1] })
      expect(templateRights(admin, c.facts)).toEqual({ read: true, edit: true })
    })
  }
})
