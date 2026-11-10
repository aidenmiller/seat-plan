/**
 * Simple line icons on a 24 by 24 grid, for fixtures on the canvas, the shape
 * panel and the editor's buttons. Each glyph is bare shapes with no colors:
 * the caller's <g> or <svg> sets the stroke, so the same glyph draws in the
 * world SVG (with fixed colors, scaled to cm) and in the page (currentColor).
 */
import type { ReactElement } from 'react'
import type { Fixture } from '@/domain/canvas-schema'
import type { PresetId } from '@/domain/presets'

export type GlyphName =
  | Fixture['type']
  | 'tableRound'
  | 'tableSquare'
  | 'tableRect'
  | 'tableHead'
  | 'tableSweetheart'
  | 'chairRow'
  | 'seatingBlock'
  | 'shapeRect'
  | 'shapeEllipse'
  | 'shapeLine'
  | 'shapeText'
  | 'wall'
  | 'room'
  | 'door'
  | 'window'
  | 'undo'
  | 'redo'
  | 'plus'
  | 'minus'
  | 'fit'
  | 'shapes'
  | 'select'
  | 'close'
  | 'lock'
  | 'more'

/** A seat dot on the table glyphs: filled, so they read as seats. */
function Dot({ cx, cy }: { cx: number; cy: number }) {
  return <circle cx={cx} cy={cy} r={1.3} fill="currentColor" stroke="none" />
}

function roundSeats(n: number, r: number): ReactElement[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n
    return <Dot key={i} cx={12 + r * Math.sin(a)} cy={12 - r * Math.cos(a)} />
  })
}

const GLYPHS: Record<GlyphName, () => ReactElement> = {
  // Fixtures
  food: () => (
    <>
      <path d="M5 16a7 7 0 0 1 14 0" />
      <path d="M3 16h18" />
      <path d="M4 19h16" />
      <path d="M12 7.5v1.5" />
    </>
  ),
  bar: () => (
    <>
      <path d="M5 5h14l-7 8z" />
      <path d="M12 13v6" />
      <path d="M8 19h8" />
      <path d="M14.5 3l-1.5 5" />
    </>
  ),
  dj: () => (
    <>
      <rect x={3} y={6} width={18} height={12} rx={2} />
      <circle cx={10} cy={12} r={3.5} />
      <circle cx={10} cy={12} r={0.8} />
      <path d="M17 8.5v5l-2.2 2" />
    </>
  ),
  danceFloor: () => (
    <>
      <rect x={4} y={4} width={16} height={16} rx={1} />
      <path d="M12 4v16M4 12h16" />
      <path d="M4 4l8 8M12 12l8 8" />
    </>
  ),
  stage: () => (
    <>
      <path d="M3 15h18v4H3z" />
      <circle cx={12} cy={7} r={2} />
      <path d="M12 9v4M9 13h6" />
    </>
  ),
  cake: () => (
    <>
      <rect x={5} y={13} width={14} height={6} rx={1} />
      <rect x={8} y={9} width={8} height={4} rx={1} />
      <path d="M12 6v3" />
      <path d="M3 19h18" />
    </>
  ),
  gifts: () => (
    <>
      <rect x={4} y={10} width={16} height={10} rx={1} />
      <path d="M3 7h18v3H3z" />
      <path d="M12 7v13" />
      <path d="M12 7c-1.5-3-5-3.5-5-1.5S10 7 12 7c2 0 5 .5 5-1.5S13.5 4 12 7z" />
    </>
  ),
  photoBooth: () => (
    <>
      <rect x={3} y={7} width={18} height={12} rx={2} />
      <circle cx={12} cy={13} r={3.5} />
      <path d="M8.5 7l1.5-2.5h4L15.5 7" />
    </>
  ),
  ceremonyStructure: () => (
    <>
      <path d="M5 20V11a7 7 0 0 1 14 0v9" />
      <path d="M8 20v-9a4 4 0 0 1 8 0v9" />
    </>
  ),
  officiant: () => (
    <>
      <circle cx={12} cy={7} r={3} />
      <path d="M6 20c0-4 2.7-7 6-7s6 3 6 7" />
    </>
  ),
  aisleRunner: () => (
    <>
      <path d="M9 3h6v18H9z" />
      <path d="M5 6v2M5 11v2M5 16v2M19 6v2M19 11v2M19 16v2" />
    </>
  ),
  musicians: () => (
    <>
      <path d="M9 18V6l10-2v12" />
      <circle cx={7} cy={18} r={2} />
      <circle cx={17} cy={16} r={2} />
    </>
  ),
  soundDesk: () => (
    <>
      <rect x={3} y={5} width={18} height={14} rx={2} />
      <path d="M8 8v8M12 8v8M16 8v8" />
      <path d="M6.5 11h3M10.5 14h3M14.5 10h3" />
    </>
  ),
  welcomeSign: () => (
    <>
      <rect x={4} y={4} width={16} height={10} rx={1} />
      <path d="M8 14l-2 7M16 14l2 7M12 14v7" />
    </>
  ),
  entrance: () => (
    <>
      <path d="M14 4h5v16h-5" />
      <path d="M4 12h10M10 8l4 4-4 4" />
    </>
  ),
  custom: () => (
    <>
      <rect x={5} y={5} width={14} height={14} rx={2} />
      <path d="M12 9v6M9 12h6" />
    </>
  ),

  // Table presets
  tableRound: () => (
    <>
      <circle cx={12} cy={12} r={5} />
      {roundSeats(8, 8.6)}
    </>
  ),
  tableSquare: () => (
    <>
      <rect x={7} y={7} width={10} height={10} rx={0.5} />
      <Dot cx={10} cy={4} />
      <Dot cx={14} cy={4} />
      <Dot cx={20} cy={10} />
      <Dot cx={20} cy={14} />
      <Dot cx={10} cy={20} />
      <Dot cx={14} cy={20} />
      <Dot cx={4} cy={10} />
      <Dot cx={4} cy={14} />
    </>
  ),
  tableRect: () => (
    <>
      <rect x={3} y={9} width={18} height={6} rx={0.5} />
      <Dot cx={5.5} cy={6} />
      <Dot cx={10} cy={6} />
      <Dot cx={14} cy={6} />
      <Dot cx={18.5} cy={6} />
      <Dot cx={5.5} cy={18} />
      <Dot cx={10} cy={18} />
      <Dot cx={14} cy={18} />
      <Dot cx={18.5} cy={18} />
    </>
  ),
  tableHead: () => (
    <>
      <rect x={2} y={11} width={20} height={4} rx={0.5} />
      <Dot cx={4} cy={8} />
      <Dot cx={8} cy={8} />
      <Dot cx={12} cy={8} />
      <Dot cx={16} cy={8} />
      <Dot cx={20} cy={8} />
    </>
  ),
  chairRow: () => (
    <>
      <circle cx={4} cy={12} r={2} />
      <circle cx={9.3} cy={12} r={2} />
      <circle cx={14.7} cy={12} r={2} />
      <circle cx={20} cy={12} r={2} />
    </>
  ),
  seatingBlock: () => (
    <>
      <circle cx={3.5} cy={7} r={1.5} />
      <circle cx={7.5} cy={7} r={1.5} />
      <circle cx={16.5} cy={7} r={1.5} />
      <circle cx={20.5} cy={7} r={1.5} />
      <circle cx={3.5} cy={12} r={1.5} />
      <circle cx={7.5} cy={12} r={1.5} />
      <circle cx={16.5} cy={12} r={1.5} />
      <circle cx={20.5} cy={12} r={1.5} />
      <circle cx={3.5} cy={17} r={1.5} />
      <circle cx={7.5} cy={17} r={1.5} />
      <circle cx={16.5} cy={17} r={1.5} />
      <circle cx={20.5} cy={17} r={1.5} />
      <path d="M12 4v16" strokeDasharray="2 2" />
    </>
  ),
  tableSweetheart: () => (
    <>
      <circle cx={12} cy={14} r={4.5} />
      <Dot cx={9.5} cy={6.5} />
      <Dot cx={14.5} cy={6.5} />
    </>
  ),

  // Plain shapes
  shapeRect: () => <rect x={4} y={6} width={16} height={12} rx={1} />,
  shapeEllipse: () => <ellipse cx={12} cy={12} rx={8} ry={6.5} />,
  shapeLine: () => <path d="M5 19L19 5" />,
  shapeText: () => <path d="M6 6h12M12 6v13M9.5 19h5" />,

  // Walls and rooms
  wall: () => <path d="M3 12h18" strokeWidth={4} strokeLinecap="square" />,
  room: () => (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="M4 12h5" />
    </>
  ),
  door: () => (
    <>
      <path d="M3 20h4M17 20h4" />
      <path d="M7 20V7" strokeWidth={2.2} />
      <path d="M7 7a13 13 0 0 1 10 13" strokeDasharray="2 2" />
    </>
  ),
  window: () => (
    <>
      <rect x={3} y={9.5} width={18} height={5} />
      <path d="M3 12h18" />
    </>
  ),

  // Buttons
  undo: () => <path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  redo: () => <path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />,
  plus: () => <path d="M12 5v14M5 12h14" />,
  minus: () => <path d="M5 12h14" />,
  fit: () => <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  shapes: () => (
    <>
      <rect x={3} y={3} width={8} height={8} rx={1} />
      <circle cx={17} cy={7} r={4} />
      <path d="M7 14l4 7H3z" />
      <rect x={13} y={14} width={8} height={7} rx={1} />
    </>
  ),
  select: () => (
    <>
      <rect x={3} y={3} width={14} height={14} rx={1} strokeDasharray="2.5 2.5" />
      <path d="M13 13l8 3-3.5 1.5L16 21z" />
    </>
  ),
  close: () => <path d="M6 6l12 12M18 6L6 18" />,
  lock: () => (
    <>
      <rect x={5} y={11} width={14} height={9} rx={1.5} />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  more: () => (
    <>
      <circle cx={5} cy={12} r={1.3} fill="currentColor" stroke="none" />
      <circle cx={12} cy={12} r={1.3} fill="currentColor" stroke="none" />
      <circle cx={19} cy={12} r={1.3} fill="currentColor" stroke="none" />
    </>
  ),
}

/** The bare shapes of a glyph, on its 24 by 24 grid. */
export function Glyph({ name }: { name: GlyphName }) {
  return GLYPHS[name]()
}

/** The glyph for a shape panel preset. */
export function presetGlyph(id: PresetId): GlyphName {
  switch (id) {
    case 'round':
      return 'tableRound'
    case 'square':
      return 'tableSquare'
    case 'rect':
      return 'tableRect'
    case 'head':
      return 'tableHead'
    case 'sweetheart':
      return 'tableSweetheart'
    case 'box':
      return 'shapeRect'
    case 'circle':
      return 'shapeEllipse'
    case 'line':
      return 'shapeLine'
    case 'text':
      return 'shapeText'
    default:
      return id
  }
}

/** A glyph as a page icon: line art in the text color, sized by `className`. */
export function Icon({ name, className = 'h-5 w-5' }: { name: GlyphName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Glyph name={name} />
    </svg>
  )
}
