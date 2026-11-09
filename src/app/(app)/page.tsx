import { requireSiteSession } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { listWeddings } from '@/server/repo/weddings'
import { NewWeddingButton } from './_components/NewWeddingButton'
import { WeddingCard } from './_components/WeddingCard'

export const metadata = { title: 'Weddings · Seat Plan' }

export default async function HomePage() {
  await requireSiteSession()
  const weddings = await listWeddings(getDb())

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Weddings</h1>
        <NewWeddingButton />
      </div>
      {weddings.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600">
          No weddings yet.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="wedding-list">
          {weddings.map((w) => (
            <li key={w.id}>
              <WeddingCard wedding={w} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
