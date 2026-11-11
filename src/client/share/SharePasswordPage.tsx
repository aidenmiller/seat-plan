import { BrandLine } from '@/client/ui/Logo'
import { SharePasswordForm } from './SharePasswordForm'

/**
 * The share link's password page (spec section 2): what the server shows
 * without a valid cookie, and what an open viewer shows once the link is
 * turned off or its password changed. No names, nothing from the plan.
 */
export function SharePasswordPage({ token }: { token: string }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-12" data-testid="share-password-page">
      <BrandLine className="mb-4" />
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Seating plan</h1>
        <p className="mt-1 text-sm text-stone-600">Type the password you were given with this link.</p>
        <SharePasswordForm token={token} />
      </div>
    </main>
  )
}
