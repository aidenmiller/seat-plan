import { describe, expect, it } from 'vitest'
import { convertLengthText, formatLength, parseLength } from './units'

describe('formatLength', () => {
  it('shows feet and inches to the nearest inch', () => {
    expect(formatLength(152.4, 'ft')).toBe('5′ 0″')
    expect(formatLength(167.64, 'ft')).toBe('5′ 6″')
    expect(formatLength(20.32, 'ft')).toBe('8″')
    expect(formatLength(0, 'ft')).toBe('0″')
  })

  it('carries 12 rounded inches into a foot', () => {
    // 11.6 in rounds to 12 in, which is 1 ft 0 in.
    expect(formatLength(11.6 * 2.54, 'ft')).toBe('1′ 0″')
  })

  it('shows meters to two decimals', () => {
    expect(formatLength(152.4, 'm')).toBe('1.52 m')
    expect(formatLength(100, 'm')).toBe('1.00 m')
  })

  it('handles negative and non-finite values', () => {
    expect(formatLength(-30.48, 'ft')).toBe('-1′ 0″')
    expect(formatLength(Number.NaN, 'm')).toBe('')
  })
})

describe('parseLength', () => {
  it.each([
    [`5'6"`, 167.64],
    ['5′ 6″', 167.64],
    ['5’ 6”', 167.64],
    [`5' 6`, 167.64],
    ['5 ft 6 in', 167.64],
    ['5 feet 6 inches', 167.64],
    ['5ft', 152.4],
    [`5'`, 152.4],
    ['66in', 167.64],
    ['66"', 167.64],
    [`66''`, 167.64],
    ['1.7m', 170],
    ['1.7 m', 170],
    ['1,7 m', 170],
    ['170cm', 170],
    ['170 CM', 170],
    ['.5 m', 50],
  ])('reads %s', (text, cm) => {
    expect(parseLength(text, 'ft')).toBeCloseTo(cm, 6)
  })

  it('reads a bare number in the given unit', () => {
    expect(parseLength('5', 'ft')).toBeCloseTo(152.4, 6)
    expect(parseLength('1.5', 'm')).toBeCloseTo(150, 6)
  })

  it('refuses anything else', () => {
    for (const text of ['', '   ', 'five feet', '5 yards', '5m6', '-', '1.2.3 m']) {
      expect(parseLength(text, 'ft'), text).toBeNull()
    }
  })

  it('reads back what formatLength wrote', () => {
    for (const cm of [60.96, 152.4, 167.64, 731.52]) {
      expect(parseLength(formatLength(cm, 'ft'), 'ft')).toBeCloseTo(cm, 6)
    }
    expect(parseLength(formatLength(152.4, 'm'), 'm')).toBe(152)
  })
})

describe('convertLengthText', () => {
  it('moves a typed length to the other unit', () => {
    expect(convertLengthText('5′ 0″', 'ft', 'm')).toBe('1.52 m')
    expect(convertLengthText('1.5', 'm', 'ft')).toBe('4′ 11″')
  })

  it('leaves unreadable text alone', () => {
    expect(convertLengthText('abc', 'ft', 'm')).toBe('abc')
  })
})
