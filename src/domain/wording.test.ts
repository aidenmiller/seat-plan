import { describe, expect, it } from 'vitest'
import {
  clockTime,
  conflictChoiceMessage,
  conflictMessage,
  copyLayoutName,
  defaultLayoutName,
  editedLine,
  formatWeddingDate,
  joinAnd,
  layoutDeleteMessage,
  layoutKindLabel,
  loadedChangesMessage,
  plural,
  relativeTime,
  weddingCounts,
  weddingDeleteMessage,
  whenText,
} from './wording'

/** Local time, so these tests pass in any time zone. */
const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi)

describe('counts and lists', () => {
  it('plural', () => {
    expect(plural(1, 'guest')).toBe('1 guest')
    expect(plural(0, 'guest')).toBe('0 guests')
    expect(plural(2, 'person', 'people')).toBe('2 people')
  })

  it('joinAnd uses commas, then "and"', () => {
    expect(joinAnd([])).toBe('')
    expect(joinAnd(['a'])).toBe('a')
    expect(joinAnd(['a', 'b'])).toBe('a and b')
    expect(joinAnd(['a', 'b', 'c'])).toBe('a, b and c')
  })

  it('weddingCounts', () => {
    expect(weddingCounts(142, 6)).toBe('142 guests · 6 layouts')
    expect(weddingCounts(1, 1)).toBe('1 guest · 1 layout')
  })
})

describe('formatWeddingDate', () => {
  it('names the weekday, month and year', () => {
    expect(formatWeddingDate('2027-06-12')).toBe('Saturday, June 12, 2027')
    expect(formatWeddingDate('2026-01-01')).toBe('Thursday, January 1, 2026')
  })

  it('returns anything else unchanged', () => {
    expect(formatWeddingDate('soon')).toBe('soon')
    expect(formatWeddingDate('2026-13-01')).toBe('2026-13-01')
  })
})

describe('layout names', () => {
  it('kind labels and default names', () => {
    expect(layoutKindLabel('reception')).toBe('Reception')
    expect(layoutKindLabel('ceremony')).toBe('Ceremony')
    expect(defaultLayoutName('reception')).toBe('Reception plan')
    expect(defaultLayoutName('ceremony')).toBe('Ceremony plan')
  })

  it('copyLayoutName adds the author and keeps under 200 characters', () => {
    expect(copyLayoutName('Reception plan', 'Noa')).toBe("Reception plan (Noa's copy)")
    const long = copyLayoutName('x'.repeat(200), 'Aiden')
    expect(long.length).toBeLessThanOrEqual(200)
    expect(long.endsWith("(Aiden's copy)")).toBe(true)
  })
})

describe('times', () => {
  it('clockTime uses am and pm', () => {
    expect(clockTime(at(2026, 11, 9, 15, 42))).toBe('3:42 pm')
    expect(clockTime(at(2026, 11, 9, 0, 5))).toBe('12:05 am')
    expect(clockTime(at(2026, 11, 9, 12, 0))).toBe('12:00 pm')
    expect(clockTime(at(2026, 11, 9, 9, 7))).toBe('9:07 am')
  })

  it('whenText names the day when it is not today', () => {
    const now = at(2026, 11, 9, 18)
    expect(whenText(at(2026, 11, 9, 15, 42), now)).toBe('at 3:42 pm')
    expect(whenText(at(2026, 11, 8, 15, 42), now)).toBe('yesterday at 3:42 pm')
    expect(whenText(at(2026, 11, 3, 15, 42), now)).toBe('on Nov 3 at 3:42 pm')
    expect(whenText(at(2025, 11, 3, 15, 42), now)).toBe('on Nov 3, 2025 at 3:42 pm')
  })

  it('relativeTime', () => {
    const now = at(2026, 11, 9, 18).getTime()
    const ago = (ms: number) => new Date(now - ms).toISOString()
    expect(relativeTime(ago(10_000), now)).toBe('just now')
    expect(relativeTime(ago(-60_000), now)).toBe('just now')
    expect(relativeTime(ago(60_000), now)).toBe('1 minute ago')
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5 minutes ago')
    expect(relativeTime(ago(60 * 60_000), now)).toBe('1 hour ago')
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3 hours ago')
    expect(relativeTime(at(2026, 11, 8, 9).toISOString(), now)).toBe('yesterday')
    expect(relativeTime(at(2026, 11, 5, 9).toISOString(), now)).toBe('4 days ago')
    expect(relativeTime(at(2026, 10, 20, 9).toISOString(), now)).toBe('Oct 20')
    expect(relativeTime('not a date', now)).toBe('')
  })

  it('editedLine', () => {
    const now = at(2026, 11, 9, 18).getTime()
    const fiveMinutesAgo = new Date(now - 5 * 60_000).toISOString()
    expect(editedLine(fiveMinutesAgo, 'Noa', now)).toBe('Edited 5 minutes ago by Noa')
    expect(editedLine(fiveMinutesAgo, null, now)).toBe('Edited 5 minutes ago')
    expect(editedLine(fiveMinutesAgo, 'Dayna K.', now)).toBe('Edited 5 minutes ago by Dayna K.')
  })
})

describe('delete messages', () => {
  it('names the wedding and everything that goes with it', () => {
    expect(
      weddingDeleteMessage({ kind: 'wedding', name: 'Noa & Aiden', layouts: 6, guests: 142, groups: 9, rules: 14 }),
    ).toBe("Delete the wedding 'Noa & Aiden'? This also deletes 6 layouts, 142 guests, 9 groups and 14 rules.")
  })

  it('leaves out counts of zero', () => {
    expect(weddingDeleteMessage({ kind: 'wedding', name: 'W', layouts: 1, guests: 0, groups: 0, rules: 2 })).toBe(
      "Delete the wedding 'W'? This also deletes 1 layout and 2 rules.",
    )
    expect(weddingDeleteMessage({ kind: 'wedding', name: 'W', layouts: 0, guests: 0, groups: 0, rules: 0 })).toBe(
      "Delete the wedding 'W'?",
    )
  })

  it('layouts', () => {
    expect(
      layoutDeleteMessage({ kind: 'layout', name: 'Reception plan', tables: 14, seatedGuests: 120, notes: 3, shareLinks: 2 }),
    ).toBe(
      "Delete the layout 'Reception plan'? This also deletes 14 tables, 3 notes and the seats of 120 guests. " +
        'The guests stay on the guest list. 2 share links stop working. Other layouts stay as they are.',
    )
    expect(
      layoutDeleteMessage({ kind: 'layout', name: 'Empty', tables: 0, seatedGuests: 0, notes: 0, shareLinks: 1 }),
    ).toBe("Delete the layout 'Empty'? 1 share link stops working. Other layouts stay as they are.")
  })
})

describe('conflict wording', () => {
  const now = at(2026, 11, 9, 18)
  const updatedAt = at(2026, 11, 9, 15, 42).toISOString()

  it('names the other person', () => {
    expect(conflictMessage('Aiden', updatedAt, 'Noa', now)).toBe('Aiden changed this layout at 3:42 pm.')
  })

  it('says another tab or device when the name is this device’s own', () => {
    expect(conflictMessage('Noa', updatedAt, 'Noa', now)).toBe(
      'Noa changed this layout from another tab or device at 3:42 pm.',
    )
  })

  it('copes with an unknown author', () => {
    expect(conflictMessage(null, updatedAt, 'Noa', now)).toBe('Someone changed this layout at 3:42 pm.')
  })

  it('names anyone, not only Noa and Aiden', () => {
    expect(conflictMessage('Dayna K.', updatedAt, 'Noa', now)).toBe('Dayna K. changed this layout at 3:42 pm.')
    expect(conflictMessage('Dayna K.', updatedAt, 'Dayna K.', now)).toBe(
      'Dayna K. changed this layout from another tab or device at 3:42 pm.',
    )
  })

  it('says plainly that Load their version drops the changes here', () => {
    expect(conflictChoiceMessage('save')).toBe(
      'Your latest changes are not saved yet. ' +
        'Load their version to drop your changes here, or keep yours as a new copy of this layout.',
    )
  })

  it('says what a closed tab on this device left, and what each choice does with it', () => {
    expect(conflictChoiceMessage('recovery')).toBe(
      'Changes made on this device earlier were not saved before that. ' +
        'Load their version to drop the changes made on this device earlier, or keep them as a new copy.',
    )
  })

  it('does not claim saved work was lost when only the last changes are missing', () => {
    const text = conflictChoiceMessage('recovery-partly-saved')
    expect(text).toBe(
      'Changes made on this device earlier were saved, apart from the last ones. ' +
        "Load their version to drop those last changes, or keep this device's version as a new copy.",
    )
    expect(text).not.toMatch(/were not saved/)
  })

  it('conflict wording has no em dashes or exclamation marks', () => {
    for (const source of ['save', 'recovery', 'recovery-partly-saved'] as const) {
      expect(conflictChoiceMessage(source)).not.toMatch(/[—!]/)
    }
  })

  it('loaded changes notice', () => {
    expect(loadedChangesMessage('Aiden', 'Noa')).toBe("Loaded Aiden's changes")
    expect(loadedChangesMessage('Noa', 'Noa')).toBe('Loaded changes from another tab or device')
    expect(loadedChangesMessage(null, 'Noa')).toBe('Loaded the latest changes')
    expect(loadedChangesMessage('Dayna K.', 'Noa')).toBe("Loaded Dayna K.'s changes")
    expect(copyLayoutName('Reception', 'Dayna K.')).toBe("Reception (Dayna K.'s copy)")
  })
})
