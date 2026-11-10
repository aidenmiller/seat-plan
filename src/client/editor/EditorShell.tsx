'use client'

/**
 * The full-screen layout editor (spec section 4; PLAN section 6). Three
 * parts, as in Lucidchart: the shape panel on the left, the canvas in the
 * middle and the right panel with its tabs. On phones (under 768 px or
 * touch-only) the canvas fills the screen, the right panel's tabs sit in a
 * bottom sheet and the shape panel opens from a button.
 *
 * The top bar: back to the layouts tab, the layout's name, the save status
 * (a fixed slot, so the bar never wraps and the canvas never moves), the
 * Edit / View switch and the Noa / Aiden switch. Zoom controls sit in the
 * canvas's bottom right corner on every screen size.
 *
 * The document lives in a store made for this layout (doc-store.ts); the
 * editor state (state/index.ts) wraps it and refuses changes in View mode
 * or while the page cannot edit. Saving, drafts, other people's changes and
 * conflicts go through layout-session.ts, which hears every finished edit.
 *
 * Once "Keep mine as a new copy" or "Save as a copy" has made the copy,
 * editing stays off until the page has opened the copy.
 *
 * Notes (spec section 9): the shape panel's Notes tools, the toolbar's notes
 * layer switches, the Notes tab and a note's Properties all work through the
 * editor state. A refused change says why under the canvas (View mode, no
 * author picked, notes hidden or locked). On phones, picking a note in the
 * Notes tab or starting to type into one lowers the sheet so the plan shows.
 */
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { errorMessage, updateLayout } from '@/client/api'
import { getAuthor, useAuthor } from '@/client/author'
import type { LayoutSaver, SaveStatus } from '@/client/sync/types'
import { useUnloadGuard } from '@/client/sync/unload'
import { ShareButton } from '@/client/share/ShareButton'
import { AuthorSwitch } from '@/client/ui/AuthorSwitch'
import { BottomSheet, type SheetSnap } from '@/client/ui/BottomSheet'
import { ContextMenu } from '@/client/ui/ContextMenu'
import { InlineName } from '@/client/ui/InlineName'
import { secondaryButton } from '@/client/ui/styles'
import type { Item } from '@/domain/canvas-schema'
import type { FixedItem } from '@/domain/venue-schema'
import { DEFAULT_MIN_GAP_CM } from '@/domain/spacing'
import type { LengthUnit } from '@/domain/units'
import { copyLayoutName } from '@/domain/wording'
import type { Group, Guest, LayoutDetail } from '@/shared/api'
import { VenuePickerDialog } from '@/client/venues/VenuePicker'
import { ConflictDialog } from './ConflictDialog'
import { createDocStore, type DocStore } from './doc-store'
import type { ContextMenuRequest, RefusalReason, SeatRequest } from './input/controller'
import { isTableTarget } from './input/hit-test'
import { openLayoutSession, type ConflictInfo, type LayoutSession } from './layout-session'
import type { UnseatConfirm } from './overlay/EditorOverlay'
import type { ScreenInsets } from './overlay/geometry'
import { canvasMenu, type CanvasMenu } from './panels/canvas-menu'
import { CanvasToolbar, PHONE_TOOLBAR_BOTTOM_PX } from './panels/CanvasToolbar'
import { EditorUiProvider, usePhoneLayout, type EditorUi } from './panels/editor-ui'
import { EditorGuestsProvider, useEditorGuestList } from './panels/guests-context'
import { ModeSwitch } from './panels/ModeSwitch'
import { PanelContent, PanelTabs, RightPanel, usePanelIds, type PanelTab } from './panels/RightPanel'
import { ShapeDrawer } from './panels/ShapeDrawer'
import { ShapePanel } from './panels/ShapePanel'
import { UnseatDialog, type UnseatAsk } from './panels/UnseatDialog'
import { ZOOM_CONTROLS_PX, ZoomControls } from './panels/ZoomControls'
import { CanvasViewport } from './render/CanvasViewport'
import { NotStoredBanner, SaveFailedBanner, SaveStatusSlot } from './SaveBanners'
import { notStoredAlert } from './save-status'
import { createEditorState, EditorStateProvider, type EditorEvents } from './state'
import { readDeviceView, browserStorage } from './state/device-view'
import { useStoreSelector } from './state/store'

/**
 * What the editor state, made once, reads from the page as it changes: can
 * the page edit, the wedding's settings, the save session and the page's
 * answers to the editor's events. Updated after every render.
 */
type Bridge = {
  canEdit: boolean
  wedding: EditorWedding
  session: LayoutSession | null
  events: EditorEvents
  /** The venue's fixed items under the layout (none on a blank canvas or after the venue was deleted). */
  venue: readonly FixedItem[]
}

function createBridge(wedding: EditorWedding, venue: readonly FixedItem[]) {
  let state: Bridge = { canEdit: false, wedding, session: null, events: {}, venue }
  return {
    get: () => state,
    set(patch: Partial<Bridge>) {
      state = { ...state, ...patch }
    },
  }
}

/** What the editor reads from the wedding: the grid and lengths unit, and the narrowest gap between tables. */
export type EditorWedding = { unit: LengthUnit; minGapCm: number }

const DEFAULT_WEDDING: EditorWedding = { unit: 'ft', minGapCm: DEFAULT_MIN_GAP_CM }
/** The bottom sheet's strip on phones: its 44 px handle and the 44 px tabs. */
const SHEET_STRIP_PX = 88

/** Where the zoom controls' bottom edge sits above the canvas's bottom: on phones, on top of the sheet's strip. */
function zoomControlsBottom(phone: boolean): number {
  return phone ? SHEET_STRIP_PX + 8 : 8
}

/**
 * What covers the canvas's edges, each with 8 px to spare: the toolbar along
 * the top, and along the bottom the zoom controls (on phones above the
 * sheet's strip). The overlay keeps the + and − and More buttons inside the
 * rest, so a table near an edge never has them hidden.
 */
export function canvasInsets(phone: boolean): ScreenInsets {
  return Object.freeze({
    top: PHONE_TOOLBAR_BOTTOM_PX + 8,
    right: 0,
    bottom: zoomControlsBottom(phone) + ZOOM_CONTROLS_PX + 8,
    left: 0,
  })
}

/**
 * What the notice under the canvas says when the editor refuses a change, or
 * null to say nothing: View mode first, then no author picked, then the
 * notes layer (hidden or locked) or another locked layer.
 */
export function refusalNotice(reason: RefusalReason | undefined, mode: 'edit' | 'view', hasAuthor: boolean): string | null {
  if (mode === 'view') return 'Switch to Edit to change the plan.'
  if (reason === 'noAuthor' || !hasAuthor) return 'Pick Noa or Aiden at the top first.'
  if (reason === 'notesHidden') return 'Notes are hidden. Show them to change notes.'
  if (reason === 'notesLocked') return 'Notes are locked. Unlock them to change notes.'
  if (reason === 'layerLocked') return 'That part of the plan is locked.'
  return null
}

const PHONE_CANVAS_INSETS = canvasInsets(true)
const DESKTOP_CANVAS_INSETS = canvasInsets(false)

/** The layout's venue as the editor shows it; changes when another venue is picked. */
type LayoutVenue = Pick<LayoutDetail, 'venueTemplateId' | 'venueName' | 'venueDeleted' | 'template'>

function layoutVenue(layout: LayoutDetail): LayoutVenue {
  return { venueTemplateId: layout.venueTemplateId, venueName: layout.venueName, venueDeleted: layout.venueDeleted, template: layout.template }
}

const NO_FIXED_ITEMS: readonly FixedItem[] = []

function venueItemsOf(v: LayoutVenue): readonly FixedItem[] {
  return v.template && !v.template.deleted ? v.template.fixedItems : NO_FIXED_ITEMS
}

const NO_GUESTS: Guest[] = []
const NO_GROUPS: Group[] = []

export type EditorShellProps = {
  layout: LayoutDetail
  wedding?: EditorWedding
  /** The wedding's guests and groups, for the Guests tab. Fetched again when the tab regains focus. */
  guests?: Guest[]
  groups?: Group[]
}

export function EditorShell({ layout, wedding = DEFAULT_WEDDING, guests = NO_GUESTS, groups = NO_GROUPS }: EditorShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const author = useAuthor()
  // The page keys this component by layout id, so these live as long as this layout is open.
  const [initial] = useState(layout)
  const backHref = `/w/${initial.weddingId}/layouts`
  const [store] = useState<DocStore>(() => createDocStore(layout.canvas))
  const [name, setName] = useState(layout.name)
  const [venueInfo, setVenueInfo] = useState(() => layoutVenue(layout))
  const [pickingVenue, setPickingVenue] = useState(false)
  const [saver, setSaver] = useState<LayoutSaver | null>(null)
  const [status, setStatus] = useState<SaveStatus | null>(null)
  const [conflict, setConflict] = useState<ConflictInfo | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  /** A copy was made (or is being made) and the page is about to open it. */
  const [leaving, setLeaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const sessionRef = useRef<LayoutSession | null>(null)

  const [tab, setTab] = useState<PanelTab>('properties')
  const [sheet, setSheet] = useState<SheetSnap>('strip')
  const [shapesOpen, setShapesOpen] = useState(false)
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; menu: CanvasMenu } | null>(null)
  const [unseat, setUnseat] = useState<UnseatAsk | null>(null)
  const phone = usePhoneLayout()
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const guestList = useEditorGuestList(layout.weddingId, guests, groups)

  const canEdit = saver !== null && author !== null && conflict === null && !leaving
  const venue = useMemo(() => venueItemsOf(venueInfo), [venueInfo])
  const [bridge] = useState(() => createBridge(wedding, venue))
  useEffect(() => {
    bridge.set({ canEdit, wedding, venue })
  })

  const [editor] = useState(() =>
    createEditorState({
      layoutId: layout.id,
      store,
      canEdit: () => bridge.get().canEdit,
      onCommit: (canvas) => bridge.get().session?.noteEdit(canvas),
      settings: () => {
        const w = bridge.get().wedding
        return { unit: w.unit, minGapCm: w.minGapCm }
      },
      venueItems: () => bridge.get().venue,
      events: {
        onContextMenu: (request) => bridge.get().events.onContextMenu?.(request),
        onTap: (tap) => bridge.get().events.onTap?.(tap),
        onRefused: (reason) => bridge.get().events.onRefused?.(reason),
      },
    }),
  )

  // Strict Mode runs effects twice in development, so the editor is torn down
  // only once nothing has mounted it again.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      setTimeout(() => {
        if (!mounted.current) editor.destroy()
      }, 0)
    }
  }, [editor])

  useEffect(() => {
    editor.setUnit(wedding.unit)
  }, [editor, wedding.unit])

  // Fit to content (the zoom button, the canvas menu, Ctrl+1 and the first fit)
  // keeps the content clear of the toolbar and, on phones, the bottom sheet.
  useLayoutEffect(() => {
    editor.camera.setFitInsets(phone ? PHONE_CANVAS_INSETS : DESKTOP_CANVAS_INSETS)
  }, [editor, phone])

  const mode = useStoreSelector(editor.ui, (s) => s.mode)
  const deviceKnown = useStoreSelector(editor.ui, (s) => s.deviceKnown)

  // The first visit on this device fits the content once the side panels have
  // their places (mount() fits before they show).
  const hadCamera = useRef<boolean | null>(null)
  useLayoutEffect(() => {
    if (hadCamera.current === null) hadCamera.current = readDeviceView(browserStorage(), initial.id).camera !== null
  }, [initial.id])
  const refitted = useRef(false)
  useEffect(() => {
    if (!deviceKnown || refitted.current || hadCamera.current !== false) return
    const frame = requestAnimationFrame(() => {
      refitted.current = true
      editor.camera.measure()
      editor.actions.zoomFit()
    })
    return () => cancelAnimationFrame(frame)
  }, [deviceKnown, editor])

  // Leaving Edit mode closes the shape drawer.
  useEffect(
    () =>
      editor.ui.subscribe(() => {
        if (editor.ui.getState().mode === 'view') setShapesOpen(false)
      }),
    [editor],
  )

  useEffect(() => {
    const session = openLayoutSession({
      layout: initial,
      store,
      getAuthor,
      events: {
        onSaver: setSaver,
        onStatus: setStatus,
        onConflict: setConflict,
        onNotice: setNotice,
        onServerCopy: (fresh) => setName(fresh.name),
        onGone: () => setGone(true),
      },
    })
    sessionRef.current = session
    bridge.set({ session })
    return () => {
      session.close()
      sessionRef.current = null
      bridge.set({ session: null })
    }
  }, [initial, store, bridge])

  useUnloadGuard(saver)

  const subscribeSaver = useCallback((listener: () => void) => saver?.subscribe(listener) ?? (() => undefined), [saver])
  const storedLocally = useSyncExternalStore(
    subscribeSaver,
    () => saver?.isStoredLocally() ?? true,
    () => true,
  )

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  // View mode has no shape panel.
  const drawerOpen = shapesOpen && mode === 'edit'

  const onSeatRequest = useCallback((tableId: string, request: SeatRequest) => {
    if (request.status === 'confirm') setUnseat({ tableId, unseated: request.unseated, confirm: request.confirm })
  }, [])

  const onConfirmUnseat = useCallback((request: UnseatConfirm) => setUnseat(request), [])

  const showDetails = useCallback(() => {
    setTab('properties')
    if (phone) setSheet((s) => (s === 'strip' ? 'half' : s))
  }, [phone])

  /** Phones: the sheet drops to its strip so the plan shows (a note picked in the Notes tab, typing into a note). */
  const showCanvas = useCallback(() => {
    if (phone) setSheet('strip')
  }, [phone])

  useEffect(() => {
    bridge.set({
      events: {
        onContextMenu(request: ContextMenuRequest) {
          const ui = editor.ui.getState()
          const selected = new Set(ui.selection)
          const selection = editor.store.getState().canvas.items.filter((i: Item) => selected.has(i.id))
          const built = canvasMenu({
            target: request.target,
            selection,
            guestCount: ui.guestSeats.length,
            mode: ui.mode,
            phone,
            canPaste: editor.clipboard.read() !== null,
            pasteAt: editor.camera.screenToWorld(request.at),
            actions: editor.actions,
            onSeatRequest,
            onDetails: showDetails,
            onEditNote: showCanvas,
          })
          if (!built) return
          // Screen points are from the viewport's top left; the menu wants the window's.
          const origin = editor.camera.clientToScreen(0, 0)
          setMenu({ at: { x: request.at.x - origin.x, y: request.at.y - origin.y }, menu: built })
        },
        onTap({ target }) {
          // View mode: a tapped table lists its seats, a tapped note shows all its text.
          const note = target.kind === 'item' && target.itemKind === 'note'
          if (editor.ui.getState().mode === 'view' && (isTableTarget(target) || note)) showDetails()
        },
        onRefused(reason) {
          const message = refusalNotice(reason, editor.ui.getState().mode, getAuthor() !== null)
          if (message) setNotice(message)
        },
      },
    })
  })

  async function loadTheirs() {
    await sessionRef.current?.loadTheirs()
  }

  async function keepMine() {
    const session = sessionRef.current
    if (!session || !conflict) return
    const who = author ?? conflict.draft?.editedBy ?? initial.editedBy ?? 'Noa'
    // Editing stays off from the moment the copy exists until the page has left.
    setLeaving(true)
    try {
      const copy = await session.keepMineAsCopy(copyLayoutName(name, who), who)
      router.push(`/w/${initial.weddingId}/layouts/${copy.id}`)
    } catch (err) {
      setLeaving(false)
      throw err
    }
  }

  /** After a 422 or 410: store this tab's canvas as a new layout and open it. */
  async function saveCopy() {
    const session = sessionRef.current
    if (!session || copying) return
    const who = author ?? initial.editedBy ?? 'Noa'
    setCopying(true)
    setCopyError(null)
    setLeaving(true)
    try {
      const copy = await session.saveAsCopy(copyLayoutName(name, who), who)
      router.push(`/w/${initial.weddingId}/layouts/${copy.id}`)
    } catch (err) {
      setLeaving(false)
      setCopying(false)
      setCopyError(`Could not make the copy. ${errorMessage(err)} You can still download a copy.`)
    }
  }

  /** Going back inside the app: send what is waiting first (up to 3 s), so the layouts list shows it. */
  async function goBack(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (!saver || !saver.hasUnsavedChanges()) return
    event.preventDefault()
    await Promise.race([saver.flush(), new Promise((resolve) => setTimeout(resolve, 3000))])
    router.push(backHref)
  }

  function download() {
    const blob = new Blob([JSON.stringify(store.getState().canvas, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name.replace(/[^\w\- ]+/g, '').trim() || 'layout'}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const blank = venueInfo.venueTemplateId === null
  const venueLabel = blank ? 'Blank canvas' : venueInfo.venueDeleted ? `${venueInfo.venueName ?? 'Venue'} (deleted)` : (venueInfo.venueName ?? 'Venue')
  const onPickVenue = useCallback(() => setPickingVenue(true), [])
  const editorUi = useMemo<EditorUi>(
    () => ({ unit: wedding.unit, phone, layoutName: name, venueLabel, onSeatRequest, showDetails, showCanvas, venue, onPickVenue }),
    [wedding.unit, phone, name, venueLabel, onSeatRequest, showDetails, showCanvas, venue, onPickVenue],
  )
  const venueGone = !blank && (venueInfo.venueDeleted || venueInfo.template?.deleted === true)
  const dropTarget = useCallback(() => canvasAreaRef.current?.querySelector<HTMLElement>('[data-editor-viewport]') ?? null, [])
  const hint = saver !== null && author === null ? 'Pick Noa or Aiden to start editing.' : null
  const panelIds = usePanelIds()

  return (
    <EditorStateProvider state={editor}>
      <EditorUiProvider value={editorUi}>
        <EditorGuestsProvider value={guestList}>
          <div className="flex min-h-0 flex-1 flex-col" data-editor-root="" data-mode={deviceKnown ? mode : undefined} data-phone={phone ? 'true' : undefined}>
            <header className="flex items-center gap-1 border-b border-stone-200 bg-white px-2 py-1 sm:gap-2 sm:px-3">
              <Link
                href={backHref}
                onClick={goBack}
                aria-label="Back to layouts"
                className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-sm text-stone-700 hover:bg-stone-100"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="hidden sm:inline">Layouts</span>
              </Link>
              <h1 className="min-w-0 flex-1">
                <InlineName
                  value={name}
                  label="Layout name"
                  textClassName="text-base font-semibold sm:text-lg"
                  testId="layout-title"
                  onSave={async (next) => {
                    const updated = await updateLayout(initial.id, { name: next })
                    setName(updated.name)
                  }}
                />
              </h1>
              <SaveStatusSlot status={status} />
              <ShareButton layoutId={initial.id} compact={phone} />
              <ModeSwitch compact={phone} />
              <AuthorSwitch compact />
            </header>

            <SaveFailedBanner
              status={status}
              gone={gone}
              storedLocally={storedLocally}
              loginHref={`/login?next=${encodeURIComponent(pathname)}`}
              copying={copying}
              copyError={copyError}
              onSaveCopy={() => void saveCopy()}
              onDownload={download}
            />
            <NotStoredBanner message={notStoredAlert(status, storedLocally)} />
            {venueGone && (
              <div
                role="status"
                className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1 text-sm text-amber-900"
                data-testid="venue-deleted-notice"
              >
                <span className="min-w-0 flex-1 basis-48 py-2">
                  The venue {venueInfo.venueName ? `“${venueInfo.venueName}” ` : ''}was deleted, so its walls and rooms are not shown on this layout.
                </span>
                <button type="button" className={secondaryButton} onClick={onPickVenue} data-testid="venue-deleted-pick">
                  Pick another venue
                </button>
              </div>
            )}

            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              {!phone && mode === 'edit' && (
                <aside aria-label="Shapes" className="hidden w-48 shrink-0 overflow-y-auto overscroll-contain border-r border-stone-200 bg-stone-50 md:block lg:w-56">
                  <ShapePanel blank={blank} disabled={!canEdit} dropTarget={dropTarget} />
                </aside>
              )}

              <div ref={canvasAreaRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
                <CanvasViewport venue={venue} onConfirmUnseat={onConfirmUnseat} insets={phone ? PHONE_CANVAS_INSETS : DESKTOP_CANVAS_INSETS} />
                <CanvasToolbar phone={phone} canEdit={canEdit} onOpenShapes={() => setShapesOpen(true)} hint={hint} />
                <div className="absolute right-2 z-10" style={{ bottom: zoomControlsBottom(phone) }}>
                  <ZoomControls />
                </div>
                {notice && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4"
                    style={{ bottom: phone ? SHEET_STRIP_PX + 64 : 64 }}
                  >
                    <p role="status" data-testid="editor-notice" className="rounded-full bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">
                      {notice}
                    </p>
                  </div>
                )}
              </div>

              {!phone && <RightPanel tab={tab} onTab={setTab} />}

              {phone && (
                <BottomSheet
                  snap={sheet}
                  onSnapChange={setSheet}
                  label="Details"
                  stripPx={SHEET_STRIP_PX}
                  testId="bottom-sheet"
                  header={
                    <PanelTabs
                      tab={tab}
                      ids={panelIds}
                      onSelect={(next) => {
                        setTab(next)
                        if (sheet === 'strip') setSheet('half')
                      }}
                    />
                  }
                >
                  <PanelContent tab={tab} ids={panelIds} />
                </BottomSheet>
              )}
              {phone && (
                <ShapeDrawer open={drawerOpen} onClose={() => setShapesOpen(false)} blank={blank} disabled={!canEdit} dropTarget={dropTarget} />
              )}
            </div>

            <ConflictDialog conflict={conflict} me={author} onLoadTheirs={loadTheirs} onKeepMine={keepMine} />
            <VenuePickerDialog
              open={pickingVenue}
              layoutId={initial.id}
              current={venueInfo.venueTemplateId}
              onCancel={() => setPickingVenue(false)}
              onChanged={(updated) => {
                setVenueInfo(layoutVenue(updated))
                setPickingVenue(false)
                setNotice(updated.venueTemplateId ? `This layout now uses “${updated.venueName ?? 'the venue'}”.` : 'This layout is now a blank canvas.')
              }}
            />
            <UnseatDialog ask={unseat} canvas={store.getState().canvas} onClose={() => setUnseat(null)} />
            <ContextMenu at={menu?.at ?? null} items={menu?.menu.items ?? []} label={menu?.menu.label ?? 'Menu'} onClose={() => setMenu(null)} testId="canvas-menu" />
          </div>
        </EditorGuestsProvider>
      </EditorUiProvider>
    </EditorStateProvider>
  )
}
