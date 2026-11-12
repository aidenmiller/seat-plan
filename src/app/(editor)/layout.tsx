import { requireUser } from '@/server/auth/pages'
import { BrowserSession } from '@/client/BrowserSession'
import { CurrentUserProvider } from '@/client/current-user'

export const dynamic = 'force-dynamic'

/** The editor fills the screen: no app header, and the page itself never scrolls. */
export default async function EditorLayout({ children }: LayoutProps<'/'>) {
  const user = await requireUser('/')
  return (
    <CurrentUserProvider user={{ id: user.id, displayName: user.displayName, email: user.email, isAdmin: user.isAdmin }}>
      <div className="flex h-dvh flex-col overflow-hidden bg-stone-100">{children}</div>
      <BrowserSession />
    </CurrentUserProvider>
  )
}
