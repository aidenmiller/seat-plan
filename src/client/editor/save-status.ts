/**
 * The words the editor's top bar shows for the save engine's status (PLAN
 * section 5, "Retries"): Saving…, Saved, Not saved, retrying, Offline, saved
 * on this device (or Offline, not saved, when this device could not keep a
 * copy), and Couldn't save: <reason>.
 *
 * The top bar gives the status a fixed, narrow slot, so the text may be cut
 * short there; `title` holds the whole of it. When this device could not keep
 * a copy of the edit, notStoredAlert() gives the sentence for a full-width
 * warning, since closing the page then loses the edit.
 */
import type { SaveStatus } from '@/client/sync/types'

export type SaveStatusView = {
  text: string
  /** Longer words for the tooltip. */
  detail?: string
  tone: 'neutral' | 'good' | 'warning' | 'error'
}

/** Shown when the edit is not saved anywhere yet: not on the server, not in this device's storage. */
export const NOT_STORED_MESSAGE = 'Not saved on this device. Keep this page open until it says Saved.'

const FAILED_REASONS: Record<Extract<SaveStatus, { kind: 'failed' }>['reason'], string> = {
  gone: 'this layout was deleted',
  invalid: 'the server would not take this layout',
  'signed-out': 'you were signed out',
}

/** `null` while the editor is still opening the layout. */
export function saveStatusView(status: SaveStatus | null): SaveStatusView {
  if (status === null) return { text: 'Opening…', tone: 'neutral' }
  switch (status.kind) {
    case 'saved':
      return { text: 'Saved', tone: 'good' }
    case 'saving':
      return { text: 'Saving…', tone: 'neutral' }
    case 'retrying':
      return status.storedLocally
        ? { text: 'Not saved, retrying', detail: status.reason, tone: 'warning' }
        : { text: 'Not saved, retrying', detail: `${status.reason} ${NOT_STORED_MESSAGE}`, tone: 'error' }
    case 'offline':
      return status.storedLocally
        ? { text: 'Offline, saved on this device', tone: 'warning' }
        : { text: 'Offline, not saved', detail: NOT_STORED_MESSAGE, tone: 'error' }
    case 'conflict':
      return { text: 'Not saved', detail: 'This layout changed somewhere else.', tone: 'warning' }
    case 'failed':
      return { text: `Couldn't save: ${FAILED_REASONS[status.reason]}`, detail: status.message, tone: 'error' }
  }
}

/** The whole status for the slot's title attribute: the text, then the detail if there is one. */
export function saveStatusTitle(view: SaveStatusView): string {
  if (!view.detail) return view.text
  const text = /[.…]$/.test(view.text) ? view.text : `${view.text}.`
  return `${text} ${view.detail}`
}

/**
 * The warning to show across the editor when the edit is neither on the
 * server nor in this device's storage, or null. `storedLocally` is the save
 * engine's isStoredLocally(), for statuses that do not carry it.
 */
export function notStoredAlert(status: SaveStatus | null, storedLocally: boolean): string | null {
  if (status === null) return null
  switch (status.kind) {
    case 'offline':
    case 'retrying':
      return status.storedLocally ? null : NOT_STORED_MESSAGE
    case 'failed':
      return status.reason === 'signed-out' && !storedLocally ? NOT_STORED_MESSAGE : null
    default:
      return null
  }
}

/** The failed banner's sentence. A signed-out tab whose draft was not stored must not claim it was. */
export function failedMessage(status: Extract<SaveStatus, { kind: 'failed' }>, storedLocally: boolean): string {
  if (status.reason === 'signed-out' && !storedLocally) return 'You were signed out. Sign in again to keep saving.'
  return status.message
}
