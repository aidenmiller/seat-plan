'use client'

/**
 * The venue's view of one layout (spec section 2, "View-only link for the
 * venue"; PLAN change 24 and section 7, "Share view"). It reuses the
 * editor's camera, input and render layers in View mode, with nothing that
 * edits: pan and zoom with a mouse, the wheel, a trackpad, or one finger and
 * a pinch on touch screens; the detail levels; the zoom buttons and Fit.
 *
 * The top bar holds the layout's and the wedding's names, and when the link
 * shows names, a search: typing part of a name pans to that guest's seat
 * once only one guest matches, and a tap on a result pans to theirs. A tap
 * or a resting mouse on a taken seat shows a card with the guest's name
 * (when the link shows names), meal and child flag, nothing else.
 *
 * Everything shown comes from GET /share/<token>/data, built on the server
 * from the link's switches, so hidden parts never reach this page. The page
 * asks again when it regains focus and every 60 seconds. A 401 (the link was
 * turned off or its password changed) or a 404 or 410 (the layout is gone)
 * clears the plan and shows the password page.
 *
 * Test hooks: data-testid share-viewer, share-layout-name,
 * share-wedding-name, share-search, share-search-result (data-guest-key),
 * share-seat-card; the canvas keeps the editor's own hooks.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createDocStore } from '@/client/editor/doc-store'
import { usePhoneLayout } from '@/client/editor/panels/editor-ui'
import { nearPoint } from '@/client/editor/panels/SeatingOverlays'
import { ZOOM_CONTROLS_PX, ZoomControls } from '@/client/editor/panels/ZoomControls'
import type { ScreenInsets } from '@/client/editor/overlay/geometry'
import { CanvasViewport } from '@/client/editor/render/CanvasViewport'
import { createEditorState, EditorStateProvider, useEditorState, useSeating, type EditorState } from '@/client/editor/state'
import { inputClass } from '@/client/ui/styles'
import { CANVAS_SCHEMA_VERSION, type Canvas } from '@/domain/canvas-schema'
import {
  SHARE_RECHECK_MS,
  searchShareGuests,
  shareGuestName,
  sharePeopleGuests,
  shareRecheckOutcome,
  shareSeatCard,
  type ShareGuest,
  type ShareView,
} from '@/domain/share-view'
import { DEFAULT_MIN_GAP_CM } from '@/domain/spacing'
import type { FixedItem } from '@/domain/venue-schema'
import { SharePasswordPage } from './SharePasswordPage'

/**
 * Room that Fit leaves round the plan: the zoom controls along the bottom,
 * and a margin on the other sides for names that run out past the chairs.
 */
const SHARE_INSETS: ScreenInsets = Object.freeze({ top: 48, right: 16, bottom: 8 + ZOOM_CONTROLS_PX + 8, left: 16 })

function canvasOf(view: ShareView): Canvas {
  return { schemaVersion: CANVAS_SCHEMA_VERSION, items: view.items }
}

/**
 * The plan, or the password page once the link stops working. The server
 * page hands over the first copy of the data; a sign-in on this page's own
 * password form refreshes the server page, which hands over a new copy.
 */
export function ShareViewer({ token, initial }: { token: string; initial: ShareView }) {
  const [view, setView] = useState<ShareView | null>(initial)
  const [given, setGiven] = useState(initial)
  if (given !== initial) {
    setGiven(initial)
    setView(initial)
  }

  const signedIn = view !== null
  useEffect(() => {
    if (!signedIn) return
    let stopped = false
    let busy = false
    async function check() {
      if (busy || stopped) return
      busy = true
      try {
        const res = await fetch(`/share/${token}/data`, { cache: 'no-store', referrerPolicy: 'no-referrer' })
        if (stopped) return
        const outcome = shareRecheckOutcome(res.status)
        if (outcome === 'signedOut') {
          stopped = true
          setView(null)
          return
        }
        if (outcome !== 'show') return
        const next = (await res.json()) as ShareView
        if (stopped) return
        // Only a change re-renders the plan.
        setView((current) => (current && JSON.stringify(current) === JSON.stringify(next) ? current : next))
      } catch {
        // Offline or a cut-off reply: the next check tries again.
      } finally {
        busy = false
      }
    }
    const timer = window.setInterval(() => void check(), SHARE_RECHECK_MS)
    const onFocus = () => {
      if (document.visibilityState === 'visible') void check()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [signedIn, token])

  if (!view) return <SharePasswordPage token={token} />
  return <SharePlan view={view} />
}

/** What the editor state reads from the page as it changes. */
function createBridge(view: ShareView) {
  let current = view
  return {
    get: () => current,
    set(next: ShareView) {
      current = next
    },
  }
}

/** The editor core for the shared layout: View mode only, and nothing it does can change the plan. */
function createShareEditor(view: ShareView, bridge: ReturnType<typeof createBridge>): EditorState {
  const editor = createEditorState({
    layoutId: 'share',
    store: createDocStore<Canvas>(canvasOf(view)),
    canEdit: () => false,
    onCommit: () => undefined,
    settings: () => ({ unit: bridge.get().unit, minGapCm: DEFAULT_MIN_GAP_CM }),
    venueItems: () => bridge.get().venue,
    layoutKind: view.kind,
    // Nothing kept in this browser: no remembered mode, camera or clipboard.
    storage: null,
  })
  // Read the device now, so mounting the canvas does not pick Edit mode on a laptop.
  if (typeof window !== 'undefined') editor.loadDevice()
  editor.ui.setState({ mode: 'view' })
  return editor
}

const NO_UNSEAT = () => undefined

function SharePlan({ view }: { view: ShareView }) {
  const [bridge] = useState(() => createBridge(view))
  const [editor] = useState(() => createShareEditor(view, bridge))

  // Strict Mode runs effects twice in development, so the editor is torn down
  // only once nothing has mounted it again.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    // View mode only, whatever asks.
    const offMode = editor.ui.subscribe(() => {
      if (editor.ui.getState().mode !== 'view') editor.ui.setState({ mode: 'view' })
    })
    return () => {
      offMode()
      mounted.current = false
      setTimeout(() => {
        if (!mounted.current) editor.destroy()
      }, 0)
    }
  }, [editor])

  // A newer save, or the link's switches changed: show what the server sent.
  const shownItems = useRef<string | null>(null)
  useEffect(() => {
    bridge.set(view)
    const items = JSON.stringify(view.items)
    if (shownItems.current !== null && items !== shownItems.current) editor.store.replace(canvasOf(view))
    shownItems.current = items
    editor.setUnit(view.unit)
    editor.labels.refresh()
  }, [bridge, editor, view])

  useEffect(() => {
    editor.setPeople({ guests: sharePeopleGuests(view.guests) })
  }, [editor, view.guests])

  // Fit keeps the content clear of the zoom controls.
  useLayoutEffect(() => {
    editor.camera.setFitInsets(SHARE_INSETS)
  }, [editor])

  // Once the page has its final size, fit the plan to the screen.
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current) return
    const frame = requestAnimationFrame(() => {
      fitted.current = true
      editor.camera.measure()
      editor.actions.zoomFit()
    })
    return () => cancelAnimationFrame(frame)
  }, [editor])

  const venue: readonly FixedItem[] = view.venue
  const phone = usePhoneLayout()

  return (
    <EditorStateProvider state={editor}>
      <div
        className="flex h-dvh flex-col overflow-hidden bg-stone-100"
        data-editor-root=""
        data-mode="view"
        data-phone={phone ? 'true' : undefined}
        data-testid="share-viewer"
      >
        <header className="relative z-20 flex flex-col gap-2 border-b border-stone-200 bg-white px-4 py-2 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-stone-900 sm:text-lg" data-testid="share-layout-name">
              {view.layoutName}
            </h1>
            <p className="truncate text-sm text-stone-600" data-testid="share-wedding-name">
              {view.weddingName}
            </p>
          </div>
          {view.showNames && <ShareSearch guests={view.guests} />}
        </header>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <CanvasViewport venue={venue} onConfirmUnseat={NO_UNSEAT} insets={SHARE_INSETS} />
          <div className="absolute bottom-2 right-2 z-10">
            <ZoomControls />
          </div>
        </div>
        <ShareSeatCard guests={view.guests} />
      </div>
    </EditorStateProvider>
  )
}

/**
 * Find a guest: every word typed must be part of their first or last name.
 * Once only one guest matches, the view pans to their seat; a tap on any
 * result, or Enter for the first, does the same.
 */
function ShareSearch({ guests }: { guests: readonly ShareGuest[] }) {
  const { actions } = useEditorState()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const results = useMemo(() => searchShareGuests(guests, query), [guests, query])
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const listId = useId()

  const go = useCallback(
    (key: string) => {
      actions.panToGuest(key)
      setOpen(false)
      inputRef.current?.blur()
    },
    [actions],
  )

  // Typing until one guest matches pans to their seat, once per guest.
  const only = results.length === 1 ? results[0]!.key : null
  const panned = useRef<string | null>(null)
  useEffect(() => {
    if (only === null) {
      panned.current = null
      return
    }
    if (panned.current === only) return
    panned.current = only
    actions.panToGuest(only)
  }, [only, actions])

  // A press anywhere else closes the results.
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      const box = boxRef.current
      if (box && event.target instanceof Node && !box.contains(event.target)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [open])

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      const first = results[0]
      if (first) go(first.key)
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const showList = open && query.trim() !== ''
  return (
    <div ref={boxRef} className="relative w-full sm:w-72">
      <label htmlFor={inputId} className="sr-only">
        Find a guest
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Find a guest"
        autoComplete="off"
        enterKeyHint="search"
        aria-controls={showList ? listId : undefined}
        className={inputClass}
        data-testid="share-search"
      />
      {showList && (
        <ul
          id={listId}
          aria-label="Guests found"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-stone-200 bg-white p-1 shadow-xl"
          data-testid="share-search-results"
        >
          {results.map((g) => (
            <li key={g.key}>
              <button
                type="button"
                onClick={() => go(g.key)}
                className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm text-stone-900 hover:bg-stone-100 focus-visible:bg-stone-100 focus-visible:outline-none"
                data-testid="share-search-result"
                data-guest-key={g.key}
              >
                <span className="min-w-0 truncate">{shareGuestName(g)}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-3 py-3 text-sm text-stone-600">No one matches.</li>}
        </ul>
      )}
    </div>
  )
}

const CARD_W = 224
const CARD_H = 120

/** A taken seat's card: the guest's name when the link shows names, their meal and whether they are a child. */
function ShareSeatCard({ guests }: { guests: readonly ShareGuest[] }) {
  const card = useSeating((s) => s.card)
  if (!card) return null
  const guest = guests.find((g) => g.key === card.guestId)
  const shown = shareSeatCard(guest)
  const place = nearPoint(card.client, CARD_W, CARD_H)
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-40 w-56 rounded-xl border border-stone-200 bg-white p-3 text-sm shadow-xl"
      style={{ left: place.left, top: place.top }}
      data-testid="share-seat-card"
    >
      <p className="font-semibold text-stone-900">{shown.name ?? 'Guest'}</p>
      <dl className="mt-1 space-y-0.5 text-stone-700">
        <div>
          <dt className="inline text-stone-500">Meal: </dt>
          <dd className="inline">{shown.meal ?? 'Not given'}</dd>
        </div>
        {shown.child && (
          <div>
            <dt className="sr-only">Age: </dt>
            <dd className="inline">Child</dd>
          </div>
        )}
      </dl>
    </div>
  )
}
