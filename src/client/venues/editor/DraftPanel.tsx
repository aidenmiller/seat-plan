'use client'

/**
 * The import draft's panel (spec section 5 steps 5 to 7): the scale step,
 * the items the model was unsure of, and Accept, Rerun and Discard.
 *
 * Scale: when the plan's dimension labels agree, one labelled line is drawn
 * on the canvas measured at that scale, and the person confirms it or sets
 * the scale by hand. When they disagree, the panel says by how much and how
 * many agree, and offers the ones that agree (confirmed the same way).
 * Otherwise they click two points on the plan and type the real distance
 * between them; the draft is then drawn again from the model's reply at the
 * new scale (redrawDraft), so sizes that were real centimeters stay right.
 * Accept waits until the scale is set. Nothing changes in the template until
 * Accept; when someone saved the venue after this tab opened it, Accept asks
 * first and then goes over their save.
 */
import { useId, useState } from 'react'
import type { DraftSource, ScaleStep } from '@/domain/template-import'
import { agreeingLabelsButton, measuredCm, scaleProblemText, takeAgreeingLabels, twoPointFactor, unsureSummary } from '@/domain/template-import'
import { fixedItemLabel, type TemplateDoc } from '@/domain/template-commands'
import { formatLength, parseLength, type LengthUnit } from '@/domain/units'
import { acceptOverText } from '@/domain/venue-wording'
import type { VenueImageInfo } from '@/shared/api'
import { errorClass, inputClass, labelClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { Section, smallButton } from '@/client/editor/panels/controls'
import { shallowEqual } from '@/client/editor/state/store'
import type { ImportPlan } from '../import/plan-body'
import { useTemplateDoc, useTemplateEditor, useTemplateUi } from './react'
import { SELECT } from './ui-store'

/** An import draft open in the editor. The template itself is `saved` until Accept. */
export type DraftState = {
  image: VenueImageInfo
  plan: ImportPlan
  model: string
  /** The model's reply and the lines it named, to draw the draft again at a new scale. */
  source: DraftSource
  /** The draft as last drawn from `source`. While the canvas still holds it, nothing was edited. */
  built: TemplateDoc
  scale: ScaleStep
  /** The person confirmed the labelled line, or set the scale by hand. */
  scaleSet: boolean
  /** Setting the scale by hand (two points). */
  byHand: boolean
  skipped: string[]
  /** The template as saved, put back on Discard. */
  saved: TemplateDoc
  /** The same id for every try of one Accept. */
  saveId: string
  /** Someone saved the venue after this tab opened it: Accept asks, then goes over their save. */
  over: { who: 'Noa' | 'Aiden' | null } | null
}

export type DraftPanelProps = {
  draft: DraftState
  unit: LengthUnit
  busy: boolean
  error: string | null
  onChange(next: DraftState): void
  /**
   * Draws the draft again at this scale (cm per image pixel) and then applies
   * `then` to the draft state. False when the page cannot edit right now.
   */
  onRescale(cmPerPx: number, then: (d: DraftState) => DraftState): boolean
  onAccept(): void
  onRerun(): void
  onDiscard(): void
}

function sourceText(plan: ImportPlan): string {
  if (plan.source === 'image') return 'From a picture.'
  if (plan.source === 'stored') return 'From the saved plan picture.'
  return plan.kind === 'vector' ? `From PDF page ${plan.page}, using its own lines.` : `From PDF page ${plan.page}, a scanned page.`
}

export function DraftPanel({ draft, unit, busy, error, onChange, onRescale, onAccept, onRerun, onDiscard }: DraftPanelProps) {
  const editor = useTemplateEditor()
  const measure = useTemplateUi((s) => s.measure)
  const cmPerPx = useTemplateDoc((d) => d.reference?.scaleCmPerPx ?? draft.scale.cmPerPx)
  const edited = useTemplateDoc((d) => d !== draft.built)
  const unsure = useTemplateDoc(
    (d) => d.items.filter((i) => i.unsure),
    shallowEqual,
  )
  const [distance, setDistance] = useState('')
  const [distanceError, setDistanceError] = useState<string | null>(null)
  const distanceId = useId()
  const { scale } = draft
  const confirm = scale.confirm
  const asking = !draft.scaleSet && scale.agreed && !draft.byHand && confirm !== null

  function byHand() {
    editor.ui.setState({ tool: { kind: 'measure' }, measure: [], drawing: null, cursor: null })
    onChange({ ...draft, byHand: true, scaleSet: false })
  }

  function setByHand() {
    if (measure.length < 2) {
      setDistanceError('Click two points on the plan first.')
      return
    }
    const cm = parseLength(distance, unit)
    const factor = cm === null ? null : twoPointFactor(measure[0], measure[1], cm)
    if (factor === null) {
      setDistanceError(unit === 'ft' ? 'Type the distance, such as 24′ 6″ or 300 in.' : 'Type the distance, such as 7.5 m or 750 cm.')
      return
    }
    if (!onRescale(cmPerPx * factor, (d) => ({ ...d, byHand: false, scaleSet: true }))) return
    editor.ui.setState({ tool: SELECT, measure: [] })
    setDistance('')
    setDistanceError(null)
  }

  /** "Use the 3 that agree": their scale, with their longest label drawn to confirm. */
  function takeAgreeing() {
    const step = takeAgreeingLabels(scale)
    if (step === scale) return
    editor.ui.setState({ tool: SELECT, measure: [] })
    if (Math.abs(step.cmPerPx - cmPerPx) <= step.cmPerPx * 1e-9) {
      onChange({ ...draft, scale: step, byHand: false, scaleSet: false })
      return
    }
    onRescale(step.cmPerPx, (d) => ({ ...d, scale: step, byHand: false, scaleSet: false }))
  }

  return (
    <div data-testid="draft-panel">
      <Section title="Import draft">
        <p className="text-sm text-stone-700">
          {sourceText(draft.plan)} Check it against the faded original. Every shape can be edited. Nothing changes in this venue until you press Accept.
        </p>
      </Section>

      <Section title="Scale" testId="scale-step">
        {asking && confirm && (
          <>
            <p className="text-sm text-stone-800">
              The label “{confirm.label.text}” measures <strong>{formatLength(measuredCm(confirm, cmPerPx), unit)}</strong> at this scale. It is drawn in pink on the plan.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={smallButton} onClick={() => onChange({ ...draft, scaleSet: true })} data-testid="scale-confirm">
                Looks right
              </button>
              <button type="button" className={smallButton} onClick={byHand}>
                Set it by hand
              </button>
            </div>
          </>
        )}
        {!draft.scaleSet && !asking && (
          <>
            {!draft.byHand && (
              <p className="text-sm text-stone-800" data-testid="scale-problem">
                {scaleProblemText(scale.choice)} {scale.consensusConfirm ? 'Use the labels that agree, or set the scale by hand.' : 'Set the scale by hand.'}
              </p>
            )}
            <p className="text-sm text-stone-700">Click two points on the plan whose real distance you know, such as the ends of a wall, then type that distance.</p>
            {!draft.byHand && (
              <div className="flex flex-wrap gap-2">
                {scale.consensusConfirm && (
                  <button type="button" className={smallButton} onClick={takeAgreeing} data-testid="scale-agreeing">
                    {agreeingLabelsButton(scale.choice)}
                  </button>
                )}
                <button type="button" className={smallButton} onClick={byHand} data-testid="scale-start">
                  Pick two points
                </button>
              </div>
            )}
            {draft.byHand && edited && (
              <p className="text-sm text-amber-800" data-testid="scale-redraw-warning">
                Setting the scale draws the draft again from the plan. Changes you made to the draft go.
              </p>
            )}
            {draft.byHand && (
              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault()
                  setByHand()
                }}
                className="space-y-2"
              >
                <p className="text-sm text-stone-600" data-testid="measure-count">
                  {measure.length === 0 ? 'No points yet.' : measure.length === 1 ? 'One point. Click the second.' : 'Two points picked.'}
                </p>
                <label htmlFor={distanceId} className={labelClass}>
                  Real distance
                </label>
                <input
                  id={distanceId}
                  value={distance}
                  onChange={(e) => {
                    setDistance(e.target.value)
                    setDistanceError(null)
                  }}
                  inputMode="text"
                  autoComplete="off"
                  placeholder={unit === 'ft' ? '24′ 6″' : '7.5 m'}
                  className={inputClass}
                  data-testid="measure-distance"
                />
                {distanceError && <p className={errorClass}>{distanceError}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className={smallButton} data-testid="measure-apply">
                    Set scale
                  </button>
                  <button type="button" className={smallButton} onClick={() => editor.ui.setState({ measure: [], tool: { kind: 'measure' } })}>
                    Pick again
                  </button>
                </div>
              </form>
            )}
          </>
        )}
        {draft.scaleSet && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-emerald-800">Scale set.</p>
            <button type="button" className={smallButton} onClick={byHand}>
              Set it again
            </button>
          </div>
        )}
      </Section>

      <Section title="To check" testId="unsure-list">
        <p className="text-sm text-stone-700">{unsureSummary(unsure.length)}</p>
        {unsure.length > 0 && (
          <ul className="space-y-1">
            {unsure.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full flex-col items-start rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-sm text-amber-950 hover:bg-amber-100"
                  onClick={() => {
                    editor.ui.select([item.id])
                    editor.actions.showItem(item.id)
                  }}
                >
                  <span className="font-medium">{fixedItemLabel(item)}</span>
                  {item.unsureNote && <span>{item.unsureNote}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {draft.skipped.length > 0 && (
          <details className="text-sm text-stone-700">
            <summary className="min-h-11 cursor-pointer py-2">{draft.skipped.length === 1 ? '1 item could not be drawn' : `${draft.skipped.length} items could not be drawn`}</summary>
            <ul className="list-disc space-y-1 pl-5 text-stone-600">
              {draft.skipped.slice(0, 50).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section title="Finish">
        {error && (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        )}
        {draft.over && (
          <p role="alert" className="text-sm font-medium text-amber-900" data-testid="draft-over">
            {acceptOverText(draft.over.who)}
          </p>
        )}
        {!draft.scaleSet && <p className="text-sm text-stone-600">Set the scale to accept the draft.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryButton} disabled={!draft.scaleSet || busy} onClick={onAccept} data-testid="draft-accept">
            {busy ? 'Saving…' : draft.over ? 'Accept over it' : 'Accept'}
          </button>
          <button type="button" className={secondaryButton} disabled={busy} onClick={onRerun} data-testid="draft-rerun">
            Rerun
          </button>
          <button type="button" className={secondaryButton} disabled={busy} onClick={onDiscard} data-testid="draft-discard">
            Discard
          </button>
        </div>
      </Section>
    </div>
  )
}
