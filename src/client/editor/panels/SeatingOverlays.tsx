'use client'

/**
 * What the seating tools show on top of the page (spec section 4, "Seating
 * guests"; PLAN section 6, "Seating guests" and "Phones"):
 *
 *  - GuestGhost: the guest's name following the pointer during a drag. The
 *    seating controller moves it with a transform each frame (bindGhost).
 *  - PickStrip: "Tap a seat for Jane D." with Cancel, while a tapped name
 *    waits for a seat (tap-then-tap).
 *  - SeatPicker: the + on an empty seat opened a short search list of
 *    unassigned guests; picking one seats them there. Beside the seat on a
 *    laptop; across the bottom of the screen on a phone.
 *  - SeatCard: a mouse resting on a taken seat, or a seat tapped in View
 *    mode: the guest's name, groups, meal, notes and any rule problems.
 *
 * Each reads only its own piece of the seating store, so a drag re-renders
 * none of them after it starts.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { SearchBox } from '@/client/guests/GuestFilters'
import { fullName } from '@/domain/guest-list'
import { evaluateRules, type LayoutKind } from '@/domain/rules'
import { useSeating } from '../seating/react'
import { seatPickerGuests } from '../seating/people'
import { useCanvas, useEditorState } from '../state/react'
import { useEditorUi } from './editor-ui'
import { useEditorGuests } from './guests-context'

/** The ghost: a dark pill with the guest's name, fixed at the window's top left and moved by transform. */
export function GuestGhost() {
  const { seating } = useEditorState()
  const text = useSeating((s) => s.drag?.text ?? null)
  const bindGhost = useCallback((element: HTMLDivElement | null) => seating.bindGhost(element), [seating])
  if (text === null) return null
  return (
    <div
      ref={bindGhost}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-50 max-w-64 truncate rounded-full bg-blue-900 px-3 py-1.5 text-sm font-medium text-white shadow-lg"
      data-testid="guest-ghost"
    >
      {text}
    </div>
  )
}

/** "Tap a seat for Jane D. · Cancel" while a name waits for a seat. */
export function PickStrip({ top }: { top: number }) {
  const { actions } = useEditorState()
  const prompt = useSeating((s) => s.pick?.prompt ?? null)
  if (prompt === null) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3" style={{ top }}>
      <div role="status" className="pointer-events-auto flex items-center gap-2 rounded-full bg-stone-900 py-1 pl-4 pr-1 text-sm text-white shadow-lg" data-testid="pick-strip">
        <span className="min-w-0 truncate">{prompt}</span>
        <button
          type="button"
          onClick={() => actions.cancelPick()}
          className="inline-flex min-h-11 items-center rounded-full px-4 font-medium text-white hover:bg-white/10"
          data-testid="pick-cancel"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/** Keeps a box of `w` by `h` px near `at` inside the window. */
function nearPoint(at: { x: number; y: number }, w: number, h: number): { left: number; top: number } {
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth
  const vh = typeof window === 'undefined' ? 900 : window.innerHeight
  const left = Math.min(Math.max(8, at.x + 24), Math.max(8, vw - w - 8))
  const top = Math.min(Math.max(8, at.y - 24), Math.max(8, vh - h - 8))
  return { left, top }
}

const PICKER_W = 288
const PICKER_H = 420

/** The + picker: a search box and up to 8 unassigned guests, each a 44 px row that seats them at the picker's seat. */
export function SeatPicker() {
  const picker = useSeating((s) => s.picker)
  if (!picker) return null
  return <PickerPanel key={`${picker.itemId}#${picker.seatIndex}`} />
}

function PickerPanel() {
  const { actions } = useEditorState()
  const { phone } = useEditorUi()
  const picker = useSeating((s) => s.picker)
  const { guests } = useEditorGuests()
  const items = useCanvas((c) => c.items)
  const [query, setQuery] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const list = useMemo(() => seatPickerGuests(guests, { items }, query), [guests, items, query])
  const anyUnseated = useMemo(() => seatPickerGuests(guests, { items }, '', 1).length > 0, [guests, items])

  // A press anywhere else closes it (the canvas closes it itself).
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const panel = panelRef.current
      if (panel && event.target instanceof Node && !panel.contains(event.target)) actions.closeSeatPicker()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [actions])

  useEffect(() => {
    if (!phone) panelRef.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [phone])

  if (!picker) return null
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      actions.closeSeatPicker()
    }
  }
  const place = phone ? null : nearPoint(picker.client, PICKER_W, PICKER_H)
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className={
        phone
          ? 'fixed inset-x-0 bottom-0 z-40 flex max-h-[70vh] flex-col rounded-t-2xl border-t border-stone-200 bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.18)]'
          : 'fixed z-40 flex max-h-[420px] w-72 flex-col rounded-xl border border-stone-200 bg-white shadow-xl'
      }
      style={place ? { left: place.left, top: place.top } : undefined}
      data-testid="seat-picker"
    >
      <div className="flex items-center gap-2 px-3 pt-2">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-semibold text-stone-900">
            Seat a guest
          </h2>
          <p className="truncate text-xs text-stone-600">{picker.label}</p>
        </div>
        <button
          type="button"
          onClick={() => actions.closeSeatPicker()}
          aria-label="Close"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl text-stone-600 hover:bg-stone-100"
          data-testid="seat-picker-close"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="px-3 py-2">
        <SearchBox value={query} onChange={setQuery} label="Search unassigned guests" testId="seat-picker-search" />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2">
        {list.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              onClick={() => actions.chooseForSeat(g.id)}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-stone-900 hover:bg-stone-100 focus-visible:bg-stone-100 focus-visible:outline-none"
              data-testid="seat-picker-guest"
              data-guest-id={g.id}
            >
              <span className="min-w-0 truncate">{fullName(g)}</span>
              {g.nickname && <span className="shrink-0 text-stone-500">({g.nickname})</span>}
            </button>
          </li>
        ))}
        {list.length === 0 && (
          <li className="px-3 py-3 text-sm text-stone-600">
            {guests.length === 0 ? 'No guests yet.' : anyUnseated ? 'No unassigned guests match.' : 'Everyone is seated.'}
          </li>
        )}
      </ul>
    </div>
  )
}

const CARD_W = 256
const CARD_H = 200

/** The card for a taken seat: name, groups, meal, notes and the guest's rule problems. */
export function SeatCard({ layoutKind = 'reception' }: { layoutKind?: LayoutKind }) {
  const card = useSeating((s) => s.card)
  const rules = useSeating((s) => s.people.rules)
  const { guests, groups } = useEditorGuests()
  const items = useCanvas((c) => c.items)
  const guest = card ? guests.find((g) => g.id === card.guestId) : undefined
  const problems = useMemo(() => {
    if (!card) return []
    const r = evaluateRules({ layoutKind, canvas: { items }, guests, rules })
    const out = (r.problemsByGuest.get(card.guestId) ?? []).map((p) => p.message)
    for (const w of r.warnings) if (w.guestId === card.guestId) out.push(w.message)
    return out
  }, [card, layoutKind, items, guests, rules])
  if (!card) return null
  const groupNames = guest ? groups.filter((g) => guest.groupIds.includes(g.id)).map((g) => g.name) : []
  const place = nearPoint(card.client, CARD_W, CARD_H)
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-40 w-64 rounded-xl border border-stone-200 bg-white p-3 text-sm shadow-xl"
      style={{ left: place.left, top: place.top }}
      data-testid="seat-card"
      data-guest-id={card.guestId}
    >
      <p className="font-semibold text-stone-900">
        {guest ? fullName(guest) : 'Guest'}
        {guest?.nickname && <span className="font-normal text-stone-500"> ({guest.nickname})</span>}
      </p>
      <dl className="mt-1 space-y-0.5 text-stone-700">
        {groupNames.length > 0 && (
          <div>
            <dt className="inline text-stone-500">Groups: </dt>
            <dd className="inline">{groupNames.join(', ')}</dd>
          </div>
        )}
        {guest?.meal && (
          <div>
            <dt className="inline text-stone-500">Meal: </dt>
            <dd className="inline">{guest.meal}</dd>
          </div>
        )}
        {guest?.notes && (
          <div>
            <dt className="inline text-stone-500">Notes: </dt>
            <dd className="inline whitespace-pre-line">{guest.notes}</dd>
          </div>
        )}
      </dl>
      {problems.length > 0 && (
        <ul className="mt-2 space-y-1" data-testid="seat-card-problems">
          {problems.map((m, i) => (
            <li key={i} className="rounded-lg bg-red-50 px-2 py-1 text-red-800">
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
