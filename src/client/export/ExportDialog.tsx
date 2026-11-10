'use client'

/**
 * The Export dialog (spec section 11; PLAN section 7, "Exports"), from the
 * editor's top bar or canvas menu and from each card on the Layouts tab.
 *
 *  - Floor plan: PDF or SVG, the names to show (full names, initials or table
 *    names only), notes on or off (on by default), and Letter or Tabloid
 *    landscape. Tabloid is the default for full names; when Letter would
 *    shorten names to keep them at 6 pt, a hint suggests Tabloid or initials.
 *  - Lists: the table list (PDF and CSV) and escort cards (PDF and CSV) for a
 *    reception; escort cards and the ceremony list (PDF) for a ceremony.
 *
 * The dialog reads the layout when it opens, so an export from the editor
 * holds the plan as it is on screen, saved or not. Files are made in the
 * browser; the PDF code loads only when one is made.
 */
import { useEffect, useMemo, useState } from 'react'
import { errorMessage } from '@/client/api'
import { Segmented, Switch, type SegmentOption } from '@/client/editor/panels/controls'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { errorClass, hintClass, labelClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import type { Canvas } from '@/domain/canvas-schema'
import {
  ceremonyList,
  ceremonyTable,
  escortCsv,
  escortList,
  escortTable,
  exportFileName,
  printedLine,
  tableList,
  tableListCsv,
  tableListTable,
  weddingLine,
  type ListGuest,
} from '@/domain/export/lists'
import { PAPER, renderPrintPlan, type PaperSize, type PrintDetail } from '@/domain/export/print-svg'
import type { LabelName, MeasureText } from '@/domain/labels'
import type { FixedItem } from '@/domain/venue-schema'
import { formatWeddingDate } from '@/domain/wording'
import type { LayoutKind } from '@/shared/api'

/** Everything an export reads. */
export type ExportSource = {
  layoutName: string
  kind: LayoutKind
  canvas: Canvas
  venue: readonly FixedItem[]
  guests: readonly ListGuest[]
  weddingName: string | null
  /** YYYY-MM-DD */
  weddingDate: string | null
}

type Format = 'pdf' | 'svg'

const FORMATS: readonly SegmentOption<Format>[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'svg', label: 'SVG' },
]
const DETAILS: readonly SegmentOption<PrintDetail>[] = [
  { value: 'names', label: 'Full names' },
  { value: 'initials', label: 'Initials' },
  { value: 'tables', label: 'Tables only' },
]
const PAPERS: readonly SegmentOption<PaperSize>[] = [
  { value: 'letter', label: 'Letter' },
  { value: 'tabloid', label: 'Tabloid' },
]

/** Hands the browser a file to save. */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function namesOf(guests: readonly ListGuest[]): Map<string, LabelName> {
  return new Map(guests.map((g) => [g.id, { firstName: g.firstName, lastName: g.lastName }]))
}

export function ExportDialog({ open, onClose, load }: { open: boolean; onClose(): void; load(): ExportSource | Promise<ExportSource> }) {
  return (
    <Dialog open={open} onClose={onClose} title="Export" testId="export-dialog">
      {open && <ExportForm load={load} onClose={onClose} />}
    </Dialog>
  )
}

function ExportForm({ load, onClose }: { load(): ExportSource | Promise<ExportSource>; onClose(): void }) {
  const [source, setSource] = useState<ExportSource | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [measure, setMeasure] = useState<MeasureText | null>(null)
  const [format, setFormat] = useState<Format>('pdf')
  const [detail, setDetail] = useState<PrintDetail>('names')
  const [paper, setPaper] = useState<PaperSize>('tabloid')
  const [paperPicked, setPaperPicked] = useState(false)
  const [notes, setNotes] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The layout as it is now, read once per opening.
  useEffect(() => {
    let live = true
    Promise.resolve()
      .then(load)
      .then((s) => live && setSource(s))
      .catch((err: unknown) => live && setLoadError(`Could not read the layout. ${errorMessage(err)}`))
    return () => {
      live = false
    }
    // Read once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The print font's widths, so names fit the way they will print.
  useEffect(() => {
    let live = true
    void import('./pdf').then(async ({ printMeasure }) => {
      const m = await printMeasure()
      if (live) setMeasure(() => m)
    })
    return () => {
      live = false
    }
  }, [])

  const heading = useMemo(() => {
    if (!source) return null
    return {
      title: source.layoutName,
      subtitle: weddingLine(source.weddingName, source.weddingDate ? formatWeddingDate(source.weddingDate) : null),
      date: printedLine(new Date()),
    }
  }, [source])

  // Would Letter shorten names to keep them at 6 pt? Worked out for the hint.
  const letterSqueezes = useMemo(() => {
    if (!source || !measure || !heading || detail !== 'names' || paper !== 'letter') return false
    return (
      renderPrintPlan({ canvas: source.canvas, venue: source.venue, names: namesOf(source.guests), detail, notes, paper: 'letter', measure, ...heading })
        .squeezed > 0
    )
  }, [source, measure, heading, detail, paper, notes])

  function pickDetail(next: PrintDetail) {
    setDetail(next)
    // Tabloid for full names, Letter otherwise, until a paper is picked by hand.
    if (!paperPicked) setPaper(next === 'names' ? 'tabloid' : 'letter')
  }

  async function run(what: string, make: (s: ExportSource) => Promise<{ blob: Blob; name: string }>) {
    if (!source || busy) return
    setBusy(what)
    setError(null)
    try {
      const { blob, name } = await make(source)
      saveFile(blob, name)
    } catch (err) {
      setError(`Could not make the file. ${errorMessage(err)}`)
    }
    setBusy(null)
  }

  const floorPlan = () =>
    run('plan', async (s) => {
      const pdf = await import('./pdf')
      const m = measure ?? (await pdf.printMeasure())
      const plan = renderPrintPlan({ canvas: s.canvas, venue: s.venue, names: namesOf(s.guests), detail, notes, paper, measure: m, ...heading! })
      if (format === 'svg') return { blob: new Blob([plan.svg], { type: 'image/svg+xml' }), name: exportFileName(s.layoutName, 'floor plan', 'svg') }
      return { blob: await pdf.floorPlanPdf(plan.svg, PAPER[paper], `${s.layoutName} floor plan`), name: exportFileName(s.layoutName, 'floor plan', 'pdf') }
    })

  const csv = (text: string, name: string) => ({ blob: new Blob([text], { type: 'text/csv;charset=utf-8' }), name })
  const ceremony = source?.kind === 'ceremony'

  const tableListPdf = () =>
    run('tables-pdf', async (s) => {
      const { listPdf } = await import('./pdf')
      const t = tableListTable(tableList(s.canvas, s.guests))
      const blob = await listPdf({ ...heading!, title: `${s.layoutName}: table list`, ...t, widths: [1.2, 3, 2] })
      return { blob, name: exportFileName(s.layoutName, 'table list', 'pdf') }
    })
  const tableListCsvFile = () => run('tables-csv', async (s) => csv(tableListCsv(tableList(s.canvas, s.guests)), exportFileName(s.layoutName, 'table list', 'csv')))
  const escortPdf = () =>
    run('escort-pdf', async (s) => {
      const { listPdf } = await import('./pdf')
      const t = escortTable(escortList(s.canvas, s.guests), ceremony)
      const blob = await listPdf({ ...heading!, title: `${s.layoutName}: escort cards`, ...t, widths: ceremony ? [3, 3, 1] : [3, 2] })
      return { blob, name: exportFileName(s.layoutName, 'escort cards', 'pdf') }
    })
  const escortCsvFile = () => run('escort-csv', async (s) => csv(escortCsv(escortList(s.canvas, s.guests), ceremony), exportFileName(s.layoutName, 'escort cards', 'csv')))
  const ceremonyPdf = () =>
    run('ceremony-pdf', async (s) => {
      const { listPdf } = await import('./pdf')
      const t = ceremonyTable(ceremonyList(s.canvas, s.guests))
      const blob = await listPdf({ ...heading!, title: `${s.layoutName}: ceremony list`, ...t, widths: [2, 2, 3] })
      return { blob, name: exportFileName(s.layoutName, 'ceremony list', 'pdf') }
    })

  if (loadError) {
    return (
      <div className="space-y-4">
        <p role="alert" className={errorClass}>
          {loadError}
        </p>
        <DialogActions>
          <button type="button" className={secondaryButton} onClick={onClose}>
            Close
          </button>
        </DialogActions>
      </div>
    )
  }

  const waiting = source === null
  const listButton = `${secondaryButton} w-full`
  return (
    <div className="space-y-5" data-testid="export-form" data-ready={waiting ? undefined : 'true'}>
      <section className="space-y-3" aria-labelledby="export-plan-title">
        <h3 id="export-plan-title" className="text-sm font-semibold text-stone-900">
          Floor plan
        </h3>
        <Segmented label="File" value={format} options={FORMATS} onChange={(next) => setFormat(next)} testId="export-format" />
        <Segmented label="Names" value={detail} options={DETAILS} onChange={pickDetail} testId="export-detail" />
        <Segmented
          label="Paper, landscape"
          value={paper}
          options={PAPERS}
          onChange={(next) => {
            setPaper(next)
            setPaperPicked(true)
          }}
          testId="export-paper"
        />
        {letterSqueezes && (
          <p className={hintClass} data-testid="export-paper-hint">
            Some names are too long for Letter at 6 pt. Try Tabloid, or initials.
          </p>
        )}
        <Switch label="Include notes" checked={notes} onChange={setNotes} testId="export-notes" />
        <button type="button" className={`${primaryButton} w-full`} onClick={floorPlan} disabled={waiting || busy !== null} data-testid="export-plan">
          {busy === 'plan' ? 'Making the file…' : 'Download floor plan'}
        </button>
      </section>

      <section className="space-y-2 border-t border-stone-200 pt-4" aria-labelledby="export-lists-title">
        <h3 id="export-lists-title" className="text-sm font-semibold text-stone-900">
          Lists
        </h3>
        <p className={labelClass}>{ceremony ? 'Escort cards give row and chair.' : 'Guest notes are left out.'}</p>
        <div className="grid grid-cols-2 gap-2">
          {!ceremony && (
            <>
              <button type="button" className={listButton} onClick={tableListPdf} disabled={waiting || busy !== null}>
                Table list PDF
              </button>
              <button type="button" className={listButton} onClick={tableListCsvFile} disabled={waiting || busy !== null}>
                Table list CSV
              </button>
            </>
          )}
          <button type="button" className={listButton} onClick={escortPdf} disabled={waiting || busy !== null}>
            Escort cards PDF
          </button>
          <button type="button" className={listButton} onClick={escortCsvFile} disabled={waiting || busy !== null}>
            Escort cards CSV
          </button>
          {ceremony && (
            <button type="button" className={`${listButton} col-span-2`} onClick={ceremonyPdf} disabled={waiting || busy !== null}>
              Ceremony list PDF
            </button>
          )}
        </div>
      </section>

      {busy !== null && busy !== 'plan' && (
        <p role="status" className={hintClass}>
          Making the file…
        </p>
      )}
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      <DialogActions>
        <button type="button" className={secondaryButton} onClick={onClose}>
          Close
        </button>
      </DialogActions>
    </div>
  )
}
