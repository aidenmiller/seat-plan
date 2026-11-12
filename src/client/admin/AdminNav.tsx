'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** The admin pages, in tab order. `exact`: only that path, not the pages under it. A new page (Backups, say) is one more line. */
export const ADMIN_SECTIONS: readonly { href: string; label: string; exact?: boolean }[] = [
  { href: '/admin', label: 'Overview', exact: true },
  { href: '/admin/weddings', label: 'Weddings' },
  { href: '/admin/users', label: 'People' },
  { href: '/admin/venues', label: 'Venues' },
  { href: '/admin/backups', label: 'Backups' },
]

/** The admin pages' tabs. On a phone they scroll sideways inside their own strip, never the page. */
export function AdminNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Admin" className="-mx-4 mt-1 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-1">
        {ADMIN_SECTIONS.map((section) => {
          const active = pathname === section.href || (!section.exact && pathname.startsWith(`${section.href}/`))
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 items-center border-b-2 px-3 text-sm font-medium ${
                  active ? 'border-blue-900 text-blue-950' : 'border-transparent text-stone-600 hover:text-stone-900'
                }`}
              >
                {section.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
