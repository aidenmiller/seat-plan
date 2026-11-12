'use client'

/**
 * The small toolbar over the canvas's top left corner, in Edit mode: Undo
 * and Redo on every screen size, and on phones the Shapes button (the shape
 * panel's drawer) and the Select switch (one finger draws a selection box
 * and taps add to the selection, PLAN change 12). A hint beside it (such as
 * "Click the plan to place the note.") shows in both modes.
 *
 * Beside it, the notes layer's switches (spec section 9), kept per device
 * (PLAN change 1): Show (all notes on the plan, or none) in both modes, and
 * Lock (nothing on the notes layer changes) in Edit mode. Each is a toggle
 * button (aria-pressed): tinted when on, plain with the eye crossed out or
 * the lock open when off, and a tooltip saying which. While a note tool is armed, a hint says what a click or a
 * drag does, with Cancel.
 */
import { NOTE_TYPE_NAMES, type NoteType } from '@/domain/notes'
import { Icon } from '../icons/glyphs'
import type { EditorState, LayerSwitch } from '../state'
import { useEditorState, useMode, useUi, useViewState } from '../state/react'
import { useStoreSelector } from '../state/store'
import { NoteIcon } from './note-ui'

/**
 * Where the toolbar ends on a phone, in px from the canvas's top: 8 px down,
 * then 50 px tall (44 px buttons, padding and border). The overlay keeps its
 * buttons below it.
 */
export const PHONE_TOOLBAR_BOTTOM_PX = 58

const button =
  'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-stone-800 outline-none hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-blue-700/50 disabled:cursor-not-allowed disabled:opacity-40'

/** A layer switch that is on: tinted, so on and off read apart at a glance. */
const switchOn = 'bg-blue-100 text-blue-950 ring-1 ring-inset ring-blue-300 hover:bg-blue-200'
/** A layer switch that is off: plain and quieter. */
const switchOff = 'text-stone-500 hover:text-stone-800'

/** What a click or a drag on the plan does with this note tool armed. */
export function noteToolHint(type: NoteType, phone: boolean): string {
  const name = NOTE_TYPE_NAMES[type].toLowerCase()
  if (type === 'arrow' || type === 'line') return `Drag on the plan to draw ${type === 'arrow' ? 'an arrow' : 'a line'}.`
  return `${phone ? 'Tap' : 'Click'} the plan to add ${type === 'text' ? 'text' : `a ${name}`}, or drag to draw it.`
}

/**
 * Flips the notes layer's Show or Lock switch on this device. Hiding or
 * locking the notes also puts a note tool down, since it could add nothing.
 */
export function switchNotesLayer(editor: Pick<EditorState, 'view' | 'actions'>, patch: Partial<LayerSwitch>): void {
  editor.view.setLayer('notes', patch)
  if (patch.visible === false || patch.locked === true) editor.actions.setNoteTool(null)
}

/**
 * The notes layer's switches: Show, and in Edit mode Lock. Phones and
 * narrow desktops show the icons alone (with tooltips), so the toolbar
 * stays on one row; wide desktops add a word to each.
 */
export function NotesLayerControls({ phone, edit }: { phone: boolean; edit: boolean }) {
  const editor = useEditorState()
  const notes = useViewState((s) => s.layers.notes)
  const shown = notes.visible
  const locked = notes.locked
  const set = (patch: Partial<LayerSwitch>) => switchNotesLayer(editor, patch)
  return (
    <div
      role="group"
      aria-label="Notes"
      className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-stone-200 bg-white/95 p-0.5 shadow-md backdrop-blur"
      data-testid="notes-layer-controls"
    >
      {!phone && (
        <span aria-hidden="true" className="hidden px-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500 lg:inline">
          Notes
        </span>
      )}
      <button
        type="button"
        className={`${button} ${shown ? switchOn : switchOff}`}
        aria-pressed={shown}
        aria-label="Show notes"
        title={shown ? 'Notes show. Click to hide all notes.' : 'Notes are hidden. Click to show all notes.'}
        data-testid="notes-show"
        data-state={shown ? 'on' : 'off'}
        onClick={() => set({ visible: !shown })}
      >
        <NoteIcon name={shown ? 'eye' : 'eyeOff'} />
        {!phone && <span className="hidden lg:inline">Show</span>}
      </button>
      {edit && (
        <button
          type="button"
          className={`${button} ${locked ? switchOn : switchOff}`}
          aria-pressed={locked}
          aria-label="Lock notes"
          title={locked ? 'Notes are locked. Click to unlock them.' : 'Click to lock all notes, so they cannot change and clicks go through them.'}
          data-testid="notes-lock"
          data-state={locked ? 'on' : 'off'}
          onClick={() => set({ locked: !locked })}
        >
          <NoteIcon name={locked ? 'lock' : 'lockOpen'} />
          {!phone && <span className="hidden lg:inline">Lock</span>}
        </button>
      )}
    </div>
  )
}

export function CanvasToolbar({
  phone,
  canEdit,
  onOpenShapes,
  hint,
}: {
  phone: boolean
  /** The page can take edits (saving ready, no conflict). */
  canEdit: boolean
  onOpenShapes(): void
  /** A short line beside the toolbar, such as "Click the plan to place the note." */
  hint: string | null
}) {
  const { actions, ui, store } = useEditorState()
  const mode = useMode()
  const phoneSelect = useUi((s) => s.phoneSelect)
  const tool = useUi((s) => s.tool)
  const canUndo = useStoreSelector(store, (s) => s.canUndo)
  const canRedo = useStoreSelector(store, (s) => s.canRedo)
  const noteTool = mode === 'edit' && tool.kind === 'note' ? tool.noteType : null

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
      <NotesLayerControls phone={phone} edit={mode === 'edit'} />
      {noteTool && (
        <div
          role="status"
          className="pointer-events-auto flex items-center gap-1 rounded-lg bg-white/95 py-0.5 pl-3 pr-0.5 text-sm text-stone-700 shadow-md"
          data-testid="note-tool-hint"
        >
          <span className="py-2">
            {noteToolHint(noteTool, phone)}
            {!phone && ' Esc cancels.'}
          </span>
          <button type="button" className={button} onClick={() => actions.setNoteTool(null)} data-testid="note-tool-cancel">
            Cancel
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
