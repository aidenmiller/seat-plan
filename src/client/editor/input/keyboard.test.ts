import { describe, expect, it } from 'vitest'
import { isPressable, isTextEntry, keyCommand, type KeyLike } from './keyboard'

const k = (key: string, o: Partial<KeyLike> = {}): KeyLike => ({ key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...o })

describe('the shortcut table (PLAN section 6)', () => {
  it('maps every shortcut, with Cmd or Ctrl', () => {
    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      expect(keyCommand(k('c', mod))).toEqual({ type: 'copy' })
      expect(keyCommand(k('v', mod))).toEqual({ type: 'paste' })
      expect(keyCommand(k('d', mod))).toEqual({ type: 'duplicate' })
      expect(keyCommand(k('a', mod))).toEqual({ type: 'selectAll' })
      expect(keyCommand(k('z', mod))).toEqual({ type: 'undo' })
      expect(keyCommand(k('Z', { ...mod, shiftKey: true }))).toEqual({ type: 'redo' })
      expect(keyCommand(k('=', mod))).toEqual({ type: 'zoomIn' })
      expect(keyCommand(k('-', mod))).toEqual({ type: 'zoomOut' })
      expect(keyCommand(k('0', mod))).toEqual({ type: 'zoomReset' })
      expect(keyCommand(k('1', mod))).toEqual({ type: 'zoomFit' })
    }
    expect(keyCommand(k('y', { ctrlKey: true }))).toEqual({ type: 'redo' })
    expect(keyCommand(k('y', { metaKey: true }))).toBeNull()
    expect(keyCommand(k('Delete'))).toEqual({ type: 'delete' })
    expect(keyCommand(k('Backspace'))).toEqual({ type: 'delete' })
    expect(keyCommand(k('ArrowLeft'))).toEqual({ type: 'nudge', direction: 'left', big: false })
    expect(keyCommand(k('ArrowDown', { shiftKey: true }))).toEqual({ type: 'nudge', direction: 'down', big: true })
    expect(keyCommand(k('Escape'))).toEqual({ type: 'escape' })
    expect(keyCommand(k(' ', { code: 'Space' }))).toEqual({ type: 'space' })
  })

  it('reads keys by their place on other keyboard layouts', () => {
    expect(keyCommand(k('+', { metaKey: true, shiftKey: true, code: 'Equal' }))).toEqual({ type: 'zoomIn' })
    expect(keyCommand(k('à', { ctrlKey: true, code: 'Digit0' }))).toEqual({ type: 'zoomReset' })
  })

  it('leaves other keys to the browser', () => {
    expect(keyCommand(k('c'))).toBeNull()
    expect(keyCommand(k('r', { metaKey: true }))).toBeNull()
    expect(keyCommand(k('c', { metaKey: true, altKey: true }))).toBeNull()
    expect(keyCommand(k('Tab'))).toBeNull()
  })
})

describe('focus checks', () => {
  it('knows text fields', () => {
    expect(isTextEntry({ tagName: 'INPUT', type: 'text' })).toBe(true)
    expect(isTextEntry({ tagName: 'INPUT', type: 'number' })).toBe(true)
    expect(isTextEntry({ tagName: 'INPUT', type: 'checkbox' })).toBe(false)
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    expect(isTextEntry({ tagName: 'DIV' })).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })

  it('knows controls that Space presses', () => {
    expect(isPressable({ tagName: 'BUTTON' })).toBe(true)
    expect(isPressable({ tagName: 'DIV', getAttribute: () => 'switch' })).toBe(true)
    expect(isPressable({ tagName: 'DIV', getAttribute: () => null })).toBe(false)
  })
})
