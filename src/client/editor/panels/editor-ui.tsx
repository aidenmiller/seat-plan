'use client'

/**
 * What the panels need from the page around them, beyond the editor state:
 * the wedding's unit, whether this is the phone layout, and the page's
 * answers to a seat change that needs a yes first and to "show details".
 */
import { createContext, useContext, useSyncExternalStore } from 'react'
import type { LengthUnit } from '@/domain/units'
import type { SeatRequest } from '../input/controller'
import { isPhoneLike, readDeviceTraits } from '../state/mode'

export type EditorUi = {
  unit: LengthUnit
  /** Under 768 px wide or a touch-only device (PLAN change 13). */
  phone: boolean
  /** The layout's name, for the Properties panel with nothing selected. */
  layoutName: string
  /** "Blank canvas", or the venue template's name. */
  venueLabel: string
  /** Handles a seat count change: asks before unseating anyone, then calls confirm(). */
  onSeatRequest(tableId: string, request: SeatRequest): void
  /** Phones: raise the sheet on the Properties tab. Desktops: nothing to do. */
  showDetails(): void
}

const EditorUiContext = createContext<EditorUi | null>(null)

export const EditorUiProvider = EditorUiContext.Provider

export function useEditorUi(): EditorUi {
  const ui = useContext(EditorUiContext)
  if (!ui) throw new Error('useEditorUi needs an EditorUiProvider')
  return ui
}

function subscribeDevice(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener('resize', listener)
  const queries = ['(any-pointer: fine)', '(any-pointer: coarse)'].map((q) => {
    try {
      return window.matchMedia(q)
    } catch {
      return null
    }
  })
  for (const q of queries) q?.addEventListener?.('change', listener)
  return () => {
    window.removeEventListener('resize', listener)
    for (const q of queries) q?.removeEventListener?.('change', listener)
  }
}

const phoneSnapshot = () => isPhoneLike(readDeviceTraits())
const serverSnapshot = () => false

/**
 * True for the phone layout. The server render (and hydration) use the
 * desktop layout; panels that must not flash on a narrow screen before then
 * also hide below 768 px with CSS.
 */
export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribeDevice, phoneSnapshot, serverSnapshot)
}
