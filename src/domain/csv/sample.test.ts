import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyMapping, guessMapping, SAMPLE_COLUMNS } from './columns'
import { decodeCsvBytes } from './decode'
import { parseCsv } from './parse'
import { SAMPLE_CSV_FILE, SAMPLE_CSV_TEXT, SAMPLE_CSV_URL } from './sample'

const publicFile = path.resolve(import.meta.dirname, '../../../public', SAMPLE_CSV_URL.slice(1))

describe('the sample file', () => {
  it('is checked in at public/samples, byte for byte', () => {
    const bytes = readFileSync(publicFile)
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(bytes.toString('utf8')).toBe(SAMPLE_CSV_FILE)
  })

  it("has the spec's ten columns in order, plus one unknown column", () => {
    const parsed = parseCsv(SAMPLE_CSV_TEXT)
    expect(parsed.errors).toEqual([])
    expect(parsed.headers).toEqual([...SAMPLE_COLUMNS, 'Table wish'])
    expect(parsed.rows).toHaveLength(10)
  })

  it('covers a partner pair, ";"-split groups, accents, a child and the extra column', () => {
    const decoded = decodeCsvBytes(readFileSync(publicFile))
    const parsed = parseCsv(decoded.text, decoded.delimiter)
    const { rows, errors, warnings } = applyMapping(parsed.rows, guessMapping(parsed.headers), parsed.rowNumbers)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(rows.filter((r) => r.partnerName).length).toBeGreaterThanOrEqual(2)
    expect(rows.some((r) => r.groups.length > 1)).toBe(true)
    expect(rows.some((r) => /[^\x00-\x7f]/.test(r.firstName + r.lastName))).toBe(true)
    expect(rows.some((r) => r.isChild)).toBe(true)
    expect(rows.some((r) => r.extraNotes.some((n) => n.startsWith('Table wish: ')))).toBe(true)
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })
})
