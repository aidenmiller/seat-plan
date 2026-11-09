'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { updateWedding } from '@/client/api'
import { InlineName } from '@/client/ui/InlineName'
import { secondaryButton } from '@/client/ui/styles'
import { formatWeddingDate } from '@/domain/wording'
import type { WeddingSummary } from '@/shared/api'
import { WeddingSettingsDialog } from './WeddingSettingsDialog'

/**
 * The newer of the page's copy of the wedding and the one a save here just
 * returned. A save calls router.refresh(), but Settings can open again before
 * the new props arrive; it must not open on the old values (and then send
 * them back).
 */
export function newestWedding(fromPage: WeddingSummary, saved: WeddingSummary | null): WeddingSummary {
  if (!saved || saved.id !== fromPage.id) return fromPage
  return Date.parse(saved.updatedAt) > Date.parse(fromPage.updatedAt) ? saved : fromPage
}

/** The wedding's name (rename in place), its date, and the Settings button. */
export function WeddingHeader({ wedding: fromPage }: { wedding: WeddingSummary }) {
  const router = useRouter()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [saved, setSaved] = useState<WeddingSummary | null>(null)
  const wedding = newestWedding(fromPage, saved)

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="min-w-0 flex-1">
        <h1 className="min-w-0 text-2xl tracking-tight">
          <InlineName
            value={wedding.name}
            label="Wedding name"
            textClassName="text-2xl font-semibold"
            testId="wedding-title"
            onSave={async (name) => {
              setSaved(await updateWedding(wedding.id, { name }))
              router.refresh()
            }}
          />
        </h1>
        <p className="text-sm text-stone-600">{wedding.date ? formatWeddingDate(wedding.date) : 'No date yet'}</p>
      </div>
      <button type="button" className={secondaryButton} onClick={() => setSettingsOpen(true)}>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="10" cy="10" r="2.5" />
          <path
            d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"
            strokeLinecap="round"
          />
        </svg>
        Settings
      </button>
      <WeddingSettingsDialog
        wedding={wedding}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={setSaved}
      />
    </div>
  )
}
