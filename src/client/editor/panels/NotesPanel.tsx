'use client'

/**
 * The Notes tab (spec section 9; PLAN section 6, "Right panel"): every note
 * on the plan, newest first, each with its color and type, a short preview
 * of its text, who added it and when, and a Done box. Filters: All, Open and
 * Done, with counts. A click (or tap) on a note selects it and brings it into
 * view, zooming when it would show too small or too large; on phones the
 * sheet drops to its strip so the plan shows.
 *
 * Hidden notes stay in the list, greyed, under "Notes hidden" with a Show
 * button; picking one shows the notes again. While notes are hidden or
 * locked, or in View mode, the Done boxes are off: only reading works.
 */
import { useState, type KeyboardEvent } from 'react'
import { NOTE_TYPE_NAMES, type NoteListEntry } from '@/domain/notes'
import { RelativeTime } from '@/client/ui/RelativeTime'
import { useEditorState, useMode, useNotes, useUi, useViewState } from '../state/react'
import { smallButton } from './controls'
import { useEditorUi } from './editor-ui'
import { NoteChip, NoteIcon } from './note-ui'
import { emptyListText, focusNoteOnPlan, NOTE_FILTERS, noteCounts, visibleNotes, type NoteFilter } from './notes-list'

export function NotesPanel() {
  const editor = useEditorState()
  const { showCanvas } = useEditorUi()
  const mode = useMode()
  const notes = useNotes()
  const layer = useViewState((s) => s.layers.notes)
  const selection = useUi((s) => s.selection)
  const [filter, setFilter] = useState<NoteFilter>('all')
  const counts = noteCounts(notes)
  const list = visibleNotes(notes, filter)
  const edit = mode === 'edit'
  const canMark = edit && layer.visible && !layer.locked
  const selected = new Set(selection)

  /** Selects the note and brings it into view (showing hidden notes); phones lower the sheet. */
  function focus(id: string) {
    if (focusNoteOnPlan(editor, id)) showCanvas?.()
  }

  function onFilterKey(event: KeyboardEvent<HTMLDivElement>) {
    const i = NOTE_FILTERS.findIndex((f) => f.value === filter)
    let next = -1
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (i + 1) % NOTE_FILTERS.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (i - 1 + NOTE_FILTERS.length) % NOTE_FILTERS.length
    if (next < 0) return
    event.preventDefault()
    setFilter(NOTE_FILTERS[next].value)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <div data-testid="notes-panel" data-filter={filter}>
      <div className="border-b border-stone-200 px-4 py-3">
        <div
          role="radiogroup"
          aria-label="Which notes"
          onKeyDown={onFilterKey}
          className="flex rounded-lg border border-stone-300 bg-stone-50 p-0.5"
          data-testid="notes-filter"
        >
          {NOTE_FILTERS.map((f) => {
            const on = f.value === filter
            return (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                data-value={f.value}
                onClick={() => setFilter(f.value)}
                className={`min-h-11 flex-1 rounded-md px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50 ${
                  on ? 'bg-white text-blue-950 shadow-sm ring-1 ring-stone-300' : 'text-stone-700 hover:bg-white/70'
                }`}
              >
                {f.label} ({counts[f.value]})
              </button>
            )
          })}
        </div>
        {!layer.visible && counts.all > 0 && (
          <div role="status" className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-amber-50 py-1 pl-3 pr-1 text-sm text-amber-900" data-testid="notes-hidden">
            <span className="inline-flex items-center gap-1.5">
              <NoteIcon name="eyeOff" className="h-4 w-4" />
              Notes hidden
            </span>
            <button type="button" className={smallButton} onClick={() => editor.view.setLayer('notes', { visible: true })}>
              Show
            </button>
          </div>
        )}
        {layer.visible && layer.locked && edit && counts.all > 0 && (
          <div role="status" className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-stone-100 py-1 pl-3 pr-1 text-sm text-stone-800" data-testid="notes-locked">
            <span className="inline-flex items-center gap-1.5">
              <NoteIcon name="lock" className="h-4 w-4" />
              Notes locked
            </span>
            <button type="button" className={smallButton} onClick={() => editor.view.setLayer('notes', { locked: false })}>
              Unlock
            </button>
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <p className="px-4 py-6 text-sm text-stone-600" data-testid="notes-empty">
          {emptyListText(filter, counts.all, edit)}
        </p>
      ) : (
        <ul className={layer.visible ? '' : 'opacity-60'} data-testid="notes-list">
          {list.map((entry) => (
            <NoteRow
              key={entry.id}
              entry={entry}
              selected={selected.has(entry.id)}
              canMark={canMark}
              onFocus={() => focus(entry.id)}
              onDone={(done) => editor.actions.setNoteDone(entry.id, done)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function NoteRow({
  entry,
  selected,
  canMark,
  onFocus,
  onDone,
}: {
  entry: NoteListEntry
  selected: boolean
  canMark: boolean
  onFocus(): void
  onDone(done: boolean): void
}) {
  return (
    <li
      className={`flex items-stretch border-b border-stone-100 ${selected ? 'bg-blue-50' : ''}`}
      data-note-id={entry.id}
      data-done={entry.done ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
    >
      <label className={`flex w-12 shrink-0 items-center justify-center ${canMark ? 'cursor-pointer' : 'cursor-not-allowed'}`} title={entry.done ? 'Done' : 'Not done'}>
        <input
          type="checkbox"
          className="h-5 w-5 accent-blue-900 disabled:cursor-not-allowed"
          checked={entry.done}
          disabled={!canMark}
          aria-label={`Done: ${entry.title}`}
          onChange={(event) => onDone(event.target.checked)}
          data-testid="note-done"
        />
      </label>
      <button
        type="button"
        onClick={onFocus}
        title="Show on the plan"
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pr-3 text-left outline-none hover:bg-stone-50 focus-visible:bg-stone-100"
        data-testid="note-row"
      >
        {/* A done note greys out here as on the plan. */}
        <span className={`flex shrink-0 ${entry.done ? 'opacity-45 grayscale' : ''}`} data-testid="note-chip">
          <NoteChip type={entry.type} color={entry.color} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${entry.done ? 'text-stone-500 line-through' : 'text-stone-900'}`}>
            <span className="sr-only">{NOTE_TYPE_NAMES[entry.type]}: </span>
            {entry.title}
          </span>
          <span className="block text-xs text-stone-500">
            {entry.author} · <RelativeTime iso={entry.createdAt} />
            {entry.locked && <span className="sr-only">, locked</span>}
          </span>
        </span>
        {entry.locked && <NoteIcon name="lock" className="h-4 w-4 shrink-0 text-stone-400" />}
      </button>
    </li>
  )
}
