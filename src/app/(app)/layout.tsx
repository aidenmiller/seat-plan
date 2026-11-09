import Link from 'next/link'
import { requireSiteSession } from '@/server/auth/require'
import { LogoutButton } from '@/client/ui/LogoutButton'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  await requireSiteSession()
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex h-14 items-center justify-between border-b border-stone-200 bg-white px-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Seat Plan
        </Link>
        <LogoutButton />
      </header>
      {children}
    </div>
  )
}
