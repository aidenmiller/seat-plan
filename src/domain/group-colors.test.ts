import { describe, expect, it } from 'vitest'
import { GROUP_COLORS, GROUP_COLOR_NAMES, HEX_COLOR_RE, nextGroupColor, nextGroupColors } from './group-colors'

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** CIE76 distance in Lab, enough to say two colors look different. */
function lab(hex: string): [number, number, number] {
  const lin = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [lin(1), lin(3), lin(5)]
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

describe('GROUP_COLORS', () => {
  it('has 8 distinct hex colors with a name each', () => {
    expect(GROUP_COLORS).toHaveLength(8)
    expect(GROUP_COLOR_NAMES).toHaveLength(8)
    expect(new Set(GROUP_COLORS).size).toBe(8)
    for (const c of GROUP_COLORS) expect(c).toMatch(HEX_COLOR_RE)
  })

  it('each reaches 4.5:1 against white', () => {
    for (const c of GROUP_COLORS) expect(contrast(c, '#FFFFFF'), c).toBeGreaterThanOrEqual(4.5)
  })

  it('every two colors are far apart', () => {
    for (let i = 0; i < GROUP_COLORS.length; i++) {
      for (let j = i + 1; j < GROUP_COLORS.length; j++) {
        const [p, q] = [lab(GROUP_COLORS[i]), lab(GROUP_COLORS[j])]
        const distance = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
        expect(distance, `${GROUP_COLORS[i]} and ${GROUP_COLORS[j]}`).toBeGreaterThan(25)
      }
    }
  })
})

describe('nextGroupColor', () => {
  it('cycles through the palette as groups are added', () => {
    const used: string[] = []
    for (let i = 0; i < 20; i++) {
      const color = nextGroupColor(used)
      expect(color).toBe(GROUP_COLORS[i % 8])
      used.push(color)
    }
  })

  it('fills a gap a deleted group left, ignoring case and colors outside the palette', () => {
    const used = GROUP_COLORS.filter((_, i) => i !== 3).map((c) => c.toLowerCase())
    expect(nextGroupColor([...used, '#123456'])).toBe(GROUP_COLORS[3])
  })

  it('picks several at once', () => {
    expect(nextGroupColors([GROUP_COLORS[0]], 3)).toEqual([GROUP_COLORS[1], GROUP_COLORS[2], GROUP_COLORS[3]])
    expect(nextGroupColors([], 0)).toEqual([])
  })
})
