'use client'

/**
 * The template editor's tools (spec section 5, "Venue templates"): a tool for
 * every fixed item type, plus the pointer and the hand. Desktops show them in
 * a column left of the canvas; phones open them in a drawer from the
 * toolbar's Tools button, and a tap on a tool closes it.
 */
import type { ReactElement } from 'react'
import { useEffect, useRef } from 'react'
import { Icon } from '@/client/editor/icons/glyphs'
import type { DrawKind } from '@/domain/template-commands'
import { useTemplateEditor, useTemplateUi } from './react'
import { sameTool, type TemplateTool } from './ui-store'

export type ToolDef = { id: string; tool: TemplateTool; label: string; hint: string }

const draw = (kind: DrawKind): TemplateTool => ({ kind: 'draw', draw: kind })

const POINTS_HINT = 'Click to place points. Double-click or press Enter to finish.'
const RECT_HINT = 'Drag a rectangle, or click the corners.'

export const TOOL_GROUPS: readonly { title: string; tools: readonly ToolDef[] }[] = [
  {
    title: 'Pointer',
    tools: [
      { id: 'select', tool: { kind: 'select' }, label: 'Select', hint: 'Click to select. Drag to move.' },
      { id: 'hand', tool: { kind: 'hand' }, label: 'Pan', hint: 'Drag to move around.' },
    ],
  },
  {
    title: 'Walls and areas',
    tools: [
      { id: 'wall', tool: draw('wall'), label: 'Wall', hint: POINTS_HINT },
      { id: 'room', tool: draw('room'), label: 'Room', hint: RECT_HINT },
      { id: 'zone', tool: draw('zone'), label: 'Zone', hint: `A named area, such as Patio. ${RECT_HINT}` },
      { id: 'patioEdge', tool: draw('patioEdge'), label: 'Patio edge', hint: POINTS_HINT },
    ],
  },
  {
    title: 'Doors and windows',
    tools: [
      { id: 'door', tool: draw('door'), label: 'Door', hint: 'Click on a wall. It snaps onto the wall.' },
      { id: 'window', tool: draw('window'), label: 'Window', hint: 'Click on a wall. It snaps onto the wall.' },
    ],
  },
  {
    title: 'Fixed items',
    tools: [
      { id: 'column', tool: draw('column'), label: 'Column', hint: 'Click, or drag a rectangle.' },
      { id: 'roundColumn', tool: draw('roundColumn'), label: 'Round column', hint: 'Click, or drag a rectangle.' },
      { id: 'stairs', tool: draw('stairs'), label: 'Stairs', hint: 'Click, or drag a rectangle.' },
      { id: 'bar', tool: draw('bar'), label: 'Built-in bar', hint: 'Click, or drag a rectangle.' },
      { id: 'label', tool: draw('label'), label: 'Label', hint: 'Click where the text goes.' },
    ],
  },
]

export function toolDef(tool: TemplateTool): ToolDef | null {
  for (const g of TOOL_GROUPS) for (const t of g.tools) if (sameTool(t.tool, tool)) return t
  return null
}

const GLYPHS: Record<string, () => ReactElement> = {
  select: () => <Icon name="select" className="h-5 w-5" />,
  hand: () => <path d="M8 13V6a1.5 1.5 0 0 1 3 0v5V4.5a1.5 1.5 0 0 1 3 0V11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-3-4a1.5 1.5 0 0 1 2.3-1.9L8 13" />,
  wall: () => <Icon name="wall" className="h-5 w-5" />,
  room: () => <Icon name="room" className="h-5 w-5" />,
  zone: () => <rect x={4} y={5} width={16} height={14} rx={1} strokeDasharray="3 2.5" />,
  patioEdge: () => <path d="M3 17l6-8 6 4 6-7" strokeDasharray="3 2.5" />,
  door: () => <Icon name="door" className="h-5 w-5" />,
  window: () => <Icon name="window" className="h-5 w-5" />,
  column: () => <rect x={7} y={7} width={10} height={10} />,
  roundColumn: () => <circle cx={12} cy={12} r={5.5} />,
  stairs: () => <path d="M5 5h14v14H5zM9 5v14M13 5v14M17 5v14" />,
  bar: () => <rect x={3} y={9} width={18} height={6} rx={2} />,
  label: () => <path d="M6 6h12M12 6v13M9.5 19h5" />,
}

function ToolGlyph({ id }: { id: string }) {
  const g = GLYPHS[id]
  if (!g) return null
  const el = g()
  if (el.type === Icon) return el
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      {el}
    </svg>
  )
}

export function ToolPanel({ disabled, onPicked }: { disabled: boolean; onPicked?: () => void }) {
  const { ui } = useTemplateEditor()
  const tool = useTemplateUi((s) => s.tool)
  return (
    <nav aria-label="Tools" className="space-y-4 p-3" data-testid="tool-panel">
      {TOOL_GROUPS.map((group) => (
        <div key={group.title}>
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{group.title}</h3>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {group.tools.map((t) => {
              const on = sameTool(t.tool, tool)
              const pointer = t.tool.kind === 'select' || t.tool.kind === 'hand'
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  title={t.hint}
                  disabled={disabled && !pointer}
                  onClick={() => {
                    ui.setTool(t.tool)
                    onPicked?.()
                  }}
                  data-testid={`tool-${t.id}`}
                  className={`flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50 disabled:cursor-not-allowed disabled:opacity-40 ${
                    on ? 'bg-blue-900 text-white' : 'text-stone-800 hover:bg-stone-200/70'
                  }`}
                >
                  <ToolGlyph id={t.id} />
                  <span className="min-w-0 leading-tight">{t.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}

/** Phones: the tools in a drawer from the left. */
export function ToolDrawer({ open, onClose, disabled }: { open: boolean; onClose(): void; disabled: boolean }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true })
  }, [open])
  if (!open) return null
  return (
    <div className="absolute inset-0 z-30" data-testid="tool-drawer">
      <div aria-hidden="true" className="absolute inset-0 bg-stone-900/30" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tools"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
        className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col bg-white shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-stone-200 py-1 pl-4 pr-1">
          <h2 className="text-base font-semibold text-stone-900">Tools</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close tools"
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-stone-700 outline-none hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-blue-700/50"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ToolPanel disabled={disabled} onPicked={onClose} />
        </div>
      </div>
    </div>
  )
}
