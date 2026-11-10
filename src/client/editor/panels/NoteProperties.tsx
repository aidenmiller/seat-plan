'use client'

/**
 * A selected note in the Properties tab (spec section 9):
 *
 *  - Edit mode: its text (sticky and text notes, with "Edit on the plan",
 *    the phone's way to type into it on the canvas), its color, Done, its
 *    size and turn (all but arrows and lines), and for arrows and lines what
 *    each end is attached to, with Detach. Who added it and when, read only.
 *    While the notes layer is locked, everything shows but nothing changes.
 *  - View mode: the same, read only, with the Done box off.
 *
 * The page adds Lock, Duplicate, To front, To back and Delete under it.
 */
import type { ArrowEnd } from '@/domain/arrows'
import { NOTE_COLOR_PRESETS, NOTE_TYPE_NAMES, isTextNote } from '@/domain/notes'
import { clockTime, whenText } from '@/domain/wording'
import { useNow } from '@/client/ui/clock'
import { itemIndex, useCanvas, useEditorState, useViewState } from '../state/react'
import { CommitField, LengthField, NumberField, Section, smallButton, Switch } from './controls'
import { useEditorUi } from './editor-ui'
import { itemName, type ItemFields } from './names'
import { ColorSwatches, NoteChip } from './note-ui'
import { focusNoteOnPlan } from './notes-list'

export type NoteFields = Extract<ItemFields, { kind: 'note' }>

const END_NAMES: Record<ArrowEnd, string> = { start: 'Start', end: 'End' }

function isArrowType(type: NoteFields['type']): boolean {
  return type === 'arrow' || type === 'line'
}

/** "Added by Noa at 3:42 pm" (or yesterday, or on Nov 3), with the full date on hover. */
export function AddedLine({ author, createdAt }: { author: string; createdAt: string }) {
  const now = useNow()
  const date = new Date(createdAt)
  const valid = Number.isFinite(date.getTime())
  return (
    <p className="text-sm text-stone-700" data-testid="note-added">
      Added by {author}
      {now !== null && valid && (
        <>
          {' '}
          <time dateTime={createdAt} title={`${date.toLocaleDateString()} ${clockTime(date)}`}>
            {whenText(date, new Date(now))}
          </time>
        </>
      )}
    </p>
  )
}

/** What one end of an arrow holds, with Detach in Edit mode. */
function ArrowEndRow({ note, end, edit, disabled }: { note: NoteFields; end: ArrowEnd; edit: boolean; disabled: boolean }) {
  const { actions } = useEditorState()
  const targetId = note.attachedTo[end]
  const name = useCanvas((c) => {
    if (targetId === null) return null
    const target = itemIndex(c).get(targetId)
    return target?.kind === 'table' || target?.kind === 'fixture' ? itemName(target) : null
  })
  return (
    <div className="flex min-h-11 items-center justify-between gap-2" data-arrow-end={end} data-attached={name !== null ? 'true' : 'false'}>
      <p className="min-w-0 break-words text-sm text-stone-800">
        <span className="font-medium">{END_NAMES[end]}:</span> {name !== null ? `attached to ${name}` : 'free'}
      </p>
      {edit && name !== null && (
        <button
          type="button"
          className={smallButton}
          aria-label={`Detach ${END_NAMES[end].toLowerCase()}`}
          disabled={disabled}
          onClick={() => actions.detachArrowEnd(note.id, end)}
          data-testid={`detach-${end}`}
        >
          Detach
        </button>
      )}
    </div>
  )
}

function ArrowEnds({ note, edit, disabled = false }: { note: NoteFields; edit: boolean; disabled?: boolean }) {
  return (
    <Section title="Ends" testId="arrow-ends">
      <ArrowEndRow note={note} end="start" edit={edit} disabled={disabled} />
      <ArrowEndRow note={note} end="end" edit={edit} disabled={disabled} />
      {edit && <p className="text-xs text-stone-500">Drag an end onto a table or fixture to attach it there.</p>}
    </Section>
  )
}

/** Edit mode. */
export function NoteProperties({ note }: { note: NoteFields }) {
  const editor = useEditorState()
  const { actions } = editor
  const { unit, showCanvas } = useEditorUi()
  const layer = useViewState((s) => s.layers.notes)
  const off = layer.locked || !layer.visible
  const arrow = isArrowType(note.type)
  const sizeOff = off || note.locked

  function editOnPlan() {
    focusNoteOnPlan(editor, note.id)
    if (actions.startNoteEdit(note.id)) showCanvas?.()
  }

  return (
    <>
      <Section title={NOTE_TYPE_NAMES[note.type]} testId="note-properties">
        {off && (
          <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700" data-testid="note-layer-locked">
            {layer.visible ? 'Notes are locked. Unlock them to change this note.' : 'Notes are hidden. Show them to change this note.'}
          </p>
        )}
        {isTextNote(note) && (
          <>
            <CommitField
              label="Text"
              value={note.text}
              maxLength={5000}
              multiline
              hint="Shift+Enter starts a new line."
              disabled={off}
              testId="note-text"
              onCommit={(text) => void actions.setNoteText(note.id, text)}
            />
            <button type="button" className={`${smallButton} w-full`} disabled={off} onClick={editOnPlan} data-testid="note-edit-on-plan">
              Edit on the plan
            </button>
          </>
        )}
        <ColorSwatches label="Color" value={note.color} disabled={off} testId="note-color-picker" onChange={(c) => void actions.setNoteColor(c, [note.id])} />
        <Switch label="Done" hint="Greys the note out." checked={note.done} disabled={off} testId="note-done-switch" onChange={(on) => void actions.setNoteDone(note.id, on)} />
      </Section>
      {arrow ? (
        <ArrowEnds note={note} edit disabled={sizeOff} />
      ) : (
        <Section title="Size">
          <div className="grid grid-cols-2 gap-2">
            <LengthField label="Width" cm={note.width} unit={unit} disabled={sizeOff} testId="note-width" onChange={(cm) => void actions.setItemBox(note.id, { width: cm })} />
            <LengthField label="Depth" cm={note.height} unit={unit} disabled={sizeOff} testId="note-depth" onChange={(cm) => void actions.setItemBox(note.id, { height: cm })} />
          </div>
          <NumberField label="Rotation" value={note.rotation} suffix="°" disabled={sizeOff} testId="note-rotation" onChange={(r) => void actions.setItemBox(note.id, { rotation: r })} />
        </Section>
      )}
      {note.locked && !off && <p className="px-4 pt-3 text-xs text-stone-500">Unlock to move, turn or resize.</p>}
      <Section title="Details" testId="note-details">
        <AddedLine author={note.author} createdAt={note.createdAt} />
      </Section>
    </>
  )
}

/** View mode: read only. */
export function NoteSummary({ note }: { note: NoteFields }) {
  const color = NOTE_COLOR_PRESETS[note.color]
  return (
    <>
      <Section title={NOTE_TYPE_NAMES[note.type]} testId="note-summary">
        {isTextNote(note) &&
          (note.text.trim() !== '' ? (
            <p className="whitespace-pre-wrap break-words text-sm text-stone-900" data-testid="note-summary-text">
              {note.text}
            </p>
          ) : (
            <p className="text-sm text-stone-500">No text.</p>
          ))}
        <p className="flex items-center gap-2 text-sm text-stone-800">
          <NoteChip type={note.type} color={note.color} className="h-6 w-6" />
          {color.label}
        </p>
        <label className="flex min-h-11 items-center gap-3 text-sm text-stone-800">
          <input type="checkbox" className="h-5 w-5 accent-blue-900" checked={note.done} disabled data-testid="note-summary-done" />
          Done
        </label>
        <AddedLine author={note.author} createdAt={note.createdAt} />
      </Section>
      {isArrowType(note.type) && <ArrowEnds note={note} edit={false} />}
    </>
  )
}
