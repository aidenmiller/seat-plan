import { AccountScreen } from '@/client/account/AccountScreen'
import { requireUser } from '@/server/auth/pages'
import { getDb } from '@/server/db/client'
import { listUserSessions } from '@/server/repo/sessions'
import type { AccountSession } from '@/shared/accounts-api'

export const metadata = { title: 'Account · Seat Plan' }

/** Your name, your password, and the devices signed in to your account. */
export default async function AccountPage() {
  const user = await requireUser('/account')
  const sessions: AccountSession[] = (await listUserSessions(getDb(), user.id)).map((s) => ({
    id: s.id,
    userAgent: s.userAgent,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    current: s.id === user.sessionId,
  }))
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <AccountScreen account={{ id: user.id, email: user.email, displayName: user.displayName }} initialSessions={sessions} />
    </main>
  )
}
