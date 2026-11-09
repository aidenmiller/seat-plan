/**
 * The editor's keyboard shortcuts (PLAN section 6, "Keyboard"), as a pure
 * key-to-command map. The DOM adapter ignores keys while a text field has
 * focus or a dialog is open, and prevents the browser's own use of every key
 * the editor handles. Cmd and Ctrl both count as the command key.
 *
 * | Keys                                   | Command                    |
 * |----------------------------------------|----------------------------|
 * | Delete, Backspace                      | delete                     |
 * | Cmd/Ctrl+C, Cmd/Ctrl+V                 | copy, paste                |
 * | Cmd/Ctrl+D                             | duplicate                  |
 * | Cmd/Ctrl+A                             | selectAll                  |
 * | Cmd/Ctrl+Z; Cmd/Ctrl+Shift+Z or Ctrl+Y | undo; redo                 |
 * | Arrow keys; Shift+arrow                | nudge one step; five steps |
 * | Space (held)                           | space: drags pan           |
 * | Cmd/Ctrl + =, -, 0, 1                  | zoomIn, zoomOut, zoomReset, zoomFit |
 * | Esc                                    | escape                     |
 *
 * Alt (no snapping) and Shift on a handle (keep proportions) are read from
 * pointer events and sent to the pointer machine as they change.
 */
import type { NudgeDirection } from '../commands'

export type KeyLike = {
  key: string
  code?: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  repeat?: boolean
}

export type KeyCommand =
  | { type: 'delete' }
  | { type: 'copy' }
  | { type: 'paste' }
  | { type: 'duplicate' }
  | { type: 'selectAll' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'nudge'; direction: NudgeDirection; big: boolean }
  | { type: 'zoomIn' }
  | { type: 'zoomOut' }
  | { type: 'zoomReset' }
  | { type: 'zoomFit' }
  | { type: 'escape' }
  | { type: 'space' }

const ARROWS: Record<string, NudgeDirection> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

/** True for the Space bar, on any layout. */
export function isSpaceKey(e: Pick<KeyLike, 'key' | 'code'>): boolean {
  return e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space'
}

export function keyCommand(e: KeyLike): KeyCommand | null {
  const mod = e.metaKey || e.ctrlKey
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (mod) {
    if (e.altKey) return null
    if (key === '=' || key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') return { type: 'zoomIn' }
    if (key === '-' || key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') return { type: 'zoomOut' }
    if ((key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') && !e.shiftKey) return { type: 'zoomReset' }
    if ((key === '1' || e.code === 'Digit1' || e.code === 'Numpad1') && !e.shiftKey) return { type: 'zoomFit' }
    switch (key) {
      case 'c':
        return e.shiftKey ? null : { type: 'copy' }
      case 'v':
        return e.shiftKey ? null : { type: 'paste' }
      case 'd':
        return e.shiftKey ? null : { type: 'duplicate' }
      case 'a':
        return e.shiftKey ? null : { type: 'selectAll' }
      case 'z':
        return e.shiftKey ? { type: 'redo' } : { type: 'undo' }
      case 'y':
        return e.ctrlKey && !e.metaKey && !e.shiftKey ? { type: 'redo' } : null
      default:
        return null
    }
  }
  if (key === 'Delete' || key === 'Backspace') return e.altKey ? null : { type: 'delete' }
  if (key in ARROWS) return { type: 'nudge', direction: ARROWS[key], big: e.shiftKey }
  if (key === 'Escape') return { type: 'escape' }
  if (isSpaceKey(e)) return { type: 'space' }
  return null
}

type ElementLike = { tagName?: string; isContentEditable?: boolean; getAttribute?(name: string): string | null; type?: string }

/** A field that takes typing: shortcuts leave it alone. */
export function isTextEntry(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as ElementLike
  if (el.isContentEditable) return true
  const tag = el.tagName?.toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (el.type ?? 'text').toLowerCase()
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image'].includes(type)
}

/** A button-like control: Space presses it, so Space does not pan. */
export function isPressable(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as ElementLike
  const tag = el.tagName?.toUpperCase()
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || tag === 'INPUT') return true
  const role = el.getAttribute?.('role')
  return role === 'button' || role === 'menuitem' || role === 'switch' || role === 'checkbox' || role === 'tab' || role === 'option'
}
