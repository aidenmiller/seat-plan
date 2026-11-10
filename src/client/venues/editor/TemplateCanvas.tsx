'use client'

/**
 * The template editor's canvas: the same viewport, camera, grid and input as
 * the layout editor (CanvasViewport.tsx), drawing the template's fixed items
 * instead of a layout's items. Under them sits the reference image (the
 * original floor plan) when its switch is on, or always while an import
 * draft is open, faded so the draft can be compared with it line by line.
 *
 * Test hooks: data-testid="template-viewport" and "template-canvas"; each
 * item is <g data-fixed-id data-fixed-type>, data-unsure="true" when the
 * import marked it unsure; the reference image is data-testid="reference-image".
 */
import { memo, useEffect, useRef } from 'react'
import { fixedItemBounds } from '@/domain/fixed-items'
import type { LengthUnit } from '@/domain/units'
import type { FixedItem } from '@/domain/venue-schema'
import { worldTransform } from '@/client/editor/camera/camera-controller'
import { isIOS } from '@/client/editor/input/dom-adapter'
import { fixedItemElement } from '@/client/editor/render/VenueLayer'
import { WORLD_FONT } from '@/client/editor/render/style'
import { shallowEqual } from '@/client/editor/state/store'
import { useFixedItem, useTemplateDoc, useTemplateEditor, useTemplateView } from './react'
import type { TemplateEditor } from './state'
import { TemplateOverlay, type ScaleLine } from './TemplateOverlay'

/** The reference image: its URL and size in pixels. */
export type ReferenceImageInfo = { url: string; width: number; height: number }

const UNSURE_STROKE = '#d97706'

function cursorFor(editor: TemplateEditor): string {
  const i = editor.interaction.getState()
  const u = editor.ui.getState()
  if (i.gesture === 'pan' || i.gesture === 'pinch') return 'grabbing'
  if (i.gesture === 'move') return 'move'
  if (i.gesture === 'marquee' || i.gesture === 'rect') return 'crosshair'
  if (i.spacePan || u.tool.kind === 'hand') return 'grab'
  if (u.tool.kind === 'draw' || u.tool.kind === 'measure') return 'crosshair'
  if (u.hover) return 'pointer'
  return 'default'
}

const FixedItemView = memo(function FixedItemView({ id }: { id: string }) {
  const item = useFixedItem(id)
  if (!item) return null
  const halo = item.unsure ? fixedItemBounds(item) : null
  const pad = 15
  return (
    <g data-fixed-id={item.id} data-fixed-type={item.type} data-unsure={item.unsure ? 'true' : undefined}>
      {halo && (
        <rect
          x={halo.minX - pad}
          y={halo.minY - pad}
          width={halo.maxX - halo.minX + pad * 2}
          height={halo.maxY - halo.minY + pad * 2}
          fill="rgba(217, 119, 6, 0.10)"
          stroke={UNSURE_STROKE}
          strokeWidth={2}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
          data-unsure-mark=""
        />
      )}
      {fixedItemElement(item)}
    </g>
  )
})

function itemIds(items: readonly FixedItem[]): string[] {
  return items.map((i) => i.id)
}

const ItemsLayer = memo(function ItemsLayer() {
  const ids = useTemplateDoc((d) => itemIds(d.items), shallowEqual)
  return (
    <g data-layer="fixed">
      {ids.map((id) => (
        <FixedItemView key={id} id={id} />
      ))}
    </g>
  )
})

const ReferenceLayer = memo(function ReferenceLayer({ image, forceShow }: { image: ReferenceImageInfo | null; forceShow: boolean }) {
  const reference = useTemplateDoc((d) => d.reference)
  const shown = useTemplateView((s) => s.showReferenceImage)
  if (!image || !reference || !(forceShow || shown)) return null
  const s = reference.scaleCmPerPx
  return (
    <image
      href={image.url}
      x={reference.offsetX}
      y={reference.offsetY}
      width={image.width * s}
      height={image.height * s}
      opacity={reference.opacity}
      transform={reference.rotation ? `rotate(${reference.rotation} ${reference.offsetX} ${reference.offsetY})` : undefined}
      preserveAspectRatio="none"
      data-testid="reference-image"
    />
  )
})

export type TemplateCanvasProps = {
  image: ReferenceImageInfo | null
  /** An import draft is open: the original always shows under it. */
  draft: boolean
  /** The labelled line the scale step asks about, in world cm. */
  scaleLine?: ScaleLine | null
  /** Feet or meters, for the lengths the overlay shows. */
  unit: LengthUnit
}

export function TemplateCanvas({ image, draft, scaleLine = null, unit }: TemplateCanvasProps) {
  const editor = useTemplateEditor()
  const viewportRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<SVGGElement>(null)

  useEffect(() => {
    const viewport = viewportRef.current
    const wrapper = wrapperRef.current
    const world = worldRef.current
    if (!viewport || !wrapper || !world) return
    return editor.mount({ viewport, wrapper, world })
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
      data-testid="template-viewport"
      className="editor-grid editor-canvas absolute inset-0 overflow-hidden outline-none"
    >
      <div ref={wrapperRef} className="absolute inset-0" style={{ transformOrigin: '0 0' }}>
        <svg
          data-testid="template-canvas"
          role="img"
          aria-label="Venue floor plan"
          xmlns="http://www.w3.org/2000/svg"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
        >
          <g ref={worldRef} transform={worldTransform(editor.camera.drawn())} fontFamily={WORLD_FONT} pointerEvents="none">
            <ReferenceLayer image={image} forceShow={draft} />
            <ItemsLayer />
          </g>
        </svg>
      </div>
      <TemplateOverlay scaleLine={scaleLine} unit={unit} />
    </div>
  )
}
