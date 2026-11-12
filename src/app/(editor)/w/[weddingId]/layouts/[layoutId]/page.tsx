import { notFound } from 'next/navigation'
import { requireWeddingPage } from '@/server/auth/pages'
import { AdminViewBanner, WeddingAccessProvider } from '@/client/wedding-access'
import { weddingAccessValue } from '@/client/wedding-access-value'
import { getDb } from '@/server/db/client'
import { listGroups } from '@/server/repo/groups'
import { listGuests } from '@/server/repo/guests'
import { getLayoutDetail } from '@/server/repo/layouts'
import { listRules } from '@/server/repo/rules'
import { getWedding } from '@/server/repo/weddings'
import { uuid } from '@/shared/api'
import { EditorShell } from '@/client/editor/EditorShell'

export const metadata = { title: 'Layout' }

/**
 * The layout editor. A missing or deleted layout, one from another wedding,
 * or one whose wedding was deleted is a 404. The wedding gives the editor its
 * unit (the grid and every length) and the narrowest gap between tables; its
 * guests, groups and rules fill the Guests and Groups tabs and the rules check.
 */
export default async function LayoutEditorPage({ params }: PageProps<'/w/[weddingId]/layouts/[layoutId]'>) {
  const { weddingId, layoutId } = await params
  const access = await requireWeddingPage(weddingId, `/w/${weddingId}/layouts/${layoutId}`)
  if (!uuid.safeParse(weddingId).success || !uuid.safeParse(layoutId).success) notFound()
  const db = getDb()
  const id = weddingId.toLowerCase()
  const [layout, wedding, guests, groups, rules] = await Promise.all([
    getLayoutDetail(db, layoutId.toLowerCase()),
    getWedding(db, id),
    listGuests(db, id),
    listGroups(db, id),
    listRules(db, id),
  ])
  if (!layout || !wedding || layout.weddingId !== wedding.id || !guests || !groups || !rules) notFound()
  return (
    <WeddingAccessProvider access={weddingAccessValue(access)}>
      {/* A sibling above the shell in the editor's full-height column, so the shell simply gets that much less room. */}
      <AdminViewBanner />
      <EditorShell
        key={layout.id}
        layout={layout}
        wedding={{
          unit: wedding.unit,
          minGapCm: wedding.minGapCm,
          name: wedding.name,
          date: wedding.date,
          partner1Name: wedding.partner1Name,
          partner2Name: wedding.partner2Name,
        }}
        guests={guests}
        groups={groups}
        rules={rules}
      />
    </WeddingAccessProvider>
  )
}
