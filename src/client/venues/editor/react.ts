/**
 * React access to the template editor (state.ts). Each hook reads through
 * useSyncExternalStore with a selector, so a component re-renders only when
 * what it reads changes.
 */
import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { Camera } from '@/domain/camera'
import type { TemplateDoc } from '@/domain/template-commands'
import type { FixedItem } from '@/domain/venue-schema'
import type { CameraController } from '@/client/editor/camera/camera-controller'
import type { ViewState } from '@/client/editor/state/device-view'
import { useStoreSelector } from '@/client/editor/state/store'
import type { TemplateEditor } from './state'
import type { TemplateInteractionState, TemplateUiState } from './ui-store'

const TemplateEditorContext = createContext<TemplateEditor | null>(null)

export function TemplateEditorProvider({ editor, children }: { editor: TemplateEditor; children?: ReactNode }) {
  return createElement(TemplateEditorContext.Provider, { value: editor }, children)
}

export function useTemplateEditor(): TemplateEditor {
  const editor = useContext(TemplateEditorContext)
  if (!editor) throw new Error('useTemplateEditor needs a TemplateEditorProvider')
  return editor
}

export function useTemplateUi<U>(selector: (state: TemplateUiState) => U, isEqual: (a: U, b: U) => boolean = Object.is): U {
  return useStoreSelector(useTemplateEditor().ui, selector, isEqual)
}

export function useTemplateInteraction<U>(selector: (state: TemplateInteractionState) => U, isEqual: (a: U, b: U) => boolean = Object.is): U {
  return useStoreSelector(useTemplateEditor().interaction, selector, isEqual)
}

export function useTemplateView<U>(selector: (state: ViewState) => U, isEqual: (a: U, b: U) => boolean = Object.is): U {
  return useStoreSelector(useTemplateEditor().view, selector, isEqual)
}

export function useTemplateDoc<U>(selector: (doc: TemplateDoc) => U, isEqual: (a: U, b: U) => boolean = Object.is): U {
  return useStoreSelector(useTemplateEditor().store, (s) => selector(s.canvas), isEqual)
}

const indexes = new WeakMap<readonly FixedItem[], Map<string, FixedItem>>()

function itemIndex(items: readonly FixedItem[]): Map<string, FixedItem> {
  let index = indexes.get(items)
  if (!index) {
    index = new Map(items.map((i) => [i.id, i]))
    indexes.set(items, index)
  }
  return index
}

/** One fixed item; its component re-renders only when it changes. */
export function useFixedItem(id: string): FixedItem | undefined {
  return useTemplateDoc((doc) => itemIndex(doc.items).get(id))
}

/** The camera, re-read on every camera frame: for the screen-space overlay, which follows pans and zooms. */
export function useCameraFrame(camera: CameraController): Camera {
  return useSyncExternalStore(
    camera.subscribeFrame,
    () => camera.get(),
    () => camera.get(),
  )
}
