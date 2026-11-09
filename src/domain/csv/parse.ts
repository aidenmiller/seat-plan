/**
 * Reads CSV text into headed rows with papaparse. The first non-blank line is
 * the header. Blank lines are skipped but still counted, so each row keeps the
 * row number a spreadsheet shows for it (the header is usually row 1).
 */
import Papa from 'papaparse'
import { stripSepLine } from './decode'

export const MAX_IMPORT_ROWS = 5000
const DELIMITERS = [',', ';', '\t', '|']

export type CsvIssue = { rowNumber: number | null; message: string }

export type ParsedCsv = {
  /** Column names in file order, trimmed and unique. Blank ones become "Column 3". */
  headers: string[]
  /** For each renamed header, the header as written: { "Notes (2)": "Notes" }. */
  renamedHeaders: Record<string, string>
  /** One record per data row, every header present, values trimmed. */
  rows: Record<string, string>[]
  /** The spreadsheet row number of each entry in `rows`. */
  rowNumbers: number[]
  delimiter: string
  /** Problems that stop the import: an empty file, no rows, too many rows. `rows` is empty when there are any. */
  errors: CsvIssue[]
  /** Problems worth showing that do not stop the import, such as an unclosed quote. */
  warnings: CsvIssue[]
}

const isBlankRecord = (record: readonly string[]) => record.every((cell) => cell.trim() === '')

function quoteMessage(code: string): string {
  return code === 'MissingQuotes'
    ? 'A quote mark is never closed, so the rows after it may be wrong'
    : 'A quote mark is in the middle of a cell'
}

export function parseCsv(input: string, delimiterHint?: string | null): ParsedCsv {
  let text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const sep = stripSepLine(text)
  text = sep.text
  // Guess on the first non-blank lines (blank ones throw papaparse's guess
  // off), then read every line, blank ones too, so row numbers stay right.
  const delimiter =
    delimiterHint ||
    sep.delimiter ||
    Papa.parse<string[]>(text, { delimitersToGuess: DELIMITERS, skipEmptyLines: 'greedy', preview: 20 }).meta
      .delimiter ||
    ','
  const result = Papa.parse<string[]>(text, { header: false, delimiter, skipEmptyLines: false })
  const records = result.data
  const empty = (message: string): ParsedCsv => ({
    headers: [],
    renamedHeaders: {},
    rows: [],
    rowNumbers: [],
    delimiter,
    errors: [{ rowNumber: null, message }],
    warnings: [],
  })

  const headerIndex = records.findIndex((r) => !isBlankRecord(r))
  if (headerIndex < 0) return empty('This file is empty')
  const dataIndexes: number[] = []
  for (let i = headerIndex + 1; i < records.length; i++) if (!isBlankRecord(records[i])) dataIndexes.push(i)
  if (dataIndexes.length === 0) return empty('This file has a header row but no guests')
  if (dataIndexes.length > MAX_IMPORT_ROWS) {
    return empty(
      `This file has ${dataIndexes.length.toLocaleString('en-US')} rows. The limit is ${MAX_IMPORT_ROWS.toLocaleString('en-US')}, so split it into smaller files`,
    )
  }

  // Columns: every header cell, plus any column further right that holds data.
  const headerCells = records[headerIndex].map((h) => h.trim())
  let width = headerCells.length
  for (const i of dataIndexes) {
    const r = records[i]
    for (let c = r.length - 1; c >= width; c--) {
      if (r[c].trim() !== '') {
        width = c + 1
        break
      }
    }
  }
  const columns: number[] = []
  for (let c = 0; c < width; c++) {
    const named = (headerCells[c] ?? '') !== ''
    if (named || dataIndexes.some((i) => (records[i][c] ?? '').trim() !== '')) columns.push(c)
  }

  const headers: string[] = []
  const renamedHeaders: Record<string, string> = {}
  const used = new Set<string>()
  for (const c of columns) {
    const written = headerCells[c] ?? ''
    const base = written || `Column ${c + 1}`
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`
    used.add(name.toLowerCase())
    headers.push(name)
    if (name !== written) renamedHeaders[name] = written
  }

  const rows = dataIndexes.map((i) => {
    const record = records[i]
    const row: Record<string, string> = {}
    columns.forEach((c, k) => {
      row[headers[k]] = (record[c] ?? '').trim()
    })
    return row
  })

  const warnings: CsvIssue[] = []
  const seen = new Set<string>()
  for (const e of result.errors) {
    if (e.type !== 'Quotes') continue
    const rowNumber = typeof e.row === 'number' ? e.row + 1 : null
    const message = quoteMessage(e.code)
    const key = `${rowNumber}:${message}`
    if (seen.has(key)) continue
    seen.add(key)
    warnings.push({ rowNumber, message })
  }

  return {
    headers,
    renamedHeaders,
    rows,
    rowNumbers: dataIndexes.map((i) => i + 1),
    delimiter,
    errors: [],
    warnings,
  }
}
