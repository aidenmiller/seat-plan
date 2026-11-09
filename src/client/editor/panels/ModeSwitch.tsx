'use client'

/**
 * The Edit / View switch in the top bar (spec section 4, "Edit mode and View
 * mode"). Desktops show both choices; phones, short of room, show one Edit
 * switch that is on in Edit mode. Each device remembers its last choice;
 * actions.setMode() saves it.
 */
import { useEditorState, useMode, useUi } from '../state/react'

const OPTIONS = [
  { value: 'edit', label: 'Edit' },
  { value: 'view', label: 'View' },
] as const

export function ModeSwitch({ compact = false }: { compact?: boolean }) {
  const { actions } = useEditorState()
  const mode = useMode()
  const known = useUi((s) => s.deviceKnown)
  const editing = known && mode === 'edit'

  if (compact) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={editing}
        onClick={() => actions.setMode(editing ? 'view' : 'edit')}
        data-testid="mode-switch"
        data-mode={known ? mode : undefined}
        className={`min-h-11 min-w-11 shrink-0 rounded-lg border px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50 ${
          editing ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-300 bg-white text-stone-700'
        }`}
      >
        Edit
      </button>
    )
  }

  return (
    <div
      role="group"
      aria-label="Mode"
      data-testid="mode-switch"
      data-mode={known ? mode : undefined}
      className="inline-flex shrink-0 rounded-lg border border-stone-300 bg-white p-0.5"
    >
      {OPTIONS.map((o) => {
        const on = known && mode === o.value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => actions.setMode(o.value)}
            className={`min-h-11 min-w-11 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50 ${
              on ? 'bg-stone-800 text-white' : 'text-stone-700 hover:bg-stone-100'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
