/**
 * What the template editor's top bar says about saving. The template saves
 * through the layout save engine (layout-saver.ts with the venue endpoint),
 * so the statuses are the same; the words name the venue, and while an import
 * draft is open nothing saves until Accept. The template keeps no copy on
 * this device, so offline edits are not saved anywhere yet.
 */
import type { SaveStatus } from '@/client/sync/types'
import type { SaveStatusView } from '@/client/editor/save-status'

const FAILED: Record<Extract<SaveStatus, { kind: 'failed' }>['reason'], string> = {
  gone: 'this venue was deleted',
  invalid: 'the server would not take this venue',
  'signed-out': 'you were signed out',
  'other-user': 'someone else signed in',
  forbidden: 'you cannot change this venue',
}

/** `readOnly`: the person may only view this venue, so nothing saves. */
export function templateStatusView(status: SaveStatus | null, draft: boolean, readOnly = false): SaveStatusView {
  if (readOnly) return { text: 'View only', detail: 'You cannot change this venue.', tone: 'neutral' }
  if (draft) return { text: 'Draft, not saved', detail: 'Nothing changes in this venue until you press Accept.', tone: 'warning' }
  if (status === null) return { text: 'Opening…', tone: 'neutral' }
  switch (status.kind) {
    case 'saved':
      return { text: 'Saved', tone: 'good' }
    case 'saving':
      return { text: 'Saving…', tone: 'neutral' }
    case 'retrying':
      return { text: 'Not saved, retrying', detail: `${status.reason} Keep this page open until it says Saved.`, tone: 'warning' }
    case 'offline':
      return { text: 'Offline, not saved', detail: 'Keep this page open until it says Saved.', tone: 'error' }
    case 'conflict':
      return { text: 'Not saved', detail: 'This venue changed somewhere else.', tone: 'warning' }
    case 'failed':
      return { text: `Couldn't save: ${FAILED[status.reason]}`, detail: status.message, tone: 'error' }
  }
}

/** The saver's sentences, naming the venue. */
export const TEMPLATE_SAVER_MESSAGES = {
  gone: 'This venue was deleted, so changes cannot be saved.',
  invalid: 'The server could not save this venue.',
  forbidden: 'You can no longer change this venue, so changes here cannot be saved.',
  signedOut: 'You were signed out. Sign in again to keep saving.',
  // The venue keeps no copy on the device (template-saver.ts), so this says plainly what is lost.
  otherUser: 'Someone else signed in on this browser, so changes here cannot be saved. Changes since the last save are lost when you leave this page.',
} as const
