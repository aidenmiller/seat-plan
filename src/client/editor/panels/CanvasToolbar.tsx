'use client'

/**
 * The small toolbar over the canvas's top left corner, in Edit mode: Undo
 * and Redo on every screen size, and on phones the Shapes button (the shape
 * panel's drawer) and the Select switch (one finger draws a selection box
 * and taps add to the selection, PLAN change 12). A hint beside it (such as
 * "Pick Noa or Aiden to start editing.") shows in both modes.
 */
import { Icon } from '../icons/glyphs'
import { useEditorState, useMode, useUi } from '../state/react'
import { useStoreSelector } from '../state/store'

/**
 * Where the toolbar ends on a phone, in px from the canvas's top: 8 px down,
 * then 50 px tall (44 px buttons, padding and border). The overlay keeps its
 * buttons below it.
 */
export const PHONE_TOOLBAR_BOTTOM_PX = 58

const button =
  'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-stone-800 outline-none hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-blue-700/50 disabled:cursor-not-allowed disabled:opacity-40'

export function CanvasToolbar({
  phone,
  canEdit,
  onOpenShapes,
  hint,
}: {
  phone: boolean
  /** The page can take edits (author picked, saving ready, no conflict). */
  canEdit: boolean
  onOpenShapes(): void
  /** A short line beside the toolbar, such as "Pick Noa or Aiden to start editing." */
  hint: string | null
}) {
  const { actions, ui, store } = useEditorState()
  const mode = useMode()
  const phoneSelect = useUi((s) => s.phoneSelect)
  const canUndo = useStoreSelector(store, (s) => s.canUndo)
  const canRedo = useStoreSelector(store, (s) => s.canRedo)
  if (mode !== 'edit' && !hint) return null

  return (
    <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-start gap-2">
      {mode === 'edit' && (
        <div role="toolbar" aria-label="Edit tools" className="pointer-events-auto flex items-center rounded-xl border border-stone-200 bg-white/95 p-0.5 shadow-md backdrop-blur" data-testid="canvas-toolbar">
          {phone && (
            <>
              <button type="button" className={button} onClick={onOpenShapes} disabled={!canEdit} aria-label="Shapes" data-testid="open-shapes">
                <Icon name="shapes" />
              </button>
              <button
                type="button"
                className={`${button} ${phoneSelect ? 'bg-blue-900 text-white hover:bg-blue-800' : ''}`}
                aria-pressed={phoneSelect}
                aria-label="Select"
                title="One finger draws a selection box"
                data-testid="phone-select"
                onClick={() => ui.setPhoneSelect(!phoneSelect)}
              >
                <Icon name="select" />
              </button>
            </>
          )}
          <button
            type="button"
            className={button}
            onClick={() => actions.undo()}
            disabled={!canEdit || !canUndo}
            aria-label="Undo"
            aria-keyshortcuts="Control+Z Meta+Z"
            title="Undo"
          >
            <Icon name="undo" />
            {!phone && <span aria-hidden="true">Undo</span>}
          </button>
          <button
            type="button"
            className={button}
            onClick={() => actions.redo()}
            disabled={!canEdit || !canRedo}
            aria-label="Redo"
            aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
            title="Redo"
          >
            <Icon name="redo" />
            {!phone && <span aria-hidden="true">Redo</span>}
          </button>
        </div>
      )}
      {hint && (
        <p className="pointer-events-auto rounded-lg bg-white/95 px-3 py-2 text-sm text-stone-700 shadow-md" data-testid="edit-hint">
          {hint}
        </p>
      )}
    </div>
  )
}
