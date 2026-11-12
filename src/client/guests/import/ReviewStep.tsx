'use client'

/**
 * The server's summary before anything is saved (spec section 6; PLAN change
 * 10): new guests, changed guests with each changed field, rows that need a
 * pick, partner names that matched no one, likely duplicates, groups to
 * create, and guests missing from the file with the choice to remove them,
 * naming every layout and table that touches. Rows without names are
 * listed as skipped.
 */
import { useId, type ReactNode } from 'react'
import { primaryButton, secondaryButton } from '@/client/ui/styles'
import type { ImportRow, RowIssue } from '@/domain/csv/columns'
import { CHANGE_FIELD_LABELS, type FieldChange, type ReviewItem } from '@/domain/csv/import-diff'
import type { PartnerMatch, PartnerPick } from '@/domain/csv/partner-match'
import { compareByName, fullName } from '@/domain/guest-list'
import { legacySide, sideLabel, type PartnerNames } from '@/domain/partners'
import { plural } from '@/domain/wording'
import type { Guest, ImportPreview } from '@/shared/api'
import { GroupChip } from '../cells'
import { usePartnerNames } from '../partners-context'
import { decodePartnerPick, encodePartnerPick, missingSeatLines, type ReviewChoice } from './picks'

export type ReviewStepProps = {
  preview: ImportPreview
  rows: readonly ImportRow[]
  skipped: readonly RowIssue[]
  warnings: readonly RowIssue[]
  guests: readonly Guest[]
  reviewPicks: ReadonlyMap<number, ReviewChoice | undefined>
  onReviewPick(rowNumber: number, choice: ReviewChoice | undefined): void
  partnerPicks: ReadonlyMap<number, PartnerPick | undefined>
  onPartnerPick(rowNumber: number, pick: PartnerPick | undefined): void
  removeMissing: boolean
  onRemoveMissing(on: boolean): void
  /** A new summary is on its way (after a pick). */
  refreshing: boolean
  busy: boolean
  error: string | null
  onBack(): void
  onImport(): void
}

/** A change's before or after as it reads: a side by the wedding's names, anything else as it is. */
function changeText(change: FieldChange, value: string, partners: PartnerNames): string {
  const side = change.field === 'side' ? legacySide(value) : null
  return side ? sideLabel(partners, side) : value
}

export function ReviewStep(props: ReviewStepProps) {
  const { preview, rows, skipped, warnings, guests, removeMissing, busy, refreshing, error } = props
  const { plan } = preview
  const partners = usePartnerNames()
  const rowByNumber = new Map(rows.map((r) => [r.rowNumber, r]))
  const rowName = (n: number) => {
    const r = rowByNumber.get(n)
    return r ? fullName(r) : `Row ${n}`
  }
  const missingName = new Map(plan.missing.map((m) => [m.guestId, fullName(m)]))
  const unpicked = plan.needsReview.filter((item) => !props.reviewPicks.get(item.rowNumber)).length
  // Partner rows stay listed after a pick, so the pick can be changed.
  const partnerRows = new Map<number, PartnerMatch | null>(plan.partnerProblems.map((m) => [m.rowNumber, m]))
  for (const [rowNumber, pick] of props.partnerPicks) if (pick !== undefined && !partnerRows.has(rowNumber)) partnerRows.set(rowNumber, null)
  const counts = plan.counts

  return (
    <div className="space-y-4" data-testid="import-review" aria-busy={refreshing || undefined}>
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h3 className="font-semibold">Before you import</h3>
        <ul className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5" data-testid="import-counts">
          <Count label="New" value={counts.new} testId="count-new" />
          <Count label="Changed" value={counts.changed} testId="count-changed" />
          <Count label="No change" value={counts.unchanged} testId="count-unchanged" />
          <Count label="Need a pick" value={counts.needsReview} testId="count-review" />
          <Count label="Not in the file" value={counts.missing} testId="count-missing" />
        </ul>
        {refreshing && <p className="mt-2 text-sm text-stone-600">Checking again…</p>}
      </section>

      {skipped.length > 0 && (
        <Section title={`Skipped: ${plural(skipped.length, 'row')} without names`} testId="import-skipped" tone="warn">
          <IssueList issues={skipped} />
        </Section>
      )}

      {warnings.length > 0 && (
        <Section title={`Values not understood: ${plural(warnings.length, 'row')}`} testId="import-warnings">
          <p className="text-sm text-stone-600">These rows are still imported.</p>
          <IssueList issues={warnings} />
        </Section>
      )}

      {plan.needsReview.length > 0 && (
        <Section title={`Pick who these rows are (${plan.needsReview.length})`} testId="import-needs-review" tone="warn">
          <ul className="space-y-3">
            {plan.needsReview.map((item) => (
              <ReviewPicker key={item.rowNumber} item={item} value={props.reviewPicks.get(item.rowNumber)} onChange={(v) => props.onReviewPick(item.rowNumber, v)} />
            ))}
          </ul>
        </Section>
      )}

      {partnerRows.size > 0 && (
        <Section title={`Partners to check (${partnerRows.size})`} testId="import-partners">
          <p className="text-sm text-stone-600">Pick the partner each of these rows means, or leave them unlinked.</p>
          <ul className="mt-2 space-y-3">
            {[...partnerRows].map(([rowNumber, match]) => (
              <PartnerPicker
                key={rowNumber}
                rowNumber={rowNumber}
                name={rowName(rowNumber)}
                partnerName={match?.partnerName ?? rowByNumber.get(rowNumber)?.partnerName ?? ''}
                message={match?.message ?? null}
                rows={rows}
                guests={guests}
                value={props.partnerPicks.get(rowNumber)}
                onChange={(pick) => props.onPartnerPick(rowNumber, pick)}
              />
            ))}
          </ul>
        </Section>
      )}

      {plan.duplicates.length > 0 && (
        <Section title={`Likely duplicates (${plan.duplicates.length})`} testId="import-duplicates">
          <p className="text-sm text-stone-600">Have a look: these may be the same person twice. Fix the file and pick it again if so.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {plan.duplicates.map((d) => (
              <li key={`${d.rowNumber}:${d.other.rowNumber ?? d.other.guestId}`}>
                <span className="font-medium">
                  Row {d.rowNumber}, {d.name}
                </span>
                : {d.message}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {plan.newGuests.length > 0 && (
        <Section title={`New guests (${plan.newGuests.length})`} testId="import-new" collapsible>
          <ul className="columns-1 text-sm sm:columns-2">
            {plan.newGuests.map((g) => (
              <li key={g.rowNumber}>{fullName(g.guest)}</li>
            ))}
          </ul>
        </Section>
      )}

      {plan.changed.length > 0 && (
        <Section title={`Changed guests (${plan.changed.length})`} testId="import-changed">
          <ul className="space-y-2 text-sm">
            {plan.changed.map((c) => (
              <li key={c.guestId}>
                <p className="font-medium">{c.name}</p>
                <ul className="mt-0.5 space-y-0.5 pl-3 text-stone-700">
                  {c.changes.map((ch) => (
                    <li key={ch.field} className="break-words">
                      {CHANGE_FIELD_LABELS[ch.field]}: <span className="text-stone-500">{changeText(ch, ch.before, partners) || 'empty'}</span> to{' '}
                      {changeText(ch, ch.after, partners) || 'empty'}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {plan.groupsToCreate.length > 0 && (
        <Section title={`Groups to make (${plan.groupsToCreate.length})`} testId="import-groups">
          <div className="flex flex-wrap gap-1">
            {plan.groupsToCreate.map((name) => (
              <GroupChip key={name} name={name} color="#78716C" />
            ))}
          </div>
        </Section>
      )}

      {plan.missing.length > 0 && (
        <Section title={`On the guest list but not in this file (${plan.missing.length})`} testId="import-missing">
          <ul className="columns-1 text-sm sm:columns-2">
            {plan.missing.map((m) => (
              <li key={m.guestId}>{fullName(m)}</li>
            ))}
          </ul>
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-stone-900">
            <input
              type="checkbox"
              checked={removeMissing}
              onChange={(e) => props.onRemoveMissing(e.target.checked)}
              className="h-5 w-5 shrink-0 accent-red-700"
              data-testid="import-remove-missing"
            />
            Remove these guests
          </label>
          <div className="text-sm text-stone-700" data-testid="import-missing-seats">
            {preview.missingSeats.length === 0 ? (
              <p>None of them has a seat in any layout.</p>
            ) : (
              <>
                <p>Removing them clears these seats:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {missingSeatLines(preview.missingSeats, (id) => missingName.get(id) ?? 'a guest').map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </Section>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {unpicked > 0 && <p className="text-sm text-amber-900">Pick who {plural(unpicked, 'row')} {unpicked === 1 ? 'is' : 'are'} before importing.</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={secondaryButton} onClick={props.onBack} disabled={busy}>
          Back to columns
        </button>
        <button
          type="button"
          className={primaryButton}
          onClick={props.onImport}
          disabled={busy || refreshing || unpicked > 0 || rows.length === 0}
          data-testid="import-commit"
        >
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
    </div>
  )
}

function Count({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <li className="rounded-lg bg-stone-50 px-3 py-2">
      <span className="block text-lg font-semibold text-stone-900" data-testid={testId}>
        {value}
      </span>
      <span className="text-stone-600">{label}</span>
    </li>
  )
}

function Section({
  title,
  children,
  testId,
  tone,
  collapsible,
}: {
  title: string
  children: ReactNode
  testId: string
  tone?: 'warn'
  collapsible?: boolean
}) {
  const box = `rounded-xl border bg-white p-4 ${tone === 'warn' ? 'border-amber-300' : 'border-stone-200'}`
  if (collapsible) {
    return (
      <details className={box} data-testid={testId}>
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{title}</summary>
        <div className="mt-2">{children}</div>
      </details>
    )
  }
  return (
    <section className={box} data-testid={testId}>
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  )
}

function IssueList({ issues }: { issues: readonly RowIssue[] }) {
  return (
    <ul className="mt-1 space-y-0.5 text-sm text-stone-800">
      {issues.map((issue, i) => (
        <li key={`${issue.rowNumber}:${i}`}>
          Row {issue.rowNumber}: {issue.message}
        </li>
      ))}
    </ul>
  )
}

function ReviewPicker({ item, value, onChange }: { item: ReviewItem; value: ReviewChoice | undefined; onChange(v: ReviewChoice | undefined): void }) {
  const id = useId()
  return (
    <li data-testid="review-item" data-row={item.rowNumber}>
      <label htmlFor={id} className="block text-sm">
        <span className="font-medium">
          Row {item.rowNumber}: {fullName(item.row)}
        </span>
        <span className="text-stone-600"> ({item.message})</span>
      </label>
      <select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="mt-1 block h-11 w-full rounded-lg border border-stone-300 bg-white px-2 text-base outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 sm:text-sm"
      >
        <option value="">Pick one</option>
        {item.candidates.map((c) => (
          <option key={c.guestId} value={c.guestId}>
            {[fullName(c), c.household, c.partnerName ? `partner ${c.partnerName}` : null, c.groups.length ? c.groups.join(', ') : null]
              .filter(Boolean)
              .join(' · ')}
          </option>
        ))}
        <option value="new">Add as a new guest</option>
      </select>
    </li>
  )
}

function PartnerPicker({
  rowNumber,
  name,
  partnerName,
  message,
  rows,
  guests,
  value,
  onChange,
}: {
  rowNumber: number
  name: string
  partnerName: string
  message: string | null
  rows: readonly ImportRow[]
  guests: readonly Guest[]
  value: PartnerPick | undefined
  onChange(pick: PartnerPick | undefined): void
}) {
  const id = useId()
  const others = rows.filter((r) => r.rowNumber !== rowNumber)
  const sortedGuests = [...guests].sort(compareByName)
  return (
    <li data-testid="partner-item" data-row={rowNumber}>
      <label htmlFor={id} className="block text-sm">
        <span className="font-medium">
          Row {rowNumber}: {name}
        </span>
        {partnerName && <span> names &ldquo;{partnerName}&rdquo;</span>}
        {message && <span className="text-stone-600"> ({message})</span>}
      </label>
      <select
        id={id}
        value={encodePartnerPick(value)}
        onChange={(e) => onChange(decodePartnerPick(e.target.value))}
        className="mt-1 block h-11 w-full rounded-lg border border-stone-300 bg-white px-2 text-base outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 sm:text-sm"
      >
        <option value="">Leave unlinked</option>
        <optgroup label="In this file">
          {others.map((r) => (
            <option key={r.rowNumber} value={encodePartnerPick({ rowNumber: r.rowNumber })}>
              {fullName(r)} (row {r.rowNumber})
            </option>
          ))}
        </optgroup>
        {sortedGuests.length > 0 && (
          <optgroup label="Already on the guest list">
            {sortedGuests.map((g) => (
              <option key={g.id} value={encodePartnerPick({ guestId: g.id })}>
                {fullName(g)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </li>
  )
}
