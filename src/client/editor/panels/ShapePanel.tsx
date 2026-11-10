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
 *
 * Notes (spec section 9) have their own section: six tools and the color
 * new notes take. A click or tap on a note tool arms it (pressed), so the
 * next click on the plan places that note and a drag draws it (arrows and
 * lines from end to end); a second click puts the tool down. A note tool
 * can also be dragged onto the plan like any tile. Note tools are off while
 * the notes layer is hidden or locked, and say so.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { Point } from '@/domain/geometry'
import { NOTE_SIZES, NOTE_TYPE_NAMES, NOTE_TYPES, type NoteType } from '@/domain/notes'
import { FIXTURE_PRESETS, getPreset, SHAPE_PRESETS, TABLE_PRESETS, WALL_PRESETS, type Preset, type PresetId } from '@/domain/presets'
import { Icon, presetGlyph } from '../icons/glyphs'
import type { EditorActions } from '../input/controller'
import { useEditorState, useUi, useViewState } from '../state/react'
import { ColorSwatches, NoteIcon } from './note-ui'

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

/** What each note tool is called, for screen readers and tests ("Sticky note", "Arrow note"). */
export const NOTE_TOOL_NAMES: Record<NoteType, string> = {
  sticky: 'Sticky note',
  text: 'Text note',
  arrow: 'Arrow note',
  line: 'Line note',
  box: 'Box note',
  circle: 'Circle note',
}

/** The short word under each note tool. */
const NOTE_TOOL_LABELS: Record<NoteType, string> = {
  sticky: 'Sticky',
  text: 'Text',
  arrow: 'Arrow',
  line: 'Line',
  box: 'Box',
  circle: 'Circle',
}

/** Why the note tools are off, or null when notes can be added. */
export function noteToolsBlocked(layer: { visible: boolean; locked: boolean }): string | null {
  if (!layer.visible) return 'Notes are hidden. Show them to add notes.'
  if (layer.locked) return 'Notes are locked. Unlock them to add notes.'
  return null
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

/**
 * A note tool let go over the canvas: adds that note there (a sticky or text
 * note then takes typing), off the grid when Alt was held. `toWorld` turns
 * the pointer's client px into a world point. Returns the new id.
 */
export function dropNote(
  actions: Pick<EditorActions, 'addNote'>,
  type: NoteType,
  drop: TileDrop,
  overCanvas: boolean,
  toWorld: (clientX: number, clientY: number) => Point,
): string | null {
  if (!overCanvas) return null
  return actions.addNote(type, toWorld(drop.x, drop.y), { free: drop.alt })
}

/** A click on a note tool: arms it, or puts it down when it was the one armed. True when the tool is now armed. */
export function toggleNoteTool(actions: Pick<EditorActions, 'setNoteTool'>, armed: NoteType | null, type: NoteType): boolean {
  if (armed === type) {
    actions.setNoteTool(null)
    return false
  }
  return actions.setNoteTool(type)
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
  /** The phone drawer: hints say tap. */
  phone?: boolean
}

/** What a tile adds: a preset, or a note. */
type Tile = { kind: 'preset'; presetId: PresetId } | { kind: 'note'; noteType: NoteType }

type DragState = {
  tile: Tile
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  dragging: boolean
}

/** The outline that follows the pointer: the tile's size at the zoom now, in px. */
type Ghost = { tile: Tile; width: number; height: number; round: boolean; x: number; y: number }

function ghostFor(tile: Tile, zoom: number, x: number, y: number): Ghost {
  const clamp = (v: number) => Math.max(20, Math.min(640, v * zoom))
  if (tile.kind === 'note') {
    const size = NOTE_SIZES[tile.noteType]
    const thin = tile.noteType === 'arrow' || tile.noteType === 'line'
    return { tile, width: clamp(size.width), height: thin ? 12 : clamp(size.height), round: tile.noteType === 'circle', x, y }
  }
  const preset = getPreset(tile.presetId)
  const round = (preset.group === 'tables' && preset.shape === 'round') || preset.id === 'circle'
  const thin = preset.id === 'line' || preset.id === 'wall'
  return { tile, width: clamp(preset.width), height: thin ? 12 : clamp(preset.height), round, x, y }
}

function GhostIcon({ tile }: { tile: Tile }) {
  return tile.kind === 'note' ? (
    <NoteIcon name={tile.noteType} className="h-6 w-6 text-stone-600" />
  ) : (
    <Icon name={presetGlyph(tile.presetId)} className="h-6 w-6 text-stone-600" />
  )
}

function overTarget(target: HTMLElement | null, x: number, y: number): boolean {
  if (!target) return false
  const r = target.getBoundingClientRect()
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false
  const hit = document.elementFromPoint(x, y)
  return hit !== null && target.contains(hit)
}

export function ShapePanel({ blank, disabled, dropTarget, onAdded, onDragChange, columns = 2, phone = false }: ShapePanelProps) {
  const editor = useEditorState()
  const tool = useUi((s) => s.tool)
  const noteColor = useUi((s) => s.noteColor)
  const notesLayer = useViewState((s) => s.layers.notes)
  const armed = tool.kind === 'note' ? tool.noteType : null
  const notesBlocked = noteToolsBlocked(notesLayer)
  const notesOff = disabled || notesBlocked !== null
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
    if (!drop) return
    const overCanvas = overTarget(dropTarget(), drop.x, drop.y)
    const added =
      d.tile.kind === 'preset'
        ? dropTile(editor.actions, d.tile.presetId, drop, overCanvas)
        : dropNote(editor.actions, d.tile.noteType, drop, overCanvas, (x, y) => editor.camera.screenToWorld(editor.camera.clientToScreen(x, y)))
    if (added !== null) onAdded?.()
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, tile: Tile) {
    if (event.button !== 0 || drag.current) return
    if (tile.kind === 'preset' ? disabled : notesOff) return
    drag.current = {
      tile,
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
        setGhost(ghostFor(d.tile, editor.camera.get().zoom, e.clientX, e.clientY))
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

  function onNoteClick(type: NoteType) {
    if (suppressClick.current || notesOff) return
    // Phones close the drawer so the next tap lands on the plan.
    if (toggleNoteTool(editor.actions, armed, type)) onAdded?.()
  }

  /** A press that never became a drag: the click acts. */
  function onTilePointerUp() {
    if (drag.current && !drag.current.dragging) {
      drag.current = null
      cleanup.current?.()
      cleanup.current = null
    }
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
            onPointerDown={(e) => onPointerDown(e, { kind: 'preset', presetId: p.id })}
            onPointerUp={onTilePointerUp}
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
      <PanelGroup title="Notes">
        <div className="space-y-3" data-testid="note-tools">
          <div className={`grid gap-2 ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {NOTE_TYPES.map((type) => {
              const on = armed === type
              return (
                <button
                  key={type}
                  type="button"
                  aria-label={NOTE_TOOL_NAMES[type]}
                  aria-pressed={on}
                  title={on ? `${NOTE_TYPE_NAMES[type]}: click again to put it down` : `${NOTE_TYPE_NAMES[type]}: click, then click or drag on the plan`}
                  disabled={notesOff}
                  data-note-tool={type}
                  onPointerDown={(e) => onPointerDown(e, { kind: 'note', noteType: type })}
                  onPointerUp={onTilePointerUp}
                  onClick={() => onNoteClick(type)}
                  className={`${TILE_CLASS} ${on ? 'border-blue-900 bg-blue-50 text-blue-950 ring-2 ring-blue-900 hover:border-blue-900 hover:bg-blue-50' : ''}`}
                >
                  <NoteIcon name={type} className={`h-7 w-7 ${on ? 'text-blue-900' : 'text-stone-700'}`} />
                  <span className="leading-tight">{NOTE_TOOL_LABELS[type]}</span>
                </button>
              )
            })}
          </div>
          <ColorSwatches label="Color for new notes" value={noteColor} disabled={disabled} testId="note-color" onChange={(c) => editor.ui.setNoteColor(c)} />
          <p className="text-xs text-stone-500">
            {notesBlocked ?? (phone ? 'Tap a tool, then tap or drag on the plan.' : 'Pick a tool, then click or drag on the plan.')}
          </p>
        </div>
      </PanelGroup>
      {ghost && (
        <div
          ref={ghostRef}
          aria-hidden="true"
          className={`pointer-events-none visible fixed left-0 top-0 z-50 flex items-center justify-center border-2 border-dashed ${
            over ? 'border-blue-700 bg-blue-50/70' : 'border-stone-400 bg-white/70'
          } ${ghost.round ? 'rounded-full' : 'rounded-md'}`}
          style={{ width: ghost.width, height: ghost.height, transform: `translate(${ghost.x}px, ${ghost.y}px) translate(-50%, -50%)` }}
        >
          {ghost.height >= 28 && <GhostIcon tile={ghost.tile} />}
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
