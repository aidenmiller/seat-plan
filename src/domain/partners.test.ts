import { describe, expect, it } from 'vitest'
import { DEFAULT_LEFT_LABEL, DEFAULT_RIGHT_LABEL } from './ceremony'
import {
  ceremonySideLabels,
  guestSides,
  legacySide,
  partnerName,
  partnersOf,
  sideKey,
  sideLabel,
  sideOptions,
  sideWordMap,
  type GuestSide,
  type PartnerNames,
} from './partners'

const NOA_AIDEN: PartnerNames = { partner1: 'Noa', partner2: 'Aiden' }
const UNNAMED: PartnerNames = { partner1: null, partner2: null }

/** What a side cell reads as, or undefined when the import does not understand it. */
const read = (p: PartnerNames, cell: string): GuestSide | undefined => sideWordMap(p).get(sideKey(cell))

describe('names and labels', () => {
  it("gives each partner's name, or Partner 1 and Partner 2 without one", () => {
    expect(partnerName(NOA_AIDEN, 'partner1')).toBe('Noa')
    expect(partnerName(NOA_AIDEN, 'partner2')).toBe('Aiden')
    expect(partnerName(UNNAMED, 'partner1')).toBe('Partner 1')
    expect(partnerName({ partner1: 'Sam', partner2: '  ' }, 'partner2')).toBe('Partner 2')
  })

  it('labels the three sides, Both always Both', () => {
    expect(guestSides.map((s) => sideLabel(NOA_AIDEN, s))).toEqual(['Noa', 'Aiden', 'Both'])
    expect(guestSides.map((s) => sideLabel(UNNAMED, s))).toEqual(['Partner 1', 'Partner 2', 'Both'])
  })

  it('offers partner 1, partner 2, then Both', () => {
    expect(sideOptions({ partner1: 'Sam', partner2: 'Alex' })).toEqual([
      { value: 'partner1', label: 'Sam' },
      { value: 'partner2', label: 'Alex' },
      { value: 'both', label: 'Both' },
    ])
  })

  it("reads a wedding's columns", () => {
    expect(partnersOf({ partner1Name: 'Sam', partner2Name: null })).toEqual({ partner1: 'Sam', partner2: null })
  })
})

describe('ceremonySideLabels', () => {
  it("puts partner 1 on the left and partner 2 on the right, as Noa's and Aiden's sides always were", () => {
    expect(ceremonySideLabels(NOA_AIDEN)).toEqual({ left: "Noa's side", right: "Aiden's side" })
    expect(ceremonySideLabels({ partner1: 'Sam', partner2: 'Alex' })).toEqual({ left: "Sam's side", right: "Alex's side" })
  })

  it('names no one without names, side by side', () => {
    expect(ceremonySideLabels(UNNAMED)).toEqual({ left: DEFAULT_LEFT_LABEL, right: DEFAULT_RIGHT_LABEL })
    expect(ceremonySideLabels(UNNAMED)).toEqual({ left: 'Left side', right: 'Right side' })
    expect(ceremonySideLabels({ partner1: null, partner2: 'Alex' })).toEqual({ left: 'Left side', right: "Alex's side" })
  })
})

describe('legacySide', () => {
  it('maps the old stored words to places and lets the codes through', () => {
    expect(legacySide('Noa')).toBe('partner1')
    expect(legacySide('Aiden')).toBe('partner2')
    expect(legacySide('Both')).toBe('both')
    for (const side of guestSides) expect(legacySide(side)).toBe(side)
  })

  it('knows nothing else', () => {
    for (const value of ['noa', 'BOTH', 'Sam', '', 'partner3']) expect(legacySide(value)).toBeNull()
  })
})

describe('the side words an import reads', () => {
  it("takes each partner's whole name, first name and possessives, ignoring case and accents", () => {
    const p = { partner1: 'Zoë Shapiro', partner2: "Liam O'Brien" }
    for (const cell of ['Zoë Shapiro', 'zoe', 'ZOE', "Zoë's", 'Zoes', "Zoe's side", 'Zoë Shapiro’s side', 'zoe shapiros']) {
      expect(read(p, cell), cell).toBe('partner1')
    }
    for (const cell of ['Liam', "liam o'brien", 'Liam’s', 'Liams side', "Liam O'Brien's"]) {
      expect(read(p, cell), cell).toBe('partner2')
    }
  })

  it('takes the apostrophe after a name ending in s', () => {
    expect(read({ partner1: 'James', partner2: 'Alex' }, "James' side")).toBe('partner1')
    expect(read({ partner1: 'James', partner2: 'Alex' }, "James's")).toBe('partner1')
  })

  it('takes Partner 1 and 2 and the words for both, in any wedding', () => {
    for (const p of [NOA_AIDEN, UNNAMED, { partner1: 'Sam', partner2: 'Alex' }]) {
      for (const cell of ['Partner 1', 'partner1', 'P1', 'partner 1 side']) expect(read(p, cell), cell).toBe('partner1')
      for (const cell of ['Partner 2', 'PARTNER2', 'p2']) expect(read(p, cell), cell).toBe('partner2')
      for (const cell of ['Both', 'both sides', 'Mutual', 'shared', 'either']) expect(read(p, cell), cell).toBe('both')
    }
  })

  it("takes Noa and Aiden only in a wedding whose partners they are", () => {
    expect(read(NOA_AIDEN, 'Noa')).toBe('partner1')
    expect(read(NOA_AIDEN, "Aiden's")).toBe('partner2')
    expect(read({ partner1: 'Sam', partner2: 'Alex' }, 'Noa')).toBeUndefined()
    expect(read(UNNAMED, 'Aiden')).toBeUndefined()
  })

  it('leaves out a word both partners share, but keeps what tells them apart', () => {
    const p = { partner1: 'Sam Lee', partner2: 'Sam Park' }
    expect(read(p, 'Sam')).toBeUndefined()
    expect(read(p, "Sam's side")).toBeUndefined()
    expect(read(p, 'Sam Lee')).toBe('partner1')
    expect(read(p, 'sam park')).toBe('partner2')
    const twins = { partner1: 'Alex', partner2: 'Álex' }
    expect(read(twins, 'Alex')).toBeUndefined()
    expect(read(twins, 'Partner 2')).toBe('partner2')
  })

  it('never lets a name take over the fixed words', () => {
    expect(read({ partner1: 'Both', partner2: 'Alex' }, 'Both')).toBe('both')
    expect(read({ partner1: 'Sam', partner2: 'P1' }, 'p1')).toBe('partner1')
  })

  it('does not understand bride, groom or blank', () => {
    for (const cell of ['Bride', 'groom', 'xyz', '']) expect(read(NOA_AIDEN, cell), cell).toBeUndefined()
  })
})
