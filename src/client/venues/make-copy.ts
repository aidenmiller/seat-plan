'use client'

/**
 * "Make my own copy" of a venue you cannot change: a private copy owned by you
 * (POST /api/venues/:id/duplicate), then the copy opens in the template editor.
 */
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { duplicateVenue, errorMessage } from '@/client/api'
import { randomId } from '@/client/sync/random-id'

/** Where a venue opens from a wedding's tab: Back in the editor returns to that tab. */
export function venueHref(venueId: string, weddingId: string): string {
  return `/venues/${venueId}?from=${weddingId}`
}

/** The editor's Back link is the wedding's Venues tab (or home); a copy opens with the same Back. */
export function copyHrefFromBack(backHref: string): (copyId: string) => string {
  const wedding = /^\/w\/([0-9a-f-]{36})\/venues$/i.exec(backHref)?.[1]
  return (copyId) => (wedding ? venueHref(copyId, wedding) : `/venues/${copyId}`)
}

export function useMakeCopy(venueId: string, hrefFor: (copyId: string) => string) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One id for this button: a second press after a dropped answer gives the same copy back.
  const [id] = useState(randomId)

  async function copy() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const made = await duplicateVenue(venueId, { id })
      router.push(hrefFor(made.id))
    } catch (err) {
      setError(`Could not make a copy. ${errorMessage(err)}`)
      setBusy(false)
    }
  }
  return { copy, busy, error }
}
