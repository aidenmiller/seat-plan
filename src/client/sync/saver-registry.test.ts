import { describe, expect, it, vi } from 'vitest'
import { anyUnsaved, flushAll, isLeavingForSignOut, markLeavingForSignOut, registerSaver, stopAll, type LiveSaver } from './saver-registry'

function fake(unsaved: boolean, flush: () => Promise<void> = async () => undefined): LiveSaver & { stopped: boolean } {
  const s = {
    stopped: false,
    unsaved,
    flush: vi.fn(async () => {
      await flush()
      s.unsaved = false
    }),
    hasUnsavedChanges: () => s.unsaved,
    stop: vi.fn(async () => {
      s.stopped = true
    }),
  }
  return s
}

describe('the saver registry', () => {
  it('flushes every live saver and reports whether anything is still unsaved', async () => {
    const a = fake(true)
    const b = fake(false)
    const offA = registerSaver(a)
    const offB = registerSaver(b)
    expect(anyUnsaved()).toBe(true)
    expect(await flushAll(1000)).toEqual({ unsaved: false })
    expect(a.flush).toHaveBeenCalled()
    expect(b.flush).toHaveBeenCalled()
    offA()
    offB()
  })

  it('waits no longer than it is told for a saver that hangs', async () => {
    vi.useFakeTimers()
    try {
      const stuck = fake(true, () => new Promise(() => undefined))
      const off = registerSaver(stuck)
      const result = flushAll(3000)
      await vi.advanceTimersByTimeAsync(3000)
      expect(await result).toEqual({ unsaved: true })
      off()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops every saver and forgets them; a saver taken out is not reached', async () => {
    const a = fake(true)
    const gone = fake(true)
    registerSaver(a)
    registerSaver(gone)()
    await stopAll()
    expect(a.stopped).toBe(true)
    expect(gone.stopped).toBe(false)
    expect(anyUnsaved()).toBe(false)
  })

  it('remembers that the page leaves for a sign-out', () => {
    expect(isLeavingForSignOut()).toBe(false)
    markLeavingForSignOut()
    expect(isLeavingForSignOut()).toBe(true)
  })
})
