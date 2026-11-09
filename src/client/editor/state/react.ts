/**
 * React access to one open layout's editor state (see index.ts). Every hook
 * reads through useSyncExternalStore with a selector, so a component
 * re-renders only when what it reads changes.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react'
import type { Canvas, Item } from '@/domain/canvas-schema'
import type { DetailLevel } from '@/domain/detail-level'
import { useDetailLevel as useCameraDetailLevel, useZoomText as useCameraZoomText } from '../camera/hooks'
import type { ViewState } from './device-view'
import type { EditorState } from './index'
import { shallowEqual, useStoreSelector } from './store'
import type { EditorMode, InteractionState, UiState } from './ui-store'

const EditorStateContext = createContext<EditorState | null>(null)

export function EditorStateProvider({ state, children }: { state: EditorState; children?: ReactNode }) {
  return createElement(EditorStateContext.Provider, { value: state }, children)
}

export function useEditorState(): EditorState {
  const state = useContext(EditorStateContext)
  if (!state) throw new Error('useEditorState needs an EditorStateProvider')
  return state
}

export function useUi<U>(selector: (state: UiState) => U, isEqual: (a: U, b: U) => boolean = Object.is): U {
  return useStoreSelector(useEditorState().ui, selector, isEqual)
}

export function useInteraction<U>(selector: (state: InteractionState) => U, isEqual: (a: U, b: U) => boolean = Object.is): U {
  return useStoreSelector(useEditorState().interaction, selector, isEqual)
}

export function useViewState<U>(selector: (state: ViewState) => U, isEqual: (a: U, b: U) => boolean = Object.is): U {
  return useStoreSelector(useEditorState().view, selector, isEqual)
}

export function useMode(): EditorMode {
  return useUi((s) => s.mode)
}

/** Reads the document. Pass shallowEqual when the selector builds a new array or object. */
export function useCanvas<U>(selector: (canvas: Canvas) => U, isEqual: (a: U, b: U) => boolean = Object.is): U {
  const { store } = useEditorState()
  return useStoreSelector(store, (s) => selector(s.canvas), isEqual)
}

const indexes = new WeakMap<readonly Item[], Map<string, Item>>()

/** Items by id, built once per document version, so each item component finds its own item at once. */
export function itemIndex(canvas: Canvas): Map<string, Item> {
  let index = indexes.get(canvas.items)
  if (!index) {
    index = new Map(canvas.items.map((i) => [i.id, i]))
    indexes.set(canvas.items, index)
  }
  return index
}

/** One item: its component re-renders only when that item changes (PLAN section 6, "State and undo"). */
export function useItem(id: string): Item | undefined {
  return useCanvas((canvas) => itemIndex(canvas).get(id))
}

/** The item ids in drawing order; changes only when items are added, removed or reordered. */
export function useItemIds(): readonly string[] {
  return useCanvas((canvas) => canvas.items.map((i) => i.id), shallowEqual)
}

/** The selected items, in selection order. */
export function useSelectedItems(): Item[] {
  const selection = useUi((s) => s.selection)
  return useCanvas((canvas) => {
    const index = itemIndex(canvas)
    return selection.map((id) => index.get(id)).filter((i): i is Item => i !== undefined)
  }, shallowEqual)
}

export function useZoomText(): string {
  return useCameraZoomText(useEditorState().camera)
}

export function useDetailLevel(): DetailLevel {
  return useCameraDetailLevel(useEditorState().camera)
}
