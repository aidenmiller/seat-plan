import { describe, expect, it } from 'vitest'
import { emptyDraft } from './floorplan/draft-schema'
import type { DimensionLabel } from './floorplan/scale'
import { DEFAULT_WALL_THICKNESS_CM } from './floorplan/to-fixed-items'
import {
  advanceWallCheck,
  agreeingLabelsButton,
  GUESS_WIDTH_CM,
  measuredCm,
  newWallCrossings,
  planScale,
  redrawDraft,
  scaleLabels,
  scaleProblemText,
  takeAgreeingLabels,
  twoPointFactor,
  unsureSummary,
  wallCheckMessage,
} from './template-import'
import type { FixedItem } from './venue-schema'
import type { VenueWallCheck } from '@/shared/api'

const label = (valueCm: number, pixels: number, text = `${valueCm} cm`): DimensionLabel => ({ text, valueCm, from: { x: 0, y: 0 }, to: { x: pixels, y: 0 } })

describe('scaleLabels', () => {
  it('prefers the PDF lines it measured over the model', () => {
    const draft = { ...emptyDraft(), dimension_labels: [{ text: '10 m', value_cm: 1000, from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, unsure: false, unsure_note: '' }] }
    expect(scaleLabels([label(500, 50)], draft)).toEqual([label(500, 50)])
  })

  it('takes the model labels with a value it could read', () => {
    const draft = {
      ...emptyDraft(),
      dimension_labels: [
        { text: '10 m', value_cm: 1000, from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, unsure: false, unsure_note: '' },
        { text: '??', value_cm: 0, from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, unsure: true, unsure_note: 'blurred' },
      ],
    }
    expect(scaleLabels([], draft)).toEqual([{ text: '10 m', valueCm: 1000, from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }])
  })
})

describe('planScale', () => {
  it('confirms the longest labelled line when the labels agree', () => {
    const step = planScale([label(1000, 500), label(400, 201)], 2000)
    expect(step.agreed).toBe(true)
    expect(step.confirm?.label.valueCm).toBe(1000)
    expect(measuredCm(step.confirm!, step.cmPerPx)).toBeCloseTo(1000, -1)
  })

  it('asks for two points when the labels disagree, opening at the larger group', () => {
    const step = planScale([label(1000, 500), label(1000, 500), label(1000, 400)], 2000)
    expect(step.agreed).toBe(false)
    expect(step.cmPerPx).toBeCloseTo(2)
  })

  it('guesses from the image width with no labels', () => {
    const step = planScale([], 1500)
    expect(step.agreed).toBe(false)
    expect(step.cmPerPx).toBe(GUESS_WIDTH_CM / 1500)
    expect(step.consensusConfirm).toBeNull()
    expect(scaleProblemText(step.choice)).toBe('No dimension labels were found on the plan.')
  })

  it('says how far disagreeing labels are apart and offers the ones that agree', () => {
    // Three labels agree on 2 cm a pixel; one was misread (12'-6" read as 21'-6").
    const step = planScale([label(1000, 500), label(600, 300), label(381, 190.5), label(655, 190.5)], 2000)
    expect(step.agreed).toBe(false)
    expect(step.cmPerPx).toBeCloseTo(2)
    expect(scaleProblemText(step.choice)).toBe('The dimension labels differ by 72%. 3 of 4 agree.')
    expect(agreeingLabelsButton(step.choice)).toBe('Use the 3 that agree')
    // The longest agreeing label is the one drawn for the person to confirm.
    expect(step.consensusConfirm?.label.valueCm).toBe(1000)
    const taken = takeAgreeingLabels(step)
    expect(taken).toMatchObject({ agreed: true, cmPerPx: step.cmPerPx })
    expect(taken.confirm).toBe(step.consensusConfirm)
    expect(measuredCm(taken.confirm!, taken.cmPerPx)).toBeCloseTo(1000)
  })

  it('offers nothing to take when no two labels agree', () => {
    const step = planScale([label(1000, 500), label(1000, 400)], 2000)
    expect(step.consensusConfirm).toBeNull()
    expect(scaleProblemText(step.choice)).toBe('The dimension labels differ by 25%. No two of them agree.')
    expect(takeAgreeingLabels(step)).toBe(step)
  })
})

describe('redrawDraft', () => {
  it('redraws at the set scale, keeping sizes that were real centimeters right', () => {
    // A 2000 px picture of a 60 m hall with no labels: the model gave no wall thickness and no door width.
    const ok = { unsure: false, unsure_note: '' }
    const draft = {
      ...emptyDraft(),
      walls: [{ id: 'w1', segment_ids: [], points: [{ x: 100, y: 500 }, { x: 1900, y: 500 }], thickness_px: 0, ...ok }],
      doors: [{ position: { x: 1000, y: 500 }, width_px: 0, rotation: 0, wall_id: 'w1', segment_ids: [], swing: 'left' as const, ...ok }],
    }
    const guess = GUESS_WIDTH_CM / 2000
    const first = redrawDraft({ draft, segments: [] }, guess, () => crypto.randomUUID())
    const wallOf = (items: FixedItem[]) => items.find((i): i is Extract<FixedItem, { type: 'wall' }> => i.type === 'wall')!
    const doorOf = (items: FixedItem[]) => items.find((i): i is Extract<FixedItem, { type: 'door' }> => i.type === 'door')!
    expect(wallOf(first.doc.items).thickness).toBe(DEFAULT_WALL_THICKNESS_CM)

    // The person measures the wall (27 m at the guess) and types 54 m: twice the guess.
    const set = redrawDraft({ draft, segments: [] }, guess * 2, () => crypto.randomUUID())
    const w = wallOf(set.doc.items)
    expect(w.points[1].x - w.points[0].x).toBeCloseTo(5400)
    expect(w.thickness).toBe(DEFAULT_WALL_THICKNESS_CM)
    expect(doorOf(set.doc.items).width).toBe(90)
    expect(set.doc.reference).toMatchObject({ scaleCmPerPx: guess * 2, offsetX: 0, offsetY: 0 })
  })
})

describe('twoPointFactor', () => {
  it('is the real distance over the measured one', () => {
    expect(twoPointFactor({ x: 0, y: 0 }, { x: 300, y: 400 }, 1000)).toBe(2)
    expect(twoPointFactor({ x: 0, y: 0 }, { x: 0, y: 0 }, 1000)).toBeNull()
    expect(twoPointFactor({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toBeNull()
  })
})

describe('wall checks', () => {
  const use = (layoutId: string, tables: string[]) => ({
    weddingId: 'w',
    weddingName: 'Noa and Aiden',
    layoutId,
    layoutName: `Layout ${layoutId}`,
    tables: tables.map((t) => ({ tableId: t, label: `Table ${t}`, wallIds: ['x'] })),
  })

  it('lists only crossings that are new since the editor opened', () => {
    const before: VenueWallCheck = { templateVersion: 1, layouts: [use('a', ['1']), use('b', [])] }
    const after: VenueWallCheck = { templateVersion: 2, layouts: [use('a', ['1', '2']), use('b', ['3'])] }
    const fresh = newWallCrossings(before, after)
    expect(fresh.map((l) => [l.layoutId, l.tables.map((t) => t.tableId)])).toEqual([
      ['a', ['2']],
      ['b', ['3']],
    ])
    expect(wallCheckMessage(fresh)).toBe('This change puts a wall through 2 tables in 2 layouts')
  })

  it('compares each save with the one before, so an unrelated save says nothing again', () => {
    const opened: VenueWallCheck = { templateVersion: 1, layouts: [use('a', [])] }
    const first = advanceWallCheck(opened, { templateVersion: 2, layouts: [use('a', ['4'])] })
    expect(wallCheckMessage(first.fresh)).toBe('This change puts a wall through 1 table in 1 layout')
    // A door width change: Table 4 is still crossed, but not by this change.
    const second = advanceWallCheck(first.baseline, { templateVersion: 3, layouts: [use('a', ['4'])] })
    expect(second.fresh).toEqual([])
    expect(second.baseline.templateVersion).toBe(3)
  })

  it('reports nothing while the check from when the editor opened is unknown', () => {
    const step = advanceWallCheck(null, { templateVersion: 2, layouts: [use('a', ['1'])] })
    expect(step.fresh).toEqual([])
    expect(step.baseline.templateVersion).toBe(2)
  })

  it('says nothing when no table is crossed', () => {
    expect(wallCheckMessage(newWallCrossings(null, { templateVersion: 1, layouts: [use('a', [])] }))).toBeNull()
    expect(wallCheckMessage([use('a', ['1', '2'])])).toBe('This change puts a wall through 2 tables in 1 layout')
  })

  it('counts items to check', () => {
    expect(unsureSummary(0)).toBe('Nothing marked unsure.')
    expect(unsureSummary(3)).toBe('3 items to check')
  })
})
