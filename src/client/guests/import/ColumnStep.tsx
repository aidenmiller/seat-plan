'use client'

/**
 * The column matching step (spec section 6, "Import"): each column of the
 * file with its guessed field, which any column can change (including Add
 * to notes and Ignore), and the first 10 rows as they will be read. A file
 * that is not UTF-8 says which older encoding it was read in, with a choice
 * of the other, since Windows and Mac put accented letters on different bytes.
 */
import { useId } from 'react'
import { primaryButton, secondaryButton } from '@/client/ui/styles'
import { applyMapping, COLUMN_TARGETS, mappingProblems, type ColumnMapping, type ColumnTarget, type ImportRow } from '@/domain/csv/columns'
import { isLegacyEncoding, LEGACY_ENCODINGS, type LegacyEncoding } from '@/domain/csv/decode'
import { sideLabel } from '@/domain/partners'
import { plural } from '@/domain/wording'
import { RSVP_LABEL } from '../options'
import { usePartnerNames } from '../partners-context'
import { sampleValues, type ReadCsv } from './read-file'

const PREVIEW_ROWS = 10

const ENCODING_LABEL: Record<LegacyEncoding, string> = {
  'windows-1252': 'Windows (Excel for Windows)',
  'mac-roman': 'Mac (Excel for Mac, "CSV (Macintosh)")',
}

export function ColumnStep({
  file,
  mapping,
  onMapping,
  onEncoding,
  onBack,
  onNext,
}: {
  file: ReadCsv
  mapping: ColumnMapping
  onMapping(mapping: ColumnMapping): void
  /** Read the file again in the other older encoding. */
  onEncoding?(encoding: LegacyEncoding): void
  onBack(): void
  onNext(): void
}) {
  const encodingId = useId()
  const partners = usePartnerNames()
  const problems = mappingProblems(mapping)
  const preview = applyMapping(file.rows.slice(0, PREVIEW_ROWS), mapping, partners, file.rowNumbers.slice(0, PREVIEW_ROWS))
  const previewRows = new Map(preview.rows.map((r) => [r.rowNumber, r]))
  const previewErrors = new Map(preview.errors.map((e) => [e.rowNumber, e.message]))

  return (
    <div className="space-y-6" data-testid="import-columns">
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h3 className="font-semibold">Match the columns</h3>
        <p className="mt-1 text-sm text-stone-600">
          {file.fileName}: {plural(file.rows.length, 'row')}. Each column fills the field picked for it. First and last name are needed; columns you
          do not need can go into notes or be ignored.
        </p>
        {isLegacyEncoding(file.encoding) && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="import-encoding">
            <p>
              This file is not saved as UTF-8, so its accented letters can read wrong. Check the names below. If letters such as é or ö look
              wrong, read the file as the other kind.
            </p>
            <label htmlFor={encodingId} className="mt-2 block font-medium">
              Read the file as
            </label>
            <select
              id={encodingId}
              value={file.encoding}
              onChange={(e) => onEncoding?.(e.target.value as LegacyEncoding)}
              className="mt-1 block h-11 w-full rounded-lg border border-stone-300 bg-white px-2 text-base outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 sm:w-80 sm:text-sm"
              data-testid="import-encoding-select"
            >
              {LEGACY_ENCODINGS.map((e) => (
                <option key={e} value={e}>
                  {ENCODING_LABEL[e]}
                </option>
              ))}
            </select>
          </div>
        )}
        <ul className="mt-4 divide-y divide-stone-100">
          {file.headers.map((header) => (
            <ColumnRow
              key={header}
              header={header}
              written={file.renamedHeaders[header]}
              samples={sampleValues(file, header)}
              target={mapping[header] ?? 'ignore'}
              onChange={(target) => onMapping({ ...mapping, [header]: target })}
            />
          ))}
        </ul>
        {problems.length > 0 && (
          <ul role="alert" className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-700" data-testid="mapping-problems">
            {problems.map((p) => (
              <li key={p}>{p}.</li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h3 className="font-semibold">First {Math.min(PREVIEW_ROWS, file.rows.length)} rows</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm" data-testid="import-preview">
            <thead className="text-xs uppercase tracking-wide text-stone-600">
              <tr>
                {['Row', 'First name', 'Last name', 'Nickname', 'Partner', 'Household', 'Side', 'Groups', 'RSVP', 'Meal', 'Child', 'Notes'].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {file.rowNumbers.slice(0, PREVIEW_ROWS).map((rowNumber) => {
                const row = previewRows.get(rowNumber)
                const error = previewErrors.get(rowNumber)
                return (
                  <tr key={rowNumber} className="border-t border-stone-100 align-top">
                    <td className="px-2 py-2 text-stone-500">{rowNumber}</td>
                    {row ? <PreviewCells row={row} /> : <td colSpan={11} className="px-2 py-2 text-red-700">{error ?? 'Skipped'}. This row is skipped.</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={secondaryButton} onClick={onBack}>
          Pick another file
        </button>
        <button type="button" className={primaryButton} disabled={problems.length > 0} onClick={onNext} data-testid="import-check">
          Check against the guest list
        </button>
      </div>
    </div>
  )
}

function ColumnRow({
  header,
  written,
  samples,
  target,
  onChange,
}: {
  header: string
  written: string | undefined
  samples: string[]
  target: ColumnTarget
  onChange(target: ColumnTarget): void
}) {
  const id = useId()
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="import-column" data-column={header}>
      <div className="min-w-0">
        <label htmlFor={id} className="block break-words font-medium text-stone-900">
          {header}
          {written !== undefined && written !== '' && written !== header && <span className="font-normal text-stone-500"> (written {written})</span>}
        </label>
        <p className="truncate text-sm text-stone-600">{samples.length > 0 ? samples.join(', ') : 'No values'}</p>
      </div>
      <select
        id={id}
        value={target}
        onChange={(e) => onChange(e.target.value as ColumnTarget)}
        className="block h-11 w-full shrink-0 rounded-lg border border-stone-300 bg-white px-2 text-base outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 sm:w-56 sm:text-sm"
      >
        {COLUMN_TARGETS.map((t) => (
          <option key={t.target} value={t.target}>
            {t.label}
          </option>
        ))}
      </select>
    </li>
  )
}

function PreviewCells({ row }: { row: ImportRow }) {
  const partners = usePartnerNames()
  const notes = [row.notes, ...row.extraNotes].filter(Boolean).join('\n')
  const cell = 'px-2 py-2'
  return (
    <>
      <td className={cell}>{row.firstName}</td>
      <td className={cell}>{row.lastName}</td>
      <td className={cell}>{row.nickname ?? ''}</td>
      <td className={cell}>{row.partnerName ?? ''}</td>
      <td className={cell}>{row.household ?? ''}</td>
      <td className={cell}>{row.side ? sideLabel(partners, row.side) : ''}</td>
      <td className={cell}>{row.groups.join('; ')}</td>
      <td className={cell}>{row.rsvp ? RSVP_LABEL[row.rsvp] : ''}</td>
      <td className={cell}>{row.meal ?? ''}</td>
      <td className={cell}>{row.isChild === undefined ? '' : row.isChild ? 'Yes' : 'No'}</td>
      <td className={`${cell} whitespace-pre-line`}>{notes}</td>
    </>
  )
}
