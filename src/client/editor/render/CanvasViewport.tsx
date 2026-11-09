'use client'

/**
 * The canvas: a viewport that fills its parent, with the world SVG inside an
 * HTML wrapper (moved by the camera during a gesture) and the screen-space
 * overlay above it (PLAN section 6, "Units and camera" and "Two drawing
 * layers"). It mounts the editor's camera and input on these elements.
 *
 * The grid is a CSS background on the viewport (.editor-grid in
 * globals.css), spaced by the --grid-step, --grid-x and --grid-y variables
 * the camera writes on each frame.
 *
 * The canvas turns off the browser's own touch gestures (pinch zoom, pull to
 * refresh, the iPhone long-press callout, text selection), so they reach the
 * editor: the class sets them before the page runs, and the input layer sets
 * them again when it mounts.
 */
import { useEffect, useRef } from 'react'
import type { FixedItem } from '@/domain/venue-schema'
import { isIOS } from '../input/dom-adapter'
import { EditorOverlay, type UnseatConfirm } from '../overlay/EditorOverlay'
import type { ScreenInsets } from '../overlay/geometry'
import { useEditorState } from '../state/react'
import type { EditorState } from '../state'
import { WorldSvg } from './WorldLayers'

export type CanvasViewportProps = {
  venue: readonly FixedItem[]
  /** − on a full table: ask before unseating, then call confirm(). */
  onConfirmUnseat(request: UnseatConfirm): void
  /** Screen px along each edge that other controls cover: the overlay's buttons stay clear of them. */
  insets?: ScreenInsets
}

/** The pointer's look, written straight onto the viewport so hovering re-renders nothing. */
function cursorFor(editor: EditorState): string {
  const i = editor.interaction.getState()
  const u = editor.ui.getState()
  if (i.gesture === 'pan' || i.gesture === 'pinch') return 'grabbing'
  if (i.gesture === 'move') return 'move'
  if (i.gesture === 'marquee') return 'crosshair'
  if (i.spacePan || u.tool.kind === 'hand') return 'grab'
  if (u.tool.kind === 'place') return 'crosshair'
  if (u.hover) return 'pointer'
  return 'default'
}

export function CanvasViewport({ venue, onConfirmUnseat, insets }: CanvasViewportProps) {
  const editor = useEditorState()
  const viewportRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<SVGGElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    const wrapper = wrapperRef.current
    const world = worldRef.current
    if (!viewport || !wrapper || !world) return
    return editor.mount({ viewport, wrapper, world })
  }, [editor])

  // data-detail on the world SVG, from the camera, without React.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const write = () => svg.setAttribute('data-detail', editor.camera.detailLevel())
    write()
    return editor.camera.subscribeDetailLevel(write)
  }, [editor])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let last = ''
    const update = () => {
      const next = cursorFor(editor)
      if (next !== last) viewport.style.cursor = next
      last = next
    }
    update()
    const offUi = editor.ui.subscribe(update)
    const offInteraction = editor.interaction.subscribe(update)
    return () => {
      offUi()
      offInteraction()
    }
  }, [editor])

  // iPhone and iPad Safari: a pinch that starts on the canvas must not zoom the page.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof window === 'undefined' || !('GestureEvent' in window) || !isIOS()) return
    const stop = (event: Event) => event.preventDefault()
    viewport.addEventListener('gesturestart', stop)
    viewport.addEventListener('gesturechange', stop)
    return () => {
      viewport.removeEventListener('gesturestart', stop)
      viewport.removeEventListener('gesturechange', stop)
    }
  }, [])

  return (
    <div
      ref={viewportRef}
      data-editor-viewport=""
      data-testid="editor-viewport"
      className="editor-grid editor-canvas absolute inset-0 overflow-hidden outline-none"
    >
      <div ref={wrapperRef} className="absolute inset-0" style={{ transformOrigin: '0 0' }}>
        <WorldSvg worldRef={worldRef} svgRef={svgRef} venue={venue} />
      </div>
      <EditorOverlay onConfirmUnseat={onConfirmUnseat} insets={insets} />
    </div>
  )
}
