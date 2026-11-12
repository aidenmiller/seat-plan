import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SaveStatus } from '@/client/sync/types'
import type { TemplateDoc } from '@/domain/template-commands'
import { saveVenueBody, type SaveVenueConflict, type SaveVenueOk } from '@/shared/api'
import { templateStatusView } from './save-status'
import { createTemplateSaver } from './template-saver'

const ID = '7a1c2b9e-3d4a-4c5b-8e7f-0a1b2c3d4e5f'

function docN(n: number): TemplateDoc {
  return { items: [{ id: 'w1', type: 'wall', points: [{ x: 0, y: 0 }, { x: 100 + n, y: 0 }], thickness: 15, unsure: false, unsureNote: '' }], reference: null }
}

type Call = { url: string; init: RequestInit; body: Record<string, unknown>; respond(status: number, data: unknown): void }

function fakeFetch() {
  const calls: Call[] = []
  const fn = vi.fn(
    (url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        calls.push({
          url: String(url),
          init: init ?? {},
          body: JSON.parse(String(init?.body)),
          respond: (status, data) => resolve(new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })),
        })
      }),
  )
  return { fn: fn as unknown as typeof fetch, calls }
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('template autosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup() {
    const fetch = fakeFetch()
    const statuses: SaveStatus[] = []
    const saver = createTemplateSaver({
      templateId: ID,
      baseVersion: 4,
      userId: '11111111-1111-4111-8111-111111111111',
      onStatus: (s) => statuses.push(s),
      fetch: fetch.fn,
      windowTarget: null,
      documentTarget: null,
      isOnline: () => true,
      random: () => 0,
    })
    return { fetch, statuses, saver }
  }

  it('sends the venue body to the venue route a second after the last edit', async () => {
    const { fetch, saver } = setup()
    saver.noteEdit(docN(1))
    await vi.advanceTimersByTimeAsync(999)
    expect(fetch.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetch.calls).toHaveLength(1)
    const call = fetch.calls[0]
    expect(call.url).toBe(`/api/venues/${ID}`)
    expect(call.init.method).toBe('PUT')
    expect(saveVenueBody.safeParse(call.body).success).toBe(true)
    expect(call.body).toMatchObject({ baseVersion: 4, reference: null })
    expect(call.body).not.toHaveProperty('editedBy')
    expect(call.body).not.toHaveProperty('canvas')
    const reply: SaveVenueOk = { status: 'saved', version: 5, updatedAt: '2026-11-09T12:00:00.000Z', editedBy: 'Aiden', editedById: null }
    call.respond(200, reply)
    await settle()
    expect(saver.getBaseVersion()).toBe(5)
    expect(saver.hasUnsavedChanges()).toBe(false)
  })

  it('stops on a conflict until the page resolves it', async () => {
    const { fetch, saver, statuses } = setup()
    saver.noteEdit(docN(1))
    await vi.advanceTimersByTimeAsync(3000)
    const conflict: SaveVenueConflict = {
      error: 'conflict',
      message: 'Noa saved this venue after you opened it.',
      version: 6,
      updatedAt: '2026-11-09T12:00:00.000Z',
      editedBy: 'Noa',
      editedById: null,
      lastSaveId: null,
    }
    fetch.calls[0].respond(409, conflict)
    await settle()
    const last = statuses[statuses.length - 1]
    expect(last).toMatchObject({ kind: 'conflict', server: { version: 6, editedBy: 'Noa' } })
    expect(templateStatusView(last, false).text).toBe('Not saved')
    saver.noteEdit(docN(2))
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetch.calls).toHaveLength(1)
  })

  it('names the venue when it was deleted', async () => {
    const { fetch, saver, statuses } = setup()
    saver.noteEdit(docN(1))
    await vi.advanceTimersByTimeAsync(3000)
    fetch.calls[0].respond(410, { error: 'gone' })
    await settle()
    const last = statuses[statuses.length - 1]
    expect(last).toMatchObject({ kind: 'failed', reason: 'gone', message: 'This venue was deleted, so changes cannot be saved.' })
    expect(templateStatusView(last, false).text).toBe("Couldn't save: this venue was deleted")
  })

  it('says a draft is not saved', () => {
    expect(templateStatusView({ kind: 'saved', at: '' }, true).text).toBe('Draft, not saved')
    expect(templateStatusView(null, false).text).toBe('Opening…')
  })
})
