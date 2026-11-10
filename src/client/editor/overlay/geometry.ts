/**
 * Where the overlay draws (PLAN section 6, "Two drawing layers"): selection
 * outlines, the 8 resize handles and the rotate handle, the + and − seat
 * buttons and the More button, the selection box, alignment guides and the
 * gap readout, all in screen px from the viewport's top left. These keep
 * their size at every zoom. Pure: the overlay re-runs it on every camera
 * frame.
 *
 * The buttons beside the selection stand in one column: + and − for a
 * table, then More (PLAN change 14: every selection shows a menu button).
 * The column sits right of the selection, or left when the right has no
 * room, and stays inside the viewport less its insets (the toolbar at the
 * top; the zoom controls, and on phones the bottom sheet's strip, at the
 * bottom). When neither side has
 * room it is pulled inside the viewport even if it then covers the
 * selection. So a table under the phone's sheet, or panned off screen,
 * keeps its buttons in reach at the nearest edge. Whether the buttons show
 * never depends on the camera: camera frames move them without React.
 *
 * Seating (milestone 5): a ring round each selected guest's seat and, in
 * Edit mode, a More button beside them (the guest menu). The + on empty
 * seats is drawn in the world SVG (TableView), not here.
 *
 * Notes (milestone 9): a selected arrow or line shows its outline as the
 * line between its drawn ends and, instead of resize and rotate handles, a
 * handle on each end (data-vertex 0 and 1, 44 px on touch). While an end
 * is dragged or drawn, the table or fixture it would attach to gets an
 * outline round its chairs. While a sticky or text note is typed into, a
 * text box covers it: at least 160 by 72 px and a 16 px font (so phones
 * do not zoom the page), never larger than the viewport. Items on a locked
 * layer show their outline but no handles.
 */
import type { Item, Note } from '@/domain/canvas-schema'
import { anchorOutline, isArrowNote, storedEnds } from '@/domain/arrows'
import { footprintBox, itemCorners, itemSize, localToWorld, obbCorners, unionBoxes, type Box, type Point } from '@/domain/geometry'
import { worldToScreen, type Camera, type Viewport } from '@/domain/camera'
import { NOTE_FONT_CM } from '@/domain/notes'
import { handlePoint, HANDLES, isResizable, ROTATE_HANDLE_OFFSET_PX, type Handle } from '@/domain/resize'
import { maxSeats, SEAT_RADIUS_CM } from '@/domain/seats'
import type { SeatRef } from '@/domain/seating'
import type { Guide } from '@/domain/snapping'
import type { Layers } from '../state/device-view'
import { isLayerLocked } from '../input/hit-test'
import type { EditorMode, GapReadout } from '../state/ui-store'

export const HANDLE_PX = 10
/** Seat buttons and touch handles are at least 44 px (spec section 4, "Phones and desktops"). */
export const TAP_TARGET_PX = 44
/** Between the selection and the button column, with a fine pointer. */
export const SEAT_BUTTON_GAP_PX = 12
/** With a coarse pointer each handle is a 44 px circle; the column keeps clear of it. */
export const COARSE_BUTTON_GAP_PX = TAP_TARGET_PX / 2 + 4
/** Center to center down the button column: 8 px between buttons. */
export const BUTTON_STEP_PX = TAP_TARGET_PX + 8
/**
 * The rotate handle's distance above the top edge with a coarse pointer. Its
 * 44 px circle then clears the n handle's (centered on the edge), so each
 * keeps a whole 44 px target.
 */
export const ROTATE_HANDLE_COARSE_OFFSET_PX = 56

/** The note text box's smallest size and its font size range, in screen px. */
export const NOTE_EDITOR_MIN_WIDTH_PX = 160
export const NOTE_EDITOR_MIN_HEIGHT_PX = 72
export const NOTE_EDITOR_FONT_MIN_PX = 16
export const NOTE_EDITOR_FONT_MAX_PX = 32
/** Kept clear round the text box inside the viewport. */
export const NOTE_EDITOR_MARGIN_PX = 8

/** Screen px along each side of the viewport that other controls cover. */
export type ScreenInsets = { top: number; right: number; bottom: number; left: number }
export const NO_INSETS: ScreenInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })

export type ProjectOptions = {
  /** Kept free of the button column: the toolbar, the zoom controls and the phone's bottom sheet strip. */
  insets?: ScreenInsets
  /** A coarse pointer (touch): 44 px handle circles, so the rotate handle and the column sit further out. */
  coarse?: boolean
}

/** A selected guest's seat: where it is, for its ring. */
export type GuestSeatSpot = SeatRef & { world: Point }

export type OverlayInput = {
  /** Selected items, in selection order, arrows at their drawn ends (useResolvedSelection). */
  selected: readonly Item[]
  mode: EditorMode
  marquee: Box | null
  guides: readonly Guide[]
  gap: GapReadout | null
  /** Selected guests' seats. */
  guestSeats?: readonly GuestSeatSpot[]
  /** The device's layer switches: items on a locked layer get no handles. */
  layers?: Layers
  /** The table or fixture an arrow end being dragged or drawn would attach to. */
  attachTarget?: Item | null
  /** The sticky or text note being typed into. */
  editing?: Note | null
}

/** The ring round a selected guest's seat sits this far outside the seat circle. */
export const GUEST_RING_GAP_PX = 3

export type ScreenOutline = { id: string; kind: 'circle'; cx: number; cy: number; r: number } | { id: string; kind: 'polygon'; points: Point[] }
export type ScreenHandle = { handle: Handle; x: number; y: number; cursor: string }
export type ScreenLine = { x1: number; y1: number; x2: number; y2: number }

export type ScreenOverlay = {
  outlines: ScreenOutline[]
  /** The one selected, unlocked item whose handles show, in Edit mode. */
  handleItemId: string | null
  handles: ScreenHandle[]
  /** The rotate handle and the stem from the top edge to it. */
  rotate: { x: number; y: number; stem: ScreenLine } | null
  /** Beside one selected table in Edit mode: button centers. */
  seatButtons: { itemId: string; plus: Point; minus: Point; canAdd: boolean; canRemove: boolean } | null
  /** Beside every selection in Edit mode: the More button's center. It opens the canvas menu for `itemId` (the first selected). */
  menuButton: { itemId: string; at: Point } | null
  marquee: { x: number; y: number; width: number; height: number } | null
  guides: ScreenLine[]
  gap: (ScreenLine & { x: number; y: number; text: string; warn: boolean }) | null
  /** One selected, unlocked arrow or line in Edit mode: its end handles. */
  arrowEnds: { itemId: string; start: Point; end: Point; startAttached: boolean; endAttached: boolean } | null
  /** The outline (chairs included) of the item an arrow end would attach to. */
  attachOutline: ScreenOutline | null
  /** The text box over the note being typed into: its center, size, turn and font size. */
  noteEditor: { itemId: string; x: number; y: number; width: number; height: number; rotation: number; fontPx: number } | null
  /** Rings round the selected guests' seats. */
  guestRings: (SeatRef & { key: string; cx: number; cy: number; r: number })[]
  /** Beside selected guests in Edit mode: the More button for the guest menu, for `seat` (the first selected). */
  guestMenuButton: { seat: SeatRef; at: Point } | null
}

/** "t1#3": a seat's key for React and the overlay's element registry. */
export function seatSpotKey(s: SeatRef): string {
  return `${s.itemId}#${s.seatIndex}`
}

const HANDLE_ANGLE: Record<Handle, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 }

/** The resize cursor for a handle on an item turned by `rotation` degrees. */
export function handleCursor(handle: Handle, rotation: number): string {
  const a = (((HANDLE_ANGLE[handle] + rotation) % 180) + 180) % 180
  if (a < 22.5 || a >= 157.5) return 'ew-resize'
  if (a < 67.5) return 'nwse-resize'
  if (a < 112.5) return 'ns-resize'
  return 'nesw-resize'
}

function screenBox(camera: Camera, box: Box): Box {
  const a = worldToScreen(camera, { x: box.minX, y: box.minY })
  const b = worldToScreen(camera, { x: box.maxX, y: box.maxY })
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y }
}

function outline(item: Item, camera: Camera): ScreenOutline {
  if (item.kind === 'table' && item.shape === 'round') {
    const c = worldToScreen(camera, item)
    return { id: item.id, kind: 'circle', cx: c.x, cy: c.y, r: (item.width / 2) * camera.zoom }
  }
  if (isArrowNote(item)) {
    // The line itself: a two-point polygon draws as one segment.
    const ends = storedEnds(item)
    return { id: item.id, kind: 'polygon', points: [worldToScreen(camera, ends.start), worldToScreen(camera, ends.end)] }
  }
  return { id: item.id, kind: 'polygon', points: itemCorners(item).map((p) => worldToScreen(camera, p)) }
}

/** The outline an arrow end attaches to, chairs included. */
function attachOutline(item: Item, camera: Camera): ScreenOutline {
  const o = anchorOutline(item)
  if (o.kind === 'circle') {
    const c = worldToScreen(camera, o)
    return { id: item.id, kind: 'circle', cx: c.x, cy: c.y, r: o.r * camera.zoom }
  }
  return { id: item.id, kind: 'polygon', points: obbCorners(o).map((p) => worldToScreen(camera, p)) }
}

/** The text box over a note being typed into: the note's box on screen, kept usable and inside the viewport. */
function noteEditorBox(note: Note, camera: Camera, viewport: Viewport): NonNullable<ScreenOverlay['noteEditor']> {
  const c = worldToScreen(camera, note)
  const room = (size: number) => (size > 0 ? size - 2 * NOTE_EDITOR_MARGIN_PX : Infinity)
  const width = Math.min(Math.max(note.width * camera.zoom, NOTE_EDITOR_MIN_WIDTH_PX), Math.max(NOTE_EDITOR_MIN_WIDTH_PX, room(viewport.width)))
  const height = Math.min(Math.max(note.height * camera.zoom, NOTE_EDITOR_MIN_HEIGHT_PX), Math.max(NOTE_EDITOR_MIN_HEIGHT_PX, room(viewport.height)))
  const fontPx = Math.min(NOTE_EDITOR_FONT_MAX_PX, Math.max(NOTE_EDITOR_FONT_MIN_PX, NOTE_FONT_CM * camera.zoom))
  return { itemId: note.id, x: c.x, y: c.y, width, height, rotation: note.rotation, fontPx }
}

function rotateHandle(item: Item, camera: Camera, offset: number): ScreenOverlay['rotate'] {
  const { height } = itemSize(item)
  const top = worldToScreen(camera, localToWorld(item, { x: 0, y: -height / 2 }))
  const r = (item.rotation * Math.PI) / 180
  const up = { x: Math.sin(r), y: -Math.cos(r) }
  const x = top.x + up.x * offset
  const y = top.y + up.y * offset
  return { x, y, stem: { x1: top.x, y1: top.y, x2: x, y2: y } }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/**
 * Centers for `count` buttons in a column beside a screen box, inside the
 * viewport less its insets. An unmeasured viewport (0 by 0) places the
 * column right of the box, unclamped.
 */
export function placeButtonColumn(box: Box, count: number, viewport: Viewport, insets: ScreenInsets, gap: number): Point[] {
  const half = TAP_TARGET_PX / 2
  const span = (count - 1) * BUTTON_STEP_PX
  let x = box.maxX + gap + half
  let cy = (box.minY + box.maxY) / 2
  if (viewport.width > 0 && viewport.height > 0) {
    const left = insets.left
    const right = viewport.width - insets.right
    const top = insets.top
    const bottom = viewport.height - insets.bottom
    const fits = (cx: number) => cx - half >= left && cx + half <= right
    if (!fits(x)) {
      const leftX = box.minX - gap - half
      // Neither side has room: inside the viewport, over the selection if need be.
      x = fits(leftX) ? leftX : clamp(x, left + half, Math.max(left + half, right - half))
    }
    const reach = span / 2 + half
    cy = bottom - top >= 2 * reach ? clamp(cy, top + reach, bottom - reach) : top + reach
  }
  return Array.from({ length: count }, (_, i) => ({ x, y: cy - span / 2 + i * BUTTON_STEP_PX }))
}

/** + and − for one selected table, then More for any selection: one column beside the selection. */
function selectionButtons(
  selected: readonly Item[],
  camera: Camera,
  viewport: Viewport,
  insets: ScreenInsets,
  gap: number,
): Pick<ScreenOverlay, 'seatButtons' | 'menuButton'> {
  const none = { seatButtons: null, menuButton: null }
  const world = unionBoxes(selected.map((item) => footprintBox(item)))
  if (!world) return none
  const table = selected.length === 1 && selected[0].kind === 'table' ? selected[0] : null
  const centers = placeButtonColumn(screenBox(camera, world), table ? 3 : 1, viewport, insets, gap)
  return {
    seatButtons: table
      ? {
          itemId: table.id,
          plus: centers[0],
          minus: centers[1],
          canAdd: table.seatCount < maxSeats(table.shape),
          canRemove: table.seatCount > 0,
        }
      : null,
    menuButton: { itemId: selected[0].id, at: centers[centers.length - 1] },
  }
}

export function projectOverlay(input: OverlayInput, camera: Camera, viewport: Viewport, options: ProjectOptions = {}): ScreenOverlay {
  const edit = input.mode === 'edit'
  const insets = options.insets ?? NO_INSETS
  const coarse = options.coarse === true
  const single = input.selected.length === 1 ? input.selected[0] : null
  const editable = edit && single !== null && !single.locked && !isLayerLocked(single, input.layers) ? single : null
  const arrow = editable && isArrowNote(editable) ? editable : null
  const boxed = arrow ? null : editable

  const handles: ScreenHandle[] =
    boxed && isResizable(boxed)
      ? HANDLES.map((handle) => {
          const p = worldToScreen(camera, handlePoint(boxed, handle))
          return { handle, x: p.x, y: p.y, cursor: handleCursor(handle, boxed.rotation) }
        })
      : []

  let arrowEnds: ScreenOverlay['arrowEnds'] = null
  if (arrow) {
    const ends = storedEnds(arrow)
    arrowEnds = {
      itemId: arrow.id,
      start: worldToScreen(camera, ends.start),
      end: worldToScreen(camera, ends.end),
      startAttached: arrow.attachedTo.start !== null,
      endAttached: arrow.attachedTo.end !== null,
    }
  }

  const marquee = input.marquee
    ? (() => {
        const b = screenBox(camera, input.marquee)
        return { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY }
      })()
    : null

  const guides = input.guides.map((g): ScreenLine => {
    const a = g.axis === 'x' ? { x: g.at, y: g.from } : { x: g.from, y: g.at }
    const b = g.axis === 'x' ? { x: g.at, y: g.to } : { x: g.to, y: g.at }
    const sa = worldToScreen(camera, a)
    const sb = worldToScreen(camera, b)
    return { x1: sa.x, y1: sa.y, x2: sb.x, y2: sb.y }
  })

  let gap: ScreenOverlay['gap'] = null
  if (input.gap) {
    const a = worldToScreen(camera, input.gap.from)
    const b = worldToScreen(camera, input.gap.to)
    gap = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, text: input.gap.text, warn: input.gap.warn }
  }

  const guestRings = (input.guestSeats ?? []).map((g) => {
    const c = worldToScreen(camera, g.world)
    return { itemId: g.itemId, seatIndex: g.seatIndex, key: seatSpotKey(g), cx: c.x, cy: c.y, r: SEAT_RADIUS_CM * camera.zoom + GUEST_RING_GAP_PX }
  })
  let guestMenuButton: ScreenOverlay['guestMenuButton'] = null
  if (edit && guestRings.length > 0 && input.selected.length === 0) {
    const box = {
      minX: Math.min(...guestRings.map((r) => r.cx - r.r)),
      minY: Math.min(...guestRings.map((r) => r.cy - r.r)),
      maxX: Math.max(...guestRings.map((r) => r.cx + r.r)),
      maxY: Math.max(...guestRings.map((r) => r.cy + r.r)),
    }
    const [at] = placeButtonColumn(box, 1, viewport, insets, coarse ? COARSE_BUTTON_GAP_PX : SEAT_BUTTON_GAP_PX)
    guestMenuButton = { seat: { itemId: guestRings[0].itemId, seatIndex: guestRings[0].seatIndex }, at }
  }
  return {
    guestRings,
    guestMenuButton,
    outlines: input.selected.map((item) => outline(item, camera)),
    handleItemId: boxed && isResizable(boxed) ? boxed.id : null,
    handles,
    rotate: boxed ? rotateHandle(boxed, camera, coarse ? ROTATE_HANDLE_COARSE_OFFSET_PX : ROTATE_HANDLE_OFFSET_PX) : null,
    ...(edit
      ? selectionButtons(input.selected, camera, viewport, insets, coarse ? COARSE_BUTTON_GAP_PX : SEAT_BUTTON_GAP_PX)
      : { seatButtons: null, menuButton: null }),
    marquee,
    guides,
    gap,
    arrowEnds,
    attachOutline: input.attachTarget ? attachOutline(input.attachTarget, camera) : null,
    noteEditor: edit && input.editing ? noteEditorBox(input.editing, camera, viewport) : null,
  }
}
