import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutVersionInfo } from '@/shared/api'
import { readLayoutVersionInfo, watchRemoteVersion } from './remote-version'

const LAYOUT = '6f1c2b9e-3d4a-4c5b-8e7f-0a1b2c3d4e5f'

const info = (version: number): LayoutVersionInfo => ({
  version,
  updatedAt: '2026-11-09T15:42:00.000Z',
  editedBy: 'Aiden',
  editedById: null,
  lastSaveId: 'aaaaaaaa-1111-4111-8111-111111111111',
  recentSaveIds: ['aaaaaaaa-1111-4111-8111-111111111111', 'bbbbbbbb-2222-4222-8222-222222222222'],
})

function setup(reply: () => Response = () => Response.json(info(8)), over = {}) {
  const fetch = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => reply())
  const onChange = vi.fn()
  const onGone = vi.fn()
  const windowTarget = new EventTarget()
  const documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const watch = watchRemoteVersion({
    layoutId: LAYOUT,
    fetch: fetch as unknown as typeof globalThis.fetch,
    onChange,
    onGone,
    windowTarget,
    documentTarget,
    ...over,
  })
  return { fetch, onChange, onGone, windowTarget, documentTarget, watch }
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: 1_000_000 })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('watchRemoteVersion', () => {
  it('asks for the version when the tab regains focus and reports it', async () => {
    const t = setup()
    t.windowTarget.dispatchEvent(new Event('focus'))
    await settle()
    expect(t.fetch).toHaveBeenCalledTimes(1)
    expect(String(t.fetch.mock.calls[0][0])).toBe(`/api/layouts/${LAYOUT}/version`)
    expect(t.fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store' })
    expect(t.onChange).toHaveBeenCalledWith(info(8))
  })

  it('asks when the page becomes visible, not when it hides', async () => {
    const t = setup()
    t.documentTarget.visibilityState = 'hidden'
    t.documentTarget.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(t.fetch).not.toHaveBeenCalled()
    t.documentTarget.visibilityState = 'visible'
    t.documentTarget.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(t.fetch).toHaveBeenCalledTimes(1)
  })

  it('asks at most once every 2 seconds', async () => {
    const t = setup()
    t.windowTarget.dispatchEvent(new Event('focus'))
    t.documentTarget.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(t.fetch).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1999)
    t.windowTarget.dispatchEvent(new Event('focus'))
    await settle()
    expect(t.fetch).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    t.windowTarget.dispatchEvent(new Event('focus'))
    await settle()
    expect(t.fetch).toHaveBeenCalledTimes(2)
  })

  it('reports only a different version when told the current one', async () => {
    let current = 8
    const t = setup(undefined, { currentVersion: () => current })
    await t.watch.check()
    expect(t.onChange).not.toHaveBeenCalled()
    current = 7
    vi.advanceTimersByTime(2000)
    await t.watch.check()
    expect(t.onChange).toHaveBeenCalledWith(info(8))
  })

  it('reports a deleted layout', async () => {
    const t = setup(() => Response.json({ error: 'gone' }, { status: 410 }))
    await t.watch.check()
    expect(t.onGone).toHaveBeenCalledTimes(1)
    expect(t.onChange).not.toHaveBeenCalled()
  })

  it('ignores errors and replies it cannot read', async () => {
    const replies = [
      () => Response.json({ error: 'unauthorized' }, { status: 401 }),
      () => Response.json({ nope: true }),
      () => {
        throw new TypeError('Failed to fetch')
      },
    ]
    let i = 0
    const t = setup(() => replies[i++]())
    for (let k = 0; k < replies.length; k++) {
      await t.watch.check()
      vi.advanceTimersByTime(2000)
    }
    expect(t.fetch).toHaveBeenCalledTimes(3)
    expect(t.onChange).not.toHaveBeenCalled()
  })

  it('reads a reply without recentSaveIds (a server from before them) as an empty list', async () => {
    const { recentSaveIds: _omit, ...older } = info(8)
    void _omit
    const t = setup(() => Response.json(older))
    await t.watch.check()
    expect(t.onChange).toHaveBeenCalledWith({ ...older, recentSaveIds: [] })
    expect(readLayoutVersionInfo({ ...older, recentSaveIds: [1] })).toBeNull()
    expect(readLayoutVersionInfo(info(8))).toEqual(info(8))
  })

  it('accepts a reply naming another person, with or without an id', () => {
    const dayna = { ...info(9), editedBy: 'Dayna K.', editedById: '0b9f6a3e-6c1d-4c8e-9f57-2a1d6f1e7a10' }
    expect(readLayoutVersionInfo(dayna)).toEqual(dayna)
    // A server from before editedById existed (mid-deploy) reads as no id.
    const { editedById: _omit, ...old } = dayna
    void _omit
    expect(readLayoutVersionInfo(old)).toEqual({ ...old, editedById: null })
    expect(readLayoutVersionInfo({ ...dayna, editedById: 5 })).toBeNull()
    expect(readLayoutVersionInfo({ ...dayna, editedBy: 5 })).toBeNull()
  })

  it('stops listening when stopped', async () => {
    const t = setup()
    t.watch.stop()
    t.windowTarget.dispatchEvent(new Event('focus'))
    await settle()
    await t.watch.check()
    expect(t.fetch).not.toHaveBeenCalled()
  })
})
