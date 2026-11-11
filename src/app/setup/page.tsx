import { notFound } from 'next/navigation'
import { setupOpen } from '@/server/auth/setup'
import { SetupForm } from './SetupForm'

export const metadata = { title: 'Set up · Seat Plan' }

// Whether setup is open depends on the database at request time, never at build time.
export const dynamic = 'force-dynamic'

/**
 * First-run setup (src/server/auth/setup.ts): the 404 page unless
 * SITE_PASSWORD is set and no account exists yet.
 */
export default async function SetupPage() {
  if (!(await setupOpen())) notFound()

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Set up Seat Plan</h1>
        <p className="mt-1 text-sm text-stone-600">
          Make the first account. It can manage everyone else’s, and it takes over the weddings already here.
        </p>
        <SetupForm />
      </div>
    </main>
  )
}
