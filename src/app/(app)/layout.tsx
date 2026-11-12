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
        <header className="flex h-14 items-center justify-between gap-2 border-b border-stone-200 bg-white px-4 sm:h-[4.5rem]">
          {/* The brand's own artwork, never typed text: the horizontal lockup at its 320 px minimum where it fits, the mark alone on a phone. */}
          <Link href="/" aria-label={BRAND_NAME} className="flex min-h-11 shrink-0 items-center">
            <Logo variant="mark" width={48} decorative className="sm:hidden" />
            <Logo variant="horizontal" width={320} decorative className="hidden sm:block" />
          </Link>
          <UserMenu />
        </header>
        {children}
      </div>
      <BrowserSession />
    </CurrentUserProvider>
  )
}
