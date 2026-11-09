'use client'

/**
 * The CSV import (spec section 6, PLAN section 7), as a page in four steps:
 * pick a file (read and parsed in the browser), match its columns, check
 * the server's summary and make any picks it asks for, then import in one
 * transaction and see what happened. The picks live here, not in the review
 * step, so going back to fix a column match keeps them (keepPicks).
 */
import Link from 'next/link'
import { useEffect, useId, useMemo, useState } from 'react'
import { ApiRequestError, commitGuestImport, errorMessage, previewGuestImport } from '@/client/api'
import { primaryButton, secondaryButton } from '@/client/ui/styles'
import { applyMapping, guessMapping, type ColumnMapping, type ImportRow, type MappedRows } from '@/domain/csv/columns'
import type { LegacyEncoding } from '@/domain/csv/decode'
import { SAMPLE_CSV_FILE_NAME, SAMPLE_CSV_URL } from '@/domain/csv/sample'
import { plural } from '@/domain/wording'
import type { Guest, ImportCommitResult, ImportPreview } from '@/shared/api'
import { seatLines } from '../DeleteGuestDialog'
import { ColumnStep } from './ColumnStep'
import { keepPicks, NO_PICKS, picksBody, type ImportPicks } from './picks'
import { readCsvFile, rereadCsv, type ReadCsv } from './read-file'
import { ReviewStep } from './ReviewStep'

type Step =
  | { kind: 'pick' }
  | { kind: 'columns'; file: ReadCsv; mapping: ColumnMapping }
  | { kind: 'review'; file: ReadCsv; mapping: ColumnMapping; mapped: MappedRows }
  | { kind: 'done'; result: ImportCommitResult }

const STEP_TITLES = ['Pick a file', 'Match columns', 'Check and import', 'Done'] as const

export function ImportWizard({ weddingId, guests }: { weddingId: string; guests: Guest[] }) {
  const [step, setStep] = useState<Step>({ kind: 'pick' })
  /** The review step's choices, and the rows they were made against. */
  const [picks, setPicks] = useState<{ picks: ImportPicks; rows: readonly ImportRow[] }>({ picks: NO_PICKS, rows: [] })
  const index = { pick: 0, columns: 1, review: 2, done: 3 }[step.kind]
  const backHref = `/w/${weddingId}/guests`

  function readAgain(file: ReadCsv, mapping: ColumnMapping, legacy: LegacyEncoding) {
    const result = rereadCsv(file, legacy)
    if (!result.ok) return
    const next = result.file
    // Headers only change when they hold the letters that read differently.
    const same = next.headers.length === file.headers.length && next.headers.every((h, i) => h === file.headers[i])
    setStep({ kind: 'columns', file: next, mapping: same ? mapping : guessMapping(next.headers) })
  }

  return (
    <div className="space-y-4" data-testid="import-wizard">
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Steps">
        {STEP_TITLES.map((title, i) => (
          <li key={title} aria-current={i === index ? 'step' : undefined} className={i === index ? 'font-semibold text-blue-950' : 'text-stone-500'}>
            {i + 1}. {title}
          </li>
        ))}
      </ol>
      {step.kind === 'pick' && (
        <PickStep
          backHref={backHref}
          onRead={(file) => {
            setPicks({ picks: NO_PICKS, rows: [] })
            setStep({ kind: 'columns', file, mapping: guessMapping(file.headers) })
          }}
        />
      )}
      {step.kind === 'columns' && (
        <ColumnStep
          file={step.file}
          mapping={step.mapping}
          onMapping={(mapping) => setStep({ ...step, mapping })}
          onEncoding={(legacy) => readAgain(step.file, step.mapping, legacy)}
          onBack={() => setStep({ kind: 'pick' })}
          onNext={() => {
            const mapped = applyMapping(step.file.rows, step.mapping, step.file.rowNumbers)
            setPicks((p) => ({ picks: keepPicks(p.picks, p.rows, mapped.rows), rows: mapped.rows }))
            setStep({ kind: 'review', file: step.file, mapping: step.mapping, mapped })
          }}
        />
      )}
      {step.kind === 'review' && (
        <Review
          weddingId={weddingId}
          guests={guests}
          mapped={step.mapped}
          picks={picks.picks}
          onPicks={(change) => setPicks((p) => ({ ...p, picks: change(p.picks) }))}
          onBack={() => setStep({ kind: 'columns', file: step.file, mapping: step.mapping })}
          onDone={(result) => setStep({ kind: 'done', result })}
        />
      )}
      {step.kind === 'done' && <DoneStep result={step.result} backHref={backHref} />}
    </div>
  )
}

function PickStep({ backHref, onRead }: { backHref: string; onRead(file: ReadCsv): void }) {
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const inputId = useId()

  async function pick(file: File | undefined) {
    if (!file) return
    setReading(true)
    setError(null)
    const result = await readCsvFile(file)
    setReading(false)
    if (result.ok) onRead(result.file)
    else setError(result.message)
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4" data-testid="import-pick">
      <h3 className="font-semibold">Pick a CSV file</h3>
      <p className="mt-1 text-sm text-stone-600">
        Only first and last name are needed. Guests already on the list are matched by name, so importing the same file twice adds no one twice.
      </p>
      <label htmlFor={inputId} className={`${primaryButton} mt-4 cursor-pointer`}>
        {reading ? 'Reading…' : 'Choose file'}
      </label>
      <input
        id={inputId}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
        className="sr-only"
        onChange={(e) => {
          void pick(e.target.files?.[0])
          e.target.value = ''
        }}
        data-testid="import-file"
      />
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={SAMPLE_CSV_URL} download={SAMPLE_CSV_FILE_NAME} className={secondaryButton}>
          Download sample CSV
        </a>
        <Link href={backHref} className={secondaryButton}>
          Back to guests
        </Link>
      </div>
    </section>
  )
}

function Review({
  weddingId,
  guests,
  mapped,
  picks,
  onPicks,
  onBack,
  onDone,
}: {
  weddingId: string
  guests: Guest[]
  mapped: MappedRows
  picks: ImportPicks
  onPicks(change: (picks: ImportPicks) => ImportPicks): void
  onBack(): void
  onDone(result: ImportCommitResult): void
}) {
  const { reviewPicks, partnerPicks, removeMissing } = picks
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Bumped by Try again, and after a commit the server found out of date, to ask for a new summary. */
  const [attempt, setAttempt] = useState(0)
  /** The newest summary that came back, and the request it answered. */
  const [answer, setAnswer] = useState<{ key: string; error: string | null } | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)

  const body = useMemo(
    () => ({ rows: mapped.rows, reviewPicks: picksBody(reviewPicks), partnerPicks: picksBody(partnerPicks) }),
    [mapped.rows, reviewPicks, partnerPicks],
  )
  const requestKey = `${attempt}:${JSON.stringify(body.reviewPicks)}:${JSON.stringify(body.partnerPicks)}`
  const loading = mapped.rows.length > 0 && answer?.key !== requestKey
  const loadError = answer?.key === requestKey ? answer.error : null

  useEffect(() => {
    if (body.rows.length === 0) return
    let live = true
    previewGuestImport(weddingId, body).then(
      (next) => {
        if (!live) return
        setAnswer({ key: requestKey, error: null })
        setPreview(next)
      },
      (err: unknown) => {
        if (live) setAnswer({ key: requestKey, error: `Could not check the file against the guest list. ${errorMessage(err)}` })
      },
    )
    // A newer request replaces this one; its late answer is dropped.
    return () => {
      live = false
    }
  }, [weddingId, body, requestKey])

  async function commit() {
    if (!preview || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await commitGuestImport(weddingId, {
        rows: mapped.rows,
        reviewPicks: picksBody(reviewPicks),
        partnerPicks: picksBody(partnerPicks),
        removeMissing,
        missingGuestIds: removeMissing ? preview.plan.missing.map((m) => m.guestId) : undefined,
      })
      onDone(result)
    } catch (err) {
      const stale = err instanceof ApiRequestError && (err.status === 409 || err.status === 422)
      setError(stale ? `${errorMessage(err)} The summary below is up to date now.` : `Could not import. ${errorMessage(err)}`)
      setBusy(false)
      if (stale) setAttempt((n) => n + 1)
    }
  }

  if (mapped.rows.length === 0) {
    return (
      <section className="rounded-xl border border-amber-300 bg-white p-4" data-testid="import-nothing">
        <h3 className="font-semibold">Nothing to import</h3>
        <p className="mt-1 text-sm text-stone-700">No row has both a first and a last name. Check the column matches.</p>
        <ul className="mt-2 space-y-0.5 text-sm">
          {mapped.errors.slice(0, 20).map((e) => (
            <li key={e.rowNumber}>
              Row {e.rowNumber}: {e.message}
            </li>
          ))}
        </ul>
        <button type="button" className={`${secondaryButton} mt-4`} onClick={onBack}>
          Back to columns
        </button>
      </section>
    )
  }

  if (!preview) {
    return (
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        {loadError ? (
          <>
            <p role="alert" className="text-sm text-red-700">
              {loadError}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={secondaryButton} onClick={onBack}>
                Back to columns
              </button>
              <button type="button" className={primaryButton} onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-stone-600">Checking {plural(mapped.rows.length, 'row')} against the guest list…</p>
        )}
      </section>
    )
  }

  return (
    <ReviewStep
      preview={preview}
      rows={mapped.rows}
      skipped={mapped.errors}
      warnings={mapped.warnings}
      guests={guests}
      reviewPicks={reviewPicks}
      onReviewPick={(row, choice) => onPicks((p) => ({ ...p, reviewPicks: new Map(p.reviewPicks).set(row, choice) }))}
      partnerPicks={partnerPicks}
      onPartnerPick={(row, pick) => onPicks((p) => ({ ...p, partnerPicks: new Map(p.partnerPicks).set(row, pick) }))}
      removeMissing={removeMissing}
      onRemoveMissing={(on) => onPicks((p) => ({ ...p, removeMissing: on }))}
      refreshing={loading}
      busy={busy}
      error={error ?? loadError}
      onBack={onBack}
      onImport={() => void commit()}
    />
  )
}

function DoneStep({ result, backHref }: { result: ImportCommitResult; backHref: string }) {
  const lines = [
    `${plural(result.created, 'guest')} added.`,
    `${plural(result.updated, 'guest')} changed.`,
    `${plural(result.unchanged, 'guest')} with no change.`,
    result.groupsCreated > 0 ? `${plural(result.groupsCreated, 'group')} made.` : null,
    // One per guest per group: a guest added to two groups counts twice.
    result.membershipsAdded > 0 ? `${plural(result.membershipsAdded, 'group membership')} added.` : null,
    result.partnersLinked > 0 ? `${plural(result.partnersLinked, 'couple')} linked.` : null,
    result.removed > 0 ? `${plural(result.removed, 'guest')} removed.` : null,
  ].filter((l): l is string => l !== null)
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4" data-testid="import-done">
      <h3 className="font-semibold">Import finished</h3>
      <ul className="mt-2 space-y-0.5 text-sm" data-testid="import-result">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {result.clearedSeats.length > 0 && (
        <div className="mt-3 text-sm">
          <p>Seats cleared:</p>
          <ul className="mt-1 list-disc pl-5">
            {seatLines(result.clearedSeats).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      {/* Pages are not kept in the client cache, so the guest list loads fresh. */}
      <Link href={backHref} className={`${primaryButton} mt-4`} data-testid="import-back">
        Back to guests
      </Link>
    </section>
  )
}
