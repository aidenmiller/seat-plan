/**
 * What the canvas menu offers (right click on a desktop, a long press on a
 * phone; PLAN section 6, "Selection"). The controller has already put the
 * pressed item in the selection. The More button beside a selection opens
 * the same menu.
 *
 *  - Tables: Fit seats, Lock, Copy, Duplicate, Delete.
 *  - Notes: Edit text (sticky and text notes: the phone's way to type into
 *    one), Mark done or Mark not done, then as other items.
 *  - Other items: Lock, Copy, Duplicate, To front, To back, Delete.
 *  - Several items: Lock all, Copy, Duplicate, Delete.
 *  - Empty canvas: Paste (at the pressed point), Select all, Fit to content.
 *  - View mode: Show seats for a table, Fit to content.
 *
 * Phones also get Details, which opens the Properties sheet. Guest menus
 * (Keep together, Keep apart, Unseat) come with seating in milestone 5.
 */
import type { Item } from '@/domain/canvas-schema'
import type { Point } from '@/domain/geometry'
import { isTextNote } from '@/domain/notes'
import type { ContextMenuItem } from '@/client/ui/ContextMenu'
import type { EditorActions, SeatRequest } from '../input/controller'
import type { Target } from '../input/hit-test'
import type { EditorMode } from '../state/ui-store'

export type CanvasMenuInput = {
  target: Target
  /** The selected items, after the press. */
  selection: readonly Item[]
  /** Guests selected by seat. */
  guestCount: number
  mode: EditorMode
  phone: boolean
  canPaste: boolean
  /** Where the menu was opened, in world cm: Paste puts the copy there. */
  pasteAt?: Point | null
  actions: Pick<
    EditorActions,
    | 'fitSeats'
    | 'setLocked'
    | 'copySelection'
    | 'duplicateSelection'
    | 'deleteSelection'
    | 'bringToFront'
    | 'sendToBack'
    | 'paste'
    | 'selectAll'
    | 'zoomFit'
    | 'startNoteEdit'
    | 'toggleNoteDone'
  >
  onSeatRequest(tableId: string, request: SeatRequest): void
  onDetails(): void
  /** Typing into a note began from the menu (phones lower the sheet so the plan shows). */
  onEditNote?(): void
}

export type CanvasMenu = { label: string; items: ContextMenuItem[] }

export function canvasMenu(input: CanvasMenuInput): CanvasMenu | null {
  const { target, selection, mode, phone, actions } = input
  const fit: ContextMenuItem = { id: 'fit', label: 'Fit to content', onSelect: () => actions.zoomFit() }
  const details: ContextMenuItem[] = phone ? [{ id: 'details', label: 'Details', onSelect: input.onDetails }] : []

  if (target.kind === 'seat' && input.guestCount > 0) return null

  if (mode === 'view') {
    if (selection.length === 1 && selection[0].kind === 'table') {
      return { label: 'Table menu', items: [{ id: 'seats', label: 'Show seats', onSelect: input.onDetails }, fit] }
    }
    return { label: 'Canvas menu', items: [fit] }
  }

  if (target.kind === 'empty' || selection.length === 0) {
    return {
      label: 'Canvas menu',
      items: [
        { id: 'paste', label: 'Paste', disabled: !input.canPaste, onSelect: () => void actions.paste(input.pasteAt ?? null) },
        { id: 'selectAll', label: 'Select all', onSelect: () => actions.selectAll() },
        fit,
      ],
    }
  }

  const allLocked = selection.every((i) => i.locked)
  const lock: ContextMenuItem = {
    id: 'lock',
    label: selection.length > 1 ? (allLocked ? 'Unlock all' : 'Lock all') : allLocked ? 'Unlock' : 'Lock',
    onSelect: () => void actions.setLocked(!allLocked),
  }
  const copy: ContextMenuItem = { id: 'copy', label: 'Copy', onSelect: () => void actions.copySelection() }
  const duplicate: ContextMenuItem = { id: 'duplicate', label: 'Duplicate', onSelect: () => void actions.duplicateSelection() }
  const remove: ContextMenuItem = {
    id: 'delete',
    label: 'Delete',
    danger: true,
    disabled: selection.every((i) => i.locked),
    onSelect: () => void actions.deleteSelection(),
  }

  if (selection.length > 1) return { label: `${selection.length} items menu`, items: [lock, copy, duplicate, remove] }

  const item = selection[0]
  if (item.kind === 'table') {
    return {
      label: 'Table menu',
      items: [
        ...details,
        { id: 'fitSeats', label: 'Fit seats', onSelect: () => input.onSeatRequest(item.id, actions.fitSeats(item.id)) },
        lock,
        copy,
        duplicate,
        remove,
      ],
    }
  }
  const noteItems: ContextMenuItem[] = []
  if (item.kind === 'note') {
    if (isTextNote(item)) {
      noteItems.push({
        id: 'editText',
        label: 'Edit text',
        onSelect: () => {
          if (actions.startNoteEdit(item.id)) input.onEditNote?.()
        },
      })
    }
    noteItems.push({ id: 'done', label: item.done ? 'Mark not done' : 'Mark done', onSelect: () => void actions.toggleNoteDone(item.id) })
  }
  return {
    label: item.kind === 'note' ? 'Note menu' : 'Item menu',
    items: [
      ...details,
      ...noteItems,
      lock,
      copy,
      duplicate,
      { id: 'front', label: 'To front', onSelect: () => void actions.bringToFront() },
      { id: 'back', label: 'To back', onSelect: () => void actions.sendToBack() },
      remove,
    ],
  }
}
