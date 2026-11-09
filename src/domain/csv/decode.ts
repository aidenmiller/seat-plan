/**
 * Turns the bytes of an uploaded guest file into text. Handles what Excel and
 * other spreadsheets write: UTF-8 with or without a byte order mark, UTF-16
 * ("Unicode Text", tab separated, always with a byte order mark), and, when
 * the bytes are not valid UTF-8, one of the two older single-byte encodings:
 * Windows-1252 (Excel for Windows, "CSV (Comma delimited)") or Mac Roman
 * (Excel for Mac, "CSV (Macintosh)"). The two put accented letters on
 * different bytes, so the one whose letters read more like names is picked
 * (guessLegacyEncoding), and the import's column step shows which one was
 * used with a choice of the other. Also strips Excel's "sep=;" first line and
 * reports the delimiter it names.
 */

/** The two single-byte encodings a file that is not UTF-8 may be in. */
export type LegacyEncoding = 'windows-1252' | 'mac-roman'
export type CsvEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | LegacyEncoding

export const LEGACY_ENCODINGS: readonly LegacyEncoding[] = ['windows-1252', 'mac-roman']

export const isLegacyEncoding = (encoding: CsvEncoding): encoding is LegacyEncoding =>
  encoding === 'windows-1252' || encoding === 'mac-roman'

export type DecodedCsv = {
  /** NFC-normalised text, with no byte order mark and no "sep=" line. */
  text: string
  encoding: CsvEncoding
  /** The delimiter a "sep=" line named, or null. */
  delimiter: string | null
}

/** Bigger files are refused before reading: 5,000 guests fit in well under 2 MB. */
export const MAX_CSV_BYTES = 5 * 1024 * 1024

/** Windows-1252 bytes 0x80 to 0x9F. The five unused bytes map to the same code point, as browsers do. */
const CP1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d,
  0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x009d, 0x017e, 0x0178,
]

/** Mac Roman bytes 0x80 to 0xFF, as the WHATWG "macintosh" index maps them. */
const MAC_ROMAN_HIGH = [
  0x00c4, 0x00c5, 0x00c7, 0x00c9, 0x00d1, 0x00d6, 0x00dc, 0x00e1, 0x00e0, 0x00e2, 0x00e4, 0x00e3, 0x00e5, 0x00e7,
  0x00e9, 0x00e8, 0x00ea, 0x00eb, 0x00ed, 0x00ec, 0x00ee, 0x00ef, 0x00f1, 0x00f3, 0x00f2, 0x00f4, 0x00f6, 0x00f5,
  0x00fa, 0x00f9, 0x00fb, 0x00fc, 0x2020, 0x00b0, 0x00a2, 0x00a3, 0x00a7, 0x2022, 0x00b6, 0x00df, 0x00ae, 0x00a9,
  0x2122, 0x00b4, 0x00a8, 0x2260, 0x00c6, 0x00d8, 0x221e, 0x00b1, 0x2264, 0x2265, 0x00a5, 0x00b5, 0x2202, 0x2211,
  0x220f, 0x03c0, 0x222b, 0x00aa, 0x00ba, 0x03a9, 0x00e6, 0x00f8, 0x00bf, 0x00a1, 0x00ac, 0x221a, 0x0192, 0x2248,
  0x2206, 0x00ab, 0x00bb, 0x2026, 0x00a0, 0x00c0, 0x00c3, 0x00d5, 0x0152, 0x0153, 0x2013, 0x2014, 0x201c, 0x201d,
  0x2018, 0x2019, 0x00f7, 0x25ca, 0x00ff, 0x0178, 0x2044, 0x20ac, 0x2039, 0x203a, 0xfb01, 0xfb02, 0x2021, 0x00b7,
  0x201a, 0x201e, 0x2030, 0x00c2, 0x00ca, 0x00c1, 0x00cb, 0x00c8, 0x00cd, 0x00ce, 0x00cf, 0x00cc, 0x00d3, 0x00d4,
  0xf8ff, 0x00d2, 0x00da, 0x00db, 0x00d9, 0x0131, 0x02c6, 0x02dc, 0x00af, 0x02d8, 0x02d9, 0x02da, 0x00b8, 0x02dd,
  0x02db, 0x02c7,
]

/** Code point of every byte, 0 to 255, in each single-byte encoding. */
const BYTE_CODES: Record<LegacyEncoding, Uint16Array> = {
  'windows-1252': Uint16Array.from({ length: 256 }, (_, b) => (b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : b)),
  'mac-roman': Uint16Array.from({ length: 256 }, (_, b) => (b >= 0x80 ? MAC_ROMAN_HIGH[b - 0x80] : b)),
}

function decodeSingleByte(bytes: Uint8Array, encoding: LegacyEncoding): string {
  const table = BYTE_CODES[encoding]
  const parts: string[] = []
  const chunk = 8192
  for (let start = 0; start < bytes.length; start += chunk) {
    const end = Math.min(bytes.length, start + chunk)
    const codes = new Array<number>(end - start)
    for (let i = start; i < end; i++) codes[i - start] = table[bytes[i]]
    parts.push(String.fromCharCode(...codes))
  }
  return parts.join('')
}

const LETTER_RE = /\p{L}/u
const LOWER_RE = /\p{Ll}/u
const UPPER_RE = /\p{Lu}/u
const isLetter = (c: string) => c !== '' && LETTER_RE.test(c)

/**
 * How much one character read from a byte of 0x80 or more looks like part
 * of a name, from the characters beside it: +1 for a letter next to a
 * letter, -1 for a capital straight after a small letter ("RenŽe"), a small
 * letter straight before a capital ("OíBrien"), or a symbol between two
 * letters ("Mu–oz"). The curly apostrophe (O’Brien) counts as nothing.
 */
function charScore(c: string, before: string, after: string): number {
  if (isLetter(c)) {
    if (LOWER_RE.test(before) && UPPER_RE.test(c)) return -1
    if (LOWER_RE.test(c) && UPPER_RE.test(after)) return -1
    return isLetter(before) || isLetter(after) ? 1 : 0
  }
  if (c === '\u2019') return 0
  return isLetter(before) && isLetter(after) ? -1 : 0
}

/** The total of charScore over every byte of 0x80 or more, read in one encoding. */
export function legacyScore(bytes: Uint8Array, encoding: LegacyEncoding): number {
  const table = BYTE_CODES[encoding]
  const char = (i: number) => (i < 0 || i >= bytes.length ? '' : String.fromCharCode(table[bytes[i]]))
  let score = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] < 0x80) continue
    score += charScore(char(i), char(i - 1), char(i + 1))
  }
  return score
}

/**
 * Windows-1252 or Mac Roman for bytes that are not UTF-8. Windows-1252
 * unless Mac Roman reads strictly more like names: a Mac file's "é" is the
 * byte Windows reads as "Ž", so "Renée" scores better as Mac Roman, and a
 * Windows file's "é" is the byte Mac reads as "È".
 */
export function guessLegacyEncoding(bytes: Uint8Array): LegacyEncoding {
  return legacyScore(bytes, 'mac-roman') > legacyScore(bytes, 'windows-1252') ? 'mac-roman' : 'windows-1252'
}

function decodeUtf16(bytes: Uint8Array, bigEndian: boolean): string {
  if (!bigEndian) return new TextDecoder('utf-16le').decode(bytes)
  const swapped = new Uint8Array(bytes.length - (bytes.length % 2))
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    swapped[i] = bytes[i + 1]
    swapped[i + 1] = bytes[i]
  }
  return new TextDecoder('utf-16le').decode(swapped)
}

/**
 * UTF-16 without a byte order mark: in a CSV of Latin names nearly every
 * other byte is zero. Looks at the first 512 bytes.
 */
function sniffUtf16(bytes: Uint8Array): 'le' | 'be' | null {
  const n = Math.min(bytes.length, 512) & ~1
  if (n < 4) return null
  let evenZeros = 0
  let oddZeros = 0
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) evenZeros++
    if (bytes[i + 1] === 0) oddZeros++
  }
  const pairs = n / 2
  if (oddZeros >= pairs * 0.4 && evenZeros <= pairs * 0.05) return 'le'
  if (evenZeros >= pairs * 0.4 && oddZeros <= pairs * 0.05) return 'be'
  return null
}

/**
 * Removes a first line such as `sep=;` (Excel writes it, and reads the
 * delimiter from it) and returns the delimiter it names.
 */
export function stripSepLine(text: string): { text: string; delimiter: string | null } {
  const m = /^"?sep=([^\r\n"])"?[^\r\n]*(?:\r\n|\n|\r|$)/i.exec(text)
  if (!m) return { text, delimiter: null }
  return { text: text.slice(m[0].length), delimiter: m[1] }
}

/**
 * @param options.legacy the single-byte encoding to read with when the bytes
 *   are not UTF-8 or UTF-16; guessed when left out. UTF-8 and UTF-16 files
 *   ignore it.
 */
export function decodeCsvBytes(input: ArrayBuffer | Uint8Array, options: { legacy?: LegacyEncoding } = {}): DecodedCsv {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  let text: string
  let encoding: CsvEncoding
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    text = decodeUtf16(bytes.subarray(2), false)
    encoding = 'utf-16le'
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    text = decodeUtf16(bytes.subarray(2), true)
    encoding = 'utf-16be'
  } else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    // A file marked UTF-8 that is not valid UTF-8 keeps the replacement characters.
    text = new TextDecoder('utf-8').decode(bytes.subarray(3))
    encoding = 'utf-8'
  } else {
    const sniffed = sniffUtf16(bytes)
    if (sniffed) {
      text = decodeUtf16(bytes, sniffed === 'be')
      encoding = sniffed === 'be' ? 'utf-16be' : 'utf-16le'
    } else {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        encoding = 'utf-8'
      } catch {
        encoding = options.legacy ?? guessLegacyEncoding(bytes)
        text = decodeSingleByte(bytes, encoding)
      }
    }
  }
  while (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const sep = stripSepLine(text)
  return { text: sep.text.normalize('NFC'), encoding, delimiter: sep.delimiter }
}
