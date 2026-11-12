'use client'

/**
 * The venue template editor (spec section 5; PLAN section 7 "Venue
 * templates", "Floor plan import", "Scale", "Draft and Accept"), at
 * /venues/[templateId].
 *
 * The same canvas as the layout editor, editing the template's fixed items:
 * tools on the left (a drawer on phones), the canvas in the middle, and on
 * the right (a bottom sheet on phones) the Properties, Plan image and
 * Revisions tabs, plus a Draft tab while an import draft is open.
 *
 * Saving: autosave through the layout save engine with the venue endpoint
 * (template-saver.ts), with the version check; a conflict stops saving and
 * shows a banner with "Load their version" and "Keep mine". When the tab
 * regains focus with nothing waiting to save, a newer save of the venue is
 * loaded. After a save lands, the wall check (GET
 * /api/venues/:id/wall-check) lists the tables a wall now runs through in
 * layouts that use the template, because of that save.
 *
 * Import: the draft replaces the canvas's document while it is open, edits
 * to it stay in the editor (nothing autosaves), and Accept saves it in one
 * go (POST /api/venues/:id/accept-import). Discard puts the saved template
 * back. When someone saved the venue meanwhile (Accept answered 409, or the
 * focus check saw it), their version becomes what Discard puts back, and
 * Accept asks before it goes over it. Undo import meeting a newer save loads
 * it and asks to try again.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { acceptVenueImport, errorMessage, getVenue, renameVenue, restoreVenueRevision, venueConflictOf, venueWallCheck } from '@/client/api'
import { useCurrentUser } from '@/client/current-user'
import { createDocStore } from '@/client/editor/doc-store'
import { ZoomPercentLabel } from '@/client/editor/camera/ZoomPercentLabel'
import { Icon } from '@/client/editor/icons/glyphs'
import { PHONE_TOOLBAR_BOTTOM_PX } from '@/client/editor/panels/CanvasToolbar'
import { ZOOM_CONTROLS_PX } from '@/client/editor/panels/ZoomControls'
import { usePhoneLayout } from '@/client/editor/panels/editor-ui'
import { browserStorage, readDeviceView } from '@/client/editor/state/device-view'
import { useStoreSelector } from '@/client/editor/state/store'
import { randomId } from '@/client/sync/random-id'
import { registerSaver } from '@/client/sync/saver-registry'
import type { LayoutSaver, SaveStatus } from '@/client/sync/types'
import { useUnloadGuard } from '@/client/sync/unload'
import { BottomSheet, type SheetSnap } from '@/client/ui/BottomSheet'
import { ContextMenu, type ContextMenuItem } from '@/client/ui/ContextMenu'
import { InlineName } from '@/client/ui/InlineName'
import { primaryButton, secondaryButton } from '@/client/ui/styles'
import { UserMenu } from '@/client/ui/UserMenu'
import { saveStatusTitle } from '@/client/editor/save-status'
import { bringFixedToFront, type TemplateDoc } from '@/domain/template-commands'
import { advanceWallCheck, imageToCanvas, measuredCm, planScale, redrawDraft, scaleLabels, wallCheckMessage, type WallCheckLayout } from '@/domain/template-import'
import { formatLength } from '@/domain/units'
import { loadedChangesText, restoreReloadedText, venueConflictText, venueReadOnlyText } from '@/domain/venue-wording'
import { editorRef } from '@/domain/wording'
import type { VenueDetail, VenueImageInfo, VenueWallCheck } from '@/shared/api'
import { copyHrefFromBack, useMakeCopy } from '../make-copy'
import { floorplanBody, scaledDimensionLabels, storedImagePlan } from '../import/plan-body'
import { ImportDialog, type ImportResult } from '../import/ImportDialog'
import { DraftPanel, type DraftState } from './DraftPanel'
import { useVenueUnit } from './device-unit'
import { TemplateEditorProvider, useTemplateEditor, useTemplateUi } from './react'
import { ReferencePanel } from './ReferencePanel'
import { RevisionsPanel } from './RevisionsPanel'
import { templateStatusView } from './save-status'
import { createTemplateEditor, templateViewKey } from './state'
import { TemplateCanvas, type ReferenceImageInfo } from './TemplateCanvas'
import type { TemplateMenuRequest } from './controller'
import type { ScaleLine } from './TemplateOverlay'
import { TemplatePropertiesPanel } from './TemplatePropertiesPanel'
import { TemplateToolbar } from './TemplateToolbar'
import { createTemplateSaver } from './template-saver'
import { ToolDrawer, ToolPanel } from './ToolPanel'
import { SELECT } from './ui-store'

type Tab = 'draft' | 'properties' | 'plan' | 'revisions'

/** What a venue you may only view shows: no Revisions (nothing to put back), no import. */
const VIEW_ONLY_TABS: Tab[] = ['properties', 'plan']

const TAB_LABELS: Record<Tab, string> = { draft: 'Draft', properties: 'Properties', plan: 'Plan image', revisions: 'Revisions' }
const SHEET_STRIP_PX = 88
const TONE_CLASS = { neutral: 'text-stone-600', good: 'text-emerald-700', warning: 'text-amber-700', error: 'text-red-700' } as const
/** What covers the canvas's edges, for fit to content: the toolbar on top, the zoom controls (and on phones the sheet's strip) below. */
function fitInsets(phone: boolean) {
  return Object.freeze({ top: PHONE_TOOLBAR_BOTTOM_PX + 8, right: 0, bottom: (phone ? SHEET_STRIP_PX + 8 : 8) + ZOOM_CONTROLS_PX + 8, left: 0 })
}
const PHONE_INSETS = fitInsets(true)
const DESKTOP_INSETS = fitInsets(false)

function imageInfo(image: VenueImageInfo | null): ReferenceImageInfo | null {
  return image ? { url: image.url, width: image.width, height: image.height } : null
}

type Bridge = {
  canEdit: boolean
  draft: boolean
  saver: LayoutSaver<TemplateDoc> | null
  unit: 'ft' | 'm'
  image: { width: number; height: number } | null
  onMenu: (request: TemplateMenuRequest) => void
  onRefused: () => void
}

/** What the editor, made once, reads from the page as it changes. Updated after every render. */
function createBridge() {
  let state: Bridge = { canEdit: false, draft: false, saver: null, unit: 'ft', image: null, onMenu: () => undefined, onRefused: () => undefined }
  return {
    get: () => state,
    set(next: Bridge) {
      state = next
    },
  }
}

export type TemplateEditorScreenProps = {
  venue: VenueDetail
  /** Where Back goes: the Venues tab of the wedding the editor was opened from, or home. */
  backHref: string
}

export function TemplateEditorScreen({ venue, backHref }: TemplateEditorScreenProps) {
  const pathname = usePathname()
  const user = useCurrentUser()
  const phone = usePhoneLayout()
  const [unit, setUnit] = useVenueUnit()
  const [initial] = useState(venue)
  const [store] = useState(() => createDocStore<TemplateDoc>({ items: venue.fixedItems, reference: venue.reference }))
  const [name, setName] = useState(venue.name)
  const [referenceImage, setReferenceImage] = useState<VenueImageInfo | null>(venue.referenceImage)
  const [importedBy, setImportedBy] = useState(venue.importedBy)
  const [saver, setSaver] = useState<LayoutSaver<TemplateDoc> | null>(null)
  const [status, setStatus] = useState<SaveStatus | null>(null)
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [importOpen, setImportOpen] = useState<'new' | 'rerun' | 'stored' | null>(null)
  const [busy, setBusy] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [crossings, setCrossings] = useState<WallCheckLayout[] | null>(null)
  const [revisionsKey, setRevisionsKey] = useState(0)
  const [tab, setTab] = useState<Tab>('properties')
  const [sheet, setSheet] = useState<SheetSnap>('strip')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: ContextMenuItem[] } | null>(null)
  const [resolving, setResolving] = useState(false)
  // A venue the server says this person may not change (the library, someone else's, or one with no owner): no saver, no tools.
  const readOnly = !venue.canEdit
  const makeCopy = useMakeCopy(venue.id, copyHrefFromBack(backHref))

  const conflict = status?.kind === 'conflict' ? status : null
  const failed = status?.kind === 'failed' ? status : null
  const canEdit = !busy && !resolving && (draft !== null || (saver !== null && conflict === null && failed === null))
  const shownImage = draft ? imageInfo(draft.image) : imageInfo(referenceImage)

  const [bridge] = useState(createBridge)
  const [editor] = useState(() =>
    createTemplateEditor({
      templateId: venue.id,
      store,
      canEdit: () => bridge.get().canEdit,
      onCommit: (doc) => {
        const b = bridge.get()
        if (!b.draft) b.saver?.noteEdit(doc)
      },
      unit: () => bridge.get().unit,
      imageSize: () => bridge.get().image,
      events: {
        onContextMenu: (request) => bridge.get().onMenu(request),
        onRefused: () => bridge.get().onRefused(),
      },
    }),
  )
  const showReference = useStoreSelector(editor.view, (s) => s.showReferenceImage)
  const mode = useStoreSelector(editor.ui, (s) => s.mode)
  const deviceKnown = useStoreSelector(editor.ui, (s) => s.deviceKnown)
  const itemCount = useStoreSelector(store, (s) => s.canvas.items.length)
  const reference = useStoreSelector(store, (s) => s.canvas.reference)

  useEffect(() => {
    bridge.set({
      canEdit,
      draft: draft !== null,
      saver,
      unit,
      image: draft ? draft.image : showReference && referenceImage ? referenceImage : null,
      onMenu(request) {
        if (!request.itemId) return
        const ids = [...editor.ui.getState().selection]
        const items: ContextMenuItem[] = [
          { id: 'duplicate', label: 'Duplicate', onSelect: () => editor.actions.duplicateSelection(), disabled: !canEdit },
          { id: 'front', label: 'Bring to front', onSelect: () => editor.actions.run('Bring to front', (d) => bringFixedToFront(d, ids)), disabled: !canEdit },
          { id: 'delete', label: 'Delete', onSelect: () => editor.actions.deleteSelection(), disabled: !canEdit, danger: true },
        ]
        const origin = editor.camera.clientToScreen(0, 0)
        setMenu({ at: { x: request.at.x - origin.x, y: request.at.y - origin.y }, items })
      },
      onRefused() {
        if (editor.ui.getState().mode === 'view') setNotice('Switch to Edit to change the venue.')
      },
    })
  })

  // Strict Mode mounts twice in development: tear down only once nothing mounted it again.
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

  useEffect(() => editor.setUnit(unit), [editor, unit])

  // Viewing only: always View mode (the device's saved choice is left alone), so no tool or edit control shows.
  useEffect(() => {
    if (readOnly && deviceKnown && mode !== 'view') editor.ui.setMode('view')
  }, [readOnly, deviceKnown, mode, editor])

  useLayoutEffect(() => {
    editor.camera.setFitInsets(phone ? PHONE_INSETS : DESKTOP_INSETS)
  }, [editor, phone])

  // The first visit on this device fits the venue once the side panels have
  // their places (mount() fits before they show). Read before mount() saves a camera.
  const hadCamera = useRef<boolean | null>(null)
  useLayoutEffect(() => {
    if (hadCamera.current === null) hadCamera.current = readDeviceView(browserStorage(), templateViewKey(initial.id)).camera !== null
  }, [initial.id])
  const refitted = useRef(false)
  useEffect(() => {
    if (!deviceKnown || refitted.current || hadCamera.current !== false) return
    refitted.current = true
    const frame = requestAnimationFrame(() => {
      editor.camera.measure()
      editor.actions.zoomFit()
    })
    return () => cancelAnimationFrame(frame)
  }, [deviceKnown, editor])

  // The save engine, pointed at the venue route, saving as the signed-in user; signing out reaches it through the registry.
  const userId = user.id
  useEffect(() => {
    // Nothing to save when the venue cannot be changed: starting the saver would only end in a refused save.
    if (readOnly) return
    let live = true
    const s = createTemplateSaver({ templateId: initial.id, baseVersion: initial.version, userId, onStatus: setStatus })
    const unregister = registerSaver({
      flush: () => s.flush(),
      hasUnsavedChanges: () => s.hasUnsavedChanges(),
      stop: async () => s.dispose(),
    })
    // Handed to React after this effect, as the layout session hands over its saver.
    void Promise.resolve().then(() => {
      if (!live) return
      setSaver(s)
      setStatus(s.getStatus())
    })
    return () => {
      live = false
      s.dispose()
      unregister()
      setSaver(null)
    }
  }, [initial, userId, readOnly])

  useUnloadGuard(saver)

  // Closing the page drops an open draft: warn first.
  useEffect(() => {
    if (!draft) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = true
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [draft])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  // ---------------------------------------------------------------- walls through tables

  // What the last save left crossed, so the next check lists only what that
  // save added. Null when it could not be fetched: then nothing is claimed.
  const baselineRef = useRef<Promise<VenueWallCheck | null> | null>(null)
  const checkedVersion = useRef(initial.version)
  const rebaseWallCheck = useCallback(() => {
    baselineRef.current = venueWallCheck(initial.id).catch(() => null)
  }, [initial.id])
  useEffect(() => {
    if (!baselineRef.current) rebaseWallCheck()
  }, [rebaseWallCheck])

  const runWallCheck = useCallback(async () => {
    try {
      const before = await (baselineRef.current ?? Promise.resolve(null))
      const check = await venueWallCheck(initial.id)
      const step = advanceWallCheck(before, check)
      baselineRef.current = Promise.resolve(step.baseline)
      setCrossings(step.fresh.length > 0 ? step.fresh : null)
    } catch {
      // The check is a help, not a gate: a failed one says nothing.
    }
  }, [initial.id])

  useEffect(() => {
    if (status?.kind !== 'saved' || !saver) return
    const version = saver.getBaseVersion()
    if (version === checkedVersion.current) return
    checkedVersion.current = version
    const timer = setTimeout(() => void runWallCheck(), 300)
    return () => clearTimeout(timer)
  }, [status, saver, runWallCheck])

  // ---------------------------------------------------------------- server copies

  /** Puts the server's template (fetched now, or the copy given) in the editor and starts saving from its version. */
  async function loadServerCopy(given?: VenueDetail) {
    const fresh = given ?? (await getVenue(initial.id))
    editor.doc.cancelGesture()
    store.replace({ items: fresh.fixedItems, reference: fresh.reference })
    setReferenceImage(fresh.referenceImage)
    setImportedBy(fresh.importedBy)
    setName(fresh.name)
    checkedVersion.current = fresh.version
    await saver?.resetTo(fresh.version)
    setRevisionsKey((k) => k + 1)
  }

  /**
   * Someone saved the venue while an import draft is open: their version is
   * what Discard now puts back, saving starts from it, and Accept asks
   * before it goes over it.
   */
  async function takeTheirsUnderDraft(fresh: VenueDetail) {
    checkedVersion.current = fresh.version
    rebaseWallCheck()
    await saver?.resetTo(fresh.version)
    setReferenceImage(fresh.referenceImage)
    setImportedBy(fresh.importedBy)
    setName(fresh.name)
    setDraft((d) => (d ? { ...d, saved: { items: fresh.fixedItems, reference: fresh.reference }, over: { who: editorRef(fresh) } } : d))
    setRevisionsKey((k) => k + 1)
  }

  /**
   * The tab regained focus: when nothing of this tab's waits to save and the
   * server holds a newer save, take it (under an open draft, as the version
   * Accept goes over). Edits waiting to save meet it as a conflict instead.
   */
  async function catchUp() {
    const s = saver
    if (!s || busy || resolving || importOpen !== null) return
    const idle = () => !s.hasUnsavedChanges() && s.getStatus().kind === 'saved'
    if (!idle()) return
    let fresh: VenueDetail
    try {
      fresh = await getVenue(initial.id)
    } catch {
      return
    }
    if (fresh.version === s.getBaseVersion() || !idle()) return
    if (draft) {
      await takeTheirsUnderDraft(fresh)
      return
    }
    rebaseWallCheck()
    await loadServerCopy(fresh)
    setNotice(loadedChangesText(editorRef(fresh), user.id))
  }
  const catchUpRef = useRef(catchUp)
  useEffect(() => {
    catchUpRef.current = catchUp
  })
  useEffect(() => {
    let last = Number.NEGATIVE_INFINITY
    const check = () => {
      if (document.visibilityState === 'hidden' || Date.now() - last < 2000) return
      last = Date.now()
      void catchUpRef.current()
    }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])

  async function loadTheirs() {
    setResolving(true)
    try {
      rebaseWallCheck()
      await loadServerCopy()
    } catch (err) {
      setNotice(`Could not load their version. ${errorMessage(err)}`)
    } finally {
      setResolving(false)
    }
  }

  async function keepMine() {
    if (!saver || !conflict) return
    const mine = store.getState().canvas
    await saver.resetTo(conflict.server.version)
    saver.noteEdit(mine)
  }

  /** Waits for edits to reach the server. False (with a notice) when they could not. */
  async function settled(): Promise<boolean> {
    if (!saver) return false
    await Promise.race([saver.flush(), new Promise((resolve) => setTimeout(resolve, 5000))])
    if (saver.hasUnsavedChanges() || saver.getStatus().kind !== 'saved') {
      setNotice('Wait until your changes are saved, then try again.')
      return false
    }
    return true
  }

  /** Puts a revision back. Answers with a sentence to show when someone else's save came first and was loaded instead. */
  async function restore(revisionId: string, undoImport: boolean): Promise<string | null> {
    if (!(await settled()) || !saver) return null
    setBusy(true)
    try {
      await restoreVenueRevision(initial.id, revisionId, { baseVersion: saver.getBaseVersion(), saveId: randomId() })
      await loadServerCopy()
      void runWallCheck()
      return null
    } catch (err) {
      const theirs = venueConflictOf(err)
      if (!theirs) throw err
      rebaseWallCheck()
      await loadServerCopy()
      return restoreReloadedText(editorRef(theirs), user.id, undoImport)
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------------------------- import

  /**
   * Before an import: edits saved, and the venue as the server holds it now,
   * so the draft's Discard and Accept start from the latest version.
   */
  async function readyForImport(): Promise<boolean> {
    if (!(await settled()) || !saver) return false
    try {
      const fresh = await getVenue(initial.id)
      if (fresh.version !== saver.getBaseVersion()) {
        rebaseWallCheck()
        await loadServerCopy(fresh)
        setNotice(loadedChangesText(editorRef(fresh), user.id))
      }
    } catch {
      // Accept checks the version again.
    }
    if (editor.ui.getState().mode !== 'edit') editor.actions.setMode('edit')
    return true
  }

  async function openImport() {
    if (await readyForImport()) setImportOpen('new')
  }

  /** "Run the import again" on the stored plan picture (Plan image tab). */
  async function rerunStored() {
    if (referenceImage && (await readyForImport())) setImportOpen('stored')
  }

  function enterDraft(result: ImportResult) {
    const labels = scaleLabels(scaledDimensionLabels(result.plan, result.image), result.draft)
    const scale = planScale(labels, result.image.width)
    // The lines exactly as the model saw them (in the stored image's pixels).
    const source = { draft: result.draft, segments: floorplanBody(result.plan, result.image).segments ?? [] }
    const drawn = redrawDraft(source, scale.cmPerPx, randomId)
    const saved = draft?.saved ?? store.getState().canvas
    editor.doc.cancelGesture()
    editor.ui.setState({ selection: [], segment: null, tool: SELECT, drawing: null, cursor: null, measure: [] })
    setDraft({
      image: result.image,
      plan: result.plan,
      model: result.model,
      source,
      built: drawn.doc,
      scale,
      scaleSet: false,
      byHand: false,
      skipped: drawn.skipped,
      saved,
      saveId: randomId(),
      over: draft?.over ?? null,
    })
    setDraftError(null)
    store.replace(drawn.doc)
    setImportOpen(null)
    setTab('draft')
    if (phone) setSheet('half')
    requestAnimationFrame(() => {
      bridge.set({ ...bridge.get(), image: result.image })
      editor.camera.measure()
      editor.actions.zoomFit()
    })
  }

  /** The scale step: the draft drawn again from the model's reply at this scale (cm per image pixel). */
  function rescaleDraft(cmPerPx: number, then: (d: DraftState) => DraftState): boolean {
    if (!draft) return false
    if (!bridge.get().canEdit) {
      bridge.get().onRefused()
      return false
    }
    const drawn = redrawDraft(draft.source, cmPerPx, randomId)
    editor.doc.cancelGesture()
    editor.ui.setState({ selection: [], segment: null, drawing: null, cursor: null })
    store.replace(drawn.doc)
    setDraft((d) => (d ? then({ ...d, built: drawn.doc, skipped: drawn.skipped }) : d))
    return true
  }

  function discardDraft() {
    if (!draft) return
    editor.doc.cancelGesture()
    editor.ui.setState({ selection: [], segment: null, tool: SELECT, drawing: null, cursor: null, measure: [] })
    store.replace(draft.saved)
    setDraft(null)
    setDraftError(null)
    setTab('properties')
  }

  async function acceptDraft() {
    if (!draft || !saver) return
    const doc = store.getState().canvas
    if (!doc.reference) return
    setBusy(true)
    setDraftError(null)
    try {
      const ok = await acceptVenueImport(initial.id, {
        baseVersion: saver.getBaseVersion(),
        saveId: draft.saveId,
        fixedItems: doc.items,
        imageId: draft.image.id,
        reference: doc.reference,
        importedBy: draft.plan.kind === 'vector' ? 'pdf vectors' : 'ai',
      })
      editor.ui.setState({ tool: SELECT, measure: [] })
      store.replace(doc)
      checkedVersion.current = ok.version
      await saver.resetTo(ok.version)
      setReferenceImage(draft.image)
      setImportedBy(draft.plan.kind === 'vector' ? 'pdf vectors' : 'ai')
      setDraft(null)
      setTab('properties')
      setRevisionsKey((k) => k + 1)
      setNotice('Import saved. Undo import is in Revisions.')
      void runWallCheck()
    } catch (err) {
      if (venueConflictOf(err)) {
        // Someone saved the venue since: load their version under the draft and ask before going over it.
        try {
          await takeTheirsUnderDraft(await getVenue(initial.id))
        } catch (loadErr) {
          setDraftError(`Could not load their version. ${errorMessage(loadErr)}`)
        }
      } else {
        setDraftError(`Could not accept the draft. ${errorMessage(err)}`)
      }
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------------------------- scale line

  const scaleLine = useMemo<ScaleLine | null>(() => {
    if (!draft || draft.scaleSet || draft.byHand || !draft.scale.agreed || !draft.scale.confirm || !reference) return null
    const c = draft.scale.confirm
    const s = reference.scaleCmPerPx
    const at = (p: { x: number; y: number }) => {
      const q = imageToCanvas(p, s)
      return { x: q.x + reference.offsetX, y: q.y + reference.offsetY }
    }
    return { from: at(c.label.from), to: at(c.label.to), text: c.label.text, measured: formatLength(measuredCm(c, s), unit) }
  }, [draft, reference, unit])

  // ---------------------------------------------------------------- layout

  const tabs: Tab[] = draft ? ['draft', 'properties', 'plan'] : readOnly ? VIEW_ONLY_TABS : ['properties', 'plan', 'revisions']
  const openTab = tabs.includes(tab) ? tab : tabs[0]
  const view = templateStatusView(status, draft !== null, readOnly)
  const zoomBottom = phone ? SHEET_STRIP_PX + 8 : 8

  function panel(t: Tab) {
    switch (t) {
      case 'draft':
        return draft ? (
          <DraftPanel
            draft={draft}
            unit={unit}
            busy={busy}
            error={draftError}
            meId={user.id}
            onChange={setDraft}
            onRescale={rescaleDraft}
            onAccept={() => void acceptDraft()}
            onRerun={() => setImportOpen('rerun')}
            onDiscard={discardDraft}
          />
        ) : null
      case 'properties':
        return <TemplatePropertiesPanel unit={unit} canEdit={canEdit} itemCount={itemCount} onImport={draft || readOnly ? undefined : () => void openImport()} />
      case 'plan':
        return (
          <ReferencePanel
            image={shownImage}
            draft={draft !== null}
            canEdit={canEdit}
            readOnly={readOnly}
            onImport={() => void openImport()}
            rerun={!referenceImage ? null : importedBy === 'pdf vectors' ? 'pdf' : 'picture'}
            onRerun={() => void rerunStored()}
          />
        )
      case 'revisions':
        return (
          <RevisionsPanel
            templateId={initial.id}
            refreshKey={revisionsKey}
            disabled={!canEdit || draft !== null}
            onRestore={restore}
          />
        )
    }
  }

  async function goBack(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (draft && !window.confirm('Leave and drop the import draft? The venue stays as it was.')) {
      event.preventDefault()
      return
    }
    if (!saver || !saver.hasUnsavedChanges()) return
    event.preventDefault()
    await Promise.race([saver.flush(), new Promise((resolve) => setTimeout(resolve, 3000))])
    window.location.assign(backHref)
  }

  return (
    <TemplateEditorProvider editor={editor}>
      <div className="flex min-h-0 flex-1 flex-col" data-template-editor="" data-mode={deviceKnown ? mode : undefined} data-phone={phone ? 'true' : undefined}>
        <header className="flex items-center gap-1 border-b border-stone-200 bg-white px-2 py-1 sm:gap-2 sm:px-3">
          <Link
            href={backHref}
            onClick={goBack}
            aria-label="Back to venues"
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-sm text-stone-700 hover:bg-stone-100"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">Venues</span>
          </Link>
          <h1 className="min-w-0 flex-1">
            {readOnly ? (
              <span className="flex min-h-11 items-center text-base font-semibold sm:text-lg" data-testid="venue-title">
                <span className="min-w-0 truncate">{name}</span>
              </span>
            ) : (
              <InlineName
                value={name}
                label="Venue name"
                textClassName="text-base font-semibold sm:text-lg"
                testId="venue-title"
                onSave={async (next) => {
                  const updated = await renameVenue(initial.id, { name: next })
                  setName(updated.name)
                }}
              />
            )}
          </h1>
          <p
            role="status"
            aria-live="polite"
            title={saveStatusTitle(view)}
            data-testid="save-status"
            data-status={readOnly ? 'read-only' : draft ? 'draft' : (status?.kind ?? 'opening')}
            className={`w-24 shrink-0 truncate text-right text-sm sm:w-48 ${TONE_CLASS[view.tone]}`}
          >
            {view.text}
          </p>
          {!draft && !phone && !readOnly && (
            <button type="button" className={`${secondaryButton} shrink-0`} onClick={() => void openImport()} disabled={!canEdit} data-testid="import-plan">
              Import plan
            </button>
          )}
          {!readOnly && <TemplateModeSwitch compact={phone} />}
          <UserMenu compact />
        </header>

        {readOnly && (
          <div role="note" data-testid="template-read-only" className="flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-950">
            <span className="min-w-0 flex-1 basis-48">{venueReadOnlyText(venue)}</span>
            <button type="button" className={secondaryButton} onClick={() => void makeCopy.copy()} disabled={makeCopy.busy} data-testid="make-copy">
              {makeCopy.busy ? 'Copying…' : 'Make my own copy'}
            </button>
            {makeCopy.error && (
              <p role="alert" className="w-full text-red-800">
                {makeCopy.error}
              </p>
            )}
          </div>
        )}
        {conflict && !draft && (
          <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="template-conflict">
            <span className="min-w-0 flex-1 basis-48">
              {venueConflictText(editorRef(conflict.server), user.id)} Your last change is not saved.
            </span>
            <button type="button" className={primaryButton} onClick={() => void loadTheirs()} disabled={resolving}>
              Load their version
            </button>
            <button type="button" className={secondaryButton} onClick={() => void keepMine()} disabled={resolving}>
              Keep mine
            </button>
          </div>
        )}
        {failed && (
          <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="template-failed">
            <span className="min-w-0 flex-1 basis-48">{failed.message}</span>
            {/* After someone else signed in, signing in from here would land as them: the message says what to do. */}
            {failed.reason === 'signed-out' && (
              <a href={`/login?next=${encodeURIComponent(pathname)}`} className={secondaryButton}>
                Sign in again
              </a>
            )}
          </div>
        )}
        {crossings && !draft && (
          <div role="status" className="border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" data-testid="wall-check">
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 py-2 font-medium">{wallCheckMessage(crossings)}</p>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setCrossings(null)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-red-900 hover:bg-red-100"
              >
                <Icon name="close" />
              </button>
            </div>
            <ul className="space-y-1 pb-1">
              {crossings.map((l) => (
                <li key={l.layoutId}>
                  <Link href={`/w/${l.weddingId}/layouts/${l.layoutId}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
                    {l.weddingName} · {l.layoutName}
                  </Link>
                  : {l.tables.map((t) => t.label).join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {!phone && !readOnly && mode === 'edit' && (
            <aside aria-label="Tools" className="hidden w-48 shrink-0 overflow-y-auto overscroll-contain border-r border-stone-200 bg-stone-50 md:block lg:w-56">
              <ToolPanel disabled={!canEdit} />
            </aside>
          )}

          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            <TemplateCanvas image={shownImage} draft={draft !== null} scaleLine={scaleLine} unit={unit} />
            <TemplateToolbar phone={phone} canEdit={canEdit} unit={unit} onUnit={setUnit} onOpenTools={() => setToolsOpen(true)} hint={null} />
            <div className="absolute right-2 z-10" style={{ bottom: zoomBottom }}>
              <TemplateZoomControls />
            </div>
            {notice && (
              <div className="pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4" style={{ bottom: phone ? SHEET_STRIP_PX + 64 : 64 }}>
                <p role="status" data-testid="editor-notice" className="rounded-full bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">
                  {notice}
                </p>
              </div>
            )}
          </div>

          {!phone && (
            <aside aria-label="Details" className="hidden w-72 shrink-0 flex-col border-l border-stone-200 bg-white md:flex lg:w-80" data-testid="template-right-panel">
              <TemplateTabs tabs={tabs} tab={openTab} onSelect={setTab} />
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{panel(openTab)}</div>
            </aside>
          )}

          {phone && (
            <BottomSheet
              snap={sheet}
              onSnapChange={setSheet}
              label="Details"
              stripPx={SHEET_STRIP_PX}
              testId="bottom-sheet"
              header={
                <TemplateTabs
                  tabs={tabs}
                  tab={openTab}
                  onSelect={(next) => {
                    setTab(next)
                    if (sheet === 'strip') setSheet('half')
                  }}
                />
              }
            >
              {panel(openTab)}
            </BottomSheet>
          )}
          {phone && !readOnly && <ToolDrawer open={toolsOpen && mode === 'edit'} onClose={() => setToolsOpen(false)} disabled={!canEdit} />}
        </div>

        <ImportDialog
          open={importOpen !== null}
          templateId={initial.id}
          rerun={
            importOpen === 'rerun' && draft
              ? { plan: draft.plan, image: draft.image }
              : importOpen === 'stored' && referenceImage
                ? { plan: storedImagePlan(referenceImage), image: referenceImage }
                : null
          }
          onClose={() => setImportOpen(null)}
          onDraft={enterDraft}
        />
        <ContextMenu at={menu?.at ?? null} items={menu?.items ?? []} label="Item menu" onClose={() => setMenu(null)} testId="template-menu" />
      </div>
    </TemplateEditorProvider>
  )
}

function TemplateTabs({ tabs, tab, onSelect }: { tabs: Tab[]; tab: Tab; onSelect(tab: Tab): void }) {
  const base = useId()
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const i = tabs.indexOf(tab)
    let next = -1
    if (event.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    if (next < 0) return
    event.preventDefault()
    onSelect(tabs[next])
    document.getElementById(`${base}-${tabs[next]}`)?.focus()
  }
  return (
    <div role="tablist" aria-label="Panels" onKeyDown={onKeyDown} className="flex shrink-0 overflow-x-auto border-b border-stone-200 [scrollbar-width:none]" data-testid="template-tabs">
      {tabs.map((t) => {
        const on = t === tab
        return (
          <button
            key={t}
            id={`${base}-${t}`}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(t)}
            className={`min-h-11 flex-1 whitespace-nowrap border-b-2 px-2 text-xs font-medium outline-none focus-visible:bg-stone-100 sm:text-sm ${
              on ? 'border-blue-900 text-blue-950' : 'border-transparent text-stone-600 hover:text-stone-900'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        )
      })}
    </div>
  )
}

function TemplateModeSwitch({ compact }: { compact: boolean }) {
  const { actions } = useTemplateEditor()
  const mode = useTemplateUi((s) => s.mode)
  const known = useTemplateUi((s) => s.deviceKnown)
  const editing = known && mode === 'edit'
  if (compact) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={editing}
        onClick={() => actions.setMode(editing ? 'view' : 'edit')}
        data-testid="mode-switch"
        data-mode={known ? mode : undefined}
        className={`min-h-11 min-w-11 shrink-0 rounded-lg border px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50 ${
          editing ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-300 bg-white text-stone-700'
        }`}
      >
        Edit
      </button>
    )
  }
  return (
    <div role="group" aria-label="Mode" data-testid="mode-switch" data-mode={known ? mode : undefined} className="inline-flex shrink-0 rounded-lg border border-stone-300 bg-white p-0.5">
      {(['edit', 'view'] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={known && mode === m}
          onClick={() => actions.setMode(m)}
          className={`min-h-11 min-w-11 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50 ${
            known && mode === m ? 'bg-stone-800 text-white' : 'text-stone-700 hover:bg-stone-100'
          }`}
        >
          {m === 'edit' ? 'Edit' : 'View'}
        </button>
      ))}
    </div>
  )
}

const zoomButton =
  'inline-flex h-11 min-w-11 items-center justify-center rounded-lg px-2 text-sm font-medium text-stone-800 outline-none hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-blue-700/50'

function TemplateZoomControls() {
  const { actions, camera } = useTemplateEditor()
  return (
    <div role="group" aria-label="Zoom" data-testid="zoom-controls" className="flex items-center rounded-xl border border-stone-200 bg-white/95 p-0.5 shadow-md backdrop-blur">
      <button type="button" className={zoomButton} aria-label="Zoom out" title="Zoom out" onClick={() => actions.zoomOut()}>
        <Icon name="minus" />
      </button>
      <ZoomPercentLabel camera={camera} className="w-12 text-center text-sm tabular-nums text-stone-700" />
      <button type="button" className={zoomButton} aria-label="Zoom in" title="Zoom in" onClick={() => actions.zoomIn()}>
        <Icon name="plus" />
      </button>
      <button type="button" className={zoomButton} aria-label="Zoom to 100%" title="Zoom to 100%" onClick={() => actions.zoomReset()}>
        100%
      </button>
      <button type="button" className={zoomButton} aria-label="Fit to content" title="Fit to content" onClick={() => actions.zoomFit()}>
        <Icon name="fit" />
      </button>
    </div>
  )
}

