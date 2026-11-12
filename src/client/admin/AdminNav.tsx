'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const ADMIN_SECTIONS = [
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/weddings', label: 'Weddings' },
] as const

/** The admin pages' tabs. On a phone they scroll sideways inside their own strip, never the page. */
export function AdminNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Admin" className="-mx-4 mt-1 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-1">
        {ADMIN_SECTIONS.map((section) => {
          const active = pathname === section.href || pathname.startsWith(`${section.href}/`)
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
