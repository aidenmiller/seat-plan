/**
 * Which devices count as phones, and which mode a device opens in (spec
 * section 4; PLAN change 13; DECISIONS 19). View on phones, on touch-only
 * devices at any width (a phone held sideways is wider than 768 px) and on
 * screens under 768 px wide; Edit everywhere else. A device's own last
 * choice wins once it has made one.
 */
import { readMode, type StorageLike } from './device-view'
import type { EditorMode } from './ui-store'

export const PHONE_MAX_WIDTH_PX = 768

export type DeviceTraits = {
  /** The window's width in CSS px. */
  width: number
  /** No mouse or trackpad at all, only touch. */
  touchOnly: boolean
  /** The browser says it is a phone. */
  phone: boolean
}

/** The phone layout (canvas fills the screen, bottom sheet) and the View default. */
export function isPhoneLike(traits: DeviceTraits): boolean {
  return traits.phone || traits.touchOnly || traits.width < PHONE_MAX_WIDTH_PX
}

export function defaultMode(traits: DeviceTraits): EditorMode {
  return isPhoneLike(traits) ? 'view' : 'edit'
}

/** This device's remembered mode, or the default for it. */
export function initialMode(storage: StorageLike | null, traits: DeviceTraits): EditorMode {
  return readMode(storage) ?? defaultMode(traits)
}

type WindowLike = {
  innerWidth: number
  matchMedia?: (query: string) => { matches: boolean }
  navigator?: { maxTouchPoints?: number; userAgent?: string }
}

/** Reads the traits from the browser. On the server: a desktop. */
export function readDeviceTraits(win: WindowLike | undefined = typeof window === 'undefined' ? undefined : window): DeviceTraits {
  if (!win) return { width: 1440, touchOnly: false, phone: false }
  const media = (q: string) => {
    try {
      return win.matchMedia?.(q).matches ?? false
    } catch {
      return false
    }
  }
  const touchPoints = win.navigator?.maxTouchPoints ?? 0
  const hasFine = media('(any-pointer: fine)')
  const hasCoarse = media('(any-pointer: coarse)')
  const ua = win.navigator?.userAgent ?? ''
  return {
    width: win.innerWidth,
    touchOnly: !hasFine && (hasCoarse || touchPoints > 0),
    phone: /iPhone|iPod|Android.+Mobile|Mobi/i.test(ua),
  }
}
