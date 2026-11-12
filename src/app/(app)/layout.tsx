import Link from 'next/link'
import { BRAND_NAME } from '@/brand/brand'
import { BrowserSession } from '@/client/BrowserSession'
import { Logo } from '@/client/ui/Logo'
import { UserMenu } from '@/client/ui/UserMenu'
import { requireUser } from '@/server/auth/pages'
import { CurrentUserProvider } from '@/client/current-user'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await requireUser('/')
  return (
    <CurrentUserProvider user={{ id: user.id, displayName: user.displayName, email: user.email, isAdmin: user.isAdmin }}>
      <div className="flex min-h-full flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-2 border-b border-stone-200 bg-white px-4">
          <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2 text-lg font-semibold tracking-tight text-blue-900">
            <Logo variant="mark" width={48} decorative />
            <span className="sr-only sm:not-sr-only">{BRAND_NAME}</span>
          </Link>
          <UserMenu />
        </header>
        {children}
      </div>
      <BrowserSession />
    </CurrentUserProvider>
  )
}
