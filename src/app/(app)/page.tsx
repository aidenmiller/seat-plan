import { RestoreButton } from '@/client/backup/RestoreButton'
import { memberRoles } from '@/server/auth/member-roles'
import { requireUser } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { listWeddingsForUser } from '@/server/repo/weddings'
import { NewWeddingButton } from './_components/NewWeddingButton'
import { WeddingCard } from './_components/WeddingCard'

export const metadata = { title: 'Weddings' }

/** Only the weddings the signed-in person belongs to (an admin sees theirs here too). */
export default async function HomePage() {
  const user = await requireUser('/')
  const db = getDb()
  const [weddings, roles] = await Promise.all([listWeddingsForUser(db, user.id), memberRoles(db, user.id)])

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Weddings</h1>
        <div className="flex flex-wrap gap-2">
          <RestoreButton />
          <NewWeddingButton />
        </div>
      </div>
      {weddings.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600">
          No weddings yet
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="wedding-list">
          {weddings.map((w) => (
            <li key={w.id}>
              <WeddingCard wedding={w} role={roles.get(w.id) ?? 'owner'} canManage={user.isAdmin || roles.get(w.id) === 'owner'} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
