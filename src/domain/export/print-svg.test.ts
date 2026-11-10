import { describe, expect, it } from 'vitest'
import { demoPlan } from '../../../scripts/demo-guests'
import { canvasTour } from '../../../scripts/demo-layouts'
import { addDemoNotes } from '../../../scripts/demo-notes'
import { emptyCanvas, type Canvas, type ChairRow, type Item } from '../canvas-schema'
import { generateSeatingBlock } from '../ceremony'
import { labelsOverlap, type LabelName, type MeasureText } from '../labels'
import { makeItem } from '../presets'
import { textWidthEm } from '../text-fit'
import { escapeXml, MIN_PRINT_NAME_PT, PAPER, renderPrintPlan, type PrintPlanInput } from './print-svg'

const measure: MeasureText = (text, size) => textWidthEm(text) * size

function idMaker(prefix: number): () => string {
  let i = 0
  return () => `00000000-0000-4000-${String(prefix).padStart(4, '0')}-${String(++i).padStart(12, '0')}`
}

const guestId = (i: number) => `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`

/** The seed's "Canvas tour": every preset, the demo guests seated by table number, and the demo notes. */
function seededTour(): { canvas: Canvas; names: Map<string, LabelName>; seated: string[] } {
  const plan = demoPlan({ tour: 'Canvas tour', planA: 'Reception plan A' })
  const names = new Map<string, LabelName>(plan.guests.map((g, i) => [guestId(i), { firstName: g.firstName, lastName: g.lastName }]))
  const tables = plan.seating['Canvas tour']!
  const seated: string[] = []
  let canvas = canvasTour(idMaker(1))
  canvas = {
    ...canvas,
    items: canvas.items.map((item) => {
      if (item.kind !== 'table') return item
      const wanted = tables.find((t) => t.number === item.number)?.guests ?? []
      return {
        ...item,
        seats: item.seats.map((seat, i) => {
          if (wanted[i] === undefined) return seat
          seated.push(guestId(wanted[i]))
          return { ...seat, guestId: guestId(wanted[i]) }
        }),
      }
    }),
  }
  canvas = addDemoNotes(canvas, idMaker(2), Date.UTC(2026, 10, 1))
  return { canvas, names, seated }
}

function input(overrides: Partial<PrintPlanInput> = {}): PrintPlanInput {
  const { canvas, names } = seededTour()
  return { canvas, names, detail: 'names', notes: true, paper: 'tabloid', title: 'Canvas tour', subtitle: 'Demo wedding', date: 'Printed Nov 10, 2026', measure, ...overrides }
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('renderPrintPlan', () => {
  it('draws with plain attributes only: no class, no style and no CSS variables', () => {
    for (const detail of ['names', 'initials', 'tables'] as const) {
      const { svg } = renderPrintPlan(input({ detail }))
      expect(svg).not.toMatch(/\sclass=/)
      expect(svg).not.toMatch(/\sstyle=/)
      expect(svg).not.toContain('var(')
      expect(svg).not.toContain('<style')
      expect(svg).not.toContain('dominant-baseline')
    }
  })

  it('fits a landscape page with margins, a title and a date', () => {
    for (const paper of ['letter', 'tabloid'] as const) {
      const plan = renderPrintPlan(input({ paper }))
      const { width, height } = PAPER[paper]
      expect(plan.width).toBe(width)
      expect(plan.height).toBe(height)
      expect(width).toBeGreaterThan(height)
      expect(plan.svg).toContain(`viewBox="0 0 ${width} ${height}"`)
      expect(plan.svg).toContain(`width="${PAPER[paper].widthIn}in"`)
      expect(plan.svg).toContain('>Canvas tour</text>')
      expect(plan.svg).toContain('>Printed Nov 10, 2026</text>')
    }
    expect(renderPrintPlan(input({ paper: 'tabloid' })).scale).toBeGreaterThan(renderPrintPlan(input({ paper: 'letter' })).scale)
  })

  it('prints each seated guest once, at every level that shows guests', () => {
    const { seated } = seededTour()
    expect(seated.length).toBeGreaterThan(30)
    for (const detail of ['names', 'initials'] as const) {
      for (const paper of ['letter', 'tabloid'] as const) {
        const plan = renderPrintPlan(input({ detail, paper }))
        for (const id of seated) expect(count(plan.svg, `data-guest="${id}"`), `${id} at ${detail} on ${paper}`).toBe(1)
        expect(plan.names).toHaveLength(seated.length)
        expect(new Set(plan.names.map((p) => p.guestId)).size).toBe(seated.length)
      }
    }
    const tables = renderPrintPlan(input({ detail: 'tables' }))
    expect(tables.svg).not.toContain('data-guest=')
    expect(tables.names).toEqual([])
    // Table names and counts still print.
    expect(tables.svg).toContain('>Table 3</text>')
  })

  it('prints full names whole and once each on Tabloid', () => {
    const plan = renderPrintPlan(input({ paper: 'tabloid' }))
    const full = plan.names.filter((p) => p.form === 'full')
    expect(full.length).toBeGreaterThan(plan.names.length / 2)
    for (const p of full) expect(count(plan.svg, `>${escapeXml(p.text)}</text>`), p.text).toBe(1)
  })

  it('never prints a name under 6 pt, and no two name boxes overlap in the seeded layout', () => {
    for (const paper of ['letter', 'tabloid'] as const) {
      const plan = renderPrintPlan(input({ paper }))
      for (const p of plan.names) expect(p.fontPt, `${p.text} on ${paper}`).toBeGreaterThanOrEqual(MIN_PRINT_NAME_PT - 1e-6)
      const shown = plan.tableLabels.filter((l) => l.form !== 'initials')
      expect(shown.length).toBeGreaterThan(0)
      for (let i = 0; i < shown.length; i++) {
        for (let j = i + 1; j < shown.length; j++) {
          expect(labelsOverlap(shown[i], shown[j]), `${shown[i].text} and ${shown[j].text} on ${paper}`).toBe(false)
        }
      }
    }
  })

  it('squeezes more names on Letter than on Tabloid', () => {
    const letter = renderPrintPlan(input({ paper: 'letter' }))
    const tabloid = renderPrintPlan(input({ paper: 'tabloid' }))
    expect(letter.squeezed).toBeGreaterThanOrEqual(tabloid.squeezed)
    expect(letter.squeezed).toBeGreaterThan(0)
  })

  it('leaves the notes out when they are off', () => {
    const on = renderPrintPlan(input({ notes: true })).svg
    const off = renderPrintPlan(input({ notes: false })).svg
    // Sticky notes' paper (yellow and pink) and a note's words.
    expect(on).toContain('#fef08a')
    expect(on).toContain('#fbcfe8')
    expect(on).toContain('mic')
    expect(off).not.toContain('#fef08a')
    expect(off).not.toContain('#fbcfe8')
    expect(off).not.toContain('mic')
  })

  it('escapes names and titles', () => {
    const t = makeItem('round', { x: 0, y: 0 }, 'tt', emptyCanvas())
    const table = { ...(t as Extract<Item, { kind: 'table' }>), seats: t.kind === 'table' ? t.seats.map((s, i) => (i === 0 ? { ...s, guestId: guestId(1) } : s)) : [] }
    const plan = renderPrintPlan({
      ...input(),
      canvas: { ...emptyCanvas(), items: [table] },
      names: new Map([[guestId(1), { firstName: '<Ann>', lastName: '& "Bo"' }]]),
      title: 'A & B <plan>',
    })
    expect(plan.svg).not.toContain('<Ann>')
    expect(plan.svg).not.toContain('<plan>')
    expect(plan.svg).toContain('A &amp; B &lt;plan&gt;')
    expect(plan.svg).toContain('&lt;Ann&gt;')
  })

  it('prints ceremony rows: names or initials beside each named chair, the reserved label, and the side label', () => {
    const rows = generateSeatingBlock({ rows: 3, chairsPerRow: 6, origin: { x: 0, y: 0 } }, idMaker(3))
    const names = new Map<string, LabelName>([
      [guestId(1), { firstName: 'Zoë', lastName: 'Shapiro' }],
      [guestId(2), { firstName: 'Łukasz', lastName: 'Nowak' }],
    ])
    const first: ChairRow = { ...rows[0]!, reservedFor: 'Family, row 1' }
    const second: ChairRow = { ...rows[1]!, seats: rows[1]!.seats.map((s, i) => (i < 2 ? { ...s, guestId: guestId(i + 1) } : s)) }
    const canvas: Canvas = { ...emptyCanvas(), items: [first, second, ...rows.slice(2)] }
    for (const detail of ['names', 'initials'] as const) {
      const plan = renderPrintPlan({ ...input(), canvas, names, detail })
      expect(plan.svg).toContain('Family, row 1')
      expect(plan.svg).toContain('Noa&#39;s side')
      expect(count(plan.svg, `data-guest="${guestId(1)}"`)).toBe(1)
      expect(count(plan.svg, `data-guest="${guestId(2)}"`)).toBe(1)
    }
  })

  it('says so on an empty plan', () => {
    const plan = renderPrintPlan({ ...input(), canvas: emptyCanvas() })
    expect(plan.svg).toContain('Nothing on this plan yet.')
    expect(plan.names).toEqual([])
  })
})
