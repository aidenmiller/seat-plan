import { SignedOutShell } from '@/client/ui/SignedOutShell'
import { ResetForm } from './ResetForm'

export const metadata = { title: 'Reset password' }

/**
 * A reset link an admin made: /reset#<token>. Open to everyone, since the
 * person cannot sign in until they have used it. The token is in the
 * #fragment, which never reaches the server: the browser reads it and sends
 * it to /api/auth/reset, which does the checks. Nothing here depends on the
 * request, so the page itself holds no secret and no account.
 */
export default function ResetPage() {
  return (
    <SignedOutShell>
      <ResetForm />
    </SignedOutShell>
  )
}
