import { SignedOutShell } from '@/client/ui/SignedOutShell'
import { SharePasswordForm } from './SharePasswordForm'

/**
 * The share link's password page (spec section 2): what the server shows
 * without a valid cookie, and what an open viewer shows once the link is
 * turned off or its password changed. No names, nothing from the plan.
 */
export function SharePasswordPage({ token }: { token: string }) {
  return (
    <SignedOutShell title="Seating plan" intro="Type the password you were given with this link." testId="share-password-page">
      <SharePasswordForm token={token} />
    </SignedOutShell>
  )
}
