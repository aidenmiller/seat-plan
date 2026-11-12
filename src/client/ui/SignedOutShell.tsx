/**
 * The page under every signed-out screen: sign-in, first-run setup, a share
 * link's password, and the invite and reset links. Heritage navy drawn as
 * blueprint paper (.blueprint-paper in globals.css), the white lockup (the
 * brand's artwork for navy), and the screen itself on a white card with crop
 * marks at its corners on wider screens (.blueprint-marks).
 *
 * Give it the card's heading and the line under it, or leave them out when
 * the content draws its own:
 *
 *   <SignedOutShell title="Sign in" intro="Guest lists and seating plans.">
 *     <LoginForm next={next} />
 *   </SignedOutShell>
 *
 * Anything placed on the navy itself must be white (10.36:1). No hooks, so
 * server and client components can both use it.
 */
import type { ReactNode } from 'react'
import { Logo } from './Logo'

const CARD_WIDTH = { sm: 'max-w-sm', md: 'max-w-md' } as const

export function SignedOutShell({
  title,
  intro,
  children,
  size = 'sm',
  testId,
}: {
  /** The card's heading (its h1). */
  title?: string
  /** A line under the heading. */
  intro?: ReactNode
  /** The card's content: the form, and anything under it. */
  children: ReactNode
  /** The card's width: sm (24rem) for a short form, md (28rem) for a longer one. */
  size?: keyof typeof CARD_WIDTH
  /** On the page's <main>. */
  testId?: string
}) {
  return (
    <main
      className="blueprint-paper flex flex-1 flex-col items-center justify-center px-4 py-12"
      data-signed-out=""
      data-testid={testId}
    >
      <Logo variant="horizontal-white" width={320} className="mb-8 h-auto w-80 sm:mb-11 sm:w-96" />
      <div className={`blueprint-marks w-full ${CARD_WIDTH[size]} rounded-2xl bg-white p-6 text-stone-900 shadow-[0_24px_64px_-16px_rgb(6_17_51/0.55)] sm:p-8`}>
        {title && <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>}
        {intro && <p className="mt-1 text-sm text-stone-600">{intro}</p>}
        {children}
      </div>
    </main>
  )
}
