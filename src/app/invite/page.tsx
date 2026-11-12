import { CurrentUserProvider } from '@/client/current-user'
import { getSessionUser } from '@/server/auth/pages'
import { InviteScreen } from './InviteScreen'

export const metadata = { title: 'Invite · Seat Plan' }

// Whether someone is signed in depends on the request, never on the build.
export const dynamic = 'force-dynamic'

/**
 * An invite link: /invite#<token>. Open to everyone, since the person may
 * have no account yet. The token is in the #fragment, which never reaches
 * the server, so this page cannot see it: the browser reads it and asks the
 * invite routes, which do the checks. All this page decides is whether
 * someone is signed in on this browser already (a session the database still
 * holds), so the screen can offer to accept the invite for that account.
 */
export default async function InvitePage() {
  const user = await getSessionUser()
  const screen = <InviteScreen signedIn={user ? { displayName: user.displayName, email: user.email } : null} />
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        {user ? (
          // Accepting and signing out are changes: they carry the user's id (src/client/http.ts).
          <CurrentUserProvider user={{ id: user.id, displayName: user.displayName, email: user.email, isAdmin: user.isAdmin }}>
            {screen}
          </CurrentUserProvider>
        ) : (
          screen
        )}
      </div>
    </main>
  )
}
