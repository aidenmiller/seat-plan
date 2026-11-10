/**
 * The editor's rules check, problems list and group highlighting, worked
 * out outside React on every canvas change (spec section 7: "Check rules on
 * every change"), so the page itself never re-renders for it. Tables, rows
 * and seats read their own marks through useItemMarks(), which re-renders
 * a table only when its badge, rings or fading change.
 *
 * Marks:
 *  - problem: a broken rule puts a red badge on the table and red rings on
 *    the seats involved. Wall crossings keep their own badge (TableView).
 *  - unfinished: a together rule with only some guests seated marks its
 *    table and seated guests grey.
 *  - ring / faded: while groups are picked in the Groups tab, their seated
 *    members get a ring in the group color and everything else fades.
 */
import { createContext, useCallback, useContext } from 'react'
import type { Canvas, Item } from '@/domain/canvas-schema'
import { groupHighlight, type GroupHighlight, type HighlightGroup } from '@/domain/group-highlight'
import { layoutProblems, type ProblemList, type ProblemsGuest } from '@/domain/problems'
import { seatKey, type LayoutKind, type Rule } from '@/domain/rules'
import { isSeatItem, seatsByGuest } from '@/domain/seating'
import { DEFAULT_MIN_GAP_CM } from '@/domain/spacing'
import type { LengthUnit } from '@/domain/units'
import type { FixedItem } from '@/domain/venue-schema'
import { createStore, useStoreSelector, type Listener, type Store } from '../state/store'

export type AnalysisInputs = {
  layoutKind: LayoutKind
  guests: readonly ProblemsGuest[]
  groups: readonly HighlightGroup[]
  rules: readonly Rule[]
  unit: LengthUnit
  minGapCm: number
  venue: readonly FixedItem[]
  /** The groups picked in the Groups tab, at most three. */
  chosen: readonly string[]
}

export type Analysis = {
  list: ProblemList
  highlight: GroupHighlight
  /** Tables and rows of unfinished together rules. */
  unfinishedItems: ReadonlySet<string>
  /** Seats (seatKey) of guests in unfinished together rules. */
  unfinishedSeats: ReadonlySet<string>
  /** The canvas the analysis was worked out from. */
  items: readonly Item[]
}

export type SeatMark = { problem: boolean; unfinished: boolean; ring: string | null; faded: boolean }
export type ItemMarks = {
  /** Red for a broken rule, grey for an unfinished one. */
  badge: 'problem' | 'unfinished' | null
  /** A group is picked and nobody here is in it. */
  faded: boolean
  seats: readonly SeatMark[]
}

const NO_MARKS: ItemMarks = Object.freeze({ badge: null, faded: false, seats: Object.freeze([]) })

export function analyse(items: readonly Item[], inputs: AnalysisInputs): Analysis {
  const canvas = { items: items as Item[] }
  const list = layoutProblems({
    layoutKind: inputs.layoutKind,
    canvas,
    guests: inputs.guests,
    rules: inputs.rules,
    unit: inputs.unit,
    minGapCm: inputs.minGapCm,
    walls: inputs.venue,
  })
  const unfinishedItems = new Set<string>()
  const unfinishedSeats = new Set<string>()
  if (list.rules.unfinished.length > 0) {
    const seats = seatsByGuest(canvas)
    for (const u of list.rules.unfinished) {
      for (const id of u.itemIds) unfinishedItems.add(id)
      for (const g of u.seatedGuestIds) {
        const s = seats.get(g)
        if (s) unfinishedSeats.add(seatKey(s.itemId, s.seatIndex))
      }
    }
  }
  return { list, highlight: groupHighlight(canvas, inputs.groups, inputs.chosen), unfinishedItems, unfinishedSeats, items }
}

/** One table's or row's marks. */
export function itemMarks(analysis: Analysis, item: Item | undefined): ItemMarks {
  if (!item || !isSeatItem(item)) return NO_MARKS
  const { list, highlight } = analysis
  const id = item.id
  const ruleProblem = (list.byItem.get(id) ?? []).some((e) => e.kind === 'rule')
  const badge = ruleProblem ? 'problem' : analysis.unfinishedItems.has(id) ? 'unfinished' : null
  const faded = highlight.fade && !highlight.itemIds.has(id)
  const seats = item.seats.map((_, i): SeatMark => {
    const key = seatKey(id, i)
    const ring = highlight.rings.get(key)?.color ?? null
    return {
      problem: (list.bySeat.get(key) ?? []).some((e) => e.kind === 'rule'),
      unfinished: analysis.unfinishedSeats.has(key),
      ring,
      faded: highlight.fade && ring === null,
    }
  })
  return { badge, faded, seats }
}

export function sameMarks(a: ItemMarks, b: ItemMarks): boolean {
  if (a === b) return true
  if (a.badge !== b.badge || a.faded !== b.faded || a.seats.length !== b.seats.length) return false
  for (let i = 0; i < a.seats.length; i++) {
    const x = a.seats[i]
    const y = b.seats[i]
    if (x.problem !== y.problem || x.unfinished !== y.unfinished || x.ring !== y.ring || x.faded !== y.faded) return false
  }
  return true
}

export type AnalysisController = {
  store: Store<{ analysis: Analysis }>
  setInputs(patch: Partial<AnalysisInputs>): void
  inputs(): AnalysisInputs
  destroy(): void
}

type CanvasSource = { getState(): { canvas: Canvas }; subscribe(listener: Listener): () => void }

export const DEFAULT_INPUTS: AnalysisInputs = Object.freeze({
  layoutKind: 'reception',
  guests: [],
  groups: [],
  rules: [],
  unit: 'ft',
  minGapCm: DEFAULT_MIN_GAP_CM,
  venue: [],
  chosen: [],
})

/** Works the analysis out again whenever the canvas or an input changes. */
export function createAnalysis(doc: CanvasSource, initial: Partial<AnalysisInputs> = {}): AnalysisController {
  let inputs: AnalysisInputs = { ...DEFAULT_INPUTS, ...initial }
  const store = createStore({ analysis: analyse(doc.getState().canvas.items, inputs) })
  const off = doc.subscribe(() => {
    const items = doc.getState().canvas.items
    if (items !== store.getState().analysis.items) store.setState({ analysis: analyse(items, inputs) })
  })
  return {
    store,
    inputs: () => inputs,
    setInputs(patch) {
      const next = { ...inputs, ...patch }
      const changed = (Object.keys(patch) as (keyof AnalysisInputs)[]).some((k) => !Object.is(inputs[k], next[k]))
      inputs = next
      if (changed) store.setState({ analysis: analyse(doc.getState().canvas.items, inputs) })
    },
    destroy: off,
  }
}

const AnalysisContext = createContext<AnalysisController | null>(null)
export const AnalysisProvider = AnalysisContext.Provider

const EMPTY_STORE = createStore({ analysis: analyse([], DEFAULT_INPUTS) })

/** The analysis store, or an empty one outside the editor (tests of single views). */
export function useAnalysisStore(): Store<{ analysis: Analysis }> {
  return useContext(AnalysisContext)?.store ?? EMPTY_STORE
}

export function useAnalysisController(): AnalysisController | null {
  return useContext(AnalysisContext)
}

export function useAnalysis<U>(selector: (a: Analysis) => U, isEqual: (a: U, b: U) => boolean = Object.is): U {
  return useStoreSelector(useAnalysisStore(), (s) => selector(s.analysis), isEqual)
}

/** A table's or row's badge, seat rings and fading. */
export function useItemMarks(item: Item | undefined): ItemMarks {
  return useAnalysis(
    useCallback((a: Analysis) => itemMarks(a, item), [item]),
    sameMarks,
  )
}
