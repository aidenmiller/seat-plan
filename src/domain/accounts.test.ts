import { describe, expect, it } from 'vitest'
import { DISPLAY_NAME_MAX, cleanDisplayName, isPlausibleEmail, normalizeEmail } from './accounts'

describe('normalizeEmail', () => {
  it('trims and lower-cases, so one address is one account', () => {
    expect(normalizeEmail('  Pat@Example.COM ')).toBe('pat@example.com')
    expect(normalizeEmail('pat@example.com')).toBe('pat@example.com')
    expect(normalizeEmail('\tPat@example.com\n')).toBe('pat@example.com')
  })
})

describe('isPlausibleEmail', () => {
  it('takes ordinary addresses', () => {
    for (const email of ['pat@example.com', 'p.lee+wedding@mail.example.co.uk', 'a@b.co']) {
      expect(isPlausibleEmail(email), email).toBe(true)
    }
  })

  it('refuses things that cannot be an address', () => {
    for (const email of ['', 'pat', 'pat@', '@example.com', 'pat@example', 'pat@@example.com', 'p at@example.com', 'pat@.com', 'pat@example.', 'pät@example.com']) {
      expect(isPlausibleEmail(email), email).toBe(false)
    }
    expect(isPlausibleEmail(`${'a'.repeat(250)}@b.co`)).toBe(false)
  })
})

describe('cleanDisplayName', () => {
  it('trims and keeps 1 to 60 characters', () => {
    expect(cleanDisplayName('  Pat Lee ')).toBe('Pat Lee')
    expect(cleanDisplayName('   ')).toBeNull()
    expect(cleanDisplayName('n'.repeat(DISPLAY_NAME_MAX))).toBe('n'.repeat(DISPLAY_NAME_MAX))
    expect(cleanDisplayName('n'.repeat(DISPLAY_NAME_MAX + 1))).toBeNull()
  })

  it('drops characters Postgres cannot store', () => {
    expect(cleanDisplayName('Pat\u0000 Lee')).toBe('Pat Lee')
    expect(cleanDisplayName('Pat \ud800')).toBe('Pat �')
  })
})
