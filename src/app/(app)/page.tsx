import { asc, isNull } from 'drizzle-orm'
import { requireSiteSession } from '@/server/auth/require'
import { getDb } from '@/server/db/client'
import { weddings } from '@/server/db/schema'

export const metadata = { title: 'Weddings · Seat Plan' }

export default async function HomePage() {
  await requireSiteSession()
  const rows = await getDb()
    .select({ id: weddings.id, name: weddings.name, date: weddings.date })
    .from(weddings)
    .where(isNull(weddings.deletedAt))
    .orderBy(asc(weddings.createdAt))

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Weddings</h1>
      {rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600">
          No weddings yet.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((w) => (
            <li key={w.id} className="rounded-xl border border-stone-200 bg-white p-4">
              <p className="font-medium">{w.name}</p>
              {w.date && <p className="text-sm text-stone-600">{w.date}</p>}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
