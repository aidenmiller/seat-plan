import { notFound } from 'next/navigation'
import { SignedOutShell } from '@/client/ui/SignedOutShell'
import { setupOpen } from '@/server/auth/setup'
import { SetupForm } from './SetupForm'

export const metadata = { title: 'Set up' }

// Whether setup is open depends on the database at request time, never at build time.
export const dynamic = 'force-dynamic'

/**
 * First-run setup (src/server/auth/setup.ts): the 404 page unless
 * SITE_PASSWORD is set and no account exists yet.
 */
export default async function SetupPage() {
  if (!(await setupOpen())) notFound()

  return (
    <SignedOutShell
      title="First-time setup"
      intro="Make the first account. It can manage everyone else’s, and it takes over the weddings already here."
    >
      <SetupForm />
    </SignedOutShell>
  )
}
