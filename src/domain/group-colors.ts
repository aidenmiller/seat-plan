/**
 * Group colors (spec section 7, "Groups"). A fixed palette of 8 colors that
 * are easy to tell apart and each reach at least 4.5:1 against white, so a
 * group ring or swatch reads on the light canvas. None of them is red (the
 * problem color), grey (an empty seat) or the dark blue of a seated guest.
 * A new group takes the palette color fewest groups use, earliest first, so
 * colors cycle through the palette as groups are added.
 */

export const GROUP_COLORS = [
  '#2563EB',
  '#C2410C',
  '#15803D',
  '#9333EA',
  '#DB2777',
  '#0F766E',
  '#A16207',
  '#7C2D12',
] as const

/** Names for a color picker's labels, in palette order. */
export const GROUP_COLOR_NAMES = ['Blue', 'Orange', 'Green', 'Purple', 'Pink', 'Teal', 'Gold', 'Brown'] as const

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** The color for a new group, given the colors the wedding's groups already use (any case). */
export function nextGroupColor(usedColors: readonly string[]): string {
  const counts = new Map<string, number>(GROUP_COLORS.map((c) => [c, 0]))
  for (const color of usedColors) {
    const key = color.toUpperCase()
    const count = counts.get(key)
    if (count !== undefined) counts.set(key, count + 1)
  }
  let best: string = GROUP_COLORS[0]
  for (const color of GROUP_COLORS) if (counts.get(color)! < counts.get(best)!) best = color
  return best
}

/** Colors for several new groups at once, each counting the ones picked before it. */
export function nextGroupColors(usedColors: readonly string[], count: number): string[] {
  const used = [...usedColors]
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const color = nextGroupColor(used)
    out.push(color)
    used.push(color)
  }
  return out
}
