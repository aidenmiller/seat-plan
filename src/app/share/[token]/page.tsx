import type { Metadata } from 'next'
import { SharePasswordPage } from '@/client/share/SharePasswordPage'
import { ShareViewer } from '@/client/share/ShareViewer'
import { requireShareAccess } from '@/server/auth/share'
import { getDb } from '@/server/db/client'
import { shareViewData } from '@/server/repo/share-links'

export const metadata: Metadata = {
  title: 'Seating plan',
  // The token is in the address; never send it to another site.
  referrer: 'no-referrer',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * A venue share link (spec section 2): its own password page, then that one
 * layout in View mode and nothing else. The site cookie opens it too. The
 * plan comes from the same data the data route sends, built from the link's
 * switches (PLAN change 24), so hidden parts never reach the browser.
 */
export default async function SharePage({ params }: PageProps<'/share/[token]'>) {
  const { token } = await params
  const access = await requireShareAccess(token)
  const view = access ? await shareViewData(getDb(), access.link) : null
  if (!view) return <SharePasswordPage token={token} />
  return <ShareViewer token={token} initial={view} />
}
