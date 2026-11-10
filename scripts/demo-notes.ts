/**
 * The demo notes for the "Canvas tour" layout (milestone 9; PLAN section 7,
 * "Seed"): sticky notes, text, a box and an arrow, by Noa and by Aiden, in
 * several colors, one marked done. The arrow runs from the bar to table 3
 * and is attached at both ends, so it follows either when it moves.
 *
 * Built from the layout as it is, so it finds the bar, the dance floor, the
 * DJ and table 3 wherever they sit. Anything it cannot find is left out.
 */
import type { Author, Canvas, Item, Note } from '../src/domain/canvas-schema'
import { placeArrowEnd } from '../src/domain/arrows'
import { makeNote, type NoteColor, type NoteType } from '../src/domain/notes'

type Spec = {
  type: NoteType
  at: { x: number; y: number }
  author: Author
  color: NoteColor
  text?: string
  size?: { width: number; height: number }
  done?: boolean
}

function find(canvas: Canvas, test: (item: Item) => boolean): Item | undefined {
  return canvas.items.find(test)
}

/** The canvas with the demo notes added on top, each a minute apart from `start`. */
export function addDemoNotes(canvas: Canvas, newId: () => string, start: number): Canvas {
  const bar = find(canvas, (i) => i.kind === 'fixture' && i.type === 'bar')
  const floor = find(canvas, (i) => i.kind === 'fixture' && i.type === 'danceFloor')
  const dj = find(canvas, (i) => i.kind === 'fixture' && i.type === 'dj')
  const cake = find(canvas, (i) => i.kind === 'fixture' && i.type === 'cake')
  const table3 = find(canvas, (i) => i.kind === 'table' && i.number === 3)

  const specs: Spec[] = []
  if (dj) {
    specs.push({ type: 'sticky', at: { x: dj.x + 230, y: dj.y }, author: 'Noa', color: 'yellow', text: 'Ask the DJ for a mic at the head table' })
  }
  if (floor && floor.kind === 'fixture') {
    specs.push({
      type: 'box',
      at: { x: floor.x, y: floor.y },
      author: 'Noa',
      color: 'green',
      size: { width: floor.width + 90, height: floor.height + 90 },
    })
    specs.push({
      type: 'text',
      at: { x: floor.x, y: floor.y + floor.height / 2 + 75 },
      author: 'Noa',
      color: 'green',
      text: 'Keep 18 in clear round the floor',
      size: { width: 320, height: 40 },
    })
  }
  if (bar) {
    specs.push({ type: 'sticky', at: { x: bar.x, y: bar.y - 300 }, author: 'Aiden', color: 'pink', text: 'The bar line may reach table 3. Move the bar back?' })
  }
  if (cake) {
    specs.push({ type: 'sticky', at: { x: cake.x, y: cake.y + 170 }, author: 'Aiden', color: 'grey', text: 'Check the cake table fits three tiers', done: true })
  }

  let out = canvas
  let minute = 0
  const add = (note: Note) => {
    out = { ...out, items: [...out.items, note] }
  }
  for (const spec of specs) {
    let note = makeNote(spec.type, spec.at, spec.author, spec.color, start + minute++ * 60_000, newId())
    if (spec.text !== undefined) note = { ...note, text: spec.text }
    if (spec.size) note = { ...note, width: spec.size.width, height: spec.size.height }
    if (spec.done) note = { ...note, done: true }
    add(note)
  }
  if (bar && table3) {
    let arrow = makeNote('arrow', { x: (bar.x + table3.x) / 2, y: bar.y }, 'Aiden', 'blue', start + minute * 60_000, newId())
    arrow = placeArrowEnd(arrow, 'start', { x: bar.x, y: bar.y }, bar.id, out)
    arrow = placeArrowEnd(arrow, 'end', { x: table3.x, y: table3.y }, table3.id, out)
    add(arrow)
  }
  return out
}
