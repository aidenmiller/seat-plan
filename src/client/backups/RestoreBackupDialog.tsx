'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { errorClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import type { RestoredBackupReply } from '@/shared/backups-api'
import { createRestoreAttempt, type RestoreAttempt } from './outcomes'

type Phase = { name: 'confirm' } | { name: 'busy' } | { name: 'failed'; message: string } | { name: 'done'; reply: RestoredBackupReply }

/**
 * "Restore as a new wedding": says what will happen, then does it. It makes a
 * new wedding and changes nothing in the one it came from. The job id is
 * chosen when the dialog opens and kept, so "Try again" after a failure sends
 * the same one and never makes a second wedding.
 */
export function RestoreBackupDialog({
  open,
  onClose,
  title = 'Restore as a new wedding',
  description,
  send,
}: {
  open: boolean
  onClose: () => void
  title?: string
  /** What is being restored: "The backup from Nov 3, 3:42 pm". */
  description: string
  send: (jobId: string) => Promise<RestoredBackupReply>
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} dismissable={false} testId="restore-backup-dialog">
      {open && <RestoreBody description={description} send={send} onClose={onClose} />}
    </Dialog>
  )
}

function RestoreBody({ description, send, onClose }: { description: string; send: (jobId: string) => Promise<RestoredBackupReply>; onClose: () => void }) {
  const [attempt] = useState<RestoreAttempt>(() => createRestoreAttempt(send))
  const [phase, setPhase] = useState<Phase>({ name: 'confirm' })

  async function start() {
    setPhase({ name: 'busy' })
    const result = await attempt.run()
    setPhase(result.ok ? { name: 'done', reply: result.reply } : { name: 'failed', message: result.message })
  }

  if (phase.name === 'done') {
    const { reply } = phase
    return (
      <div className="space-y-4">
        <p className="text-sm text-stone-700" role="status" data-testid="restore-done">
          Restored as {reply.weddingName}.
          {reply.droppedSeats > 0 && ` ${reply.droppedSeats} ${reply.droppedSeats === 1 ? 'seat was' : 'seats were'} left empty because the guest was not in the backup.`}
        </p>
        <DialogActions>
          <button type="button" className={secondaryButton} onClick={onClose}>
            Close
          </button>
          <Link href={`/w/${reply.weddingId}/layouts`} className={primaryButton} data-testid="open-restored">
            Open the restored wedding
          </Link>
        </DialogActions>
      </div>
    )
  }

  const busy = phase.name === 'busy'
  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-700">{description}</p>
      <p className="text-sm text-stone-700">
        This makes a new wedding with the guests, groups, rules, layouts and venues from the backup. It changes nothing in any existing wedding.
      </p>
      {phase.name === 'failed' && (
        <p role="alert" className={errorClass}>
          Could not restore. {phase.message}
        </p>
      )}
      <DialogActions>
        <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={primaryButton} onClick={() => void start()} disabled={busy}>
          {busy ? 'Restoring…' : phase.name === 'failed' ? 'Try again' : 'Restore as a new wedding'}
        </button>
      </DialogActions>
    </div>
  )
}
