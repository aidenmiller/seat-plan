/**
 * Guest names at close level (spec section 4, "Detail levels"; PLAN section
 * 6, "Name labels"). The labels are laid out by domain/labels.ts for every
 * table at once (each name's box runs to halfway to the next table or wall,
 * at 10 px or more on screen) and kept in a small store that the world
 * SVG's names layer reads, one table at a time.
 *
 * They are worked out when the camera settles at close level with a zoom
 * they were not worked out for, when the plan changes (after a drag ends,
 * never during one), and when the guest list arrives: never on a camera
 * frame. Below close level the last labels stay, hidden by CSS, so zooming
 * in and out across the switch point costs nothing.
 */
import type { Canvas, Item, Table } from '@/domain/canvas-schema'
import { layoutLabels, wallSegments, type MeasureText, type SeatLabel } from '@/domain/labels'
import type { FixedItem } from '@/domain/venue-schema'
import type { CameraController } from '../camera/camera-controller'
import { textWidthEm } from '../render/text-fit'
import { WORLD_FONT } from '../render/style'
import type { EditorDoc } from '../state/editor-doc'
import { createStore, type Store } from '../state/store'
import type { PeopleDirectory } from './people'
import type { SeatingStore } from './store'

export type NameLabelsState = {
  /** Each table's labels, in seat order; a table's list keeps its identity while its labels are the same. */
  byTable: ReadonlyMap<string, readonly SeatLabel[]>
}

export type NameLabels = {
  store: Store<NameLabelsState>
  /** Works the labels out again if anything they depend on changed (the controller does this itself). */
  refresh(): void
  destroy(): void
}

export type NameLabelsDeps = {
  doc: Pick<EditorDoc, 'canvas' | 'gesture' | 'store'>
  camera: Pick<CameraController, 'get' | 'detailLevel' | 'isMoving' | 'subscribeSettle'>
  seating: SeatingStore
  /** The venue template's fixed items: their walls stop names. */
  venueItems: () => readonly FixedItem[]
  measure?: MeasureText
}

const NO_LABELS: readonly SeatLabel[] = Object.freeze([])

/** The browser's own text widths for the world font (canvas measureText), cached by text; a fair estimate where there is no canvas. */
export function browserMeasure(): MeasureText {
  const estimate: MeasureText = (text, size) => textWidthEm(text) * size
  if (typeof document === 'undefined') return estimate
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = document.createElement('canvas').getContext('2d')
  } catch {
    ctx = null
  }
  if (!ctx) return estimate
  const base = 100
  ctx.font = `${base}px ${WORLD_FONT}`
  const cache = new Map<string, number>()
  const c = ctx
  return (text, size) => {
    let w = cache.get(text)
    if (w === undefined) {
      w = c.measureText(text).width / base
      if (cache.size > 5000) cache.clear()
      cache.set(text, w)
    }
    return w * size
  }
}

function sameLabel(a: SeatLabel, b: SeatLabel): boolean {
  return (
    a.seatIndex === b.seatIndex &&
    a.guestId === b.guestId &&
    a.form === b.form &&
    a.text === b.text &&
    a.fontSize === b.fontSize &&
    a.anchor === b.anchor &&
    a.local.x === b.local.x &&
    a.local.y === b.local.y &&
    a.local.rotation === b.local.rotation
  )
}

function sameLabels(a: readonly SeatLabel[], b: readonly SeatLabel[]): boolean {
  return a.length === b.length && a.every((l, i) => sameLabel(l, b[i]))
}

type Inputs = { items: readonly Item[]; people: PeopleDirectory; zoom: number; venue: readonly FixedItem[] }

export function createNameLabels(deps: NameLabelsDeps): NameLabels {
  const store = createStore<NameLabelsState>({ byTable: new Map() })
  let measure: MeasureText | null = deps.measure ?? null
  let last: Inputs | null = null
  let destroyed = false

  function refresh() {
    if (destroyed || deps.camera.detailLevel() !== 'close' || deps.camera.isMoving() || deps.doc.gesture()) return
    const canvas: Canvas = deps.doc.canvas()
    const inputs: Inputs = { items: canvas.items, people: deps.seating.getState().people, zoom: deps.camera.get().zoom, venue: deps.venueItems() }
    const sameVenue = last !== null && (last.venue === inputs.venue || (last.venue.length === 0 && inputs.venue.length === 0))
    if (last && sameVenue && last.items === inputs.items && last.people === inputs.people && last.zoom === inputs.zoom) return
    last = inputs
    measure ??= browserMeasure()
    const tables = canvas.items.filter((i): i is Table => i.kind === 'table')
    const out = layoutLabels({ tables, walls: wallSegments(inputs.venue, canvas.items), zoom: inputs.zoom, measure, names: inputs.people.byId })
    const before = store.getState().byTable
    const next = new Map<string, readonly SeatLabel[]>()
    let changed = before.size !== out.size
    for (const [id, labels] of out) {
      const old = before.get(id)
      if (old && sameLabels(old, labels)) next.set(id, old)
      else {
        next.set(id, labels.length === 0 ? NO_LABELS : labels)
        changed = true
      }
    }
    if (changed) store.setState({ byTable: next })
  }

  const off = [deps.camera.subscribeSettle(refresh), deps.doc.store.subscribe(refresh), deps.seating.subscribe(refresh)]

  return {
    store,
    refresh,
    destroy() {
      destroyed = true
      for (const o of off) o()
    },
  }
}
