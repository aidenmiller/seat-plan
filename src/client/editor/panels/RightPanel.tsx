'use client'

/**
 * The right panel's tabs (PLAN section 6, "Right panel"): Properties, Guests,
 * Groups, Problems and Notes. Desktops show it right of the canvas; phones
 * put the same tabs and contents in the bottom sheet. Groups fills in with
 * a later milestone.
 */
import { useId, type KeyboardEvent, type ReactNode } from 'react'
import { useEditorUi } from './editor-ui'
import { GuestsPanel } from './GuestsPanel'
import { NotesPanel } from './NotesPanel'
import { ProblemsPanel } from './ProblemsPanel'
import { PropertiesPanel } from './PropertiesPanel'

export type PanelTab = 'properties' | 'guests' | 'groups' | 'problems' | 'notes'

export const PANEL_TABS: readonly { id: PanelTab; label: string }[] = [
  { id: 'properties', label: 'Properties' },
  { id: 'guests', label: 'Guests' },
  { id: 'groups', label: 'Groups' },
  { id: 'problems', label: 'Problems' },
  { id: 'notes', label: 'Notes' },
]

const EMPTY_TEXT: Record<Exclude<PanelTab, 'properties' | 'guests' | 'problems' | 'notes'>, string> = {
  groups: 'Groups show here once the guest list is in.',
}

/** Ids that tie each tab to its panel. */
export function usePanelIds(): (tab: PanelTab) => { tab: string; panel: string } {
  const base = useId()
  return (tab) => ({ tab: `${base}-tab-${tab}`, panel: `${base}-panel` })
}

export function PanelTabs({
  tab,
  onSelect,
  ids,
}: {
  tab: PanelTab
  /** A tab was pressed (also when it is already the open one: phones raise the sheet). */
  onSelect(tab: PanelTab): void
  ids: (tab: PanelTab) => { tab: string; panel: string }
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const i = PANEL_TABS.findIndex((t) => t.id === tab)
    let next = -1
    if (event.key === 'ArrowRight') next = (i + 1) % PANEL_TABS.length
    else if (event.key === 'ArrowLeft') next = (i - 1 + PANEL_TABS.length) % PANEL_TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = PANEL_TABS.length - 1
    if (next < 0) return
    event.preventDefault()
    const id = PANEL_TABS[next].id
    onSelect(id)
    document.getElementById(ids(id).tab)?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="Panels"
      onKeyDown={onKeyDown}
      className="flex shrink-0 overflow-x-auto border-b border-stone-200 [scrollbar-width:none]"
      data-testid="panel-tabs"
    >
      {PANEL_TABS.map((t) => {
        const on = t.id === tab
        return (
          <button
            key={t.id}
            id={ids(t.id).tab}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={ids(t.id).panel}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(t.id)}
            className={`min-h-11 flex-1 whitespace-nowrap border-b-2 px-2 text-xs font-medium outline-none focus-visible:bg-stone-100 sm:text-sm ${
              on ? 'border-blue-900 text-blue-950' : 'border-transparent text-stone-600 hover:text-stone-900'
            }`}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

export function PanelContent({ tab, ids }: { tab: PanelTab; ids: (tab: PanelTab) => { tab: string; panel: string } }) {
  const { venue } = useEditorUi()
  let body: ReactNode
  if (tab === 'properties') body = <PropertiesPanel />
  else if (tab === 'guests') body = <GuestsPanel />
  else if (tab === 'problems') body = <ProblemsPanel venue={venue} />
  else if (tab === 'notes') body = <NotesPanel />
  else
    body = (
      <p className="px-4 py-6 text-sm text-stone-600" data-testid={`${tab}-empty`}>
        {EMPTY_TEXT[tab]}
      </p>
    )
  return (
    <div role="tabpanel" id={ids(tab).panel} aria-labelledby={ids(tab).tab}>
      {body}
    </div>
  )
}

/** The desktop column: tabs on top, the open tab's contents scrolling under them. */
export function RightPanel({ tab, onTab }: { tab: PanelTab; onTab(tab: PanelTab): void }) {
  const ids = usePanelIds()
  return (
    <aside
      aria-label="Details"
      data-testid="right-panel"
      className="hidden w-72 shrink-0 flex-col border-l border-stone-200 bg-white md:flex lg:w-80"
    >
      <PanelTabs tab={tab} onSelect={onTab} ids={ids} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <PanelContent tab={tab} ids={ids} />
      </div>
    </aside>
  )
}
