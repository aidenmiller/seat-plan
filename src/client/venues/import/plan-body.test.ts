import { describe, expect, it } from 'vitest'
import { floorplanImportBody, MAX_IMPORT_LABELS } from '@/shared/api'
import { elapsedText, floorplanBody, planFileKind, scaledDimensionLabels, storedImagePlan, type PlanData } from './plan-body'

const IMAGE_ID = '11111111-1111-4111-8111-111111111111'

function plan(over: Partial<PlanData> = {}): PlanData {
  return {
    width: 2000,
    height: 1000,
    kind: 'vector',
    segments: [{ id: 's1', x1: 10.04, y1: 20, x2: 500.06, y2: 20, thickness: 6.66, source: 'stroke' }],
    texts: [
      { text: '  MAIN   ROOM ', center: { x: 100.123, y: 50 } },
      { text: '   ', center: { x: 0, y: 0 } },
    ],
    doorHints: [{ hinge: { x: 10, y: 10 }, radius: 40, from: { x: 50, y: 10 }, to: { x: 10, y: 50 }, sweep: 90 }],
    dimensionLabels: [{ text: '10 m', valueCm: 1000, from: { x: 0, y: 0 }, to: { x: 1000, y: 0 } }],
    ...over,
  }
}

describe('floorplanBody', () => {
  it('sends a vector page with its lines, text and door swings, rounded, in a body the route accepts', () => {
    const body = floorplanBody(plan(), { id: IMAGE_ID, width: 2000, height: 1000 })
    expect(body.segments).toEqual([{ id: 's1', x1: 10, y1: 20, x2: 500.1, y2: 20, thickness: 6.7, source: 'stroke' }])
    expect(body.labels).toEqual([{ text: 'MAIN ROOM', center: { x: 100.1, y: 50 } }])
    expect(body.doorHints).toHaveLength(1)
    expect(floorplanImportBody.safeParse(body).success).toBe(true)
  })

  it('sends a picture with no lines', () => {
    const body = floorplanBody(plan({ kind: 'raster', segments: [], texts: [], doorHints: [] }), { id: IMAGE_ID, width: 800, height: 600 })
    expect(body).toEqual({ imageId: IMAGE_ID, imageWidth: 800, imageHeight: 600 })
  })

  it('scales everything to the stored image when its size differs', () => {
    const body = floorplanBody(plan(), { id: IMAGE_ID, width: 1000, height: 500 })
    expect(body.segments?.[0]).toMatchObject({ x2: 250, thickness: 3.3 })
    expect(scaledDimensionLabels(plan(), { width: 1000, height: 500 })[0].to).toEqual({ x: 500, y: 0 })
  })

  it('caps the text list', () => {
    const texts = Array.from({ length: MAX_IMPORT_LABELS + 5 }, (_, i) => ({ text: `T${i}`, center: { x: i, y: 0 } }))
    expect(floorplanBody(plan({ texts }), { id: IMAGE_ID, width: 2000, height: 1000 }).labels).toHaveLength(MAX_IMPORT_LABELS)
  })
})

describe('planFileKind', () => {
  it('takes PNG, JPG and PDF by type or name', () => {
    expect(planFileKind({ type: 'application/pdf', name: 'a' })).toBe('pdf')
    expect(planFileKind({ type: '', name: 'Plan.PDF' })).toBe('pdf')
    expect(planFileKind({ type: 'image/jpeg', name: 'a' })).toBe('jpeg')
    expect(planFileKind({ type: '', name: 'scan.jpg' })).toBe('jpeg')
    expect(planFileKind({ type: 'image/png', name: 'a' })).toBe('png')
    expect(planFileKind({ type: 'image/gif', name: 'a.gif' })).toBeNull()
  })
})

describe('elapsedText', () => {
  it('shows minutes and seconds', () => {
    expect(elapsedText(0)).toBe('0:00')
    expect(elapsedText(65_400)).toBe('1:05')
  })
})

describe('storedImagePlan', () => {
  it('runs the import again on the stored picture alone', () => {
    const plan = storedImagePlan({ width: 2576, height: 1800 })
    expect(plan).toMatchObject({ width: 2576, height: 1800, kind: 'raster', source: 'stored', page: null })
    const body = floorplanBody(plan, { id: IMAGE_ID, width: 2576, height: 1800 })
    expect(body).toEqual({ imageId: IMAGE_ID, imageWidth: 2576, imageHeight: 1800 })
    expect(floorplanImportBody.safeParse(body).success).toBe(true)
  })
})
