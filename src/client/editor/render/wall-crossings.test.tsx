import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { emptyCanvas, type Item } from '@/domain/canvas-schema'
import { makeItem } from '@/domain/presets'
import type { FixedItem } from '@/domain/venue-schema'
import { createDocStore } from '../doc-store'
import { ProblemsPanel } from '../panels/ProblemsPanel'
import { AnalysisProvider, createAnalysis } from '../problems/analysis'
import { createEditorState, EditorStateProvider } from '../state'
import { TableView } from './TableView'
import { crossedTables } from './wall-crossings'

const wall = (x: number): FixedItem => ({
  id: 'w1',
  type: 'wall',
  points: [
    { x, y: -1000 },
    { x, y: 1000 },
  ],
  thickness: 20,
  unsure: false,
  unsureNote: '',
})

function tables(): Item[] {
  return [makeItem('round', { x: 0, y: 0 }, 't1', emptyCanvas()), { ...makeItem('round', { x: 600, y: 0 }, 't2', emptyCanvas()), number: 2, name: 'Table 2' } as Item]
}

/** An editor holding the two tables; TableView reads the seating drag from it. */
function editorState() {
  return createEditorState({
    layoutId: 'L1',
    store: createDocStore({ ...emptyCanvas(), items: tables() }),
    onCommit: () => undefined,
    settings: () => ({ unit: 'ft', minGapCm: 152.4 }),
    storage: null,
    traits: () => ({ width: 1440, touchOnly: false, phone: false }),
  })
}

describe('crossedTables', () => {
  it('finds the tables a wall runs through, once per canvas version', () => {
    const items = tables()
    const venue = [wall(0)]
    const set = crossedTables(items, venue)
    expect([...set]).toEqual(['t1'])
    expect(crossedTables(items, venue)).toBe(set)
    expect(crossedTables(items, []).size).toBe(0)
  })
})

describe('TableView', () => {
  it('draws a red outline and a badge on a table a wall crosses', () => {
    const table = tables()[0] as Extract<Item, { kind: 'table' }>
    const editor = editorState()
    const crossed = renderToStaticMarkup(
      <EditorStateProvider state={editor}>
        <svg>
          <TableView table={table} selected={false} crossed />
        </svg>
      </EditorStateProvider>,
    )
    expect(crossed).toContain('data-wall-crossing="true"')
    expect(crossed).toContain('data-wall-outline=""')
    expect(crossed).toContain('data-wall-badge=""')
    expect(crossed).toContain('Table 1 crosses a wall')
    const clear = renderToStaticMarkup(
      <EditorStateProvider state={editor}>
        <svg>
          <TableView table={table} selected={false} />
        </svg>
      </EditorStateProvider>,
    )
    expect(clear).not.toContain('data-wall-crossing')
  })
})

describe('ProblemsPanel', () => {
  function render(venue: FixedItem[]) {
    const editor = editorState()
    return renderToStaticMarkup(
      <EditorStateProvider state={editor}>
        <AnalysisProvider value={createAnalysis(editor.store, { venue })}>
          <ProblemsPanel />
        </AnalysisProvider>
      </EditorStateProvider>,
    )
  }

  it('says which table crosses a wall', () => {
    const html = render([wall(600)])
    expect(html).toContain('Table 2 crosses a wall')
    expect(html).not.toContain('Table 1 crosses')
  })

  it('keeps the placeholder when nothing is wrong', () => {
    expect(render([wall(5000)])).toContain('data-testid="problems-empty"')
  })
})
