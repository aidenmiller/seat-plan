'use client'

/**
 * Paste names (spec section 6, DECISIONS 25): one name per line, split into
 * first and last name and shown in a table to fix before saving. A line
 * missing a first or last name blocks saving until it is fixed or removed;
 * a line that looks like two people is flagged, with a Split button when the
 * split is clear and an Add a line button when it is not. Lines that look
 * like someone already on the guest list, or like another line, are marked
 * so a list pasted twice is not quietly added twice. Saving adds everyone in
 * one request, all or nothing.
 *
 * The text and the preview live in the dialog's frame, which stays mounted,
 * so closing it by mistake keeps them; Esc and a tap outside only close it
 * while nothing is typed. Cancel clears it. Back to the text and Check names
 * again with the text unchanged brings back the preview with its fixes.
 */
import { useEffect, useId, useMemo, useState } from 'react'
import { addGuestsBulk, errorMessage } from '@/client/api'
import { randomId } from '@/client/sync/random-id'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { errorClass, inputClass, labelClass, primaryButton, quietButton, secondaryButton } from '@/client/ui/styles'
import { looksLikeTwoPeople, pastedDuplicates, pastedRowError } from '@/domain/guest-list'
import { splitPastedName, splitPastedNames, suggestTwoPeopleSplit, type PersonName } from '@/domain/names'
import { plural } from '@/domain/wording'
import { MAX_GUEST_ROWS, type Guest } from '@/shared/api'

export type PastedRow = { id: string; source: string; firstName: string; lastName: string }

export function rowsFromText(text: string, newId: () => string = randomId): PastedRow[] {
  return splitPastedNames(text).map((p) => ({ id: newId(), source: p.source, firstName: p.firstName, lastName: p.lastName }))
}

/** An empty line to type a name into, under `after` (with its last name, for "Mr and Mrs John Smith"). */
export function blankRowAfter(rows: readonly PastedRow[], after: string | null, newId: () => string = randomId): { rows: PastedRow[]; id: string } {
  const id = newId()
  const at = after === null ? -1 : rows.findIndex((r) => r.id === after)
  const lastName = at >= 0 ? rows[at]!.lastName : ''
  const row = { id, source: '', firstName: '', lastName }
  if (at < 0) return { rows: [...rows, row], id }
  return { rows: [...rows.slice(0, at + 1), row, ...rows.slice(at + 1)], id }
}

export function PasteNamesDialog({
  open,
  weddingId,
  guests,
  onAdded,
  onClose,
}: {
  open: boolean
  weddingId: string
  /** The guest list now, to mark names already on it. */
  guests: readonly PersonName[]
  onAdded(guests: Guest[]): void
  onClose(): void
}) {
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [rows, setRows] = useState<PastedRow[] | null>(null)
  /** The preview left with Back, and the text it was made from. */
  const [kept, setKept] = useState<{ text: string; rows: PastedRow[] } | null>(null)
  const empty = rows === null && text.trim() === ''

  function clear() {
    setText('')
    setRows(null)
    setKept(null)
  }

  return (
    <Dialog open={open} onClose={onClose} title="Paste names" dismissable={!busy && empty} testId="paste-names-dialog">
      {open && (
        <PasteNames
          weddingId={weddingId}
          guests={guests}
          text={text}
          setText={setText}
          rows={rows}
          setRows={setRows}
          kept={kept}
          setKept={setKept}
          onAdded={(added) => {
            clear()
            onAdded(added)
          }}
          onCancel={() => {
            clear()
            onClose()
          }}
          busy={busy}
          setBusy={setBusy}
        />
      )}
    </Dialog>
  )
}

function PasteNames({
  weddingId,
  guests,
  text,
  setText,
  rows,
  setRows,
  kept,
  setKept,
  onAdded,
  onCancel,
  busy,
  setBusy,
}: {
  weddingId: string
  guests: readonly PersonName[]
  text: string
  setText(text: string): void
  rows: PastedRow[] | null
  setRows(update: PastedRow[] | null | ((rows: PastedRow[] | null) => PastedRow[] | null)): void
  kept: { text: string; rows: PastedRow[] } | null
  setKept(kept: { text: string; rows: PastedRow[] } | null): void
  onAdded(guests: Guest[]): void
  onCancel(): void
  busy: boolean
  setBusy(busy: boolean): void
}) {
  const [error, setError] = useState<string | null>(null)
  /** A line just added, to put the cursor in. */
  const [focusId, setFocusId] = useState<string | null>(null)
  const textId = useId()
  const duplicates = useMemo(() => (rows ? pastedDuplicates(rows, guests) : new Map<string, string>()), [rows, guests])

  useEffect(() => {
    if (!focusId) return
    document.querySelector<HTMLInputElement>(`[data-row-id="${focusId}"] input`)?.focus()
  }, [focusId])

  function preview() {
    if (kept && kept.text === text && kept.rows.length > 0) {
      setError(null)
      setRows(kept.rows)
      return
    }
    const next = rowsFromText(text)
    if (next.length === 0) {
      setError('Paste at least one name.')
      return
    }
    if (next.length > MAX_GUEST_ROWS) {
      setError(`Paste at most ${MAX_GUEST_ROWS.toLocaleString('en-US')} names at a time.`)
      return
    }
    setError(null)
    setRows(next)
  }

  function update(id: string, change: Partial<PastedRow>) {
    setRows((list) => list?.map((r) => (r.id === id ? { ...r, ...change } : r)) ?? null)
  }

  function remove(id: string) {
    setRows((list) => list?.filter((r) => r.id !== id) ?? null)
  }

  function split(row: PastedRow) {
    const pair = suggestTwoPeopleSplit(row.source) ?? suggestTwoPeopleSplit(`${row.firstName} ${row.lastName}`)
    if (!pair) return
    const two = pair.map((line) => {
      const p = splitPastedName(line)
      return { id: randomId(), source: p.source, firstName: p.firstName, lastName: p.lastName }
    })
    setRows((list) => list?.flatMap((r) => (r.id === row.id ? two : [r])) ?? null)
  }

  function addLine(after: string | null) {
    if (!rows) return
    const next = blankRowAfter(rows, after)
    setRows(next.rows)
    setFocusId(next.id)
  }

  const blocking = rows?.filter((r) => pastedRowError(r) !== null).length ?? 0

  async function save() {
    if (!rows || busy || blocking > 0 || rows.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const added = await addGuestsBulk(weddingId, {
        guests: rows.map((r) => ({ id: r.id, firstName: r.firstName.trim(), lastName: r.lastName.trim() })),
      })
      setBusy(false)
      onAdded(added)
    } catch (err) {
      setError(`Could not add them. ${errorMessage(err)}`)
      setBusy(false)
    }
  }

  if (!rows) {
    // Keys keep React from reusing the preview's Back button as this form's
    // submit button: the click that pressed Back would then submit this form.
    return (
      <form
        key="text"
        onSubmit={(e) => {
          e.preventDefault()
          preview()
        }}
        noValidate
      >
        <label htmlFor={textId} className={labelClass}>
          One name per line
        </label>
        <textarea
          id={textId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={'Anna van der Berg\nSmith, John\nJosé García'}
          className={`${inputClass} mt-1 h-auto py-2`}
          data-testid="paste-names-text"
        />
        <p className="mt-1 text-sm text-stone-600">&ldquo;Last, First&rdquo; works too. You can check every name before saving.</p>
        {error && (
          <p role="alert" className={`${errorClass} mt-2`}>
            {error}
          </p>
        )}
        <DialogActions>
          <button type="button" className={secondaryButton} onClick={onCancel} data-testid="paste-names-cancel">
            Cancel
          </button>
          <button type="submit" className={primaryButton} data-testid="paste-names-preview">
            Check names
          </button>
        </DialogActions>
      </form>
    )
  }

  const marked = rows.filter((r) => duplicates.has(r.id)).length

  return (
    <form
      key="preview"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      noValidate
    >
      <p className="text-sm text-stone-700" aria-live="polite">
        {plural(rows.length, 'name')} to add.
        {blocking > 0 && <span className="text-red-700"> Fix or remove {plural(blocking, 'line')} first.</span>}
        {marked > 0 && <span className="text-amber-900"> {plural(marked, 'line')} may be on the list already.</span>}
      </p>
      <ol className="mt-3 space-y-3" data-testid="paste-names-rows">
        {rows.map((row, i) => {
          const problem = pastedRowError(row)
          const two = !problem && looksLikeTwoPeople(row)
          const canSplit = two && (suggestTwoPeopleSplit(row.source) ?? suggestTwoPeopleSplit(`${row.firstName} ${row.lastName}`)) !== null
          const duplicate = duplicates.get(row.id)
          return (
            <li key={row.id} className="rounded-lg border border-stone-200 p-2" data-testid="paste-names-row" data-row-id={row.id}>
              <div className="flex items-end gap-2">
                <label className="min-w-0 flex-1 text-xs font-medium text-stone-600">
                  First name
                  <input
                    value={row.firstName}
                    onChange={(e) => update(row.id, { firstName: e.target.value })}
                    aria-invalid={problem === 'Needs a first name' || problem === 'Needs a name' ? true : undefined}
                    aria-label={`First name, line ${i + 1}`}
                    autoComplete="off"
                    className={`${inputClass} mt-0.5`}
                  />
                </label>
                <label className="min-w-0 flex-1 text-xs font-medium text-stone-600">
                  Last name
                  <input
                    value={row.lastName}
                    onChange={(e) => update(row.id, { lastName: e.target.value })}
                    aria-invalid={problem === 'Needs a last name' || problem === 'Needs a name' ? true : undefined}
                    aria-label={`Last name, line ${i + 1}`}
                    autoComplete="off"
                    className={`${inputClass} mt-0.5`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => remove(row.id)}
                  aria-label={`Remove line ${i + 1}`}
                  className={`${quietButton} min-w-11 shrink-0 px-0`}
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              {problem && <p className="mt-1 text-sm text-red-700">{problem}</p>}
              {duplicate && (
                <p className="mt-1 text-sm text-amber-900" data-testid="paste-names-duplicate">
                  {duplicate}. Remove this line if it is the same person.
                </p>
              )}
              {two && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-amber-900">
                  <span>{canSplit ? 'Two people? Split this line.' : 'Two people? Add the second person below.'}</span>
                  {canSplit ? (
                    <button type="button" className={`${secondaryButton} min-h-11`} onClick={() => split(row)}>
                      Split
                    </button>
                  ) : (
                    <button type="button" className={`${secondaryButton} min-h-11`} onClick={() => addLine(row.id)} data-testid="paste-names-add-line">
                      Add a line
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <button type="button" className={`${secondaryButton} mt-3`} onClick={() => addLine(null)} data-testid="paste-names-add-name">
        Add a name
      </button>
      {error && (
        <p role="alert" className={`${errorClass} mt-3`}>
          {error}
        </p>
      )}
      <DialogActions>
        <button type="button" className={secondaryButton} onClick={onCancel} disabled={busy} data-testid="paste-names-cancel">
          Cancel
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => {
            setKept({ text, rows })
            setRows(null)
          }}
          disabled={busy}
        >
          Back
        </button>
        <button type="submit" className={primaryButton} disabled={busy || blocking > 0 || rows.length === 0} data-testid="paste-names-save">
          {busy ? 'Adding…' : `Add ${plural(rows.length, 'guest')}`}
        </button>
      </DialogActions>
    </form>
  )
}
