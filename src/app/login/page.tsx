import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/auth/pages'
import { safeNextPath } from '@/server/auth/paths'
import { setupOpen } from '@/server/auth/setup'
import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign in · Seat Plan' }

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams
  const next = safeNextPath(Array.isArray(params.next) ? params.next[0] : params.next)
  // Only a session the database still holds counts. A cookie that is merely
  // well signed (an ended session) must not bounce back to a page that sends
  // it here again.
  if (await getSessionUser()) redirect(next)
  const offerSetup = await setupOpen()

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to Seat Plan</h1>
        <p className="mt-1 text-sm text-stone-600">Guest lists and seating plans.</p>
        <LoginForm next={next} />
        {offerSetup && (
          <p className="mt-6 border-t border-stone-200 pt-4 text-sm text-stone-600">
            No accounts yet.{' '}
            <Link href="/setup" className="inline-flex min-h-11 items-center font-medium text-blue-900 underline">
              Set up the first account
            </Link>
          </p>
        )}
      </div>
    </main>
  )
}
