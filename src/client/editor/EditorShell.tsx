'use client'

/**
 * The full-screen layout editor for milestone 2: a top bar (back to the
 * layouts tab, the layout's name, the save status, the Noa / Aiden switch), a
 * small toolbar (Add round table, Undo, Redo) and the bare canvas. The
 * document lives in a store made for this layout (doc-store.ts); saving,
 * drafts, other people's changes and conflicts go through layout-session.ts.
 *
 * The top bar never wraps: the name is cut short and the save status has a
 * fixed slot, so the canvas does not move when the status changes.
 *
 * Once "Keep mine as a new copy" or "Save as a copy" has made the copy,
 * editing stays off until the page has opened the copy.
 */
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { errorMessage, updateLayout } from '@/client/api'
import { getAuthor, useAuthor } from '@/client/author'
import { randomId } from '@/client/sync/random-id'
import type { LayoutSaver, SaveStatus } from '@/client/sync/types'
import { useUnloadGuard } from '@/client/sync/unload'
import { AuthorSwitch } from '@/client/ui/AuthorSwitch'
import { InlineName } from '@/client/ui/InlineName'
import { primaryButton, secondaryButton } from '@/client/ui/styles'
import type { Canvas } from '@/domain/canvas-schema'
import { addRoundTable } from '@/domain/round-table'
import { copyLayoutName } from '@/domain/wording'
import type { LayoutDetail } from '@/shared/api'
import { BareCanvas } from './BareCanvas'
import { ConflictDialog } from './ConflictDialog'
import { createDocStore, type DocStore } from './doc-store'
import { openLayoutSession, type ConflictInfo, type LayoutSession } from './layout-session'
import { NotStoredBanner, SaveFailedBanner, SaveStatusSlot } from './SaveBanners'
import { notStoredAlert } from './save-status'

export function EditorShell({ layout }: { layout: LayoutDetail }) {
  const router = useRouter()
  const pathname = usePathname()
  const author = useAuthor()
  // The page keys this component by layout id, so these live as long as this layout is open.
  const [initial] = useState(layout)
  const backHref = `/w/${initial.weddingId}/layouts`
  const [store] = useState<DocStore>(() => createDocStore(layout.canvas))
  const [name, setName] = useState(layout.name)
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

  const doc = useSyncExternalStore(
    store.subscribe,
    () => store.getState(),
    () => store.getState(),
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
    return () => {
      session.close()
      sessionRef.current = null
    }
  }, [initial, store])

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

  const canEdit = saver !== null && author !== null && conflict === null && !leaving
  const canEditRef = useRef(canEdit)
  useEffect(() => {
    canEditRef.current = canEdit
  })

  const commit = useCallback((next: Canvas | null) => {
    if (next) sessionRef.current?.noteEdit(next)
  }, [])

  const addTable = useCallback(() => {
    if (!canEditRef.current) return
    const id = randomId()
    commit(store.edit('Add table', (canvas) => addRoundTable(canvas, id)))
  }, [commit, store])

  const undo = useCallback(() => {
    if (canEditRef.current) commit(store.undo())
  }, [commit, store])

  const redo = useCallback(() => {
    if (canEditRef.current) commit(store.redo())
  }, [commit, store])

  // Cmd/Ctrl+Z undoes; Cmd/Ctrl+Shift+Z (or Ctrl+Y) redoes. Not while typing, and not behind a dialog.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      if (document.querySelector('[aria-modal="true"]')) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if ((key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.metaKey)) {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-stone-200 bg-white px-2 py-1 sm:px-3">
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

      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-2 py-2 sm:px-3">
        <button type="button" className={primaryButton} onClick={addTable} disabled={!canEdit}>
          Add round table
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={undo}
          disabled={!canEdit || !doc.canUndo}
          aria-keyshortcuts="Control+Z Meta+Z"
        >
          Undo
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={redo}
          disabled={!canEdit || !doc.canRedo}
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
        >
          Redo
        </button>
        {saver !== null && author === null && (
          <p className="text-sm text-stone-600">Pick Noa or Aiden to start editing.</p>
        )}
      </div>

      <div className="relative min-h-0 flex-1 bg-stone-50">
        <BareCanvas store={store} />
        {notice && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
            <p
              role="status"
              data-testid="editor-notice"
              className="rounded-full bg-stone-900 px-4 py-2 text-sm text-white shadow-lg"
            >
              {notice}
            </p>
          </div>
        )}
      </div>

      <ConflictDialog conflict={conflict} me={author} onLoadTheirs={loadTheirs} onKeepMine={keepMine} />
    </div>
  )
}
