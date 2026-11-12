'use client'

/**
 * The save status in the editor's top bar, and the two warnings under it:
 *
 * - SaveStatusSlot: a fixed-width slot, so "Saved", "Saving…" and "Not saved,
 *   retrying" never change the top bar's width or make it wrap (which would
 *   move the canvas on every save). The text is cut short when it does not
 *   fit; the title holds all of it.
 * - NotStoredBanner: the edit is neither on the server nor in this device's
 *   storage, so closing the page would lose it.
 * - SaveFailedBanner: a 422 or 410 (or a deleted layout) stops saving. It
 *   offers Save as a copy, then Download a copy. A 401 offers Sign in again.
 *   When someone else signed in on this browser, it offers Download a copy:
 *   a copy saved now would go under the other person's account.
 */
import type { SaveStatus } from '@/client/sync/types'
import { primaryButton, secondaryButton } from '@/client/ui/styles'
import { failedMessage, saveStatusTitle, saveStatusView } from './save-status'

const TONE_CLASS = {
  neutral: 'text-stone-600',
  good: 'text-emerald-700',
  warning: 'text-amber-700',
  error: 'text-red-700',
} as const

export function SaveStatusSlot({ status }: { status: SaveStatus | null }) {
  const view = saveStatusView(status)
  return (
    <p
      role="status"
      aria-live="polite"
      title={saveStatusTitle(view)}
      data-testid="save-status"
      data-status={status?.kind ?? 'opening'}
      className={`w-24 shrink-0 truncate text-right text-sm sm:w-56 ${TONE_CLASS[view.tone]}`}
    >
      {view.text}
    </p>
  )
}

export function NotStoredBanner({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div
      role="alert"
      data-testid="not-stored-banner"
      className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      {message}
    </div>
  )
}

export const GONE_MESSAGE = 'This layout was deleted, so changes cannot be saved.'

export type SaveFailedBannerProps = {
  status: SaveStatus | null
  /** The layout or its wedding was found deleted outside a save (the version check). */
  gone: boolean
  /** The save engine's isStoredLocally(). */
  storedLocally: boolean
  loginHref: string
  /** "Save as a copy" is under way, or done and the page is about to open the copy. */
  copying: boolean
  copyError: string | null
  onSaveCopy: () => void
  onDownload: () => void
}

export function SaveFailedBanner({
  status,
  gone,
  storedLocally,
  loginHref,
  copying,
  copyError,
  onSaveCopy,
  onDownload,
}: SaveFailedBannerProps) {
  const failed = status?.kind === 'failed' ? status : null
  if (!failed && !gone) return null
  const signedOut = failed?.reason === 'signed-out'
  const otherUser = failed?.reason === 'other-user'
  return (
    <div
      role="alert"
      data-testid="save-failed-banner"
      className="flex flex-wrap items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      <span className="min-w-0 flex-1 basis-48">{failed ? failedMessage(failed, storedLocally) : GONE_MESSAGE}</span>
      {signedOut ? (
        <a href={loginHref} className={secondaryButton}>
          Sign in again
        </a>
      ) : otherUser ? (
        <button type="button" className={secondaryButton} onClick={onDownload}>
          Download a copy
        </button>
      ) : (
        <>
          <button type="button" className={primaryButton} onClick={onSaveCopy} disabled={copying}>
            {copying ? 'Saving a copy…' : 'Save as a copy'}
          </button>
          <button type="button" className={secondaryButton} onClick={onDownload}>
            Download a copy
          </button>
        </>
      )}
      {copyError && <p className="w-full text-red-700">{copyError}</p>}
    </div>
  )
}
