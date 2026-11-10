import type { Metadata } from 'next'
import { SharePasswordForm } from '@/client/share/SharePasswordForm'
import { ShareRecheck } from '@/client/share/ShareRecheck'
import { requireShareAccess } from '@/server/auth/share'

export const metadata: Metadata = {
  title: 'Seating plan',
  // The token is in the address; never send it to another site.
  referrer: 'no-referrer',
  robots: { index: false, follow: false, nocache: true },
}

/**
 * A venue share link (spec section 2): its own password page, then that one
 * layout, view only. The site cookie opens it too. For now the page after the
 * password shows the layout's name; the plan viewer comes later.
 */
export default async function SharePage({ params }: PageProps<'/share/[token]'>) {
  const { token } = await params
  const access = await requireShareAccess(token)

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        {access ? (
          <>
            <p className="text-sm text-stone-600">Seating plan, view only</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight" data-testid="share-layout-name">
              {access.link.layoutName}
            </h1>
            <p className="mt-4 text-sm text-stone-700">The floor plan will show here.</p>
            <ShareRecheck token={token} />
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Seating plan</h1>
            <p className="mt-1 text-sm text-stone-600">Type the password you were given with this link.</p>
            <SharePasswordForm token={token} />
          </>
        )}
      </div>
    </main>
  )
}
