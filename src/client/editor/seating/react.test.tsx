import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Table } from '@/domain/canvas-schema'
import { makeItem } from '@/domain/presets'
import { createDocStore } from '../doc-store'
import { createEditorState, EditorStateProvider } from '../state'
import { GUEST_ROW_STYLE, useDragOrigin, useDragTint, useDropTargetSeat, useGuestDrag, useGuestPick, useGuestRowProps, useSeatPulse } from './react'

function Probe({ itemId }: { itemId: string }) {
  const tint = useDragTint(itemId)
  const target = useDropTargetSeat(itemId)
  const origin = useDragOrigin(itemId)
  const pulse = useSeatPulse(itemId)
  const drag = useGuestDrag()
  const pick = useGuestPick()
  const row = useGuestRowProps('g1')
  return (
    <p
      data-tint={tint ?? 'null'}
      data-target={target ?? 'null'}
      data-origin={origin ?? 'null'}
      data-pulse={pulse ? pulse.seatIndex : 'null'}
      data-ghost={drag?.text ?? ''}
      data-pick={pick?.prompt ?? ''}
      data-row={row['data-guest-id']}
      style={row.style}
    />
  )
}

function render(setup: (editor: ReturnType<typeof createEditorState>) => void, itemId = 't1') {
  const t = makeItem('round', { x: 0, y: 0 }, 't1', emptyCanvas()) as Table
  const editor = createEditorState({
    layoutId: 'L1',
    store: createDocStore({ ...emptyCanvas(), items: [t] }),
    onCommit: () => undefined,
    settings: () => ({ unit: 'ft', minGapCm: 152.4 }),
    storage: null,
    traits: () => ({ width: 1440, touchOnly: false, phone: false }),
    listWindow: null,
  })
  editor.loadDevice()
  setup(editor)
  return renderToStaticMarkup(
    <EditorStateProvider state={editor}>
      <Probe itemId={itemId} />
    </EditorStateProvider>,
  )
}

describe('seating hooks', () => {
  it('read nothing with no drag, pick or pulse', () => {
    const html = render(() => undefined)
    expect(html).toContain('data-tint="null"')
    expect(html).toContain('data-target="null"')
    expect(html).toContain('data-pulse="null"')
    expect(html).toContain('data-row="g1"')
    expect(html).toContain('touch-action:pan-y')
  })

  it("read a drag's tint, target seat and origin for one table, and the pulse", () => {
    const html = render((e) =>
      e.seating.store.setState({
        drag: {
          id: 1,
          guestId: 'g1',
          text: 'Jane Doe',
          source: 'seat',
          from: { itemId: 't1', seatIndex: 4 },
          pointer: 'mouse',
          target: { kind: 'seat', itemId: 't1', seatIndex: 2, occupant: null },
          targetSeat: { itemId: 't1', seatIndex: 2 },
          tints: new Map([['t1', 'good']]),
        },
        pulse: { itemId: 't1', seatIndex: 3, id: 1 },
        pick: { guestId: 'g1', name: 'Jane D.', prompt: 'Tap a seat for Jane D.' },
      }),
    )
    expect(html).toContain('data-tint="good"')
    expect(html).toContain('data-target="2"')
    expect(html).toContain('data-origin="4"')
    expect(html).toContain('data-pulse="3"')
    expect(html).toContain('data-ghost="Jane Doe"')
    expect(html).toContain('data-pick="Tap a seat for Jane D."')
  })

  it('keep the row style frozen for every row', () => {
    expect(Object.isFrozen(GUEST_ROW_STYLE)).toBe(true)
  })
})
