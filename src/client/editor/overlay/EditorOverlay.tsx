'use client'

/**
 * The screen-space overlay (PLAN section 6, "Two drawing layers"): what must
 * keep its size on screen at every zoom. Selection outlines; for one
 * selected unlocked item in Edit mode, 8 resize handles and a rotate handle;
 * the + and − seat buttons (44 px) beside one selected table; the More
 * button (44 px) beside every selection in Edit mode, which opens the menu
 * that right click and a long press open (PLAN change 14); the selection
 * box; alignment guides; and the gap readout while a table is dragged, in
 * amber under the wedding's minimum gap.
 *
 * The buttons stay inside the viewport less `insets` (the toolbar at the
 * top; the zoom controls at the bottom, and on phones the bottom sheet's
 * strip under them). With a coarse pointer the
 * rotate handle sits further out, so it and the n handle each keep a whole
 * 44 px target.
 *
 * Place it inside the viewport element (the one mount() gets), above the
 * world wrapper. React renders it when the selection, the selected items or
 * a drag's drawing change; the camera moves it in the same frame as the
 * world, by writing positions straight into these elements, so panning and
 * zooming re-render nothing.
 *
 * The DOM adapter finds handles by data-handle and data-item-id, and the
 * rotate handle by data-rotate-handle. The seat buttons and More sit in
 * [data-overlay-control], which the adapter leaves to their own click
 * handlers.
 */
import { useLayoutEffect, useMemo, useState, useSyncExternalStore, type MouseEvent } from 'react'
import type { Item } from '@/domain/canvas-schema'
import type { Point } from '@/domain/geometry'
import type { CameraController } from '../camera/camera-controller'
import { Icon } from '../icons/glyphs'
import { useEditorState, useInteraction, useMode, useSelectedItems } from '../state/react'
import { shallowEqual } from '../state/store'
import type { PointerKind } from '../input/pointer-machine'
import type { SeatRequest } from '../input/controller'
import type { Target } from '../input/hit-test'
import {
  HANDLE_PX,
  NO_INSETS,
  projectOverlay,
  TAP_TARGET_PX,
  type OverlayInput,
  type ProjectOptions,
  type ScreenInsets,
  type ScreenLine,
  type ScreenOverlay,
} from './geometry'

export type UnseatConfirm = { tableId: string; unseated: string[]; confirm(): boolean }

export type EditorOverlayProps = {
  /** − on a table whose every seat is taken: name these guests, then call confirm() to move them to Unassigned. */
  onConfirmUnseat?(request: UnseatConfirm): void
  /** Screen px the buttons keep clear of: the toolbar (top), the zoom controls and on phones the sheet's strip (bottom). */
  insets?: ScreenInsets
}

/** The query Tailwind's pointer-coarse: variant uses, so the hit circles and the positions agree. */
const COARSE_QUERY = '(pointer: coarse)'

function coarseQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  try {
    return window.matchMedia(COARSE_QUERY)
  } catch {
    return null
  }
}

function subscribeCoarse(listener: () => void): () => void {
  const q = coarseQuery()
  q?.addEventListener?.('change', listener)
  return () => q?.removeEventListener?.('change', listener)
}

/** True while the main pointer is coarse (a finger). False on the server. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarse,
    () => coarseQuery()?.matches === true,
    () => false,
  )
}

/**
 * What the More button asks the controller for: the canvas menu that right
 * click opens, for `item`, opening at the button's bottom left corner.
 */
export function moreMenuRequest(
  item: Pick<Item, 'id' | 'kind' | 'locked'>,
  button: { left: number; bottom: number },
  camera: Pick<CameraController, 'clientToScreen'>,
): { at: Point; target: Target } {
  return {
    at: camera.clientToScreen(button.left, button.bottom),
    target: { kind: 'item', itemId: item.id, itemKind: item.kind, locked: item.locked },
  }
}

function pointerKindOf(event: MouseEvent): PointerKind {
  const type = (event.nativeEvent as { pointerType?: string }).pointerType
  return type === 'touch' ? 'touch' : type === 'pen' ? 'pen' : 'mouse'
}

const SELECT_STROKE = '#2563eb'
const GUIDE_STROKE = '#db2777'

function pointsAttr(points: readonly Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}

function lineAttrs(l: ScreenLine) {
  return { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 }
}

function translate(x: number, y: number): string {
  return `translate(${x} ${y})`
}

function cssCenter(p: Point, size: number): string {
  return `translate(${p.x - size / 2}px, ${p.y - size / 2}px)`
}

/** The overlay's elements by key, filled by ref callbacks, so camera frames can move them. */
function createRegistry() {
  const els = new Map<string, Element>()
  const callbacks = new Map<string, (el: Element | null) => void>()
  return {
    els,
    ref(key: string) {
      let cb = callbacks.get(key)
      if (!cb) {
        cb = (el: Element | null) => {
          if (el) els.set(key, el)
          else els.delete(key)
        }
        callbacks.set(key, cb)
      }
      return cb
    },
  }
}

/** Moves the overlay's elements to a new projection without React. */
function writeOverlay(els: ReadonlyMap<string, Element>, s: ScreenOverlay) {
  const set = (key: string, attrs: Record<string, number | string>) => {
    const el = els.get(key)
    if (!el) return
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  }
  const move = (key: string, transform: string) => {
    const el = els.get(key) as HTMLElement | undefined
    if (el) el.style.transform = transform
  }
  for (const o of s.outlines) {
    if (o.kind === 'circle') set(`outline:${o.id}`, { cx: o.cx, cy: o.cy, r: o.r })
    else set(`outline:${o.id}`, { points: pointsAttr(o.points) })
  }
  for (const h of s.handles) set(`handle:${h.handle}`, { transform: translate(h.x, h.y) })
  if (s.rotate) {
    set('rotate', { transform: translate(s.rotate.x, s.rotate.y) })
    set('rotate-stem', lineAttrs(s.rotate.stem))
  }
  if (s.marquee) set('marquee', s.marquee)
  s.guides.forEach((g, i) => set(`guide:${i}`, lineAttrs(g)))
  if (s.gap) {
    set('gap-line', lineAttrs(s.gap))
    move('gap-label', `translate(${s.gap.x}px, ${s.gap.y}px) translate(-50%, -50%)`)
  }
  if (s.seatButtons) {
    move('plus', cssCenter(s.seatButtons.plus, TAP_TARGET_PX))
    move('minus', cssCenter(s.seatButtons.minus, TAP_TARGET_PX))
  }
  if (s.menuButton) move('more', cssCenter(s.menuButton.at, TAP_TARGET_PX))
}

export function EditorOverlay({ onConfirmUnseat, insets = NO_INSETS }: EditorOverlayProps) {
  const editor = useEditorState()
  const selected = useSelectedItems()
  const mode = useMode()
  const { marquee, guides, gap, longPress } = useInteraction(
    (s) => ({ marquee: s.marquee, guides: s.guides, gap: s.gap, longPress: s.longPress }),
    shallowEqual,
  )
  const input = useMemo<OverlayInput>(() => ({ selected, mode, marquee, guides, gap }), [selected, mode, marquee, guides, gap])
  const coarse = useCoarsePointer()
  const options = useMemo<ProjectOptions>(() => ({ insets, coarse }), [insets, coarse])
  const [registry] = useState(createRegistry)
  const { camera } = editor

  // Initial positions from the camera now; the frame listener keeps them in step after that.
  const screen = projectOverlay(input, camera.get(), camera.viewportSize(), options)

  useLayoutEffect(() => {
    const apply = () => writeOverlay(registry.els, projectOverlay(input, camera.get(), camera.viewportSize(), options))
    apply()
    return camera.subscribeFrame(apply)
  }, [camera, input, options, registry])

  const register = registry.ref

  function minus(tableId: string) {
    const r: SeatRequest = editor.actions.removeSeat(tableId)
    if (r.status === 'confirm') onConfirmUnseat?.({ tableId, unseated: r.unseated, confirm: r.confirm })
  }

  /** More: the menu that right click opens, for the selection, below the button's left edge. */
  function openMenu(event: MouseEvent<HTMLButtonElement>, itemId: string) {
    const item = selected.find((i) => i.id === itemId)
    if (!item) return
    const request = moreMenuRequest(item, event.currentTarget.getBoundingClientRect(), camera)
    editor.controller.contextMenu(request.at, request.target, pointerKindOf(event))
  }

  const buttons = screen.seatButtons
  const more = screen.menuButton
  const buttonClass =
    'pointer-events-auto absolute left-0 top-0 flex h-11 w-11 items-center justify-center rounded-full border border-stone-300 bg-white text-xl font-semibold text-stone-800 shadow-md hover:bg-stone-50 disabled:opacity-40'

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-editor-overlay data-testid="editor-overlay">
      <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        {screen.outlines.map((o) =>
          o.kind === 'circle' ? (
            <circle key={o.id} ref={register(`outline:${o.id}`)} cx={o.cx} cy={o.cy} r={o.r} fill="none" stroke={SELECT_STROKE} strokeWidth={2} />
          ) : (
            <polygon key={o.id} ref={register(`outline:${o.id}`)} points={pointsAttr(o.points)} fill="none" stroke={SELECT_STROKE} strokeWidth={2} />
          ),
        )}
        {screen.marquee && (
          <rect
            ref={register('marquee')}
            {...screen.marquee}
            fill="rgba(37, 99, 235, 0.08)"
            stroke={SELECT_STROKE}
            strokeWidth={1}
            strokeDasharray="4 3"
            data-testid="selection-box"
          />
        )}
        {screen.guides.map((g, i) => (
          <line key={i} ref={register(`guide:${i}`)} {...lineAttrs(g)} stroke={GUIDE_STROKE} strokeWidth={1} data-testid="guide" />
        ))}
        {screen.gap && (
          <line ref={register('gap-line')} {...lineAttrs(screen.gap)} stroke={screen.gap.warn ? '#d97706' : '#57534e'} strokeWidth={1.5} strokeDasharray="5 3" />
        )}
        {screen.rotate && (
          <line ref={register('rotate-stem')} {...lineAttrs(screen.rotate.stem)} stroke={SELECT_STROKE} strokeWidth={1} />
        )}
        {screen.rotate && (
          <g
            ref={register('rotate')}
            transform={translate(screen.rotate.x, screen.rotate.y)}
            data-rotate-handle=""
            data-item-id={selected[0]?.id}
            className="pointer-events-auto cursor-grab"
            data-testid="rotate-handle"
          >
            <circle className="[r:12px] pointer-coarse:[r:22px]" r={12} fill="transparent" />
            <circle r={6} fill="#ffffff" stroke={SELECT_STROKE} strokeWidth={1.5} />
          </g>
        )}
        {screen.handles.map((h) => (
          <g
            key={h.handle}
            ref={register(`handle:${h.handle}`)}
            transform={translate(h.x, h.y)}
            data-handle={h.handle}
            data-item-id={screen.handleItemId ?? undefined}
            className="pointer-events-auto"
            style={{ cursor: h.cursor }}
            data-testid={`handle-${h.handle}`}
          >
            <circle className="[r:8px] pointer-coarse:[r:22px]" r={8} fill="transparent" />
            <rect x={-HANDLE_PX / 2} y={-HANDLE_PX / 2} width={HANDLE_PX} height={HANDLE_PX} fill="#ffffff" stroke={SELECT_STROKE} strokeWidth={1.5} />
          </g>
        ))}
        {longPress && <circle cx={longPress.x} cy={longPress.y} r={28} fill="rgba(37, 99, 235, 0.15)" stroke={SELECT_STROKE} strokeWidth={2} />}
      </svg>
      {screen.gap && (
        <div
          ref={register('gap-label')}
          role="status"
          className={`absolute left-0 top-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium shadow ${
            screen.gap.warn ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-500' : 'bg-white text-stone-800 ring-1 ring-stone-300'
          }`}
          style={{ transform: `translate(${screen.gap.x}px, ${screen.gap.y}px) translate(-50%, -50%)` }}
          data-testid="gap-readout"
          data-warn={screen.gap.warn ? 'true' : 'false'}
        >
          {screen.gap.warn ? `${screen.gap.text} · too close` : screen.gap.text}
        </div>
      )}
      {(buttons || more) && (
        <div data-overlay-control="">
          {buttons && (
            <>
              <button
                ref={register('plus')}
                type="button"
                className={buttonClass}
                style={{ transform: cssCenter(buttons.plus, TAP_TARGET_PX) }}
                disabled={!buttons.canAdd}
                aria-label="Add a seat"
                data-testid="seat-plus"
                onClick={() => editor.actions.addSeat(buttons.itemId)}
              >
                +
              </button>
              <button
                ref={register('minus')}
                type="button"
                className={buttonClass}
                style={{ transform: cssCenter(buttons.minus, TAP_TARGET_PX) }}
                disabled={!buttons.canRemove}
                aria-label="Remove a seat"
                data-testid="seat-minus"
                onClick={() => minus(buttons.itemId)}
              >
                −
              </button>
            </>
          )}
          {more && (
            <button
              ref={register('more')}
              type="button"
              className={buttonClass}
              style={{ transform: cssCenter(more.at, TAP_TARGET_PX) }}
              aria-label="More"
              aria-haspopup="menu"
              title="More"
              data-testid="selection-more"
              onClick={(event) => openMenu(event, more.itemId)}
            >
              <Icon name="more" className="h-6 w-6" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
