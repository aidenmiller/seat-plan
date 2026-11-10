import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Table } from '@/domain/canvas-schema'
import type { DetailLevel } from '@/domain/detail-level'
import { makeItem } from '@/domain/presets'
import { createDocStore } from '../doc-store'
import { createEditorDoc } from '../state/editor-doc'
import { createNameLabels } from './name-labels'
import { directory } from './people'
import { createSeatingStore } from './store'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

function table(id: string, x: number, guests: (string | null)[]): Table {
  const t = makeItem('round', { x, y: 0 }, id, emptyCanvas()) as Table
  return { ...t, seats: t.seats.map((s, i) => ({ index: i, guestId: guests[i] ?? null })) }
}

function setup() {
  const store = createDocStore({ ...emptyCanvas(), items: [table('t1', 0, [A]), table('t2', 600, [B])] })
  const doc = createEditorDoc({ store, canEdit: () => true, onCommit: () => undefined })
  const seating = createSeatingStore()
  let level: DetailLevel = 'far'
  let zoom = 0.2
  let moving = false
  const settles = new Set<(camera: { zoom: number; x: number; y: number }) => void>()
  let measured = 0
  const labels = createNameLabels({
    doc,
    camera: {
      get: () => ({ zoom, x: 0, y: 0 }),
      detailLevel: () => level,
      isMoving: () => moving,
      subscribeSettle: (l) => {
        settles.add(l)
        return () => void settles.delete(l)
      },
    },
    seating,
    venueItems: () => [],
    measure: (text, size) => {
      measured++
      return text.length * 0.6 * size
    },
  })
  const settle = (z: number, l: DetailLevel) => {
    zoom = z
    level = l
    moving = false
    for (const s of settles) s({ zoom, x: 0, y: 0 })
  }
  return {
    store,
    doc,
    seating,
    labels,
    settle,
    setMoving: (m: boolean) => void (moving = m),
    measured: () => measured,
    of: (id: string) => labels.store.getState().byTable.get(id),
  }
}

const people = directory({
  guests: [
    { id: A, firstName: 'Jane', lastName: 'Doe', nickname: null, rsvp: 'yes', partnerId: null, coupleRuleEnabled: true },
    { id: B, firstName: 'Bo', lastName: 'Ray', nickname: null, rsvp: 'yes', partnerId: null, coupleRuleEnabled: true },
  ],
})

describe('guest names at close level (review finding)', () => {
  it('are worked out only at close level, when the camera settles, never while it moves', () => {
    const h = setup()
    h.seating.setState({ people })
    expect(h.of('t1')).toBeUndefined()
    h.settle(0.6, 'middle')
    expect(h.of('t1')).toBeUndefined()
    expect(h.measured()).toBe(0)
    h.settle(1, 'close')
    expect(h.of('t1')).toEqual([expect.objectContaining({ seatIndex: 0, guestId: A, form: 'full', text: 'Jane Doe' })])
    expect(h.of('t2')?.[0]).toMatchObject({ text: 'Bo Ray' })
    // A camera mid-gesture changes nothing; the same zoom settling again does no work.
    const before = h.measured()
    h.setMoving(true)
    h.labels.refresh()
    h.settle(1, 'close')
    expect(h.measured()).toBe(before)
    // Back to middle: the labels stay (hidden by CSS), so zooming back in costs nothing.
    h.settle(0.6, 'middle')
    expect(h.of('t1')?.[0].text).toBe('Jane Doe')
  })

  it('follow the plan after an edit, but not during a drag, and keep each unchanged table list as it was', () => {
    const h = setup()
    h.seating.setState({ people })
    h.settle(1, 'close')
    const t2 = h.of('t2')
    const g = h.doc.begin('Move')!
    g.preview((c) => ({ ...c, items: c.items.map((i) => (i.id === 't1' ? { ...i, x: 50 } : i)) }))
    expect(h.of('t1')?.[0].guestId).toBe(A)
    g.commit()
    h.doc.edit('Seat', (c) => ({ ...c, items: c.items.map((i) => (i.id === 't1' && i.kind === 'table' ? { ...i, seats: i.seats.map((s, k) => (k === 1 ? { ...s, guestId: B } : s)) } : i)) }))
    expect(h.of('t1')?.map((l) => l.seatIndex)).toEqual([0, 1])
    expect(h.of('t2')).toBe(t2)
  })

  it('arrive with the guest list', () => {
    const h = setup()
    h.settle(1, 'close')
    expect(h.of('t1')).toEqual([])
    h.seating.setState({ people })
    expect(h.of('t1')?.[0].text).toBe('Jane Doe')
  })
})
