'use client'

/**
 * The shape panel (spec section 4, "Adding and editing shapes"): the five
 * table presets, the fixtures, plain shapes and, on a blank canvas, walls,
 * rooms, doors and windows (spec section 5). On desktops it sits left of the
 * canvas; on phones it opens as a drawer from a button.
 *
 * Drag a tile onto the canvas to add it where you drop it (pointer events,
 * so a mouse works); hold Alt as you let go to place it off the grid. A tap,
 * a click or Enter adds it at the middle of the view, which is the phone's
 * way.
 *
 * On touch screens the tiles take touch-action: pan-y, so a finger moving
 * up or down scrolls the list (the browser takes it and cancels the press)
 * and one moving sideways drags the tile. A touch drag starts only once the
 * finger has moved more across than down, so a scroll never flashes the
 * drag's ghost or hides the phone drawer.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { FIXTURE_PRESETS, getPreset, SHAPE_PRESETS, TABLE_PRESETS, WALL_PRESETS, type Preset, type PresetId } from '@/domain/presets'
import { Icon, presetGlyph } from '../icons/glyphs'
import type { EditorActions } from '../input/controller'
import { useEditorState } from '../state/react'

/** What each tile adds, for screen readers and tests ("Add round table"). */
export const PRESET_NAMES: Record<PresetId, string> = {
  round: 'Add round table',
  square: 'Add square table',
  rect: 'Add rectangle table',
  head: 'Add long head table',
  sweetheart: 'Add sweetheart table',
  food: 'Add food station',
  bar: 'Add bar',
  dj: 'Add DJ booth',
  danceFloor: 'Add dance floor',
  stage: 'Add stage',
  cake: 'Add cake table',
  gifts: 'Add gift table',
  photoBooth: 'Add photo booth',
  box: 'Add rectangle',
  circle: 'Add circle',
  line: 'Add line',
  text: 'Add text',
  wall: 'Add wall',
  room: 'Add room',
  door: 'Add door',
  window: 'Add window',
}

const DRAG_START_PX = 4

/**
 * True once a press on a tile has become a drag: past 4 px, and for a
 * finger, more across than down (up and down is the list's scroll).
 */
export function tileDragStarts(dx: number, dy: number, pointerType: string): boolean {
  if (Math.hypot(dx, dy) <= DRAG_START_PX) return false
  return pointerType !== 'touch' || Math.abs(dx) > Math.abs(dy)
}

/** Where a tile drag was let go, in client px, and whether Alt was held. */
export type TileDrop = { x: number; y: number; alt: boolean }

/** A tile let go over the canvas: adds its preset there, off the grid when Alt was held. Returns the new id. */
export function dropTile(actions: Pick<EditorActions, 'dropPreset'>, presetId: PresetId, drop: TileDrop, overCanvas: boolean): string | null {
  if (!overCanvas) return null
  return actions.dropPreset(presetId, drop.x, drop.y, { free: drop.alt })
}

/** The tiles' classes: pan-y lets a finger scroll the list up and down, and leaves sideways moves to the drag. */
export const TILE_CLASS =
  'flex min-h-16 touch-pan-y flex-col items-center justify-center gap-1 rounded-lg border border-stone-200 bg-white px-1 py-2 text-xs font-medium text-stone-700 outline-none hover:border-stone-300 hover:bg-stone-50 focus-visible:ring-2 focus-visible:ring-blue-700/50 disabled:cursor-not-allowed disabled:opacity-50 cursor-grab active:cursor-grabbing'

export type ShapePanelProps = {
  /** A blank canvas also offers walls, rooms, doors and windows. */
  blank: boolean
  /** Editing is not possible right now (no author picked, a conflict open). */
  disabled: boolean
  /** The canvas viewport: drops count only over it. */
  dropTarget(): HTMLElement | null
  /** After an add (phones close the drawer). */
  onAdded?(): void
  /** A drag from a tile began or ended (phones hide the drawer while it lasts). */
  onDragChange?(dragging: boolean): void
  /** Tiles per row: 2 in the desktop column, 3 in the phone drawer. */
  columns?: 2 | 3
}

type DragState = {
  presetId: PresetId
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  dragging: boolean
}

/** The outline that follows the pointer: the preset's size at the zoom now, in px. */
type Ghost = { presetId: PresetId; width: number; height: number; round: boolean; x: number; y: number }

function ghostFor(preset: Preset, zoom: number, x: number, y: number): Ghost {
  const clamp = (v: number) => Math.max(20, Math.min(640, v * zoom))
  const round = (preset.group === 'tables' && preset.shape === 'round') || preset.id === 'circle'
  const thin = preset.id === 'line' || preset.id === 'wall'
  return { presetId: preset.id, width: clamp(preset.width), height: thin ? 12 : clamp(preset.height), round, x, y }
}

function overTarget(target: HTMLElement | null, x: number, y: number): boolean {
  if (!target) return false
  const r = target.getBoundingClientRect()
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false
  const hit = document.elementFromPoint(x, y)
  return hit !== null && target.contains(hit)
}

export function ShapePanel({ blank, disabled, dropTarget, onAdded, onDragChange, columns = 2 }: ShapePanelProps) {
  const editor = useEditorState()
  const drag = useRef<DragState | null>(null)
  const suppressClick = useRef(false)
  const ghostRef = useRef<HTMLDivElement>(null)
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const [over, setOver] = useState(false)
  const cleanup = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanup.current?.(), [])

  function add(presetId: PresetId) {
    if (disabled) return
    if (editor.actions.addPreset(presetId) !== null) onAdded?.()
  }

  function moveGhost(x: number, y: number) {
    const el = ghostRef.current
    if (el) el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
  }

  function endDrag(drop: TileDrop | null) {
    const d = drag.current
    drag.current = null
    cleanup.current?.()
    cleanup.current = null
    if (!d?.dragging) return
    // A click may follow this pointerup on the tile; it must not add a second one.
    window.setTimeout(() => {
      suppressClick.current = false
    }, 0)
    setGhost(null)
    setOver(false)
    onDragChange?.(false)
    if (drop && dropTile(editor.actions, d.presetId, drop, overTarget(dropTarget(), drop.x, drop.y)) !== null) onAdded?.()
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, presetId: PresetId) {
    if (disabled || event.button !== 0 || drag.current) return
    drag.current = {
      presetId,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    }

    const onMove = (e: PointerEvent) => {
      const d = drag.current
      if (!d || e.pointerId !== d.pointerId) return
      if (!d.dragging) {
        if (!tileDragStarts(e.clientX - d.startX, e.clientY - d.startY, d.pointerType)) return
        d.dragging = true
        suppressClick.current = true
        setGhost(ghostFor(getPreset(d.presetId), editor.camera.get().zoom, e.clientX, e.clientY))
        onDragChange?.(true)
      }
      moveGhost(e.clientX, e.clientY)
      const isOver = overTarget(dropTarget(), e.clientX, e.clientY)
      setOver((was) => (was === isOver ? was : isOver))
    }
    const onUp = (e: PointerEvent) => {
      if (drag.current && e.pointerId === drag.current.pointerId) endDrag({ x: e.clientX, y: e.clientY, alt: e.altKey })
    }
    const onCancel = (e: PointerEvent) => {
      if (drag.current && e.pointerId === drag.current.pointerId) endDrag(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drag.current?.dragging) {
        e.preventDefault()
        e.stopPropagation()
        endDrag(null)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    cleanup.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
    }
  }

  function onClick(presetId: PresetId) {
    // The click that ends a drag released over the tile itself.
    if (suppressClick.current) return
    add(presetId)
  }

  function tiles(presets: readonly Preset[]) {
    return (
      <div className={`grid gap-2 ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-label={PRESET_NAMES[p.id]}
            title={PRESET_NAMES[p.id]}
            disabled={disabled}
            data-preset={p.id}
            onPointerDown={(e) => onPointerDown(e, p.id)}
            onPointerUp={() => {
              // A press that never became a drag: the click adds it.
              if (drag.current && !drag.current.dragging) {
                drag.current = null
                cleanup.current?.()
                cleanup.current = null
              }
            }}
            onClick={() => onClick(p.id)}
            className={TILE_CLASS}
          >
            <Icon name={presetGlyph(p.id)} className="h-7 w-7 text-stone-700" />
            <span className="leading-tight">{p.label}</span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="select-none space-y-5 p-3" data-testid="shape-panel">
      <PanelGroup title="Tables">{tiles(TABLE_PRESETS)}</PanelGroup>
      <PanelGroup title="Fixtures">{tiles(FIXTURE_PRESETS)}</PanelGroup>
      <PanelGroup title="Shapes">{tiles(SHAPE_PRESETS)}</PanelGroup>
      {blank && <PanelGroup title="Walls and rooms">{tiles(WALL_PRESETS)}</PanelGroup>}
      <p className="text-xs text-stone-500">Drag onto the plan, or tap to add in the middle.</p>
      {ghost && (
        <div
          ref={ghostRef}
          aria-hidden="true"
          className={`pointer-events-none visible fixed left-0 top-0 z-50 flex items-center justify-center border-2 border-dashed ${
            over ? 'border-blue-700 bg-blue-50/70' : 'border-stone-400 bg-white/70'
          } ${ghost.round ? 'rounded-full' : 'rounded-md'}`}
          style={{ width: ghost.width, height: ghost.height, transform: `translate(${ghost.x}px, ${ghost.y}px) translate(-50%, -50%)` }}
        >
          {ghost.height >= 28 && <Icon name={presetGlyph(ghost.presetId)} className="h-6 w-6 text-stone-600" />}
        </div>
      )}
    </div>
  )
}

function PanelGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</h2>
      {children}
    </section>
  )
}
