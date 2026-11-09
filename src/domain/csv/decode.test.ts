import { describe, expect, it } from 'vitest'
import { decodeCsvBytes, guessLegacyEncoding, legacyScore, stripSepLine } from './decode'

const utf8 = (s: string) => new TextEncoder().encode(s)
const withBom = (bom: number[], body: Uint8Array) => new Uint8Array([...bom, ...body])

function utf16le(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2)
  for (let i = 0; i < s.length; i++) {
    out[i * 2] = s.charCodeAt(i) & 0xff
    out[i * 2 + 1] = s.charCodeAt(i) >> 8
  }
  return out
}

function utf16be(s: string): Uint8Array {
  const le = utf16le(s)
  const out = new Uint8Array(le.length)
  for (let i = 0; i < le.length; i += 2) {
    out[i] = le[i + 1]
    out[i + 1] = le[i]
  }
  return out
}

const TEXT = 'first_name,last_name\r\nZoë,Kowalczyk\r\nŁukasz,Nowak\r\n'

describe('decodeCsvBytes', () => {
  it('reads UTF-8 without a byte order mark', () => {
    expect(decodeCsvBytes(utf8(TEXT))).toEqual({ text: TEXT, encoding: 'utf-8', delimiter: null })
  })

  it('reads UTF-8 with a byte order mark and drops it', () => {
    const r = decodeCsvBytes(withBom([0xef, 0xbb, 0xbf], utf8(TEXT)))
    expect(r.text).toBe(TEXT)
    expect(r.encoding).toBe('utf-8')
  })

  it('takes an ArrayBuffer as well as a Uint8Array', () => {
    const bytes = utf8(TEXT)
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    expect(decodeCsvBytes(buffer).text).toBe(TEXT)
  })

  it('reads Excel "Unicode Text": UTF-16LE with a byte order mark, tab separated', () => {
    const tsv = 'first_name\tlast_name\r\nZoë\tKowalczyk\r\n'
    const r = decodeCsvBytes(withBom([0xff, 0xfe], utf16le(tsv)))
    expect(r.text).toBe(tsv)
    expect(r.encoding).toBe('utf-16le')
  })

  it('reads UTF-16BE with a byte order mark', () => {
    const r = decodeCsvBytes(withBom([0xfe, 0xff], utf16be(TEXT)))
    expect(r.text).toBe(TEXT)
    expect(r.encoding).toBe('utf-16be')
  })

  it('spots UTF-16LE without a byte order mark', () => {
    const r = decodeCsvBytes(utf16le(TEXT))
    expect(r.text).toBe(TEXT)
    expect(r.encoding).toBe('utf-16le')
  })

  it('falls back to Windows-1252 when the bytes are not UTF-8', () => {
    // "Zoë,Renée,€5,“quoted”" in Windows-1252.
    const bytes = new Uint8Array([
      0x5a, 0x6f, 0xeb, 0x2c, 0x52, 0x65, 0x6e, 0xe9, 0x65, 0x2c, 0x80, 0x35, 0x2c, 0x93, 0x71, 0x75, 0x6f, 0x74, 0x65,
      0x64, 0x94,
    ])
    const r = decodeCsvBytes(bytes)
    expect(r.encoding).toBe('windows-1252')
    expect(r.text).toBe('Zoë,Renée,€5,“quoted”')
  })

  it('reads a Mac Roman file ("CSV (Macintosh)") as Mac Roman (review finding)', () => {
    // "Renée,Dubois\nMuñoz,Françoise\nKrämer,Zoë" in Mac Roman: é 0x8E, ñ 0x96, ç 0x8D, ä 0x8A, ë 0x91.
    const ascii = (s: string) => [...new TextEncoder().encode(s)]
    const bytes = new Uint8Array([
      ...ascii('Ren'), 0x8e, ...ascii('e,Dubois\nMu'), 0x96, ...ascii('oz,Fran'), 0x8d, ...ascii('oise\nKr'), 0x8a,
      ...ascii('mer,Zo'), 0x91,
    ])
    const r = decodeCsvBytes(bytes)
    expect(r.encoding).toBe('mac-roman')
    expect(r.text).toBe('Renée,Dubois\nMuñoz,Françoise\nKrämer,Zoë')
    // The same bytes read as Windows-1252 give "RenŽe": the choice in the column step.
    expect(decodeCsvBytes(bytes, { legacy: 'windows-1252' }).text.startsWith('RenŽe')).toBe(true)
  })

  it('one Mac Roman é is enough, and a Windows file with curly quotes and apostrophes stays Windows', () => {
    expect(guessLegacyEncoding(new Uint8Array([0x52, 0x65, 0x6e, 0x8e, 0x65]))).toBe('mac-roman')
    // "O’Brien,“Ann”" and "Ann’s" in Windows-1252.
    const ascii = (s: string) => [...new TextEncoder().encode(s)]
    const windows = new Uint8Array([...ascii('O'), 0x92, ...ascii('Brien,'), 0x93, ...ascii('Ann'), 0x94, ...ascii(',Ann'), 0x92, ...ascii('s')])
    expect(guessLegacyEncoding(windows)).toBe('windows-1252')
    expect(decodeCsvBytes(windows).text).toBe('O’Brien,“Ann”,Ann’s')
    // Bytes both read as letters ("Hašek" or "Haöek") stay Windows-1252, the more common of the two.
    expect(legacyScore(new Uint8Array([0x48, 0x61, 0x9a, 0x65, 0x6b]), 'windows-1252')).toBe(
      legacyScore(new Uint8Array([0x48, 0x61, 0x9a, 0x65, 0x6b]), 'mac-roman'),
    )
    expect(guessLegacyEncoding(new Uint8Array([0x48, 0x61, 0x9a, 0x65, 0x6b]))).toBe('windows-1252')
  })

  it('maps every Mac Roman byte the way the WHATWG "macintosh" decoder does', () => {
    const all = new Uint8Array(256).map((_, i) => i)
    expect(decodeCsvBytes(new Uint8Array([0xff, ...all]), { legacy: 'mac-roman' }).text).toBe(
      new TextDecoder('macintosh').decode(new Uint8Array([0xff, ...all])).normalize('NFC'),
    )
  })

  it('ignores the legacy choice for UTF-8 files', () => {
    expect(decodeCsvBytes(utf8(TEXT), { legacy: 'mac-roman' })).toEqual({ text: TEXT, encoding: 'utf-8', delimiter: null })
  })

  it('strips a sep= line and reports the delimiter', () => {
    const r = decodeCsvBytes(utf8('sep=;\r\nfirst_name;last_name\r\nAnna;Lee\r\n'))
    expect(r.delimiter).toBe(';')
    expect(r.text).toBe('first_name;last_name\r\nAnna;Lee\r\n')
  })

  it('strips a sep= line after a byte order mark', () => {
    const r = decodeCsvBytes(withBom([0xef, 0xbb, 0xbf], utf8('sep=,\nfirst_name,last_name\n')))
    expect(r.delimiter).toBe(',')
    expect(r.text).toBe('first_name,last_name\n')
  })

  it('normalises decomposed accents to composed ones', () => {
    const r = decodeCsvBytes(utf8('Zoë'))
    expect(r.text).toBe('Zoë')
  })

  it('handles an empty file', () => {
    expect(decodeCsvBytes(new Uint8Array())).toEqual({ text: '', encoding: 'utf-8', delimiter: null })
  })
})

describe('stripSepLine', () => {
  it('accepts a quoted sep line and a tab', () => {
    expect(stripSepLine('"sep=;"\na;b')).toEqual({ text: 'a;b', delimiter: ';' })
    expect(stripSepLine('sep=\t\r\na\tb')).toEqual({ text: 'a\tb', delimiter: '\t' })
    expect(stripSepLine('SEP=|')).toEqual({ text: '', delimiter: '|' })
  })

  it('leaves other first lines alone', () => {
    expect(stripSepLine('separator,name\n')).toEqual({ text: 'separator,name\n', delimiter: null })
  })
})
