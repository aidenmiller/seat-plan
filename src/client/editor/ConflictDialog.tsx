'use client'

/**
 * "Aiden changed this layout at 3:42 pm." (PLAN section 5, "Answers"). The
 * person must choose: load their version (which drops the changes at stake),
 * or keep them as a new copy. Esc and clicks outside do nothing.
 */
import { useState } from 'react'
import { errorMessage } from '@/client/api'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { useNow } from '@/client/ui/clock'
import { errorClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { conflictChoiceMessage, conflictMessage, type ConflictSource } from '@/domain/wording'
import type { ConflictInfo } from './layout-session'

/** Which wording the dialog uses for this conflict. */
export function conflictSource(conflict: Pick<ConflictInfo, 'source' | 'partlySaved'>): ConflictSource {
  if (conflict.source === 'save') return 'save'
  return conflict.partlySaved ? 'recovery-partly-saved' : 'recovery'
}

export function ConflictDialog({
  conflict,
  me,
  onLoadTheirs,
  onKeepMine,
}: {
  conflict: ConflictInfo | null
  me: string | null
  onLoadTheirs: () => Promise<void>
  onKeepMine: () => Promise<void>
}) {
  const now = useNow()
  const [busy, setBusy] = useState<'theirs' | 'mine' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const message = conflict
    ? conflictMessage(conflict.server.editedBy, conflict.server.updatedAt, me, new Date(now ?? Date.parse(conflict.server.updatedAt)))
    : ''

  async function run(which: 'theirs' | 'mine') {
    if (busy) return
    setBusy(which)
    setError(null)
    try {
      await (which === 'theirs' ? onLoadTheirs() : onKeepMine())
    } catch (err) {
      setError(
        which === 'theirs'
          ? `Could not load their version. ${errorMessage(err)}`
          : `Could not make the copy. ${errorMessage(err)}`,
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog
      open={conflict !== null}
      onClose={() => undefined}
      dismissable={false}
      title="This layout changed"
      description={<p data-testid="conflict-message">{message}</p>}
      testId="conflict-dialog"
    >
      <p className="text-sm text-stone-700" data-testid="conflict-choice">
        {conflict ? conflictChoiceMessage(conflictSource(conflict)) : ''}
      </p>
      {error && (
        <p role="alert" className={`${errorClass} mt-3`}>
          {error}
        </p>
      )}
      <DialogActions>
        <button type="button" className={secondaryButton} onClick={() => void run('mine')} disabled={busy !== null}>
          {busy === 'mine' ? 'Making a copy…' : 'Keep mine as a new copy'}
        </button>
        <button type="button" className={primaryButton} onClick={() => void run('theirs')} disabled={busy !== null}>
          {busy === 'theirs' ? 'Loading…' : 'Load their version'}
        </button>
      </DialogActions>
    </Dialog>
  )
}
