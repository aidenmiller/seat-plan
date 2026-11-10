'use client'

/**
 * The bar over the canvas's top left corner: Undo and Redo, on phones the
 * Tools button (the tool drawer), the feet or meters switch (kept on this
 * device), and while a draw tool is on, what it does with Finish, Undo point
 * and Cancel buttons, since phones have no Enter or Esc key.
 */
import { Icon } from '@/client/editor/icons/glyphs'
import { useStoreSelector } from '@/client/editor/state/store'
import { shallowEqual } from '@/client/editor/state/store'
import type { LengthUnit } from '@/domain/units'
import { drawsPoints } from '@/domain/template-commands'
import { useTemplateEditor, useTemplateUi } from './react'
import { toolDef } from './ToolPanel'
import { SELECT } from './ui-store'

const button =
  'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium text-stone-800 outline-none hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-blue-700/50 disabled:cursor-not-allowed disabled:opacity-40'

export function TemplateToolbar({
  phone,
  canEdit,
  unit,
  onUnit,
  onOpenTools,
  hint,
}: {
  phone: boolean
  canEdit: boolean
  unit: LengthUnit
  onUnit(unit: LengthUnit): void
  onOpenTools(): void
  hint: string | null
}) {
  const editor = useTemplateEditor()
  const { mode, tool, drawing, phoneSelect } = useTemplateUi((s) => ({ mode: s.mode, tool: s.tool, drawing: s.drawing, phoneSelect: s.phoneSelect }), shallowEqual)
  const canUndo = useStoreSelector(editor.store, (s) => s.canUndo)
  const canRedo = useStoreSelector(editor.store, (s) => s.canRedo)
  const def = tool.kind === 'select' ? null : toolDef(tool)
  const pointsTool = tool.kind === 'draw' && drawsPoints(tool.draw)
  const edit = mode === 'edit'

  return (
    <div className="pointer-events-none absolute left-2 right-2 top-2 z-10 flex flex-wrap items-start gap-2">
      <div role="toolbar" aria-label="Edit tools" className="pointer-events-auto flex items-center rounded-xl border border-stone-200 bg-white/95 p-0.5 shadow-md backdrop-blur" data-testid="template-toolbar">
        {edit && phone && (
          <>
            <button type="button" className={button} onClick={onOpenTools} disabled={!canEdit} aria-label="Tools" data-testid="open-tools">
              <Icon name="shapes" />
            </button>
            <button
              type="button"
              className={`${button} ${phoneSelect ? 'bg-blue-900 text-white hover:bg-blue-800' : ''}`}
              aria-pressed={phoneSelect}
              aria-label="Select"
              title="One finger draws a selection box"
              onClick={() => editor.ui.setState({ phoneSelect: !phoneSelect })}
            >
              <Icon name="select" />
            </button>
          </>
        )}
        {edit && (
          <>
            <button type="button" className={button} onClick={() => editor.actions.undo()} disabled={!canEdit || !canUndo} aria-label="Undo" title="Undo">
              <Icon name="undo" />
              {!phone && <span aria-hidden="true">Undo</span>}
            </button>
            <button type="button" className={button} onClick={() => editor.actions.redo()} disabled={!canEdit || !canRedo} aria-label="Redo" title="Redo">
              <Icon name="redo" />
              {!phone && <span aria-hidden="true">Redo</span>}
            </button>
          </>
        )}
        <div role="radiogroup" aria-label="Units" className="ml-0.5 flex rounded-lg bg-stone-100 p-0.5" data-testid="unit-switch">
          {(['ft', 'm'] as const).map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={unit === u}
              onClick={() => onUnit(u)}
              className={`h-11 min-w-11 rounded-md px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-blue-700/50 ${unit === u ? 'bg-white text-blue-950 shadow-sm' : 'text-stone-600'}`}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      {edit && def && tool.kind !== 'measure' && (
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-blue-200 bg-blue-50/95 p-1 pl-3 text-sm text-blue-950 shadow-md" data-testid="draw-hint">
          <span className="min-w-0 py-2">
            <strong>{def.label}.</strong> {def.hint}
          </span>
          {pointsTool && drawing && (
            <>
              <button type="button" className={button} onClick={() => editor.actions.undoPoint()}>
                Undo point
              </button>
              <button type="button" className={`${button} bg-blue-900 text-white hover:bg-blue-800`} onClick={() => editor.actions.finishDrawing()} data-testid="finish-drawing">
                Finish
              </button>
            </>
          )}
          <button
            type="button"
            className={button}
            onClick={() => {
              if (drawing) editor.actions.cancelDrawing()
              else editor.ui.setTool(SELECT)
            }}
            data-testid="cancel-drawing"
          >
            Cancel
          </button>
        </div>
      )}

      {hint && (
        <p className="pointer-events-auto rounded-lg bg-white/95 px-3 py-2 text-sm text-stone-700 shadow-md" data-testid="edit-hint">
          {hint}
        </p>
      )}
    </div>
  )
}
