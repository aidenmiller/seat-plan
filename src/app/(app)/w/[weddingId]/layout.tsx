import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PartnerNamesProvider } from '@/client/guests/partners-context'
import { AdminViewBanner, WeddingAccessProvider, weddingAccessValue } from '@/client/wedding-access'
import { requireWeddingPage } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { getWedding } from '@/server/repo/weddings'
import { uuid } from '@/shared/api'
import { WeddingHeader } from './_components/WeddingHeader'
import { WeddingTabs } from './_components/WeddingTabs'

/** The wedding area: its name, date and settings, and the six tabs. A missing or deleted wedding is a 404. */
export default async function WeddingLayout({ children, params }: LayoutProps<'/w/[weddingId]'>) {
  const { weddingId } = await params
  const access = await requireWeddingPage(weddingId, `/w/${weddingId}/layouts`)
  if (!uuid.safeParse(weddingId).success) notFound()
  const wedding = await getWedding(getDb(), weddingId.toLowerCase())
  if (!wedding) notFound()

  return (
    <WeddingAccessProvider access={weddingAccessValue(access)}>
      <div className="flex flex-1 flex-col">
        <AdminViewBanner />
        <div className="border-b border-stone-200 bg-white">
          <div className="mx-auto w-full max-w-5xl px-4 pt-2">
            <Link
              href="/"
              className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              All weddings
            </Link>
            <WeddingHeader wedding={wedding} />
            <WeddingTabs weddingId={wedding.id} />
          </div>
        </div>
        {/* The partners' names label guest sides in every tab. */}
        <PartnerNamesProvider partner1={wedding.partner1Name} partner2={wedding.partner2Name}>
          {children}
        </PartnerNamesProvider>
      </div>
    </WeddingAccessProvider>
  )
}
