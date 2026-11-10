'use client'

/**
 * The Problems tab (spec section 7; PLAN change 16): broken rules and tables
 * a venue wall runs through first, then warnings (tight tables, narrow gaps
 * between tables, seated guests who answered no) under their own heading.
 * Only problems make the top bar count. A tap on a line selects the tables
 * involved and pans to them.
 */
import { crossingLine } from '@/domain/template-import'
import type { EditorProblem } from '@/domain/problems'
import { useAnalysis } from '../problems/analysis'
import { useEditorState } from '../state/react'

export function ProblemsPanel() {
  const editor = useEditorState()
  const list = useAnalysis((a) => a.list)

  if (list.problems.length === 0 && list.warnings.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-stone-600" data-testid="problems-empty">
        No seating problems or warnings.
      </p>
    )
  }

  const go = (e: EditorProblem) => {
    editor.ui.select(e.panTo.itemIds)
    editor.camera.centerOn(e.panTo.point)
  }

  return (
    <section className="space-y-4 px-4 py-4" data-testid="problems-panel">
      {list.problems.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            {list.problems.length === 1 ? '1 problem' : `${list.problems.length} problems`}
          </h3>
          <ul className="mt-2 space-y-1">
            {list.problems.map((e) => (
              <li key={e.id}>
                <Line entry={e} onGo={go} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {list.warnings.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            {list.warnings.length === 1 ? '1 warning' : `${list.warnings.length} warnings`}
          </h3>
          <ul className="mt-2 space-y-1">
            {list.warnings.map((e) => (
              <li key={e.id}>
                <Line entry={e} onGo={go} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Line({ entry, onGo }: { entry: EditorProblem; onGo(e: EditorProblem): void }) {
  const problem = entry.severity === 'problem'
  return (
    <button
      type="button"
      className={`flex min-h-11 w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
        problem ? 'border-red-200 bg-red-50 text-red-900 hover:bg-red-100' : 'border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100'
      }`}
      onClick={() => onGo(entry)}
      data-testid={entry.kind === 'wall' ? 'wall-problem' : problem ? 'problem-item' : 'warning-item'}
      data-problem-id={entry.id}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0">
        <circle cx={10} cy={10} r={9} fill={problem ? '#dc2626' : '#eab308'} />
        <path d="M10 5v6M10 14.5v.5" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" />
      </svg>
      {entry.kind === 'wall' ? (
        <span>{crossingLine(entry.title)}</span>
      ) : (
        <span className="min-w-0">
          <span className="block font-medium">{entry.title}</span>
          <span className="block">{entry.message}</span>
        </span>
      )}
    </button>
  )
}
