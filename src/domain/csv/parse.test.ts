import { describe, expect, it } from 'vitest'
import { MAX_IMPORT_ROWS, parseCsv } from './parse'

describe('parseCsv', () => {
  it('reads headed rows with trimmed headers and values', () => {
    const r = parseCsv(' first_name , last_name \r\n Anna , Lee \r\nTheo,Lee\r\n')
    expect(r.errors).toEqual([])
    expect(r.headers).toEqual(['first_name', 'last_name'])
    expect(r.rows).toEqual([
      { first_name: 'Anna', last_name: 'Lee' },
      { first_name: 'Theo', last_name: 'Lee' },
    ])
    expect(r.rowNumbers).toEqual([2, 3])
    expect(r.delimiter).toBe(',')
  })

  it('handles quotes, commas and line breaks inside cells', () => {
    const r = parseCsv('first_name,last_name,notes\n"Anna","Lee, Jr.","Line one\nLine ""two"""\nTheo,Lee,\n')
    expect(r.rows[0]).toEqual({ first_name: 'Anna', last_name: 'Lee, Jr.', notes: 'Line one\nLine "two"' })
    // The quoted line break keeps the next record on spreadsheet row 3.
    expect(r.rowNumbers).toEqual([2, 3])
  })

  it('skips blank lines but keeps spreadsheet row numbers', () => {
    const r = parseCsv('\n\nfirst_name,last_name\n\nAnna,Lee\n , \nTheo,Lee\n\n')
    expect(r.rows.map((x) => x.first_name)).toEqual(['Anna', 'Theo'])
    expect(r.rowNumbers).toEqual([5, 7])
  })

  it('strips a byte order mark and a sep= line', () => {
    const r = parseCsv('﻿sep=;\nfirst_name;last_name\nAnna;Lee\n')
    expect(r.headers).toEqual(['first_name', 'last_name'])
    expect(r.rows).toEqual([{ first_name: 'Anna', last_name: 'Lee' }])
    expect(r.delimiter).toBe(';')
  })

  it('guesses semicolons, tabs and pipes', () => {
    expect(parseCsv('first;last\nAnna;Lee\nTheo;Lee\n').delimiter).toBe(';')
    expect(parseCsv('first\tlast\nAnna\tLee\nTheo\tLee\n').delimiter).toBe('\t')
    expect(parseCsv('first|last\nAnna|Lee\nTheo|Lee\n').delimiter).toBe('|')
    expect(parseCsv('first;last\nAnna;Lee\n').rows).toEqual([{ first: 'Anna', last: 'Lee' }])
  })

  it('uses the delimiter hint over guessing', () => {
    const r = parseCsv('a;b,c\n1;2,3\n', ',')
    expect(r.headers).toEqual(['a;b', 'c'])
  })

  it('keeps duplicate headers, renamed', () => {
    const r = parseCsv('Notes,first_name,notes,Notes\nA,Anna,B,C\n')
    expect(r.headers).toEqual(['Notes', 'first_name', 'notes (2)', 'Notes (3)'])
    expect(r.renamedHeaders).toEqual({ 'notes (2)': 'notes', 'Notes (3)': 'Notes' })
    expect(r.rows[0]).toEqual({ Notes: 'A', first_name: 'Anna', 'notes (2)': 'B', 'Notes (3)': 'C' })
  })

  it('names blank headers that hold data, and drops empty unnamed columns', () => {
    const r = parseCsv('first_name,,last_name,,\nAnna,x,Lee,,\nTheo,,Lee,,\n')
    expect(r.headers).toEqual(['first_name', 'Column 2', 'last_name'])
    expect(r.rows[0]).toEqual({ first_name: 'Anna', 'Column 2': 'x', last_name: 'Lee' })
  })

  it('adds columns for cells past the last header, and fills short rows', () => {
    const r = parseCsv('first_name,last_name\nAnna,Lee,extra\nTheo\n')
    expect(r.headers).toEqual(['first_name', 'last_name', 'Column 3'])
    expect(r.rows).toEqual([
      { first_name: 'Anna', last_name: 'Lee', 'Column 3': 'extra' },
      { first_name: 'Theo', last_name: '', 'Column 3': '' },
    ])
  })

  it('reports an empty file and a file with no rows', () => {
    expect(parseCsv('').errors).toEqual([{ rowNumber: null, message: 'This file is empty' }])
    expect(parseCsv('\n \n').errors[0].message).toBe('This file is empty')
    const headerOnly = parseCsv('first_name,last_name\n')
    expect(headerOnly.errors[0].message).toBe('This file has a header row but no guests')
    expect(headerOnly.rows).toEqual([])
  })

  it(`refuses more than ${MAX_IMPORT_ROWS} rows with a clear error`, () => {
    const lines = ['first_name,last_name']
    for (let i = 0; i < MAX_IMPORT_ROWS + 1; i++) lines.push(`Guest${i},Lee`)
    const r = parseCsv(lines.join('\n'))
    expect(r.rows).toEqual([])
    expect(r.errors).toEqual([
      { rowNumber: null, message: 'This file has 5,001 rows. The limit is 5,000, so split it into smaller files' },
    ])
  })

  it(`accepts exactly ${MAX_IMPORT_ROWS} rows`, () => {
    const lines = ['first_name,last_name']
    for (let i = 0; i < MAX_IMPORT_ROWS; i++) lines.push(`Guest${i},Lee`)
    const r = parseCsv(lines.join('\n'))
    expect(r.errors).toEqual([])
    expect(r.rows).toHaveLength(MAX_IMPORT_ROWS)
  })

  it('warns about a quote that never closes', () => {
    const r = parseCsv('first_name,last_name\nAnna,"Lee\nTheo,Lee\n')
    expect(r.errors).toEqual([])
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.warnings[0].message).toMatch(/quote/)
  })
})
