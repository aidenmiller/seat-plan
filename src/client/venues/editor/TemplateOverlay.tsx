'use client'

/**
 * The template editor's screen-space overlay: what keeps its size at every
 * zoom. Selection outlines; the side picked for the length field, with its
 * length; for one selected item in Edit mode, its points (walls, rooms,
 * zones, patio edges: data-vertex) or its 8 resize handles and rotate handle
 * (columns, stairs, bars; labels turn only); the selection box; the
 * rectangle a draw tool drags out; the wall or outline being drawn, with the
 * next segment's length; the two points of the import's scale step; and the
 * labelled line that step asks about.
 *
 * It re-renders on each camera frame. The template editor holds a venue's
 * few hundred items at most, so this costs little, unlike the layout
 * editor's overlay, which moves its elements without React.
 */
import { formatLength, type LengthUnit } from '@/domain/units'
import { fixedItemBounds, isClosedOutline, polylineSegment } from '@/domain/fixed-items'
import { localToWorld, type Point } from '@/domain/geometry'
import { worldToScreen, type Camera } from '@/domain/camera'
import { HANDLES, ROTATE_HANDLE_OFFSET_PX } from '@/domain/resize'
import { isBoxItem, isPolyItem } from '@/domain/template-commands'
import type { FixedItem } from '@/domain/venue-schema'
import { HANDLE_PX } from '@/client/editor/overlay/geometry'
import { useCoarsePointer } from '@/client/editor/overlay/EditorOverlay'
import { shallowEqual } from '@/client/editor/state/store'
import { useCameraFrame, useTemplateDoc, useTemplateEditor, useTemplateInteraction, useTemplateUi } from './react'

const SELECT_STROKE = '#2563eb'
const DRAW_STROKE = '#1d4ed8'
const MEASURE_STROKE = '#c026d3'
const CURSORS: Record<string, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }

/** The scale step's labelled line, world cm, with the label as printed and its length at the chosen scale. */
export type ScaleLine = { from: Point; to: Point; text: string; measured: string }

function pts(points: readonly Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}

/** The item's outline corners in world cm: turned boxes for boxes and labels, else the bounds. */
function outlineCorners(item: FixedItem): Point[] | null {
  if (isBoxItem(item)) {
    const hw = item.width / 2
    const hh = item.height / 2
    return [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ].map((p) => localToWorld(item, p))
  }
  const b = fixedItemBounds(item)
  if (!b) return null
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ]
}

function handleWorld(item: Extract<FixedItem, { type: 'column' | 'stairs' | 'bar' }>, h: string): Point {
  const hx = h.includes('e') ? 1 : h.includes('w') ? -1 : 0
  const hy = h.includes('s') ? 1 : h.includes('n') ? -1 : 0
  return localToWorld(item, { x: (hx * item.width) / 2, y: (hy * item.height) / 2 })
}

function rotateWorld(item: FixedItem, zoom: number, coarse: boolean): { at: Point; base: Point } | null {
  if (!(isBoxItem(item) || item.type === 'label')) return null
  const half = item.type === 'label' ? item.fontSize / 2 : item.height / 2
  const offset = (coarse ? 56 : ROTATE_HANDLE_OFFSET_PX) / Math.max(zoom, 1e-6)
  return { at: localToWorld(item, { x: 0, y: -half - offset }), base: localToWorld(item, { x: 0, y: -half }) }
}

function Label({ at, text, tone = 'plain', testId }: { at: Point; text: string; tone?: 'plain' | 'draw' | 'measure'; testId?: string }) {
  const color = tone === 'measure' ? 'bg-fuchsia-50 text-fuchsia-900 ring-fuchsia-400' : tone === 'draw' ? 'bg-blue-50 text-blue-950 ring-blue-300' : 'bg-white text-stone-800 ring-stone-300'
  return (
    <div
      className={`absolute left-0 top-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium shadow ring-1 ${color}`}
      style={{ transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -150%)` }}
      data-testid={testId}
    >
      {text}
    </div>
  )
}

export function TemplateOverlay({ scaleLine = null, unit = 'ft' }: { scaleLine?: ScaleLine | null; unit?: LengthUnit }) {
  const editor = useTemplateEditor()
  const camera: Camera = useCameraFrame(editor.camera)
  const coarse = useCoarsePointer()
  const { selection, segment, hover, mode, tool, drawing, cursor, measure } = useTemplateUi(
    (s) => ({ selection: s.selection, segment: s.segment, hover: s.hover, mode: s.mode, tool: s.tool, drawing: s.drawing, cursor: s.cursor, measure: s.measure }),
    shallowEqual,
  )
  const { marquee, rect, longPress, gesture } = useTemplateInteraction((s) => ({ marquee: s.marquee, rect: s.rect, longPress: s.longPress, gesture: s.gesture }), shallowEqual)
  const items = useTemplateDoc((d) => d.items)
  const byId = new Map(items.map((i) => [i.id, i]))
  const selected = selection.map((id) => byId.get(id)).filter((i): i is FixedItem => i !== undefined)
  const hovered = hover && !selection.includes(hover) ? byId.get(hover) : undefined
  const S = (p: Point) => worldToScreen(camera, p)
  const single = selected.length === 1 ? selected[0] : null
  const editing = mode === 'edit' && tool.kind === 'select' && gesture !== 'move'

  const segmentEnds = (() => {
    if (!segment || !single || single.id !== segment.itemId || !isPolyItem(single)) return null
    return polylineSegment(single.points, segment.index, isClosedOutline(single))
  })()

  const drawPoints = drawing ? [...drawing.points, ...(cursor ? [cursor] : [])] : []
  const lastDrawn = drawing && drawing.points.length > 0 ? drawing.points[drawing.points.length - 1] : null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-editor-overlay data-testid="template-overlay">
      <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        {hovered &&
          (() => {
            const c = outlineCorners(hovered)
            return c ? <polygon points={pts(c.map(S))} fill="none" stroke={SELECT_STROKE} strokeOpacity={0.45} strokeWidth={1} /> : null
          })()}
        {selected.map((item) => {
          const c = outlineCorners(item)
          return c ? <polygon key={item.id} points={pts(c.map(S))} fill="none" stroke={SELECT_STROKE} strokeWidth={1.5} strokeDasharray={isPolyItem(item) ? '4 3' : undefined} data-testid="selection-outline" /> : null
        })}
        {single && isPolyItem(single) && (
          <polyline
            points={pts([...single.points, ...(isClosedOutline(single) ? [single.points[0]] : [])].map(S))}
            fill="none"
            stroke={SELECT_STROKE}
            strokeOpacity={0.6}
            strokeWidth={2}
          />
        )}
        {segmentEnds && (
          <line
            x1={S(segmentEnds[0]).x}
            y1={S(segmentEnds[0]).y}
            x2={S(segmentEnds[1]).x}
            y2={S(segmentEnds[1]).y}
            stroke={SELECT_STROKE}
            strokeWidth={5}
            strokeLinecap="round"
            data-testid="selected-side"
          />
        )}
        {marquee && (
          <rect
            x={S({ x: marquee.minX, y: marquee.minY }).x}
            y={S({ x: marquee.minX, y: marquee.minY }).y}
            width={(marquee.maxX - marquee.minX) * camera.zoom}
            height={(marquee.maxY - marquee.minY) * camera.zoom}
            fill="rgba(37, 99, 235, 0.08)"
            stroke={SELECT_STROKE}
            strokeDasharray="4 3"
            data-testid="selection-box"
          />
        )}
        {rect && (
          <rect
            x={S({ x: rect.minX, y: rect.minY }).x}
            y={S({ x: rect.minX, y: rect.minY }).y}
            width={(rect.maxX - rect.minX) * camera.zoom}
            height={(rect.maxY - rect.minY) * camera.zoom}
            fill="rgba(29, 78, 216, 0.06)"
            stroke={DRAW_STROKE}
            strokeWidth={2}
            data-testid="draw-rect"
          />
        )}
        {drawPoints.length > 0 && (
          <polyline points={pts(drawPoints.map(S))} fill="none" stroke={DRAW_STROKE} strokeWidth={2} strokeDasharray="6 4" data-testid="drawing-preview" />
        )}
        {drawing?.points.map((p, i) => (
          <circle key={i} cx={S(p).x} cy={S(p).y} r={i === 0 ? 6 : 4} fill="#ffffff" stroke={DRAW_STROKE} strokeWidth={2} />
        ))}
        {measure.length > 0 && (
          <>
            {measure.length === 2 && <line x1={S(measure[0]).x} y1={S(measure[0]).y} x2={S(measure[1]).x} y2={S(measure[1]).y} stroke={MEASURE_STROKE} strokeWidth={2} />}
            {measure.map((p, i) => (
              <circle key={i} cx={S(p).x} cy={S(p).y} r={6} fill="#ffffff" stroke={MEASURE_STROKE} strokeWidth={2} data-testid="measure-point" />
            ))}
          </>
        )}
        {scaleLine && (
          <line
            x1={S(scaleLine.from).x}
            y1={S(scaleLine.from).y}
            x2={S(scaleLine.to).x}
            y2={S(scaleLine.to).y}
            stroke={MEASURE_STROKE}
            strokeWidth={4}
            strokeLinecap="round"
            data-testid="scale-line"
          />
        )}
        {editing && single && isPolyItem(single) &&
          single.points.map((p, i) => {
            const s = S(p)
            return (
              <g key={i} transform={`translate(${s.x} ${s.y})`} data-vertex={i} data-item-id={single.id} className="pointer-events-auto cursor-move" data-testid="vertex-handle">
                <circle className="[r:9px] pointer-coarse:[r:22px]" r={9} fill="transparent" />
                <circle r={5} fill="#ffffff" stroke={SELECT_STROKE} strokeWidth={1.5} />
              </g>
            )
          })}
        {editing && single && isBoxItem(single) &&
          HANDLES.map((h) => {
            const s = S(handleWorld(single, h))
            return (
              <g key={h} transform={`translate(${s.x} ${s.y})`} data-handle={h} data-item-id={single.id} className="pointer-events-auto" style={{ cursor: CURSORS[h] }} data-testid={`handle-${h}`}>
                <circle className="[r:8px] pointer-coarse:[r:22px]" r={8} fill="transparent" />
                <rect x={-HANDLE_PX / 2} y={-HANDLE_PX / 2} width={HANDLE_PX} height={HANDLE_PX} fill="#ffffff" stroke={SELECT_STROKE} strokeWidth={1.5} />
              </g>
            )
          })}
        {editing &&
          single &&
          (() => {
            const r = rotateWorld(single, camera.zoom, coarse)
            if (!r) return null
            const at = S(r.at)
            const base = S(r.base)
            return (
              <>
                <line x1={base.x} y1={base.y} x2={at.x} y2={at.y} stroke={SELECT_STROKE} strokeWidth={1} />
                <g transform={`translate(${at.x} ${at.y})`} data-rotate-handle="" data-item-id={single.id} className="pointer-events-auto cursor-grab" data-testid="rotate-handle">
                  <circle className="[r:12px] pointer-coarse:[r:22px]" r={12} fill="transparent" />
                  <circle r={6} fill="#ffffff" stroke={SELECT_STROKE} strokeWidth={1.5} />
                </g>
              </>
            )
          })()}
        {longPress && <circle cx={longPress.x} cy={longPress.y} r={28} fill="rgba(37, 99, 235, 0.15)" stroke={SELECT_STROKE} strokeWidth={2} />}
      </svg>
      {segmentEnds && (
        <Label
          at={S({ x: (segmentEnds[0].x + segmentEnds[1].x) / 2, y: (segmentEnds[0].y + segmentEnds[1].y) / 2 })}
          text={formatLength(Math.hypot(segmentEnds[1].x - segmentEnds[0].x, segmentEnds[1].y - segmentEnds[0].y), unit)}
          testId="side-length"
        />
      )}
      {lastDrawn && cursor && (
        <Label at={S({ x: (lastDrawn.x + cursor.x) / 2, y: (lastDrawn.y + cursor.y) / 2 })} text={formatLength(Math.hypot(cursor.x - lastDrawn.x, cursor.y - lastDrawn.y), unit)} tone="draw" />
      )}
      {rect && (
        <Label
          at={S({ x: (rect.minX + rect.maxX) / 2, y: rect.minY })}
          text={`${formatLength(rect.maxX - rect.minX, unit)} × ${formatLength(rect.maxY - rect.minY, unit)}`}
          tone="draw"
        />
      )}
      {measure.length === 2 && (
        <Label at={S({ x: (measure[0].x + measure[1].x) / 2, y: (measure[0].y + measure[1].y) / 2 })} text="Type the real distance" tone="measure" />
      )}
      {scaleLine && (
        <Label at={S({ x: (scaleLine.from.x + scaleLine.to.x) / 2, y: (scaleLine.from.y + scaleLine.to.y) / 2 })} text={`${scaleLine.text} · ${scaleLine.measured}`} tone="measure" testId="scale-line-label" />
      )}
    </div>
  )
}
