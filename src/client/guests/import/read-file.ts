/**
 * Reads a picked guest file in the browser: size check, then decode
 * (src/domain/csv/decode.ts: UTF-8, UTF-16, Windows-1252 or Mac Roman,
 * Excel's "sep=" line), then parse (src/domain/csv/parse.ts). The bytes are
 * kept, so a file in an older encoding can be read again in the other one
 * (rereadCsv). Nothing is sent anywhere.
 */
import { decodeCsvBytes, MAX_CSV_BYTES, type CsvEncoding, type LegacyEncoding } from '@/domain/csv/decode'
import { parseCsv, type CsvIssue } from '@/domain/csv/parse'

export type ReadCsv = {
  fileName: string
  headers: string[]
  /** Headers the parser renamed, to the name written in the file. */
  renamedHeaders: Record<string, string>
  rows: Record<string, string>[]
  rowNumbers: number[]
  encoding: CsvEncoding
  delimiter: string
  warnings: CsvIssue[]
  /** The file as picked, for reading it again in another encoding. */
  bytes: ArrayBuffer
}

export type ReadCsvResult = { ok: true; file: ReadCsv } | { ok: false; message: string }

/** Anything with a name, a size and its bytes: a File, or a Blob in tests. */
export type PickedFile = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }

export async function readCsvFile(file: PickedFile): Promise<ReadCsvResult> {
  if (file.size > MAX_CSV_BYTES) {
    return { ok: false, message: 'This file is over 5 MB. A guest list that big will not fit; split it into smaller files.' }
  }
  let bytes: ArrayBuffer
  try {
    bytes = await file.arrayBuffer()
  } catch {
    return { ok: false, message: 'Could not read this file. Try picking it again.' }
  }
  return decodeAndParse(file.name, bytes)
}

/** The same file read again in the other older encoding (only files that are not UTF-8 or UTF-16 change). */
export function rereadCsv(file: ReadCsv, legacy: LegacyEncoding): ReadCsvResult {
  return decodeAndParse(file.fileName, file.bytes, legacy)
}

function decodeAndParse(fileName: string, bytes: ArrayBuffer, legacy?: LegacyEncoding): ReadCsvResult {
  const decoded = decodeCsvBytes(bytes, { legacy })
  const parsed = parseCsv(decoded.text, decoded.delimiter)
  if (parsed.errors.length > 0) return { ok: false, message: `${parsed.errors[0].message}.` }
  return {
    ok: true,
    file: {
      fileName,
      headers: parsed.headers,
      renamedHeaders: parsed.renamedHeaders,
      rows: parsed.rows,
      rowNumbers: parsed.rowNumbers,
      encoding: decoded.encoding,
      delimiter: parsed.delimiter,
      warnings: parsed.warnings,
      bytes,
    },
  }
}

/** Up to `count` filled values of a column, for the matching step ("Zoë, Łukasz"). */
export function sampleValues(file: Pick<ReadCsv, 'rows'>, header: string, count = 3): string[] {
  const out: string[] = []
  for (const row of file.rows) {
    const v = row[header]?.trim()
    if (v) out.push(v.length > 40 ? `${v.slice(0, 39)}…` : v)
    if (out.length >= count) break
  }
  return out
}
