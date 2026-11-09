import { describe, expect, it, vi } from 'vitest'
import { installUnloadGuard, type UnloadGuardSaver } from './unload'

function fakeSaver() {
  let unsaved = false
  const listeners = new Set<() => void>()
  const saver = {
    hasUnsavedChanges: () => unsaved,
    flush: vi.fn(async () => {}),
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  } satisfies UnloadGuardSaver
  return {
    saver,
    listeners,
    setUnsaved(value: boolean) {
      unsaved = value
      for (const l of listeners) l()
    },
  }
}

function targets() {
  const windowTarget = new EventTarget()
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  return { windowTarget, documentTarget }
}

/** Like the browser's BeforeUnloadEvent, whose returnValue holds what the page set. */
function beforeUnload() {
  const event = new Event('beforeunload', { cancelable: true })
  Object.defineProperty(event, 'returnValue', { value: '', writable: true })
  return event as Event & { returnValue: unknown }
}

describe('installUnloadGuard', () => {
  it('warns before closing only while there are unsaved changes', () => {
    const s = fakeSaver()
    const t = targets()
    const add = vi.spyOn(t.windowTarget, 'addEventListener')
    const remove = vi.spyOn(t.windowTarget, 'removeEventListener')
    installUnloadGuard(s.saver, t)
    expect(add.mock.calls.map((c) => c[0])).not.toContain('beforeunload')

    const clean = beforeUnload()
    t.windowTarget.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    s.setUnsaved(true)
    expect(add.mock.calls.filter((c) => c[0] === 'beforeunload')).toHaveLength(1)
    const dirty = beforeUnload()
    t.windowTarget.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
    expect(dirty.returnValue).toBe(true)

    s.setUnsaved(true) // no second listener
    expect(add.mock.calls.filter((c) => c[0] === 'beforeunload')).toHaveLength(1)

    s.setUnsaved(false)
    expect(remove.mock.calls.map((c) => c[0])).toContain('beforeunload')
    const again = beforeUnload()
    t.windowTarget.dispatchEvent(again)
    expect(again.defaultPrevented).toBe(false)
  })

  it('tries a last keepalive save on page hide and when the page is hidden', () => {
    const s = fakeSaver()
    const t = targets()
    installUnloadGuard(s.saver, t)

    t.windowTarget.dispatchEvent(new Event('pagehide'))
    expect(s.saver.flush).not.toHaveBeenCalled() // nothing unsaved

    s.setUnsaved(true)
    t.windowTarget.dispatchEvent(new Event('pagehide'))
    expect(s.saver.flush).toHaveBeenCalledWith({ keepalive: true })

    t.documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(s.saver.flush).toHaveBeenCalledTimes(1) // still visible

    t.documentTarget.visibilityState = 'hidden'
    t.documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(s.saver.flush).toHaveBeenCalledTimes(2)
    expect(s.saver.flush).toHaveBeenLastCalledWith({ keepalive: true })
  })

  it('removes every listener when cleaned up', () => {
    const s = fakeSaver()
    const t = targets()
    s.setUnsaved(true)
    const stop = installUnloadGuard(s.saver, t)
    stop()
    expect(s.listeners.size).toBe(0)
    const e = beforeUnload()
    t.windowTarget.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    t.windowTarget.dispatchEvent(new Event('pagehide'))
    t.documentTarget.visibilityState = 'hidden'
    t.documentTarget.dispatchEvent(new Event('visibilitychange'))
    expect(s.saver.flush).not.toHaveBeenCalled()
  })
})
