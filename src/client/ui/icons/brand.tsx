/**
 * The Something Blueprint brand icon set: 63 line icons from the owner's brand
 * pack (brand-pack/icons/*.svg), copied path for path. Do not redraw or tweak
 * them here; replace the pack and regenerate instead. Every icon sits on a
 * 24 by 24 grid and draws in the current text color. Use at 20 to 24 px in
 * controls, and 16 px only where it stays legible.
 */
import type { ReactElement } from 'react'

export type BrandIconName =
  | 'align'
  | 'arrow'
  | 'bar'
  | 'box'
  | 'cake'
  | 'ceremony-arch'
  | 'chair-row'
  | 'circle'
  | 'column'
  | 'couple'
  | 'dance-floor'
  | 'delete'
  | 'dj'
  | 'door'
  | 'duplicate'
  | 'edit-mode'
  | 'export'
  | 'fit-screen'
  | 'food'
  | 'gifts'
  | 'grid'
  | 'group'
  | 'guest'
  | 'import-floor-plan'
  | 'layers'
  | 'layout'
  | 'line'
  | 'lock'
  | 'measure'
  | 'pan'
  | 'paste-names'
  | 'photo-booth'
  | 'redo'
  | 'rename'
  | 'rotate'
  | 'rule-apart'
  | 'rule-together'
  | 'search'
  | 'seat-add'
  | 'seat-empty'
  | 'seat-filled'
  | 'seat-remove'
  | 'settings'
  | 'share-link'
  | 'stage'
  | 'sticky-note'
  | 'table-head'
  | 'table-rect'
  | 'table-round'
  | 'table-square'
  | 'table-sweetheart'
  | 'text'
  | 'undo'
  | 'unlock'
  | 'upload-csv'
  | 'venue'
  | 'view-mode'
  | 'wall'
  | 'warning'
  | 'wedding'
  | 'window'
  | 'zoom-in'
  | 'zoom-out'

const Align = () => (
  <>
    <path d="M12 3v18" strokeDasharray="2 3" />
    <rect x="3" y="5" width="7" height="5" rx=".7" />
    <rect x="14" y="12" width="7" height="7" rx=".7" />
  </>
)

const Arrow = () => (
  <>
    <path d="M4 19 20 5m-7 0h7v7" />
  </>
)

const Bar = () => (
  <>
    <path d="m3 4 9 10 9-10H3Zm9 10v6m-5 1h10M17 4l2-2" />
    <circle cx="13" cy="8" r="1.2" />
  </>
)

const Box = () => (
  <>
    <rect x="4" y="4" width="16" height="16" rx="1" />
  </>
)

const Cake = () => (
  <>
    <path d="M5 11h14v9H5zM3 20h18M8 11V7.5h8V11M12 2v3m0-3c2 1 2 2 0 3-2-1-2-2 0-3ZM5 14c2 2 4 2 7 0 3 2 5 2 7 0" />
  </>
)

const CeremonyArch = () => (
  <>
    <path d="M4 21V11a8 8 0 0 1 16 0v10M7 21V11a5 5 0 0 1 10 0v10" />
    <path d="M4 12c2 0 3-2 3-4M20 13c-2 0-3-2-3-4" />
  </>
)

const ChairRow = () => (
  <>
    <rect x="2.5" y="6.5" width="5" height="7" rx="2" />
    <rect x="9.5" y="6.5" width="5" height="7" rx="2" />
    <rect x="16.5" y="6.5" width="5" height="7" rx="2" />
    <path d="M5 13.5v4m7-4v4m7-4v4M3 20h18" />
  </>
)

const Circle = () => (
  <>
    <circle cx="12" cy="12" r="8" />
  </>
)

const Column = () => (
  <>
    <ellipse cx="12" cy="5" rx="6" ry="2" />
    <path d="M6 5v14c0 2 12 2 12 0V5M6 19c0-2 12-2 12 0M9 7v10m6-10v10" />
  </>
)

const Couple = () => (
  <>
    <circle cx="7.5" cy="7.5" r="2.5" />
    <circle cx="16.5" cy="7.5" r="2.5" />
    <path d="M2.5 19v-2c0-3 2.1-5 5-5s5 2 5 5v2m-.5-2c0-3 1.8-5 4.5-5 3 0 5 2 5 5v2" />
  </>
)

const DanceFloor = () => (
  <>
    <path d="M3 8h18v12H3zM9 8v12m6-12v12M3 14h18M12 2l1.4 2.4L16 5.8l-2.6 1.1L12 9l-1.3-2.1L8 5.8l2.7-1.4Z" />
  </>
)

const Delete = () => (
  <>
    <path d="M4 7h16M9 7V4h6v3m-9 0 1 14h10l1-14M10 11v6m4-6v6" />
  </>
)

const Dj = () => (
  <>
    <rect x="2.5" y="4" width="19" height="16" rx="2" />
    <circle cx="7.5" cy="11.5" r="3.3" />
    <circle cx="16.5" cy="11.5" r="3.3" />
    <path d="M11.7 6h.5m-1 12h2M7.5 11.5l2-2m7 2 2-2" />
  </>
)

const Door = () => (
  <>
    <path d="M3 21V3h15v18H3ZM18 21h3M18 7v14" />
    <path d="M18 7a12 12 0 0 0-12 12" strokeDasharray="2 2" />
    <circle cx="15" cy="12" r=".75" fill="currentColor" />
  </>
)

const Duplicate = () => (
  <>
    <rect x="8" y="8" width="12" height="12" rx="1.5" />
    <path d="M5 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1" />
  </>
)

const EditMode = () => (
  <>
    <path d="M4 20l4.5-.8L20 7.8 16.2 4 4.8 15.5 4 20Zm9.5-12.5 3.8 3.8M3 21h18" />
  </>
)

const Export = () => (
  <>
    <path d="M4 15v5h16v-5M12 16V3m-4 4 4-4 4 4" />
  </>
)

const FitScreen = () => (
  <>
    <path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6M8 8h8v8H8z" />
  </>
)

const Food = () => (
  <>
    <path d="M4 2.5v7.5a3.5 3.5 0 0 0 7 0V2.5M7.5 2.5V21M15 13.5V9c0-3 1.6-5.3 4.6-6.5v18.5M15 13.5h4.6" />
  </>
)

const Gifts = () => (
  <>
    <rect x="3" y="9" width="18" height="12" rx="1.3" />
    <path d="M2 9h20M12 9v12M7 9C3 9 3 3 7 3c2.5 0 5 6 5 6m0 0s2.5-6 5-6c4 0 4 6 0 6" />
  </>
)

const Grid = () => (
  <>
    <rect x="3" y="3" width="18" height="18" rx="1" />
    <path d="M9 3v18m6-18v18M3 9h18M3 15h18" />
  </>
)

const Group = () => (
  <>
    <circle cx="12" cy="6.5" r="2.7" />
    <circle cx="4.8" cy="10" r="2" />
    <circle cx="19.2" cy="10" r="2" />
    <path d="M6 21v-2c0-3.6 2-5.8 6-5.8s6 2.2 6 5.8v2M2.5 20v-2c0-2 1-3.1 2.7-3.7M21.5 20v-2c0-2-1-3.1-2.7-3.7" />
  </>
)

const Guest = () => (
  <>
    <circle cx="12" cy="7" r="3.2" />
    <path d="M5 21v-2.5c0-4 3.1-6.5 7-6.5s7 2.5 7 6.5V21" />
  </>
)

const ImportFloorPlan = () => (
  <>
    <path d="M3 3h13v8H3zM5 11v8h14v-5" />
    <path d="M18 3v9m-3-3 3 3 3-3" />
    <path d="M8 7h4M8 14v3" />
  </>
)

const Layers = () => (
  <>
    <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />
  </>
)

const Layout = () => (
  <>
    <rect x="2.5" y="3" width="19" height="18" rx="1" />
    <path d="M8 3v18M8 10h13M14 10v11" />
  </>
)

const Line = () => (
  <>
    <path d="M4 20 20 4" />
    <circle cx="4" cy="20" r="1" fill="currentColor" />
    <circle cx="20" cy="4" r="1" fill="currentColor" />
  </>
)

const Lock = () => (
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    <circle cx="12" cy="16" r="1" fill="currentColor" />
  </>
)

const Measure = () => (
  <>
    <rect x="3" y="8" width="18" height="8" rx="1" />
    <path d="M7 8v4m4-4v2.5m4-2.5v4m4-4v2.5" />
  </>
)

const Pan = () => (
  <>
    <path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3" />
  </>
)

const PasteNames = () => (
  <>
    <rect x="5" y="5" width="14" height="17" rx="1.5" />
    <path d="M9 5V3h6v2M9 11h6m-6 4h6m-6 4h4" />
  </>
)

const PhotoBooth = () => (
  <>
    <rect x="3" y="3.5" width="18" height="17" rx="1.5" />
    <path d="M3 7l4 3-4 3m18-6-4 3 4 3" />
    <circle cx="12" cy="11.5" r="3" />
    <path d="M8 20.5v-2.2h8v2.2" />
  </>
)

const Redo = () => (
  <>
    <path d="m15 6 5 5-5 5m5 0H10a6 6 0 0 0 0 12" />
  </>
)

const Rename = () => (
  <>
    <path d="M4 20h16M5 15 16 4l4 4L9 19H5v-4Zm8-7 4 4" />
  </>
)

const Rotate = () => (
  <>
    <path d="M20 9a8.2 8.2 0 1 0 1 5m-1-8v4h-4" />
    <rect x="9" y="9" width="6" height="6" rx=".5" />
  </>
)

const RuleApart = () => (
  <>
    <circle cx="6.5" cy="7" r="2.3" />
    <circle cx="17.5" cy="7" r="2.3" />
    <path d="M2.3 20v-2c0-3 1.5-5.2 4.2-5.2 2.5 0 3.5 1.5 3.5 4.2v3m4 0v-3c0-2.7 1-4.2 3.5-4.2 2.7 0 4.2 2.2 4.2 5.2v2M10 12l4-4" />
  </>
)

const RuleTogether = () => (
  <>
    <circle cx="7" cy="7.5" r="2.4" />
    <circle cx="17" cy="7.5" r="2.4" />
    <path d="M3 20v-2.2C3 15 4.8 13 7 13c2.6 0 3.8 1.3 5 2.5 1.2-1.2 2.5-2.5 5-2.5 2.3 0 4 2 4 4.8V20M10 9.2l4 0" />
  </>
)

const Search = () => (
  <>
    <circle cx="10.5" cy="10.5" r="7" />
    <path d="m16 16 5 5" />
  </>
)

const SeatAdd = () => (
  <>
    <circle cx="8.5" cy="12" r="6" />
    <path d="M18 8v8m-4-4h8" />
  </>
)

const SeatEmpty = () => (
  <>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="4.3" strokeDasharray="1 2.5" opacity=".5" />
  </>
)

const SeatFilled = () => (
  <>
    <circle cx="12" cy="12" r="7.5" fill="currentColor" stroke="currentColor" />
  </>
)

const SeatRemove = () => (
  <>
    <circle cx="8.5" cy="12" r="6" />
    <path d="M14 12h8" />
  </>
)

const Settings = () => (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="m10 2-.6 2.3-2 1-2.3-.8-2 3.5 1.7 1.8v2.4L3 14l2 3.5 2.4-.7 2.1 1L10 20h4l.6-2.2 2.1-1 2.3.7 2-3.5-1.7-1.8V9.8L21 8l-2-3.5-2.3.8-2.1-1L14 2h-4Z" />
  </>
)

const ShareLink = () => (
  <>
    <path d="m9 15 6-6M8 8l2-2a4.2 4.2 0 0 1 6 6l-2 2m2 2-2 2a4.2 4.2 0 0 1-6-6l2-2" />
  </>
)

const Stage = () => (
  <>
    <rect x="3" y="13" width="18" height="5" rx="1" />
    <path d="M5 18v3m14-3v3M7 13V7m10 6V7M6 7h12M9 3.5l3 3 3-3" />
  </>
)

const StickyNote = () => (
  <>
    <path d="M4 3h16v11l-6 6H4zM14 20v-6h6" />
  </>
)

const TableHead = () => (
  <>
    <rect x="4" y="8.5" width="16" height="7" rx="1" />
    <circle cx="6.5" cy="19.5" r="1.5" />
    <circle cx="12" cy="19.5" r="1.5" />
    <circle cx="17.5" cy="19.5" r="1.5" />
    <path d="M7 5.4h10" />
  </>
)

const TableRect = () => (
  <>
    <rect x="4.5" y="8.5" width="15" height="7" rx="1.5" />
    <circle cx="7" cy="4.5" r="1.3" />
    <circle cx="12" cy="4.5" r="1.3" />
    <circle cx="17" cy="4.5" r="1.3" />
    <circle cx="7" cy="19.5" r="1.3" />
    <circle cx="12" cy="19.5" r="1.3" />
    <circle cx="17" cy="19.5" r="1.3" />
  </>
)

const TableRound = () => (
  <>
    <circle cx="12" cy="12" r="5.5" />
    <circle cx="12" cy="3.2" r="1.4" />
    <circle cx="20.8" cy="12" r="1.4" />
    <circle cx="12" cy="20.8" r="1.4" />
    <circle cx="3.2" cy="12" r="1.4" />
  </>
)

const TableSquare = () => (
  <>
    <rect x="7.5" y="7.5" width="9" height="9" rx=".5" />
    <circle cx="12" cy="3.5" r="1.5" />
    <circle cx="20.5" cy="12" r="1.5" />
    <circle cx="12" cy="20.5" r="1.5" />
    <circle cx="3.5" cy="12" r="1.5" />
  </>
)

const TableSweetheart = () => (
  <>
    <circle cx="8" cy="6" r="2" />
    <circle cx="16" cy="6" r="2" />
    <path d="M5 14c0-2.5 3-4 7-4s7 1.5 7 4v2.5c0 3-14 3-14 0Z" />
    <path d="M12 16v3" />
  </>
)

const Text = () => (
  <>
    <path d="M3 5h18M12 5v14m-5 0h10M6 5v3m12-3v3" />
  </>
)

const Undo = () => (
  <>
    <path d="m9 6-5 5 5 5M4 11h10a6 6 0 0 1 0 12" />
  </>
)

const Unlock = () => (
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8-1M16 7v1" />
    <circle cx="12" cy="16" r="1" fill="currentColor" />
  </>
)

const UploadCsv = () => (
  <>
    <path d="M4 15v5h16v-5M12 3v13m-4-4 4 4 4-4" />
    <path d="M4 5h4m8 0h4" />
  </>
)

const Venue = () => (
  <>
    <path d="M3 21V7l9-5 9 5v14H3ZM8 21v-8h8v8M3 10h18" />
    <circle cx="12" cy="8" r="1" />
  </>
)

const ViewMode = () => (
  <>
    <path d="M2 12s3.7-6.5 10-6.5S22 12 22 12s-3.7 6.5-10 6.5S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </>
)

const Wall = () => (
  <>
    <path d="M3 3h18v7H3zM3 10h18v7H3zM3 17h18v4H3M9 3v7m6 0v7m-6 7v-7" />
  </>
)

const Warning = () => (
  <>
    <path d="M10.2 3.8 1.9 18.3a2.2 2.2 0 0 0 1.9 3.3h16.4a2.2 2.2 0 0 0 1.9-3.3L13.8 3.8a2.1 2.1 0 0 0-3.6 0Z" />
    <path d="M12 9v5.5M12 18h.01" />
  </>
)

const Wedding = () => (
  <>
    <path d="M4 21V11a8 8 0 0 1 16 0v10M7 21V11a5 5 0 0 1 10 0v10M2 21h20" />
    <path d="M12 4v3m-2-1.5h4" />
  </>
)

const Window = () => (
  <>
    <rect x="3" y="4" width="18" height="16" rx="1" />
    <path d="M12 4v16M3 12h18m-16 0h14" />
  </>
)

const ZoomIn = () => (
  <>
    <circle cx="10.4" cy="10.4" r="6.9" />
    <path d="M15.5 15.5 21 21M7 10.4h6.8m-3.4-3.4v6.8" />
  </>
)

const ZoomOut = () => (
  <>
    <circle cx="10.4" cy="10.4" r="6.9" />
    <path d="M15.5 15.5 21 21M7 10.4h6.8" />
  </>
)

const SHAPES: Record<BrandIconName, () => ReactElement> = {
  'align': Align,
  'arrow': Arrow,
  'bar': Bar,
  'box': Box,
  'cake': Cake,
  'ceremony-arch': CeremonyArch,
  'chair-row': ChairRow,
  'circle': Circle,
  'column': Column,
  'couple': Couple,
  'dance-floor': DanceFloor,
  'delete': Delete,
  'dj': Dj,
  'door': Door,
  'duplicate': Duplicate,
  'edit-mode': EditMode,
  'export': Export,
  'fit-screen': FitScreen,
  'food': Food,
  'gifts': Gifts,
  'grid': Grid,
  'group': Group,
  'guest': Guest,
  'import-floor-plan': ImportFloorPlan,
  'layers': Layers,
  'layout': Layout,
  'line': Line,
  'lock': Lock,
  'measure': Measure,
  'pan': Pan,
  'paste-names': PasteNames,
  'photo-booth': PhotoBooth,
  'redo': Redo,
  'rename': Rename,
  'rotate': Rotate,
  'rule-apart': RuleApart,
  'rule-together': RuleTogether,
  'search': Search,
  'seat-add': SeatAdd,
  'seat-empty': SeatEmpty,
  'seat-filled': SeatFilled,
  'seat-remove': SeatRemove,
  'settings': Settings,
  'share-link': ShareLink,
  'stage': Stage,
  'sticky-note': StickyNote,
  'table-head': TableHead,
  'table-rect': TableRect,
  'table-round': TableRound,
  'table-square': TableSquare,
  'table-sweetheart': TableSweetheart,
  'text': Text,
  'undo': Undo,
  'unlock': Unlock,
  'upload-csv': UploadCsv,
  'venue': Venue,
  'view-mode': ViewMode,
  'wall': Wall,
  'warning': Warning,
  'wedding': Wedding,
  'window': Window,
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
}

/** A brand icon: line art in the text color, hidden from assistive tech, sized by `className`. */
export function BrandIcon({ name, className = 'h-5 w-5', color }: { name: BrandIconName; className?: string; color?: string }) {
  const Shapes = SHAPES[name]
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Shapes />
    </svg>
  )
}
