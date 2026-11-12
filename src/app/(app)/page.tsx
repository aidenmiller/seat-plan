import { RestoreButton } from '@/client/backup/RestoreButton'
import { secondaryButtonOnNavy } from '@/client/ui/styles'
import { memberRoles } from '@/server/auth/member-roles'
import { requireUser } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { listWeddingsForUser } from '@/server/repo/weddings'
import { NewWeddingButton } from './_components/NewWeddingButton'
import { WeddingCard } from './_components/WeddingCard'

export const metadata = { title: 'Weddings' }

/**
 * Only the weddings the signed-in person belongs to (an admin sees theirs here too).
 * The page is drawn on blueprint paper under the app's header, as the signed-out
 * pages are (data-surface="blueprint" in globals.css): white text and buttons made
 * for navy on it, and the weddings on white cards. The other signed-in pages keep
 * the ivory.
 */
export default async function HomePage() {
  const user = await requireUser('/')
  const db = getDb()
  const [weddings, roles] = await Promise.all([listWeddingsForUser(db, user.id), memberRoles(db, user.id)])

  return (
    <main className="blueprint-paper flex-1" data-surface="blueprint">
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-10 sm:pt-8 sm:pb-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-white">Weddings</h1>
          <div className="flex flex-wrap gap-2">
            <RestoreButton buttonClassName={secondaryButtonOnNavy} />
            <NewWeddingButton />
          </div>
        </div>
        {weddings.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-white/50 p-8 text-center text-white">No weddings yet</p>
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="wedding-list">
            {weddings.map((w) => (
              <li key={w.id}>
                <WeddingCard wedding={w} role={roles.get(w.id) ?? 'owner'} canManage={user.isAdmin || roles.get(w.id) === 'owner'} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
