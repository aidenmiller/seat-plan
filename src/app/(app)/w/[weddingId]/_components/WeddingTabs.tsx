'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const WEDDING_TABS = [
  { segment: 'layouts', label: 'Layouts' },
  { segment: 'guests', label: 'Guests' },
  { segment: 'groups', label: 'Groups' },
  { segment: 'rules', label: 'Rules' },
  { segment: 'venues', label: 'Venues' },
  { segment: 'links', label: 'Links' },
] as const

/** The wedding's tabs. On a phone they scroll sideways inside their own strip, never the page. */
export function WeddingTabs({ weddingId }: { weddingId: string }) {
  // Ids are lower case; someone may have typed the address in capitals.
  const pathname = usePathname().toLowerCase()
  return (
    <nav aria-label="Wedding" className="-mx-4 mt-1 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-1">
        {WEDDING_TABS.map((tab) => {
          const href = `/w/${weddingId}/${tab.segment}`
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <li key={tab.segment}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 items-center border-b-2 px-3 text-sm font-medium ${
                  active ? 'border-blue-900 text-blue-950' : 'border-transparent text-stone-600 hover:text-stone-900'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
