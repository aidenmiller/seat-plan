/**
 * The demo wedding's guest list (spec section 12): about 120 made-up guests
 * in households, 8 groups, 20 couples, 5 rules, and who sits where in the
 * seed's two blank-canvas layouts. Pure and the same on every run: names
 * come from a fixed random seed. Never real people.
 *
 * Guests are referred to by their index in `guests`. scripts/seed.ts writes
 * the plan; scripts/demo-guests.test.ts checks its shape.
 */

export type DemoSide = 'Noa' | 'Aiden' | 'Both'
export type DemoRsvp = 'yes' | 'no' | 'pending'

export type DemoGuest = {
  firstName: string
  lastName: string
  nickname: string | null
  household: string | null
  side: DemoSide
  rsvp: DemoRsvp
  meal: string | null
  isChild: boolean
  notes: string | null
  /** Group names. */
  groups: string[]
}

export type DemoRule = {
  kind: 'together' | 'apart'
  nextToEachOther: boolean
  appliesTo: 'reception' | 'ceremony' | 'both'
  /** Also how the seed knows the rule is already there. */
  note: string
  guests: number[]
}

/** One table of a layout: the guests in seat order (seat 1 first). */
export type DemoTable = { number: number; guests: number[] }

export type DemoPlan = {
  guests: DemoGuest[]
  groups: string[]
  /** Partner pairs, each guest in at most one. */
  couples: [number, number][]
  rules: DemoRule[]
  /** Layout name to its tables. */
  seating: Record<string, DemoTable[]>
}

export const DEMO_GROUPS = [
  'Noa Family',
  'Aiden Family',
  'Noa Cousins',
  'Aiden HS Friends',
  'Noa University',
  'Aiden Work',
  'Neighbours',
  'Family Friends',
] as const

/** The seats each layout's tables have, by table number, as scripts/seed.ts makes them. */
export type TableSeats = { number: number; seats: number }[]

// ---------------------------------------------------------------------------
// Made-up names

const FIRST_NAMES = [
  'Amara', 'Ayesha', 'Beatriz', 'Camila', 'Chloé', 'Clara', 'Daniela', 'Elena', 'Esther', 'Fatima', 'Freya', 'Grace',
  'Hana', 'Ines', 'Isla', 'Keiko', 'Leila', 'Lucia', 'Margot', 'Maya', 'Mei', 'Nadia', 'Nora', 'Priya', 'Renée',
  'Rosa', 'Sienna', 'Sofia', 'Thandiwe', 'Yuki', 'Anaïs', 'Ingrid', 'Aisha', 'Olivia', 'Harper', 'Jade',
  'Andrés', 'Arjun', 'Björn', 'Diego', 'Elias', 'Ethan', 'Ezra', 'Hiroshi', 'Hugo', 'Ibrahim', 'Isaac', 'Jakub',
  'José', 'Kenji', 'Kwame', 'Leo', 'Lucas', 'Malik', 'Marcus', 'Mateo', 'Mikael', 'Nathan', 'Omar', 'Oscar',
  'Pierre', 'Rafael', 'Ravi', 'Samuel', 'Søren', 'Tariq', 'Tomás', 'Wei', 'Theo', 'Jonas', 'Felipe', 'Dmitri',
]

const LAST_NAMES = [
  'Abadi', 'Andersen', 'Becker', 'Bennett', 'Bianchi', 'Chen', 'Costa', 'de Vries', 'Dubois', 'Dvořák', 'Ellis',
  'Fischer', 'Foster', 'García', 'Haddad', 'Hughes', 'Johansson', 'Kaplan', 'Khan', 'Kim', 'Kowalczyk', 'Lindqvist',
  'MacLeod', 'Martínez', 'Mensah', 'Mizrahi', 'Moreau', 'Müller', 'Murphy', 'Nguyen', 'Novak', 'Okafor', 'Ortiz',
  'Park', 'Patel', 'Peretz', 'Rahman', 'Ramírez', 'Reyes', 'Rossi', 'Sato', 'Schmidt', 'Shah', 'Silva', 'Singh',
  'Stein', 'Tanaka', 'Tran', 'van der Berg', 'Walsh', 'Weiss', 'Wong', 'Núñez', 'Goldberg', 'Hayes', 'Ito',
]

const MEALS = ['Vegetarian', 'Vegan', 'Fish', 'Gluten free']
const NOTES = ['Arrives after the ceremony', 'Leaves before dessert', 'Nut allergy', 'Prefers a seat near the door', 'Bringing a plus one later in the evening']

/** A small seeded random number generator (mulberry32), so every run gives the same list. */
function randomFrom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Households

type PersonSpec = {
  first?: string
  last?: string
  nickname?: string
  child?: boolean
  /** Groups on top of the household's. */
  groups?: string[]
  notes?: string
  meal?: string
  /** Sits at the head table. */
  head?: boolean
  /** A name the rules and the seating pick out. */
  key?: string
}

type UnitSpec = {
  side: DemoSide
  groups: string[]
  last?: string
  /** people[0] and people[1] are partners. */
  couple?: boolean
  /** Always yes (close family and the wedding party). */
  sure?: boolean
  people: PersonSpec[]
}

const NF = 'Noa Family'
const AF = 'Aiden Family'
const NC = 'Noa Cousins'
const HS = 'Aiden HS Friends'
const UNI = 'Noa University'
const WORK = 'Aiden Work'
const NB = 'Neighbours'
const FF = 'Family Friends'

/** The families, written out; the friends come from the random names. */
const FAMILY_UNITS: UnitSpec[] = [
  // Noa's family.
  { side: 'Noa', groups: [NF], last: 'Levi', couple: true, sure: true, people: [{ first: 'Miriam', head: true }, { first: 'David', head: true }] },
  { side: 'Noa', groups: [NF], last: 'Levi', sure: true, people: [{ first: 'Tamar', head: true, key: 'tamar' }] },
  {
    side: 'Noa',
    groups: [NF],
    last: 'Levi',
    couple: true,
    sure: true,
    people: [
      { first: 'Ruth', nickname: 'Savta', key: 'ruth' },
      { first: 'Yosef', notes: 'Uses a walker. Seat him near the door.', key: 'yosef' },
    ],
  },
  { side: 'Noa', groups: [NF], last: 'Shapiro', sure: true, people: [{ first: 'Esther', notes: 'Hard of hearing. Away from the speakers.', key: 'esther' }] },
  {
    side: 'Noa',
    groups: [NF],
    last: 'Shapiro',
    couple: true,
    people: [{ first: 'Hannah' }, { first: 'Jonah', meal: 'Vegetarian' }, { first: 'Lily', child: true, groups: [NC], meal: 'Kids meal' }, { first: 'Max', child: true, groups: [NC], notes: 'Needs a booster seat' }],
  },
  {
    side: 'Noa',
    groups: [NF],
    couple: true,
    people: [{ first: 'Rachel', last: 'Levi' }, { first: 'Łukasz', last: 'Nowak' }, { first: 'Maya', last: 'Nowak', child: true, groups: [NC], meal: 'Kids meal' }],
  },
  { side: 'Noa', groups: [NF], last: 'Levi', people: [{ first: 'Daniel' }] },
  { side: 'Noa', groups: [NF, NC], couple: true, people: [{ first: 'Zoë', last: 'Shapiro' }, { first: 'Felix', last: 'Wagner' }] },
  { side: 'Noa', groups: [NF, NC], last: 'Levi', people: [{ first: 'Talia' }] },
  { side: 'Noa', groups: [NF, NC], last: 'Levi', people: [{ first: 'Ari' }] },
  { side: 'Noa', groups: [NF, NC], last: 'Shapiro', people: [{ first: 'Noam' }] },
  { side: 'Noa', groups: [NF, NC], last: 'Levi', people: [{ first: 'Gabriel', meal: 'Vegan' }] },
  { side: 'Noa', groups: [NF, NC], last: 'Shapiro', people: [{ first: 'Yael' }] },

  // Aiden's family.
  { side: 'Aiden', groups: [AF], last: 'Brooks', couple: true, sure: true, people: [{ first: 'Karen', head: true }, { first: 'Michael', head: true }] },
  { side: 'Aiden', groups: [AF], last: 'Brooks', sure: true, people: [{ first: 'Owen', head: true }] },
  {
    side: 'Aiden',
    groups: [AF],
    couple: true,
    sure: true,
    people: [{ first: 'Claire', last: 'Brooks', head: true }, { first: 'Chidi', last: 'Okafor', head: true }, { first: 'Ada', last: 'Okafor', child: true, meal: 'Kids meal' }],
  },
  { side: 'Aiden', groups: [AF], last: "O'Neill", sure: true, people: [{ first: 'Margaret', nickname: 'Nana' }] },
  {
    side: 'Aiden',
    groups: [AF],
    last: "O'Neill",
    couple: true,
    sure: true,
    people: [{ first: 'Siobhán' }, { first: 'Patrick', key: 'patrick' }, { first: 'Finn', child: true }, { first: 'Nora', child: true, meal: 'Kids meal' }],
  },
  { side: 'Aiden', groups: [AF], last: 'Brooks', sure: true, people: [{ first: 'Linda', key: 'linda' }] },
  { side: 'Aiden', groups: [AF], last: "O'Neill", people: [{ first: 'Ryan' }] },
  { side: 'Aiden', groups: [AF], last: 'Brooks', people: [{ first: 'Kate' }] },
  { side: 'Aiden', groups: [AF], last: "O'Neill", people: [{ first: 'Sean', meal: 'Gluten free' }] },
  { side: 'Aiden', groups: [AF], last: 'Brooks', people: [{ first: 'Emily' }] },
]

/** Friends' households: how many couples (and couples with children) and singles each circle has. */
type Circle = { side: DemoSide; groups: string[]; couples: number; families?: number[]; singles: number; head?: number; keys?: string[] }
const CIRCLES: Circle[] = [
  // Two of Noa's university friends sit at the head table; the first two singles of Aiden HS too.
  { side: 'Noa', groups: [UNI], couples: 2, singles: 12, head: 2, keys: ['uni-1', 'uni-2'] },
  { side: 'Aiden', groups: [HS], couples: 2, singles: 11, head: 2, keys: ['hs-1', 'hs-2', 'hs-3', 'hs-4', 'hs-5'] },
  { side: 'Aiden', groups: [WORK], couples: 1, singles: 12, keys: ['work-1'] },
  { side: 'Both', groups: [NB], couples: 1, families: [1], singles: 2 },
  { side: 'Both', groups: [FF], couples: 2, families: [2], singles: 4 },
  { side: 'Noa', groups: [], couples: 0, families: [1], singles: 7 },
  { side: 'Aiden', groups: [], couples: 1, singles: 7, keys: ['aiden-1'] },
]

type Built = DemoGuest & { unit: number; head: boolean; key: string | null }

function householdName(people: { lastName: string }[]): string | null {
  if (people.length < 2) return null
  const names = [...new Set(people.map((p) => p.lastName))]
  return names.join(' and ')
}

function build(): { guests: Built[]; couples: [number, number][] } {
  const rand = randomFrom(20270619)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!
  const used = new Set<string>()
  const guests: Built[] = []
  const couples: [number, number][] = []

  const unitRsvp = (sure: boolean): DemoRsvp => {
    if (sure) return 'yes'
    const r = rand()
    return r < 0.07 ? 'no' : r < 0.2 ? 'pending' : 'yes'
  }
  /** A made-up name no one has yet, kept for whoever asked. */
  const freshName = (last?: string): { first: string; last: string } => {
    for (;;) {
      const name = { first: pick(FIRST_NAMES), last: last ?? pick(LAST_NAMES) }
      const full = `${name.first} ${name.last}`
      if (used.has(full)) continue
      used.add(full)
      return name
    }
  }

  const addUnit = (unit: UnitSpec, unitIndex: number) => {
    const rsvp = unitRsvp(unit.sure ?? false)
    const people = unit.people.map((p) => {
      const name = p.first ? { first: p.first, last: p.last ?? unit.last! } : freshName(p.last ?? unit.last)
      used.add(`${name.first} ${name.last}`)
      return { spec: p, name }
    })
    const household = householdName(people.map((p) => ({ lastName: p.name.last })))
    const start = guests.length
    for (const { spec, name } of people) {
      const adultMeal = !spec.child && rand() < 0.12 ? pick(MEALS) : null
      const note = !spec.child && rand() < 0.05 ? pick(NOTES) : null
      guests.push({
        firstName: name.first,
        lastName: name.last,
        nickname: spec.nickname ?? null,
        household,
        side: unit.side,
        rsvp,
        meal: spec.meal ?? adultMeal,
        isChild: spec.child ?? false,
        notes: spec.notes ?? note,
        groups: [...unit.groups, ...(spec.groups ?? [])],
        unit: unitIndex,
        head: spec.head ?? false,
        key: spec.key ?? null,
      })
    }
    if (unit.couple) couples.push([start, start + 1])
  }

  let unitIndex = 0
  for (const unit of FAMILY_UNITS) addUnit(unit, unitIndex++)
  for (const circle of CIRCLES) {
    const units: UnitSpec[] = []
    const together = () => rand() < 0.5
    for (let i = 0; i < circle.couples; i++) {
      const first = freshName()
      units.push({ side: circle.side, groups: circle.groups, couple: true, people: [{ first: first.first, last: first.last }, { last: together() ? first.last : undefined }] })
    }
    for (const kids of circle.families ?? []) {
      const first = freshName()
      const kidList: PersonSpec[] = Array.from({ length: kids }, () => ({ last: first.last, child: true }))
      units.push({ side: circle.side, groups: circle.groups, couple: true, people: [{ first: first.first, last: first.last }, { last: first.last }, ...kidList] })
    }
    for (let i = 0; i < circle.singles; i++) units.push({ side: circle.side, groups: circle.groups, people: [{}] })
    // Singles first in the circle get the head table seats and the rule keys.
    const singles = units.filter((u) => !u.couple)
    singles.forEach((u, i) => {
      u.people[0] = { ...u.people[0], head: i < (circle.head ?? 0), key: circle.keys?.[i] }
      if (i < (circle.head ?? 0)) u.sure = true
    })
    for (const unit of units) addUnit(unit, unitIndex++)
  }
  return { guests, couples }
}

// ---------------------------------------------------------------------------
// Seating

type Party = number[]

/** Households as parties, with head table guests taken out; declined guests never sit. */
function parties(guests: readonly Built[], filter: (g: Built) => boolean): Party[] {
  const byUnit = new Map<number, number[]>()
  guests.forEach((g, i) => {
    if (!filter(g) || g.rsvp === 'no') return
    const list = byUnit.get(g.unit) ?? []
    list.push(i)
    byUnit.set(g.unit, list)
  })
  return [...byUnit.values()]
}

/**
 * Fills tables in order from a queue of parties, keeping each party at one
 * table: a party too big for the seats left waits for the next table, and a
 * smaller one from further back fills in.
 */
function fillTables(tables: TableSeats, queue: Party[], taken: Set<number>): DemoTable[] {
  const waiting = queue.map((p) => p.filter((i) => !taken.has(i))).filter((p) => p.length > 0)
  return tables.map(({ number, seats }) => {
    const table: number[] = []
    for (;;) {
      const left = seats - table.length
      const at = waiting.findIndex((p) => p.length <= left)
      if (left === 0 || at < 0) break
      const [party] = waiting.splice(at, 1)
      for (const i of party!) {
        table.push(i)
        taken.add(i)
      }
    }
    return { number, guests: table }
  })
}

/** "Canvas tour": 1 head (12, one side), 2 sweetheart (2), 3 and 4 round (8), 5 square (8), 6 rectangle (8). */
export const TOUR_TABLES: TableSeats = [
  { number: 1, seats: 12 },
  { number: 2, seats: 2 },
  { number: 3, seats: 8 },
  { number: 4, seats: 8 },
  { number: 5, seats: 8 },
  { number: 6, seats: 8 },
]

/** "Reception plan A": five round tables of 8. */
export const PLAN_A_TABLES: TableSeats = [1, 2, 3, 4, 5].map((number) => ({ number, seats: 8 }))

export function demoPlan(names: { tour: string; planA: string }): DemoPlan {
  const { guests, couples } = build()
  const key = (k: string) => {
    const i = guests.findIndex((g) => g.key === k)
    if (i < 0) throw new Error(`No demo guest "${k}"`)
    return i
  }
  const inGroup = (group: string) => (g: Built) => g.groups.includes(group)

  // Canvas tour: the wedding party at the head table, the sweetheart table
  // left for Noa and Aiden, then each family and two circles of friends.
  const tourTaken = new Set<number>()
  const head = guests.map((g, i) => (g.head ? i : -1)).filter((i) => i >= 0)
  for (const i of head) tourTaken.add(i)
  const [, sweetheart, ...rest] = TOUR_TABLES
  const filled = [
    ...fillTables([rest[0]!], parties(guests, (g) => inGroup(NF)(g) && !g.head), tourTaken),
    ...fillTables([rest[1]!], parties(guests, (g) => inGroup(AF)(g) && !g.head), tourTaken),
    ...fillTables([rest[2]!], parties(guests, (g) => inGroup(UNI)(g) && !g.head), tourTaken),
    ...fillTables([rest[3]!], parties(guests, (g) => inGroup(HS)(g) && !g.head), tourTaken),
  ]
  // One couple split on purpose, for the seating rules to find later: the
  // first couple at the rectangle swaps one partner with a single at the square.
  const square = filled[2]!.guests
  const rect = filled[3]!.guests
  const coupleAtRect = couples.find(([a, b]) => rect.includes(a) && rect.includes(b))
  const singleAtSquare = square.find((i) => !couples.some(([a, b]) => a === i || b === i))
  if (coupleAtRect && singleAtSquare !== undefined) {
    const moved = coupleAtRect[1]
    rect[rect.indexOf(moved)] = singleAtSquare
    square[square.indexOf(singleAtSquare)] = moved
  }
  const tour: DemoTable[] = [{ number: TOUR_TABLES[0]!.number, guests: head }, { number: sweetheart!.number, guests: [] }, ...filled]

  // Reception plan A: the circles the tour leaves out.
  const planATaken = new Set<number>()
  const planA = fillTables(
    PLAN_A_TABLES,
    [
      ...parties(guests, inGroup(FF)),
      ...parties(guests, inGroup(NB)),
      ...parties(guests, inGroup(WORK)),
      ...parties(guests, (g) => g.groups.length === 0 && g.side === 'Noa'),
    ],
    planATaken,
  )

  // Rules: four together (one next to each other; one with a guest no
  // layout seats yet, so it stays unfinished) and one apart that the tour
  // breaks (Linda and Patrick share table 4).
  const rules: DemoRule[] = [
    { kind: 'together', nextToEachOther: true, appliesTo: 'both', note: 'Best friends since first year', guests: [key('uni-1'), key('uni-2')] },
    { kind: 'together', nextToEachOther: false, appliesTo: 'reception', note: 'The grandparents at one table', guests: [key('ruth'), key('yosef'), key('esther')] },
    { kind: 'together', nextToEachOther: false, appliesTo: 'reception', note: 'The old band', guests: [key('hs-3'), key('hs-4'), key('hs-5')] },
    { kind: 'together', nextToEachOther: false, appliesTo: 'both', note: 'Driving in together', guests: [key('work-1'), key('aiden-1')] },
    { kind: 'apart', nextToEachOther: false, appliesTo: 'both', note: 'Not on speaking terms', guests: [key('linda'), key('patrick')] },
  ]

  return {
    guests: guests.map((g) => ({
      firstName: g.firstName,
      lastName: g.lastName,
      nickname: g.nickname,
      household: g.household,
      side: g.side,
      rsvp: g.rsvp,
      meal: g.meal,
      isChild: g.isChild,
      notes: g.notes,
      groups: g.groups,
    })),
    groups: [...DEMO_GROUPS],
    couples,
    rules,
    seating: { [names.tour]: tour, [names.planA]: planA },
  }
}
