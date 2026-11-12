'use client'

/**
 * The floor plan import (spec section 5, "Floor plan import with AI"):
 * pick a PNG, JPG or PDF (for a PDF with more than one page, pick the page;
 * page 1 is picked), then the browser reads it, uploads the picture, and the
 * server asks the AI model for a draft. While that runs the dialog shows how
 * long it has taken, with a Cancel button. "Rerun" opens it straight at the
 * last step with the same picture.
 *
 * Nothing here changes the template: the draft goes to the editor, which
 * keeps it apart until Accept.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { ApiRequestError, errorMessage, runFloorplanImport, uploadVenueImage } from '@/client/api'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { errorClass, hintClass, inputClass, labelClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import type { FloorplanDraft } from '@/domain/floorplan/draft-schema'
import type { ImportLimitReached, VenueImageInfo } from '@/shared/api'
import { elapsedText, floorplanBody, planFileKind, type ImportPlan } from './plan-body'
import { openPdf, PlanReadError, prepareImage, preparePdfPage, type OpenPdf, type PreparedPlan } from './prepare-plan'

export type ImportResult = { draft: FloorplanDraft; model: string; plan: ImportPlan; image: VenueImageInfo }

export type ImportDialogProps = {
  open: boolean
  templateId: string
  /** Run again on a picture already uploaded: the draft's Rerun, or the stored plan picture. */
  rerun: { plan: ImportPlan; image: VenueImageInfo } | null
  onClose(): void
  onDraft(result: ImportResult): void
}

export function ImportDialog(props: ImportDialogProps) {
  if (!props.open) return null
  return <ImportFlow {...props} />
}

type Step = { kind: 'pick' } | { kind: 'working'; label: string; startedAt: number } | { kind: 'error'; message: string; retry: boolean }

const ERROR_TEXT: Record<string, string> = {
  refusal: 'The AI model would not read this plan.',
  max_tokens: 'The plan has more in it than the AI model could answer in one go.',
  invalid_reply: 'The AI model sent back something the app could not read.',
  timeout: 'The AI model took too long.',
  busy: 'The AI model is busy right now.',
}

function ImportFlow({ templateId, rerun, onClose, onDraft }: ImportDialogProps) {
  const [step, setStep] = useState<Step>(rerun ? { kind: 'working', label: 'The AI model is reading the plan', startedAt: Date.now() } : { kind: 'pick' })
  const [file, setFile] = useState<File | null>(null)
  const [pdf, setPdf] = useState<OpenPdf | null>(null)
  const [page, setPage] = useState('1')
  const [pickError, setPickError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const abortRef = useRef<AbortController | null>(null)
  const runRef = useRef(0)
  const lastRef = useRef<{ plan: ImportPlan; image: VenueImageInfo } | null>(rerun)
  const fileId = useId()
  const pageId = useId()

  useEffect(() => () => pdf?.close(), [pdf])
  useEffect(
    () => () => {
      runRef.current += 1
      abortRef.current?.abort()
    },
    [],
  )

  useEffect(() => {
    if (step.kind !== 'working') return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [step.kind])

  // Rerun starts at once.
  const started = useRef(false)
  useEffect(() => {
    if (!rerun || started.current) return
    started.current = true
    void ask(rerun.plan, rerun.image, runRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function pick(next: File | null) {
    pdf?.close()
    setPdf(null)
    setPickError(null)
    setPage('1')
    setFile(next)
    if (!next) return
    const kind = planFileKind(next)
    if (!kind) {
      setPickError('Upload a PNG, JPG or PDF.')
      return
    }
    if (kind !== 'pdf') return
    setOpening(true)
    try {
      setPdf(await openPdf(next))
    } catch (err) {
      setPickError(err instanceof PlanReadError ? err.message : 'This PDF could not be opened.')
    } finally {
      setOpening(false)
    }
  }

  async function ask(plan: ImportPlan, image: VenueImageInfo, run: number) {
    const abort = new AbortController()
    abortRef.current = abort
    setStep({ kind: 'working', label: 'The AI model is reading the plan', startedAt: Date.now() })
    try {
      const result = await runFloorplanImport(templateId, floorplanBody(plan, image), { signal: abort.signal })
      if (run !== runRef.current) return
      if (result.type === 'draft') {
        onDraft({ draft: result.draft, model: result.model, plan, image })
        return
      }
      const retry = result.code !== 'auth' && result.code !== 'bad_request'
      setStep({ kind: 'error', message: ERROR_TEXT[result.code] ?? result.message, retry })
    } catch (err) {
      if (run !== runRef.current) return
      if (abort.signal.aborted) return
      const notConfigured = err instanceof ApiRequestError && err.status === 503
      // Over the planner's AI import allowance: the reply says so, and trying again will not help.
      const limit = err instanceof ApiRequestError && err.status === 429 ? (err.body as Partial<ImportLimitReached> | null) : null
      if (limit?.error === 'import_limit' && limit.message) {
        setStep({ kind: 'error', message: limit.message, retry: false })
        return
      }
      setStep({ kind: 'error', message: errorMessage(err), retry: !notConfigured })
    }
  }

  async function start() {
    if (!file) return
    const kind = planFileKind(file)
    if (!kind || (kind === 'pdf' && !pdf)) return
    const pageNumber = Number(page)
    if (kind === 'pdf' && pdf && (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.pages)) {
      setPickError(`Pick a page from 1 to ${pdf.pages}.`)
      return
    }
    const run = ++runRef.current
    const startedAt = Date.now()
    try {
      setStep({ kind: 'working', label: 'Reading the plan', startedAt })
      let plan: PreparedPlan
      if (kind === 'pdf' && pdf) {
        plan = await preparePdfPage(pdf, pageNumber, file.name)
      } else if (kind !== 'pdf') {
        plan = await prepareImage(file, kind)
      } else return
      if (run !== runRef.current) return
      setStep({ kind: 'working', label: 'Uploading the picture', startedAt })
      const image = await uploadVenueImage(templateId, plan.blob)
      if (run !== runRef.current) return
      lastRef.current = { plan, image }
      await ask(plan, image, run)
    } catch (err) {
      if (run !== runRef.current) return
      setStep({ kind: 'error', message: err instanceof PlanReadError ? err.message : errorMessage(err), retry: true })
    }
  }

  function cancel() {
    runRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    if (rerun) onClose()
    else setStep({ kind: 'pick' })
  }

  function retry() {
    const last = lastRef.current
    if (last) void ask(last.plan, last.image, ++runRef.current)
    else setStep({ kind: 'pick' })
  }

  const working = step.kind === 'working'
  const isPdf = file !== null && planFileKind(file) === 'pdf'

  return (
    <Dialog open onClose={working ? () => undefined : onClose} dismissable={!working} title={rerun ? 'Run the import again' : 'Import a floor plan'} testId="import-dialog">
      {step.kind === 'pick' && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void start()
          }}
          className="space-y-4"
        >
          <p className="text-sm text-stone-700">The AI model turns the plan into walls, rooms and doors you can edit. Nothing changes in this venue until you press Accept.</p>
          <div>
            <label htmlFor={fileId} className={labelClass}>
              Floor plan (PNG, JPG or PDF)
            </label>
            <input
              id={fileId}
              type="file"
              accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf"
              onChange={(e) => void pick(e.target.files?.[0] ?? null)}
              className="mt-1 block min-h-11 w-full text-sm text-stone-800 file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-stone-300 file:bg-white file:px-4 file:text-sm file:font-medium"
              data-testid="import-file"
            />
          </div>
          {opening && <p className={hintClass}>Opening the PDF…</p>}
          {isPdf && pdf && pdf.pages > 1 && (
            <div>
              <label htmlFor={pageId} className={labelClass}>
                Page (of {pdf.pages})
              </label>
              <input
                id={pageId}
                type="number"
                inputMode="numeric"
                min={1}
                max={pdf.pages}
                value={page}
                onChange={(e) => {
                  setPage(e.target.value)
                  setPickError(null)
                }}
                className={`${inputClass} mt-1 w-28`}
                data-testid="import-page"
              />
            </div>
          )}
          {pickError && (
            <p role="alert" className={errorClass}>
              {pickError}
            </p>
          )}
          <DialogActions>
            <button type="button" className={secondaryButton} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={primaryButton} disabled={!file || pickError !== null || opening || (isPdf && !pdf)} data-testid="import-start">
              Start import
            </button>
          </DialogActions>
        </form>
      )}

      {step.kind === 'working' && (
        <div className="space-y-4" data-testid="import-progress">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-blue-900 border-t-transparent" />
            <p role="status" className="text-sm text-stone-800">
              {step.label}… <span className="tabular-nums text-stone-600">{elapsedText(now - step.startedAt)}</span>
            </p>
          </div>
          <p className={hintClass}>A detailed plan can take a few minutes. You can keep this page open and wait.</p>
          <DialogActions>
            <button type="button" className={secondaryButton} onClick={cancel} data-testid="import-cancel">
              Cancel
            </button>
          </DialogActions>
        </div>
      )}

      {step.kind === 'error' && (
        <div className="space-y-4">
          <p role="alert" className={errorClass} data-testid="import-error">
            {step.message}
          </p>
          <DialogActions>
            <button type="button" className={secondaryButton} onClick={onClose}>
              Close
            </button>
            {step.retry && (
              <button type="button" className={primaryButton} onClick={retry}>
                Try again
              </button>
            )}
          </DialogActions>
        </div>
      )}
    </Dialog>
  )
}
