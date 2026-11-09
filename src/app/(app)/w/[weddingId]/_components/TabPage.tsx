import type { ReactNode } from 'react'

/** The frame every wedding tab shares: a heading row and the tab's content. */
export function TabPage({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {actions}
      </div>
      <div className="mt-4">{children}</div>
    </main>
  )
}

/** "No guests yet." and the like. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600">{children}</p>
  )
}
