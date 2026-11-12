import { ResetForm } from './ResetForm'

export const metadata = { title: 'Reset password · Seat Plan' }

/**
 * A reset link an admin made: /reset#<token>. Open to everyone, since the
 * person cannot sign in until they have used it. The token is in the
 * #fragment, which never reaches the server: the browser reads it and sends
 * it to /api/auth/reset, which does the checks. Nothing here depends on the
 * request, so the page itself holds no secret and no account.
 */
export default function ResetPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        <ResetForm />
      </div>
    </main>
  )
}
