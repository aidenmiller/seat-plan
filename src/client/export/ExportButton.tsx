'use client'

import { useState } from 'react'
import { getLayout, getWedding, listGuests } from '@/client/api'
import { BrandIcon } from '@/client/ui/icons/brand'
import { secondaryButton } from '@/client/ui/styles'
import type { LayoutSummary } from '@/shared/api'
import { ExportDialog, type ExportSource } from './ExportDialog'

function ExportIcon() {
  return (
    <BrandIcon name="export" />
  )
}

/** The editor's Export button in the top bar: the dialog reads the plan as it is on screen. */
export function ExportButton({ compact, load }: { compact: boolean; load(): ExportSource }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Export"
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
        data-testid="export-button"
      >
        <ExportIcon />
        {!compact && <span className="hidden lg:inline">Export</span>}
      </button>
      <ExportDialog open={open} onClose={() => setOpen(false)} load={load} />
    </>
  )
}

/** The layout as last saved, its venue, the wedding's guests and the wedding's name and date. */
export async function loadSavedLayout(weddingId: string, layoutId: string): Promise<ExportSource> {
  const [layout, guests, wedding] = await Promise.all([getLayout(layoutId), listGuests(weddingId), getWedding(weddingId)])
  return {
    layoutName: layout.name,
    kind: layout.kind,
    canvas: layout.canvas,
    venue: layout.template && !layout.template.deleted ? layout.template.fixedItems : [],
    guests,
    weddingName: wedding.name,
    weddingDate: wedding.date,
  }
}

/** Export on a card in the Layouts tab: the layout as last saved. */
export function LayoutExportButton({ weddingId, layout, className }: { weddingId: string; layout: Pick<LayoutSummary, 'id' | 'name'>; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Export ${layout.name}`} className={className ?? secondaryButton} data-testid="layout-export">
        Export
      </button>
      <ExportDialog open={open} onClose={() => setOpen(false)} load={() => loadSavedLayout(weddingId, layout.id)} />
    </>
  )
}
