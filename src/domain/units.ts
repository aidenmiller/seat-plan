/**
 * Lengths are stored in centimeters (DECISIONS 1) and shown in the wedding's
 * unit (DECISIONS 2): feet and inches to the nearest inch (`5′ 6″`), or
 * meters to two decimals (`1.52 m`).
 *
 * Length fields take any of `5'6"`, `5′ 6″`, `5 ft 6 in`, `66in`, `1.7m`,
 * `170cm`, or a bare number in the wedding's unit.
 */

export type LengthUnit = 'ft' | 'm'

export const CM_PER_INCH = 2.54
export const CM_PER_FOOT = 30.48

/** Rounds away float noise (5'6" is 167.64, not 167.64000000000001). */
function clean(cm: number): number {
  return Math.round(cm * 1e6) / 1e6
}

export function formatLength(cm: number, unit: LengthUnit): string {
  if (!Number.isFinite(cm)) return ''
  const sign = cm < 0 ? '-' : ''
  const abs = Math.abs(cm)
  if (unit === 'm') return `${sign}${(abs / 100).toFixed(2)} m`
  const totalInches = Math.round(abs / CM_PER_INCH)
  if (totalInches === 0) return '0″'
  const feet = Math.floor(totalInches / 12)
  const inches = totalInches % 12
  return feet === 0 ? `${sign}${inches}″` : `${sign}${feet}′ ${inches}″`
}

const NUM = String.raw`(\d+(?:\.\d*)?|\.\d+)`
const FEET = String.raw`(?:'|ft|feet|foot)`
const INCHES = String.raw`(?:"|in|inch|inches)`
const feetInches = new RegExp(String.raw`^${NUM}\s*${FEET}\s*(?:${NUM}\s*${INCHES}?)?$`)
const inchesOnly = new RegExp(String.raw`^${NUM}\s*${INCHES}$`)
const meters = new RegExp(String.raw`^${NUM}\s*(?:m|meters?|metres?)$`)
const centimeters = new RegExp(String.raw`^${NUM}\s*(?:cm|centimeters?|centimetres?)$`)
const bare = new RegExp(String.raw`^${NUM}$`)

/** Phone keyboards type curly quotes; people type primes, two apostrophes, or a decimal comma. */
function normalize(text: string): string {
  let s = text.trim().toLowerCase()
  s = s.replace(/[’‘′´`]/g, "'").replace(/[“”″]/g, '"').replace(/''/g, '"')
  if (!s.includes('.')) s = s.replace(/(\d),(\d)/g, '$1.$2')
  return s.replace(/\s+/g, ' ')
}

/** Centimeters, or null when the text is not a length. A bare number is in `unit`. */
export function parseLength(text: string, unit: LengthUnit): number | null {
  const s = normalize(text)
  if (s === '') return null
  let m = feetInches.exec(s)
  if (m) return clean(Number(m[1]) * CM_PER_FOOT + (m[2] === undefined ? 0 : Number(m[2]) * CM_PER_INCH))
  m = inchesOnly.exec(s)
  if (m) return clean(Number(m[1]) * CM_PER_INCH)
  m = meters.exec(s)
  if (m) return clean(Number(m[1]) * 100)
  m = centimeters.exec(s)
  if (m) return clean(Number(m[1]))
  m = bare.exec(s)
  if (m) return clean(Number(m[1]) * (unit === 'm' ? 100 : CM_PER_FOOT))
  return null
}

/** Moves a typed length to another unit, for a field whose unit just changed. Unreadable text stays as it is. */
export function convertLengthText(text: string, from: LengthUnit, to: LengthUnit): string {
  const cm = parseLength(text, from)
  return cm === null ? text : formatLength(cm, to)
}
