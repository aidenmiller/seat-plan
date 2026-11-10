'use client'

/**
 * The Plan image tab: the original floor plan under the fixed items (spec
 * section 5: "Keep the original image on a hidden layer we can turn on
 * later"). The show switch is kept on this device; the opacity is saved with
 * the template, so a slider drag is one undo step.
 *
 * "Run the import again" sends the stored picture to the model again (spec
 * section 5 step 7; PLAN change 22: a larger FLOORPLAN_MODEL, say). A plan
 * read from a PDF's own lines needs its lines, which are not kept, so the
 * panel says to import the PDF again instead.
 */
import { setReferenceOpacity } from '@/domain/template-commands'
import { Section, Switch, smallButton } from '@/client/editor/panels/controls'
import { useTemplateDoc, useTemplateEditor, useTemplateUi, useTemplateView } from './react'
import type { ReferenceImageInfo } from './TemplateCanvas'

export type ReferencePanelProps = {
  image: ReferenceImageInfo | null
  draft: boolean
  canEdit: boolean
  onImport(): void
  /** How the saved plan can be run again: 'picture' sends the stored image, 'pdf' needs the PDF picked again. Null: nothing stored. */
  rerun: 'picture' | 'pdf' | null
  onRerun(): void
}

export function ReferencePanel({ image, draft, canEdit, onImport, rerun, onRerun }: ReferencePanelProps) {
  const editor = useTemplateEditor()
  const reference = useTemplateDoc((d) => d.reference)
  const shown = useTemplateView((s) => s.showReferenceImage)
  const mode = useTemplateUi((s) => s.mode)
  const disabled = !canEdit || mode !== 'edit'

  return (
    <div data-testid="reference-panel">
      <Section title="Floor plan image">
        {!image || !reference ? (
          <p className="text-sm text-stone-700">No floor plan image yet. Import a plan to add one.</p>
        ) : (
          <>
            <Switch
              label="Show the original plan"
              hint={draft ? 'It always shows while you check a draft.' : 'Kept on this device.'}
              checked={draft || shown}
              disabled={draft}
              onChange={(on) => editor.view.setShowReferenceImage(on)}
              testId="show-reference"
            />
            <div>
              <label htmlFor="reference-opacity" className="block text-sm font-medium text-stone-700">
                Opacity <span className="tabular-nums text-stone-500">{Math.round(reference.opacity * 100)}%</span>
              </label>
              <input
                id="reference-opacity"
                type="range"
                min={5}
                max={100}
                step={5}
                value={Math.round(reference.opacity * 100)}
                disabled={disabled}
                onChange={(e) => editor.actions.run('Change opacity', (d) => setReferenceOpacity(d, Number(e.target.value) / 100), 'reference-opacity')}
                className="mt-1 h-11 w-full accent-blue-900 disabled:opacity-50"
                data-testid="reference-opacity"
              />
            </div>
            <p className="text-xs text-stone-500">
              {image.width} × {image.height} pixels
            </p>
          </>
        )}
        {!draft && rerun === 'pdf' && (
          <p className="text-sm text-stone-700" data-testid="rerun-pdf-note">
            This plan was read from a PDF’s own lines, which are not kept. To run the import again, import the same PDF.
          </p>
        )}
        {!draft && (
          <div className="flex flex-wrap gap-2">
            {rerun === 'picture' && (
              <button type="button" className={smallButton} onClick={onRerun} disabled={!canEdit} data-testid="rerun-stored">
                Run the import again
              </button>
            )}
            <button type="button" className={smallButton} onClick={onImport} disabled={!canEdit} data-testid="import-plan-panel">
              Import a floor plan
            </button>
          </div>
        )}
      </Section>
    </div>
  )
}
