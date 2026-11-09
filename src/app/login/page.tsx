import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { safeNextPath } from '@/server/auth/paths'
import { SITE_COOKIE, verifySiteToken } from '@/server/auth/tokens'
import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign in · Seat Plan' }

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams
  const next = safeNextPath(Array.isArray(params.next) ? params.next[0] : params.next)
  const jar = await cookies()
  if (verifySiteToken(jar.get(SITE_COOKIE)?.value)) redirect(next)

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Seat Plan</h1>
        <p className="mt-1 text-sm text-stone-600">Noa &amp; Aiden&apos;s guest list and seating.</p>
        <LoginForm next={next} />
      </div>
    </main>
  )
}
