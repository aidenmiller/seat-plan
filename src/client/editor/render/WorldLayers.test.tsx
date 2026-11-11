import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Item, type Note, type Table } from '@/domain/canvas-schema'
import { anchorPoint, withEnds } from '@/domain/arrows'
import { makeNote, NOTE_COLOR_PRESETS, NOTE_DONE_OPACITY, NOTE_LINE_CM, type NoteType } from '@/domain/notes'
import { makeItem, type PresetId } from '@/domain/presets'
import { CHAIR_DEPTH_CM, SEAT_EMPTY_COLOR, SEAT_TAKEN_COLOR, seatLocalLayout, SEAT_RADIUS_CM } from '@/domain/seats'
import type { FixedItem } from '@/domain/venue-schema'
import { createDocStore } from '../doc-store'
import { createEditorState, EditorStateProvider } from '../state'
import { NOTE_LINE_MIN_SCREEN_PX, TABLE_STROKE_CM, TABLE_STROKE_MIN_SCREEN_PX, TIGHT_OFFSET_CM, TIGHT_STROKE, TIGHT_STROKE_SCREEN_PX } from './style'
import { isZooming } from './NamesLayer'
import { tightRing } from './TableView'
import { WorldSvg } from './WorldLayers'

const GUEST_A = '11111111-1111-4111-8111-111111111111'
const GUEST_B = '22222222-2222-4222-8222-222222222222'

function item(preset: PresetId, id: string, x = 0, y = 0, items: Item[] = []): Item {
  return makeItem(preset, { x, y }, id, { items })
}

type RenderOptions = {
  venue?: FixedItem[]
  select?: string[]
  hideFurniture?: boolean
  hideNotes?: boolean
  /** A note being typed into. */
  editing?: string
  /** Runs on the editor before rendering: people, seating state, the camera. */
  setup?: (editor: ReturnType<typeof createEditorState>) => void
}

function note(type: NoteType, id: string, patch: Partial<Note> = {}, x = 0, y = 0): Note {
  return { ...makeNote(type, { x, y }, 'Noa', 'pink', Date.UTC(2026, 10, 10), id), ...patch }
}

/** The markup of one item's group, from its opening tag to its closing </g>. */
function itemMarkup(html: string, id: string): string {
  const start = html.indexOf(`data-item-id="${id}"`)
  const open = html.lastIndexOf('<g', start)
  let depth = 0
  const re = /<g[\s>]|<\/g>/g
  re.lastIndex = open
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0] === '</g>' ? -1 : 1
    if (depth === 0) return html.slice(open, m.index + 4)
  }
  return html.slice(open)
}

function render(items: Item[], options: RenderOptions = {}) {
  const editor = createEditorState({
    layoutId: 'L1',
    store: createDocStore({ ...emptyCanvas(), items }),
    onCommit: () => undefined,
    settings: () => ({ unit: 'ft', minGapCm: 152.4 }),
    storage: null,
    traits: () => ({ width: 1440, touchOnly: false, phone: false }),
  })
  editor.loadDevice()
  if (options.select) editor.ui.select(options.select)
  if (options.hideFurniture) editor.view.setLayer('furniture', { visible: false })
  if (options.hideNotes) editor.view.setLayer('notes', { visible: false })
  if (options.editing) editor.ui.beginNoteEdit(options.editing, 'draft')
  options.setup?.(editor)
  return renderToStaticMarkup(
    <EditorStateProvider state={editor}>
      <WorldSvg worldRef={{ current: null }} svgRef={{ current: null }} venue={options.venue ?? []} />
    </EditorStateProvider>,
  )
}

/** Everything inside the world <g>: what an export or print would copy. */
function worldContents(html: string): string {
  return html.slice(html.indexOf('<g '), html.lastIndexOf('</svg>'))
}

describe('WorldSvg', () => {
  it('keeps the test hooks: canvas, data-detail, tables and seat states', () => {
    const t = item('round', 't1') as Table
    t.seats[0] = { index: 0, guestId: GUEST_A }
    t.seats[3] = { index: 3, guestId: GUEST_B }
    const html = render([t, item('square', 't2', 400, 0, [t])])
    expect(html).toContain('data-testid="canvas"')
    expect(html).toMatch(/data-detail="(far|middle|close)"/)
    expect(html.match(/data-kind="table"/g)).toHaveLength(2)
    expect(html).toContain('data-item-id="t1"')
    expect(html.match(/data-seat-state="taken"/g)).toHaveLength(2)
    expect(html.match(/data-seat-state="empty"/g)).toHaveLength(14)
    expect(html).toContain(`fill="${SEAT_TAKEN_COLOR}"`)
    expect(html).toContain(`fill="${SEAT_EMPTY_COLOR}"`)
    expect(html).toContain('aria-label="Floor plan with 2 tables"')
  })

  it('writes the name and a count such as 2/8 in the middle of each table', () => {
    const t = item('round', 't1') as Table
    t.seats[0] = { index: 0, guestId: GUEST_A }
    t.seats[1] = { index: 1, guestId: GUEST_B }
    const html = render([t])
    expect(html).toMatch(/data-table-name="">Table 1</)
    expect(html).toMatch(/data-seat-count="">2\/8</)
  })

  it('marks selected items and every item kind', () => {
    const items = [item('round', 't1'), item('bar', 'f1', 300), item('box', 's1', 600), item('wall', 'w1', 900)]
    const html = render(items, { select: ['f1'] })
    expect(html).toMatch(/data-item-id="f1" data-kind="fixture"[^>]*data-selected="true"/)
    expect(html).not.toMatch(/data-item-id="t1"[^>]*data-selected/)
    expect(html).toContain('data-kind="shape"')
    expect(html).toContain('data-shape-type="wall"')
    expect(html).toContain('data-fixture-icon=""')
  })

  it('outlines a tight table in yellow', () => {
    const tight = { ...(item('round', 't1') as Table), width: 100, height: 100 }
    const roomy = item('round', 't2', 500, 0, [tight])
    const html = render([tight, roomy])
    expect(html).toMatch(/data-item-id="t1"[^>]*data-tight="true"/)
    expect(html).not.toMatch(/data-item-id="t2"[^>]*data-tight/)
    expect(html.match(new RegExp(`stroke="${TIGHT_STROKE}"`, 'g'))).toHaveLength(1)
  })

  it('draws the tight ring outside the seat circles, so the seats never hide it', () => {
    const tight = { ...(item('round', 't1') as Table), width: 100, height: 100 }
    const html = render([tight])
    const r = Number(/<circle r="([\d.]+)"[^>]*data-tight-outline=""/.exec(html)![1])
    const seatReach = Math.max(...seatLocalLayout(tight).map((p) => Math.hypot(p.x, p.y) + SEAT_RADIUS_CM))
    expect(r).toBeCloseTo(seatReach + TIGHT_OFFSET_CM, 6)
    expect(r).toBeCloseTo(50 + CHAIR_DEPTH_CM + TIGHT_OFFSET_CM, 6)
  })

  it('rings a tight rectangle outside its seats on seated sides and outside its edge on the ends', () => {
    // 8 ft by 30 in, no ends, 12 seats: 6 a side at 16 in each.
    const t = { ...(item('rect', 't1') as Table), seatCount: 12, seats: Array.from({ length: 12 }, (_, index) => ({ index, guestId: null })) }
    const ring = tightRing(t)
    expect(ring.kind).toBe('rect')
    if (ring.kind !== 'rect') return
    const seats = seatLocalLayout(t)
    const top = Math.min(...seats.map((p) => p.y - SEAT_RADIUS_CM))
    const bottom = Math.max(...seats.map((p) => p.y + SEAT_RADIUS_CM))
    expect(ring.box.minY).toBeCloseTo(top - TIGHT_OFFSET_CM, 6)
    expect(ring.box.maxY).toBeCloseTo(bottom + TIGHT_OFFSET_CM, 6)
    expect(ring.box.minX).toBeCloseTo(-t.width / 2 - TIGHT_OFFSET_CM, 6)
    expect(ring.box.maxX).toBeCloseTo(t.width / 2 + TIGHT_OFFSET_CM, 6)
    expect(render([t])).toMatch(/<rect[^>]*data-tight-outline=""/)
  })

  it('marks table bodies, so their outline keeps at least 1 px on screen', () => {
    const html = render([item('round', 't1'), item('rect', 't2', 400)])
    expect(html.match(/data-table-body=""/g)).toHaveLength(2)
    expect(html).toMatch(new RegExp(`<circle r="76.2"[^>]*stroke-width="${TABLE_STROKE_CM}" data-table-body=""`))
  })

  it('keeps the tight ring and table outlines at a screen width through --zoom in globals.css', () => {
    const css = readFileSync(path.resolve(import.meta.dirname, '../../../app/globals.css'), 'utf8').replace(/\s+/g, ' ')
    expect(css).toContain(`[data-editor-viewport] [data-tight-outline] { stroke-width: calc(${TIGHT_STROKE_SCREEN_PX}px / var(--zoom, 1)); }`)
    expect(css).toContain(
      `[data-editor-viewport] [data-table-body] { stroke-width: max(${TABLE_STROKE_CM}px, calc(${TABLE_STROKE_MIN_SCREEN_PX}px / var(--zoom, 1))); }`,
    )
  })

  describe('seating (review findings)', () => {
    const people = [
      { id: GUEST_A, firstName: 'Jane', lastName: 'Doe', nickname: null, rsvp: 'yes' as const, partnerId: null, coupleRuleEnabled: true },
      { id: GUEST_B, firstName: 'Bo', lastName: 'Ray', nickname: null, rsvp: 'yes' as const, partnerId: null, coupleRuleEnabled: true },
    ]
    function seated(): Table {
      const t = item('round', 't1') as Table
      t.seats[0] = { index: 0, guestId: GUEST_A }
      t.seats[3] = { index: 3, guestId: GUEST_B }
      return t
    }

    const at = (zoom: number) => (e: ReturnType<typeof createEditorState>) => {
      e.setPeople({ guests: people })
      e.camera.set({ zoom, x: 500, y: 400 }, { immediate: true })
    }

    it('draws only the label set for the level, in a layer of its own after the furniture: names (close), initials (middle), none (far)', () => {
      // Close: full names beside the seats.
      const close = render([seated()], { setup: at(1) })
      expect(close).toMatch(/<g data-layer="names"[^>]*><g data-labels="close">/)
      expect(close.indexOf('data-layer="furniture"')).toBeLessThan(close.indexOf('data-layer="names"'))
      expect(close).toMatch(/data-guest-name="" data-name-for="0" data-name-form="full">Jane Doe</)
      expect(close).toMatch(/data-name-for="3" data-name-form="full">Bo Ray</)
      expect(close).not.toContain('data-labels="middle"')
      // The names layer carries no item ids, and the furniture layer holds no labels.
      const names = close.slice(close.indexOf('data-layer="names"'))
      expect(names).not.toContain('data-item-id')
      const furniture = close.slice(close.indexOf('data-layer="furniture"'), close.indexOf('data-layer="names"'))
      expect(furniture).not.toContain('data-guest-name')
      expect(furniture).not.toContain('data-seat-initials')
      // Middle: white initials centered in each taken seat.
      const middle = render([seated()], { setup: at(0.6) })
      expect(middle).toMatch(/<g data-labels="middle"[^>]*fill="#ffffff"/)
      expect(middle).toMatch(/data-initials-for="0">JD</)
      expect(middle).toMatch(/data-initials-for="3">BR</)
      expect(middle).not.toContain('data-guest-name')
      // Far: neither.
      const far = render([seated()], { setup: at(0.2) })
      expect(far).not.toContain('data-labels=')
      // A + in each empty seat (CSS shows it in Edit mode at middle and close level).
      expect(close.match(/data-seat-plus=""/g)).toHaveLength(6)
      expect(close).not.toMatch(/data-plus-for="0"/)
    })

    it('knows when the view zooms, when no label set is in the page (DECISIONS 83; the browser test checks the page)', () => {
      expect(isZooming({ get: () => ({ zoom: 1.2, x: 0, y: 0 }), drawn: () => ({ zoom: 1, x: 0, y: 0 }) })).toBe(true)
      expect(isZooming({ get: () => ({ zoom: 1, x: 40, y: 0 }), drawn: () => ({ zoom: 1, x: 0, y: 0 }) })).toBe(false)
    })

    it('has no names or initials before the guest list arrives', () => {
      const html = render([seated()])
      expect(html).not.toContain('data-seat-initials')
      expect(html).not.toContain('data-guest-name')
    })

    it('tints tables while a guest is dragged, grows the seat they would land in, and pulses a seat after pan to it', () => {
      const t2 = item('round', 't2', 400, 0) as Table
      const t3 = item('round', 't3', 800, 0) as Table
      const html = render([seated(), t2, t3], {
        setup: (e) => {
          e.seating.store.setState({
            drag: {
              id: 1,
              guestId: GUEST_A,
              text: 'Jane Doe',
              source: 'list',
              from: null,
              pointer: 'mouse',
              target: { kind: 'seat', itemId: 't2', seatIndex: 2, occupant: null },
              targetSeat: { itemId: 't2', seatIndex: 2 },
              tints: new Map([
                ['t1', 'good'],
                ['t2', 'bad'],
                ['t3', 'none'],
              ]),
            },
            pulse: { itemId: 't3', seatIndex: 5, id: 7 },
          })
        },
      })
      expect(html).toMatch(/data-item-id="t1"[^>]*data-drag-tint="good"/)
      expect(html).toMatch(/data-item-id="t2"[^>]*data-drag-tint="bad"/)
      expect(html).not.toMatch(/data-item-id="t3"[^>]*data-drag-tint/)
      expect(html).toMatch(/fill="#dcfce7" stroke="#16a34a"[^>]*data-table-body="" data-drag-tint="good"/)
      expect(html).toMatch(/fill="#fee2e2" stroke="#dc2626"[^>]*data-table-body="" data-drag-tint="bad"/)
      const grown = /<circle[^>]*r="([\d.]+)"[^>]*data-seat-index="2"[^>]*data-drop-target=""/.exec(html)
      expect(Number(grown![1])).toBeCloseTo(SEAT_RADIUS_CM * 1.3, 6)
      expect(html.match(/data-drop-target=""/g)).toHaveLength(1)
      expect(html.match(/data-seat-pulse=""/g)).toHaveLength(1)
      const pulseAt = seatLocalLayout(t3)[5]
      expect(html).toMatch(new RegExp(`<circle cx="${pulseAt.x}" cy="${pulseAt.y}"[^>]*data-seat-pulse=""`))
    })

    it('fades each label set in, and shows the + only in Edit mode at middle and close level, through globals.css', () => {
      const css = readFileSync(path.resolve(import.meta.dirname, '../../../app/globals.css'), 'utf8').replace(/\s+/g, ' ')
      expect(css).toContain('[data-editor-viewport] [data-labels] { animation: labels-in 120ms ease-out; }')
      expect(css).toContain('[data-editor-root][data-mode="edit"]:not([data-guest-drag]) svg[data-detail="middle"]')
      expect(css).toContain('animation: seat-pulse 1000ms ease-out 2 forwards;')
    })
  })

  it('draws the venue layer first, under the furniture', () => {
    const venue: FixedItem[] = [
      { id: 'v1', type: 'wall', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], thickness: 20, unsure: false, unsureNote: '' },
      { id: 'v2', type: 'room', name: 'Main Room', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }], unsure: false, unsureNote: '' },
      { id: 'v3', type: 'door', wallId: null, x: 500, y: 0, rotation: 0, width: 90, swing: 'left', unsure: false, unsureNote: '' },
    ]
    const html = render([item('round', 't1')], { venue })
    expect(html.indexOf('data-layer="venue"')).toBeLessThan(html.indexOf('data-layer="furniture"'))
    expect(html).toContain('data-venue-type="wall"')
    expect(html).toContain('Main Room')
    expect(html).toContain('data-venue-type="door"')
  })

  it('hides a hidden layer', () => {
    const html = render([item('round', 't1')], { hideFurniture: true })
    expect(html).toMatch(/data-layer="furniture" display="none"/)
  })

  it('uses no page CSS inside the world: no class, style or vector-effect', () => {
    const items = [
      item('round', 't1'),
      item('head', 't2', 0, 400),
      item('danceFloor', 'f1', 900),
      item('text', 's1', 0, 800),
      item('door', 's2', 300, 800),
      item('window', 's3', 600, 800),
      item('room', 's4', 900, 900),
      item('line', 's5', 1200, 900),
    ]
    const world = worldContents(render(items))
    expect(world).not.toMatch(/\sclass=/)
    expect(world).not.toMatch(/\sstyle=/)
    expect(world).not.toContain('vector-effect')
    expect(world).not.toContain('currentColor')
    expect(world).toContain('text-rendering="geometricPrecision"')
    expect(world).toMatch(/font-family="[^"]+"/)
  })
})

describe('notes on the plan', () => {
  it('draws notes on their own layer, above the furniture', () => {
    const html = render([note('sticky', 'n1', { text: 'Hi' }), item('round', 't1')])
    expect(html.indexOf('data-layer="furniture"')).toBeLessThan(html.indexOf('data-layer="notes"'))
    expect(html.indexOf('data-item-id="t1"')).toBeLessThan(html.indexOf('data-item-id="n1"'))
    expect(html.slice(html.indexOf('data-layer="notes"'))).toContain('data-item-id="n1"')
  })

  it('draws a whole emoji as the initial of a note by someone with another name', () => {
    const html = itemMarkup(render([note('sticky', 'n1', { text: 'Hi', author: '🎂 Dayna' })]), 'n1')
    expect(html).toMatch(/data-note-author="">🎂<\/text>/)
  })

  it('draws a sticky note as a filled square with its wrapped text and the author initial', () => {
    const html = itemMarkup(render([note('sticky', 'n1', { text: 'Keep Uncle Bob away from the bar' })]), 'n1')
    const color = NOTE_COLOR_PRESETS.pink
    expect(html).toMatch(/data-kind="note" data-note-type="sticky" data-note-color="pink"/)
    expect(html).toMatch(new RegExp(`<rect x="-60" y="-60" width="120" height="120"[^>]*fill="${color.fill}"`))
    expect(html.match(/<tspan /g)!.length).toBeGreaterThan(1)
    expect(html).toContain('Uncle')
    expect(html).toMatch(new RegExp(`text-anchor="end" fill="${color.stroke}"[^>]*data-note-author="">N</text>`))
    expect(html).toContain('text-rendering="geometricPrecision"')
    expect(html).not.toContain('data-note-strike')
    expect(html).not.toMatch(/\sopacity="/)
  })

  it('greys out a done note and strikes through a done sticky note', () => {
    const html = render([note('sticky', 'n1', { text: 'Order cake', done: true }), note('box', 'n2', { done: true }, 400)])
    const sticky = itemMarkup(html, 'n1')
    expect(sticky).toMatch(new RegExp(`data-done="true"[^>]*opacity="${NOTE_DONE_OPACITY}"`))
    expect(sticky).toContain('data-note-strike=""')
    const box = itemMarkup(html, 'n2')
    expect(box).toMatch(new RegExp(`opacity="${NOTE_DONE_OPACITY}"`))
    expect(box).not.toContain('data-note-strike')
  })

  it('draws text in the darker shade, boxes and circles as outlines, in world units', () => {
    const html = render([note('text', 'n1', { text: 'Dance floor' }), note('box', 'n2', {}, 400), note('circle', 'n3', {}, 800)])
    const stroke = NOTE_COLOR_PRESETS.pink.stroke
    expect(itemMarkup(html, 'n1')).toMatch(new RegExp(`<text font-size="18" fill="${stroke}"`))
    expect(itemMarkup(html, 'n2')).toMatch(new RegExp(`<rect [^>]*stroke="${stroke}" stroke-width="${NOTE_LINE_CM}" data-note-line=""`))
    expect(itemMarkup(html, 'n3')).toMatch(new RegExp(`<ellipse rx="75" ry="75"[^>]*stroke="${stroke}" stroke-width="${NOTE_LINE_CM}" data-note-line=""`))
  })

  it('gives an empty text note a dashed box that only the editor shows', () => {
    const html = itemMarkup(render([note('text', 'n1', { text: '' })]), 'n1')
    expect(html).toMatch(/stroke-dasharray="6 4" visibility="hidden" data-note-placeholder=""/)
    expect(html).not.toContain('<text')
  })

  it('draws an arrow with a filled head and a line with none', () => {
    const arrow = withEnds(note('arrow', 'a1'), { x: 0, y: 0 }, { x: 300, y: 0 })
    const line = withEnds(note('line', 'l1'), { x: 0, y: 200 }, { x: 300, y: 200 })
    const html = render([arrow, line])
    const a = itemMarkup(html, 'a1')
    expect(a).toMatch(/<line [^>]*stroke-linecap="round" data-note-line=""/)
    expect(a).toMatch(/<polygon points="[^"]*150,0[^"]*"[^>]*data-arrow-head=""/)
    expect(itemMarkup(html, 'l1')).not.toContain('data-arrow-head')
  })

  it('draws an attached arrow end where it meets its table, so it follows the table', () => {
    const t = item('round', 't1', 1000, 0) as Table
    const arrow = withEnds({ ...note('arrow', 'a1'), attachedTo: { start: null, end: 't1' } }, { x: 0, y: 0 }, { x: 500, y: 0 })
    const html = itemMarkup(render([t, arrow]), 'a1')
    // The stored end (500, 0) is only a fallback: the arrow is drawn to the chair ring of the table at 1000.
    const meets = anchorPoint(t, { x: 0, y: 0 })
    const tip = /<polygon points="([^"]+)"/.exec(html)![1].split(' ')[1].split(',').map(Number)
    const transform = /transform="translate\(([-\d.]+) ([-\d.]+)\)"/.exec(html)!
    expect(Number(transform[1]) + tip[0]).toBeCloseTo(meets.x, 2)
    expect(Number(transform[2]) + tip[1]).toBeCloseTo(meets.y, 2)
  })

  it('leaves out the text of a note being typed into', () => {
    const html = itemMarkup(render([note('sticky', 'n1', { text: 'Old words' })], { editing: 'n1' }), 'n1')
    expect(html).toContain('data-editing="true"')
    expect(html).not.toContain('Old words')
    expect(html).toContain('data-note-author=""')
  })

  it('hides every note when the notes layer is off', () => {
    const html = render([note('sticky', 'n1')], { hideNotes: true })
    expect(html).toMatch(/data-layer="notes" display="none"/)
  })

  it('uses no page CSS inside notes, so print can draw them the same', () => {
    const items: Item[] = [
      note('sticky', 'n1', { text: 'One two three', done: true }),
      note('text', 'n2', { text: '' }, 300),
      note('box', 'n3', {}, 600),
      note('circle', 'n4', {}, 900),
      withEnds(note('arrow', 'n5'), { x: 0, y: 400 }, { x: 300, y: 400 }),
      withEnds(note('line', 'n6'), { x: 0, y: 600 }, { x: 300, y: 600 }),
    ]
    const notes = render(items).split('data-layer="notes"')[1]
    expect(notes).not.toMatch(/\sclass=/)
    expect(notes).not.toMatch(/\sstyle=/)
    expect(notes).not.toContain('var(')
    expect(notes).not.toContain('currentColor')
  })

  it('keeps note lines at least 1 px on screen and shows placeholders through globals.css', () => {
    const css = readFileSync(path.resolve(import.meta.dirname, '../../../app/globals.css'), 'utf8').replace(/\s+/g, ' ')
    expect(css).toContain(
      `[data-editor-viewport] [data-note-line] { stroke-width: max(${NOTE_LINE_CM}px, calc(${NOTE_LINE_MIN_SCREEN_PX}px / var(--zoom, 1))); }`,
    )
    expect(css).toContain('[data-editor-viewport] [data-note-placeholder] { visibility: visible; }')
  })
})
