import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Item, type Table } from '@/domain/canvas-schema'
import { makeItem } from '@/domain/presets'
import { footprintBox } from '@/domain/geometry'
import {
  BUTTON_STEP_PX,
  COARSE_BUTTON_GAP_PX,
  GUEST_RING_GAP_PX,
  handleCursor,
  placeButtonColumn,
  projectOverlay,
  ROTATE_HANDLE_COARSE_OFFSET_PX,
  SEAT_BUTTON_GAP_PX,
  TAP_TARGET_PX,
  type OverlayInput,
  type ScreenInsets,
} from './geometry'

const rect = (overrides: Partial<Table> = {}) => ({ ...(makeItem('rect', { x: 0, y: 0 }, 'r', emptyCanvas()) as Table), ...overrides })
const roundT = (overrides: Partial<Table> = {}) => ({ ...(makeItem('round', { x: 0, y: 0 }, 'o', emptyCanvas()) as Table), ...overrides })

function input(selected: Item[], overrides: Partial<OverlayInput> = {}): OverlayInput {
  return { selected, mode: 'edit', marquee: null, guides: [], gap: null, ...overrides }
}

const viewport = { width: 1000, height: 800 }
/** A phone: 390 by 700, the toolbar's 66 px at the top and the sheet's strip (88 + 8) at the bottom. */
const phone = { width: 390, height: 700 }
const phoneInsets: ScreenInsets = { top: 66, right: 0, bottom: 96, left: 0 }
const half = TAP_TARGET_PX / 2

/** Every button's box lies inside the viewport less its insets. */
function insideInsets(points: { x: number; y: number }[], size: { width: number; height: number }, insets: ScreenInsets) {
  for (const p of points) {
    expect(p.x - half).toBeGreaterThanOrEqual(insets.left - 1e-9)
    expect(p.x + half).toBeLessThanOrEqual(size.width - insets.right + 1e-9)
    expect(p.y - half).toBeGreaterThanOrEqual(insets.top - 1e-9)
    expect(p.y + half).toBeLessThanOrEqual(size.height - insets.bottom + 1e-9)
  }
}

describe('the overlay', () => {
  it('puts 8 handles on the body at screen size, and the rotate handle 28 px above the top', () => {
    const s = projectOverlay(input([rect()]), { zoom: 0.5, x: 500, y: 400 }, viewport)
    expect(s.handleItemId).toBe('r')
    expect(s.handles).toHaveLength(8)
    const ne = s.handles.find((h) => h.handle === 'ne')!
    expect(ne.x).toBeCloseTo(500 + 121.92 * 0.5, 6)
    expect(ne.y).toBeCloseTo(400 - 38.1 * 0.5, 6)
    expect(s.rotate!.x).toBeCloseTo(500, 6)
    expect(s.rotate!.y).toBeCloseTo(400 - 38.1 * 0.5 - 28, 6)
  })

  it('turns the rotate handle with the item', () => {
    const s = projectOverlay(input([rect({ rotation: 90 })]), { zoom: 1, x: 0, y: 0 }, viewport)
    // The top edge now faces +x: the handle sits to the right.
    expect(s.rotate!.x).toBeCloseTo(38.1 + 28, 6)
    expect(s.rotate!.y).toBeCloseTo(0, 6)
  })

  it('shows outlines but no handles for a multi-selection, a locked item or View mode', () => {
    const camera = { zoom: 1, x: 0, y: 0 }
    const two = projectOverlay(input([rect(), { ...roundT(), x: 400 }]), camera, viewport)
    expect(two.outlines).toHaveLength(2)
    expect(two.handles).toHaveLength(0)
    expect(two.rotate).toBeNull()
    expect(projectOverlay(input([rect({ locked: true })]), camera, viewport).handles).toHaveLength(0)
    const view = projectOverlay(input([rect()], { mode: 'view' }), camera, viewport)
    expect(view.handles).toHaveLength(0)
    expect(view.seatButtons).toBeNull()
    expect(view.outlines).toHaveLength(1)
  })

  it('outlines a round table as a circle that scales with the zoom', () => {
    const s = projectOverlay(input([roundT()]), { zoom: 2, x: 10, y: 20 }, viewport)
    expect(s.outlines[0]).toEqual({ id: 'o', kind: 'circle', cx: 10, cy: 20, r: 152.4 })
  })

  it('puts 44 px + and − buttons beside a selected table, flipping left near the edge', () => {
    const s = projectOverlay(input([roundT()]), { zoom: 1, x: 300, y: 400 }, viewport)
    const b = s.seatButtons!
    // Right of the chairs (76.2 + 53 cm), 12 px gap, centered on the button.
    expect(b.plus.x).toBeCloseTo(300 + 129.2 + 12 + TAP_TARGET_PX / 2, 6)
    expect(b.plus.x).toBe(b.minus.x)
    expect(b.minus.y - b.plus.y).toBeGreaterThanOrEqual(TAP_TARGET_PX)
    expect(b).toMatchObject({ itemId: 'o', canAdd: true, canRemove: true })
    const nearEdge = projectOverlay(input([roundT()]), { zoom: 1, x: 900, y: 400 }, viewport).seatButtons!
    expect(nearEdge.plus.x).toBeLessThan(900)
    expect(projectOverlay(input([makeItem('bar', { x: 0, y: 0 }, 'b', emptyCanvas())]), { zoom: 1, x: 0, y: 0 }, viewport).seatButtons).toBeNull()
  })

  it('stacks +, − and More in one column beside a table, 8 px apart', () => {
    const s = projectOverlay(input([roundT()]), { zoom: 1, x: 300, y: 400 }, viewport)
    const b = s.seatButtons!
    const more = s.menuButton!
    expect(more.itemId).toBe('o')
    expect(more.at.x).toBe(b.plus.x)
    expect(b.minus.y - b.plus.y).toBe(BUTTON_STEP_PX)
    expect(more.at.y - b.minus.y).toBe(BUTTON_STEP_PX)
    expect(BUTTON_STEP_PX - TAP_TARGET_PX).toBe(8)
    // Centered on the table.
    expect(b.minus.y).toBeCloseTo(400, 6)
  })

  it('shows a More button beside every selection in Edit mode, and none in View mode', () => {
    const camera = { zoom: 1, x: 300, y: 400 }
    const bar = makeItem('bar', { x: 0, y: 0 }, 'b', emptyCanvas())
    const one = projectOverlay(input([bar]), camera, viewport)
    expect(one.seatButtons).toBeNull()
    expect(one.menuButton!.itemId).toBe('b')
    const box = footprintBox(bar)
    expect(one.menuButton!.at.x).toBeCloseTo(300 + box.maxX + SEAT_BUTTON_GAP_PX + half, 6)
    expect(one.menuButton!.at.y).toBeCloseTo(400, 6)

    // Several items: beside the box around them all, for the first selected; no seat buttons.
    const two = projectOverlay(input([rect(), { ...roundT(), x: 400 }]), camera, viewport)
    expect(two.seatButtons).toBeNull()
    expect(two.menuButton!.itemId).toBe('r')
    expect(two.menuButton!.at.x).toBeCloseTo(300 + 400 + 129.2 + SEAT_BUTTON_GAP_PX + half, 6)

    // A locked item still gets the menu (it holds Unlock).
    expect(projectOverlay(input([rect({ locked: true })]), camera, viewport).menuButton).not.toBeNull()
    expect(projectOverlay(input([rect()], { mode: 'view' }), camera, viewport).menuButton).toBeNull()
    expect(projectOverlay(input([]), camera, viewport).menuButton).toBeNull()
  })

  it('keeps the buttons inside the phone insets: below the toolbar, above the sheet strip', () => {
    // A table near the bottom, partly behind the sheet.
    const low = projectOverlay(input([roundT()]), { zoom: 0.5, x: 120, y: 560 }, phone, { insets: phoneInsets })
    const lowButtons = [low.seatButtons!.plus, low.seatButtons!.minus, low.menuButton!.at]
    insideInsets(lowButtons, phone, phoneInsets)
    expect(low.menuButton!.at.y + half).toBeCloseTo(phone.height - phoneInsets.bottom, 6)

    // A table near the top, partly under the toolbar.
    const high = projectOverlay(input([roundT()]), { zoom: 0.5, x: 120, y: 40 }, phone, { insets: phoneInsets })
    insideInsets([high.seatButtons!.plus, high.seatButtons!.minus, high.menuButton!.at], phone, phoneInsets)
    expect(high.seatButtons!.plus.y - half).toBeCloseTo(phoneInsets.top, 6)

    // Without insets the column only keeps inside the screen's own top edge.
    const bare = projectOverlay(input([roundT()]), { zoom: 0.5, x: 120, y: 40 }, phone)
    expect(bare.seatButtons!.plus.y - half).toBeCloseTo(0, 6)
  })

  it('pulls the column inside the viewport over the table when neither side has room', () => {
    // A round table 129.2 cm out from its center to the chairs: 517 px wide at 200%, on a 390 px phone.
    const s = projectOverlay(input([roundT()]), { zoom: 2, x: 195, y: 350 }, phone, { insets: phoneInsets })
    const all = [s.seatButtons!.plus, s.seatButtons!.minus, s.menuButton!.at]
    insideInsets(all, phone, phoneInsets)
    expect(s.seatButtons!.plus.x).toBeCloseTo(phone.width - half, 6)
  })

  it('flips to the left before it covers the table', () => {
    const s = projectOverlay(input([roundT()]), { zoom: 1, x: 300, y: 350 }, phone, { insets: phoneInsets })
    expect(s.seatButtons!.plus.x).toBeCloseTo(300 - 129.2 - SEAT_BUTTON_GAP_PX - half, 6)
    insideInsets([s.seatButtons!.plus, s.seatButtons!.minus, s.menuButton!.at], phone, phoneInsets)
  })

  it('keeps the buttons in reach for a table behind the sheet or panned off screen', () => {
    const behindSheet = projectOverlay(input([roundT()]), { zoom: 0.5, x: 195, y: 700 + 40 }, phone, { insets: phoneInsets })
    insideInsets([behindSheet.seatButtons!.plus, behindSheet.seatButtons!.minus, behindSheet.menuButton!.at], phone, phoneInsets)
    const offRight = projectOverlay(input([roundT()]), { zoom: 1, x: 2000, y: 350 }, phone, { insets: phoneInsets })
    insideInsets([offRight.seatButtons!.plus, offRight.seatButtons!.minus, offRight.menuButton!.at], phone, phoneInsets)
    expect(offRight.menuButton!.at.x).toBeCloseTo(phone.width - half, 6)
  })

  it('places a column directly: right, left, clamped, and unclamped before the viewport is measured', () => {
    const box = { minX: 100, minY: 100, maxX: 200, maxY: 200 }
    const none = { top: 0, right: 0, bottom: 0, left: 0 }
    expect(placeButtonColumn(box, 1, { width: 400, height: 400 }, none, 12)).toEqual([{ x: 234, y: 150 }])
    expect(placeButtonColumn(box, 1, { width: 240, height: 400 }, none, 12)).toEqual([{ x: 66, y: 150 }])
    expect(placeButtonColumn({ ...box, minX: 20, maxX: 230 }, 1, { width: 240, height: 400 }, none, 12)).toEqual([{ x: 218, y: 150 }])
    expect(placeButtonColumn(box, 2, { width: 0, height: 0 }, none, 12)).toEqual([
      { x: 234, y: 124 },
      { x: 234, y: 176 },
    ])
    // Too short for the column: pinned under the top inset.
    expect(placeButtonColumn(box, 3, { width: 400, height: 200 }, { ...none, top: 20, bottom: 40 }, 12)[0].y).toBe(20 + half)
  })

  it('moves the rotate handle out to 56 px with a coarse pointer, clear of the n handle', () => {
    const camera = { zoom: 0.5, x: 500, y: 400 }
    const fine = projectOverlay(input([rect()]), camera, viewport)
    const coarse = projectOverlay(input([rect()]), camera, viewport, { coarse: true })
    const top = 400 - 38.1 * 0.5
    expect(fine.rotate!.y).toBeCloseTo(top - 28, 6)
    expect(coarse.rotate!.y).toBeCloseTo(top - ROTATE_HANDLE_COARSE_OFFSET_PX, 6)
    const n = coarse.handles.find((h) => h.handle === 'n')!
    // Two 44 px circles, centers at least 44 px apart: neither covers the other.
    expect(Math.hypot(coarse.rotate!.x - n.x, coarse.rotate!.y - n.y)).toBeGreaterThanOrEqual(TAP_TARGET_PX)
    expect(Math.hypot(fine.rotate!.x - n.x, fine.rotate!.y - n.y)).toBeLessThan(TAP_TARGET_PX)
    // Turned with the item.
    const turned = projectOverlay(input([rect({ rotation: 90 })]), { zoom: 1, x: 0, y: 0 }, viewport, { coarse: true })
    expect(turned.rotate!.x).toBeCloseTo(38.1 + ROTATE_HANDLE_COARSE_OFFSET_PX, 6)
  })

  it('keeps the column clear of the 44 px handle circles with a coarse pointer', () => {
    const bar = makeItem('bar', { x: 0, y: 0 }, 'b', emptyCanvas())
    const s = projectOverlay(input([bar]), { zoom: 0.1, x: 300, y: 400 }, viewport, { coarse: true })
    const e = s.handles.find((h) => h.handle === 'e')!
    // The bar is 18 px wide at 10%: the e handle's 44 px circle reaches 22 px past its edge.
    expect(s.menuButton!.at.x).toBeCloseTo(e.x + COARSE_BUTTON_GAP_PX + half, 6)
    expect(s.menuButton!.at.x - half).toBeGreaterThan(e.x + half)
  })

  it('stops + at the seat cap', () => {
    const full = roundT({ seatCount: 30, seats: Array.from({ length: 30 }, (_, index) => ({ index, guestId: null })) })
    expect(projectOverlay(input([full]), { zoom: 1, x: 0, y: 0 }, viewport).seatButtons!.canAdd).toBe(false)
  })

  it('projects the selection box, guides and gap readout', () => {
    const s = projectOverlay(
      input([], {
        marquee: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
        guides: [{ axis: 'x', at: 10, from: -5, to: 20 }],
        gap: { otherId: 'b', gapCm: 100, from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, text: '3′ 3″', warn: true },
      }),
      { zoom: 2, x: 5, y: 5 },
      viewport,
    )
    expect(s.marquee).toEqual({ x: 5, y: 5, width: 200, height: 100 })
    expect(s.guides).toEqual([{ x1: 25, y1: -5, x2: 25, y2: 45 }])
    expect(s.gap).toMatchObject({ x: 105, y: 5, text: '3′ 3″', warn: true })
  })

  it('turns resize cursors with the item', () => {
    expect(handleCursor('e', 0)).toBe('ew-resize')
    expect(handleCursor('se', 0)).toBe('nwse-resize')
    expect(handleCursor('ne', 0)).toBe('nesw-resize')
    expect(handleCursor('n', 0)).toBe('ns-resize')
    expect(handleCursor('e', 90)).toBe('ns-resize')
    expect(handleCursor('e', 45)).toBe('nwse-resize')
  })
})

describe('seating in the overlay', () => {
  const camera = { zoom: 0.5, x: 500, y: 400 }
  const guestSeats = [
    { itemId: 'o', seatIndex: 0, world: { x: 0, y: -100 } },
    { itemId: 'o', seatIndex: 1, world: { x: 100, y: 0 } },
  ]

  it('rings each selected guest seat at screen size, with a More button beside them in Edit mode', () => {
    const s = projectOverlay(input([], { guestSeats }), camera, viewport)
    expect(s.guestRings).toEqual([
      { itemId: 'o', seatIndex: 0, key: 'o#0', cx: 500, cy: 350, r: 22.5 * 0.5 + GUEST_RING_GAP_PX },
      { itemId: 'o', seatIndex: 1, key: 'o#1', cx: 550, cy: 400, r: 22.5 * 0.5 + GUEST_RING_GAP_PX },
    ])
    expect(s.guestMenuButton?.seat).toEqual({ itemId: 'o', seatIndex: 0 })
    expect(s.guestMenuButton!.at.x).toBeGreaterThan(550 + 11.25)
    expect(s.menuButton).toBeNull()
    const view = projectOverlay(input([], { guestSeats, mode: 'view' }), camera, viewport)
    expect(view.guestRings).toHaveLength(2)
    expect(view.guestMenuButton).toBeNull()
  })
})
