import { requireSiteSession } from '@/server/auth/require'

export const dynamic = 'force-dynamic'

/** The editor fills the screen: no app header, and the page itself never scrolls. */
export default async function EditorLayout({ children }: LayoutProps<'/'>) {
  await requireSiteSession()
  return <div className="flex h-dvh flex-col overflow-hidden bg-stone-100">{children}</div>
}
