/**
 * Feet or meters in the template editor. Templates belong to no wedding, so
 * they have no wedding unit: each device keeps its own choice, feet until it
 * picks (spec section 5 and PLAN section 4: lengths show in feet and inches
 * or meters).
 */
import { useCallback, useSyncExternalStore } from 'react'
import { browserStorage, type StorageLike } from '@/client/editor/state/device-view'
import type { LengthUnit } from '@/domain/units'

export const VENUE_UNIT_KEY = 'seat-plan:venue-unit'

export function readVenueUnit(storage: StorageLike | null): LengthUnit {
  try {
    return storage?.getItem(VENUE_UNIT_KEY) === 'm' ? 'm' : 'ft'
  } catch {
    return 'ft'
  }
}

export function writeVenueUnit(storage: StorageLike | null, unit: LengthUnit): void {
  try {
    storage?.setItem(VENUE_UNIT_KEY, unit)
  } catch {
    // Blocked storage: this device just forgets.
  }
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === VENUE_UNIT_KEY) listener()
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

/** This device's unit for venues, and a setter that remembers it. Feet on the server render. */
export function useVenueUnit(): [LengthUnit, (unit: LengthUnit) => void] {
  const unit = useSyncExternalStore(
    subscribe,
    () => readVenueUnit(browserStorage()),
    () => 'ft' as const,
  )
  const set = useCallback((next: LengthUnit) => {
    writeVenueUnit(browserStorage(), next)
    for (const l of [...listeners]) l()
  }, [])
  return [unit, set]
}
