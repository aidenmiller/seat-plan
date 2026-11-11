import Link from 'next/link'
import { requireUser } from '@/server/auth/pages'
import { CurrentUserProvider } from '@/client/current-user'
import { AuthorSwitch } from '@/client/ui/AuthorSwitch'
import { LogoutButton } from '@/client/ui/LogoutButton'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await requireUser('/')
  return (
    <CurrentUserProvider user={{ id: user.id, displayName: user.displayName, email: user.email, isAdmin: user.isAdmin }}>
      <div className="flex min-h-full flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-2 border-b border-stone-200 bg-white px-4">
          <Link href="/" className="flex min-h-11 items-center text-lg font-semibold tracking-tight">
            Seat Plan
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <AuthorSwitch />
            <LogoutButton />
          </div>
        </header>
        {children}
      </div>
    </CurrentUserProvider>
  )
}
