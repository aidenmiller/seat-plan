import { describe, expect, it } from 'vitest'
import { guessMapping } from '@/domain/csv/columns'
import { SAMPLE_CSV_FILE } from '@/domain/csv/sample'
import { readCsvFile, sampleValues } from './read-file'

function picked(name: string, parts: BlobPart[]) {
  const blob = new Blob(parts)
  return { name, size: blob.size, arrayBuffer: () => blob.arrayBuffer() }
}

describe('reading a picked guest file', () => {
  it('reads the sample file, accents and all, and guesses every column', async () => {
    const result = await readCsvFile(picked('guests-sample.csv', [SAMPLE_CSV_FILE]))
    if (!result.ok) throw new Error(result.message)
    expect(result.file.headers[0]).toBe('first_name')
    expect(result.file.rows).toHaveLength(10)
    expect(result.file.rows[0].first_name).toBe('Zoë')
    expect(result.file.rowNumbers[0]).toBe(2)
    expect(result.file.encoding).toBe('utf-8')
    const mapping = guessMapping(result.file.headers)
    expect(mapping.first_name).toBe('first_name')
    expect(mapping['Table wish']).toBe('add_to_notes')
    expect(sampleValues(result.file, 'first_name', 2)).toEqual(['Zoë', 'Łukasz'])
  })

  it('reads an older Excel file in Windows-1252 with semicolons', async () => {
    // "José;García" in Windows-1252: é is 0xE9.
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('first;last\r\nJos'),
      0xe9,
      ...new TextEncoder().encode(';Garc'),
      0xed,
      ...new TextEncoder().encode('a\r\n'),
    ])
    const result = await readCsvFile(picked('old.csv', [bytes]))
    if (!result.ok) throw new Error(result.message)
    expect(result.file.encoding).toBe('windows-1252')
    expect(result.file.delimiter).toBe(';')
    expect(result.file.rows[0]).toEqual({ first: 'José', last: 'García' })
  })

  it('refuses an empty file and one over 5 MB, in plain words', async () => {
    const empty = await readCsvFile(picked('empty.csv', ['']))
    expect(empty).toEqual({ ok: false, message: 'This file is empty.' })
    const big = await readCsvFile({ name: 'big.csv', size: 6 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) })
    expect(big.ok).toBe(false)
  })
})
