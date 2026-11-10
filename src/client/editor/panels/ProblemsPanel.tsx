'use client'

/**
 * The Problems tab. For now it lists the tables a venue wall runs through
 * ("Table 4 crosses a wall"; spec section 5, PLAN change 16); seating rule
 * problems and warnings join it with the rules milestone. A tap on a line
 * selects that table and shows it.
 */
import type { Canvas, Table } from '@/domain/canvas-schema'
import { itemLabel } from '@/domain/item-labels'
import { crossingLine } from '@/domain/template-import'
import type { FixedItem } from '@/domain/venue-schema'
import { useCallback } from 'react'
import { useCanvas, useEditorState } from '../state/react'
import { shallowEqual } from '../state/store'
import { crossedTables } from '../render/wall-crossings'

const NO_VENUE: readonly FixedItem[] = Object.freeze([])

export function ProblemsPanel({ venue = NO_VENUE }: { venue?: readonly FixedItem[] }) {
  const editor = useEditorState()
  const tables = useCanvas(
    useCallback(
      (canvas: Canvas) => {
        const crossed = crossedTables(canvas.items, venue)
        return canvas.items.filter((i): i is Table => i.kind === 'table' && crossed.has(i.id))
      },
      [venue],
    ),
    shallowEqual,
  )

  if (tables.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-stone-600" data-testid="problems-empty">
        Seating problems and warnings show here.
      </p>
    )
  }

  return (
    <section className="px-4 py-4" data-testid="problems-panel">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{tables.length === 1 ? '1 problem' : `${tables.length} problems`}</h3>
      <ul className="mt-3 space-y-1">
        {tables.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 text-left text-sm text-red-900 hover:bg-red-100"
              onClick={() => {
                editor.ui.select([t.id])
                editor.camera.centerOn({ x: t.x, y: t.y })
              }}
              data-testid="wall-problem"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0">
                <circle cx={10} cy={10} r={9} fill="#dc2626" />
                <path d="M10 5v6M10 14.5v.5" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" />
              </svg>
              {crossingLine(itemLabel(t))}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-stone-500">Move the table off the wall, or change the venue in its template.</p>
    </section>
  )
}
