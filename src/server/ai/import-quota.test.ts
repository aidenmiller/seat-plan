/** The AI import cap's plain parts: reading the limit, and what the dialog says. reserveAiImport is in import-quota.int.test.ts. */
import { describe, expect, it } from 'vitest'
import { DEFAULT_AI_IMPORT_MONTHLY_LIMIT, aiImportMonthlyLimit, importLimitMessage } from './import-quota'

describe('aiImportMonthlyLimit', () => {
  it('reads a whole number, 0 included', () => {
    expect(aiImportMonthlyLimit('25')).toBe(25)
    expect(aiImportMonthlyLimit(' 3 ')).toBe(3)
    expect(aiImportMonthlyLimit('0')).toBe(0)
  })

  it('falls back to 10 for anything else', () => {
    expect(DEFAULT_AI_IMPORT_MONTHLY_LIMIT).toBe(10)
    for (const raw of [undefined, '', 'ten', '-1', '2.5', '1e3', '99999999999']) expect(aiImportMonthlyLimit(raw), String(raw)).toBe(10)
  })
})

describe('importLimitMessage', () => {
  it('says how many and over what time, and what to do instead', () => {
    expect(importLimitMessage(10, 10)).toBe('You have used your 10 AI floor plan imports for the last 30 days (10 so far). Ask the admin, or trace the plan by hand.')
    expect(importLimitMessage(1, 1)).toContain('your 1 AI floor plan import for')
  })

  it('says imports are off when the limit is 0', () => {
    expect(importLimitMessage(0, 0)).toBe('AI floor plan imports are turned off for planners on this site. Ask the admin, or trace the plan by hand.')
  })
})
