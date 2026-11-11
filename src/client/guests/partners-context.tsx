'use client'

/**
 * The wedding's two partner names, which label guest sides everywhere: the
 * side pickers and filters, the import's side words and the seating block's
 * side labels (domain/partners). The wedding layout provides them from the
 * server, and router.refresh() after a settings save brings new ones; the
 * editor provides its own. Without a provider, sides read "Partner 1",
 * "Partner 2" and "Both".
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { sideOptions, type GuestSide, type PartnerNames } from '@/domain/partners'

const NO_NAMES: PartnerNames = Object.freeze({ partner1: null, partner2: null })

const PartnerNamesContext = createContext<PartnerNames>(NO_NAMES)

export function PartnerNamesProvider({ partner1, partner2, children }: PartnerNames & { children: ReactNode }) {
  const value = useMemo(() => ({ partner1, partner2 }), [partner1, partner2])
  return <PartnerNamesContext.Provider value={value}>{children}</PartnerNamesContext.Provider>
}

export function usePartnerNames(): PartnerNames {
  return useContext(PartnerNamesContext)
}

/** The side picker's choices with this wedding's names: partner 1, partner 2, Both. */
export function useSideOptions(): readonly { value: GuestSide; label: string }[] {
  const names = usePartnerNames()
  return useMemo(() => sideOptions(names), [names])
}
