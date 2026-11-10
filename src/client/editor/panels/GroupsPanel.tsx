'use client'

/**
 * The editor's Groups tab (spec section 7, "Groups" and "Closeness score";
 * PLAN section 7, change 19). One line per group, loosest first:
 * "Aiden HS Friends · 11 of 12 seated · 3 tables (2 possible) · 67% tight ·
 * 9 ft spread", each number with a plain tooltip (and a "What these mean"
 * list for touch screens), and the members not seated yet. Tapping a group
 * shows it on the plan: up to three at once get rings in their color while
 * everything else fades, and the view pans to the newly shown group.
 */
import { useMemo, useState } from 'react'
import { closenessScores, closenessText, type GroupCloseness } from '@/domain/closeness'
import { canAddHighlight, MAX_HIGHLIGHT_GROUPS, toggleHighlight } from '@/domain/group-highlight'
import { fullName } from '@/domain/guest-list'
import type { Canvas } from '@/domain/canvas-schema'
import { useAnalysis, useAnalysisController } from '../problems/analysis'
import { useCanvas, useEditorState } from '../state/react'
import { shallowEqual } from '../state/store'
import { useEditorUi } from './editor-ui'
import { useEditorGuests } from './guests-context'

const itemsOf = (c: Canvas) => c.items

export function GroupsPanel() {
  const editor = useEditorState()
  const analysis = useAnalysisController()
  const { unit, layoutKind = 'reception' } = useEditorUi()
  const { guests, groups } = useEditorGuests()
  const items = useCanvas(itemsOf)
  const chosen = useAnalysis((a) => a.highlight.groupIds, shallowEqual)
  const scores = useMemo(() => closenessScores({ layoutKind, canvas: { items }, guests, groups }), [layoutKind, items, guests, groups])
  const colorOf = useMemo(() => new Map(groups.map((g) => [g.id, g.color])), [groups])
  const nameOf = useMemo(() => new Map(guests.map((g) => [g.id, fullName(g)])), [guests])

  if (groups.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-stone-600" data-testid="groups-empty">
        No groups yet. Make them on the Groups tab of the wedding.
      </p>
    )
  }

  function pick(c: GroupCloseness) {
    if (!analysis) return
    const next = toggleHighlight(chosen, c.groupId)
    analysis.setInputs({ chosen: next })
    if (next.includes(c.groupId) && !chosen.includes(c.groupId) && c.itemIds.length > 0) {
      const ids = new Set(c.itemIds)
      const at = items.filter((i) => ids.has(i.id))
      const xs = at.map((i) => i.x)
      const ys = at.map((i) => i.y)
      editor.camera.centerOn({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 })
    }
  }

  const full = !canAddHighlight(chosen)
  return (
    <section className="px-4 py-4" data-testid="groups-panel">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <p className="text-sm text-stone-600">
          {chosen.length === 0 ? `Tap a group to show it. Up to ${MAX_HIGHLIGHT_GROUPS} at once.` : `Showing ${chosen.length} of ${MAX_HIGHLIGHT_GROUPS}.`}
        </p>
        {chosen.length > 0 && (
          <button
            type="button"
            className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-stone-700 hover:bg-stone-100"
            onClick={() => analysis?.setInputs({ chosen: [] })}
            data-testid="groups-clear"
          >
            Show all
          </button>
        )}
      </div>
      <ul className="mt-2 space-y-2">
        {scores.map((c) => (
          <GroupLine
            key={c.groupId}
            score={c}
            color={colorOf.get(c.groupId) ?? '#78716c'}
            on={chosen.includes(c.groupId)}
            disabled={full && !chosen.includes(c.groupId)}
            unit={unit}
            layoutKind={layoutKind}
            nameOf={nameOf}
            onPick={() => pick(c)}
          />
        ))}
      </ul>
    </section>
  )
}

function GroupLine({
  score,
  color,
  on,
  disabled,
  unit,
  layoutKind,
  nameOf,
  onPick,
}: {
  score: GroupCloseness
  color: string
  on: boolean
  disabled: boolean
  unit: 'ft' | 'm'
  layoutKind: 'reception' | 'ceremony'
  nameOf: ReadonlyMap<string, string>
  onPick(): void
}) {
  const [explain, setExplain] = useState(false)
  const text = closenessText(score, unit, layoutKind)
  const unseated = score.unseatedIds.map((id) => nameOf.get(id) ?? 'Guest')
  return (
    <li
      className={`rounded-lg border p-2 ${on ? 'border-stone-900 bg-stone-50' : 'border-stone-200 bg-white'}`}
      data-testid="group-closeness"
      data-group-id={score.groupId}
      data-on={on ? 'true' : undefined}
    >
      <button
        type="button"
        aria-pressed={on}
        disabled={disabled}
        onClick={onPick}
        title={disabled ? `Up to ${MAX_HIGHLIGHT_GROUPS} groups show at once` : undefined}
        className="flex min-h-11 w-full items-start gap-2 rounded-lg px-1 py-1 text-left text-sm text-stone-800 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2"
          style={on ? { backgroundColor: color, borderColor: color } : { borderColor: color }}
        />
        <span className="min-w-0" data-testid="closeness-line" aria-label={text.line}>
          <span className="font-semibold text-stone-900">{score.name}</span>
          {text.parts.map((p) => (
            <span key={p.key} title={p.tooltip} data-part={p.key}>
              {' · '}
              {p.text}
            </span>
          ))}
        </span>
      </button>
      {unseated.length > 0 && (
        <p className="mt-1 px-1 text-xs text-stone-600" data-testid="group-unseated">
          Not seated: {unseated.join(', ')}
        </p>
      )}
      <button
        type="button"
        aria-expanded={explain}
        onClick={() => setExplain((v) => !v)}
        className="mt-1 min-h-11 rounded-lg px-1 text-xs font-medium text-stone-600 hover:bg-stone-100"
      >
        {explain ? 'Hide what these mean' : 'What these mean'}
      </button>
      {explain && (
        <ul className="mt-1 space-y-1 px-1 text-xs text-stone-700">
          {text.parts.map((p) => (
            <li key={p.key}>
              <span className="font-medium">{p.text}:</span> {p.tooltip}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
