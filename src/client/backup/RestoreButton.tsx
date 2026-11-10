'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, type ChangeEvent } from 'react'
import { errorMessage } from '@/client/api'
import { randomId } from '@/client/sync/random-id'
import { Dialog, DialogActions } from '@/client/ui/Dialog'
import { errorClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import type { BackupFile } from '@/domain/backup/schema'
import { readBackupFile, runRestore, type RestoreProgress } from './restore'

type State =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'ready'; backup: BackupFile; jobId: string }
  | { kind: 'running'; backup: BackupFile; jobId: string; progress: RestoreProgress }
  | { kind: 'failed'; backup: BackupFile; jobId: string; message: string; progress: RestoreProgress | null }
  | { kind: 'bad-file'; message: string }
  | { kind: 'done'; weddingId: string; weddingName: string; droppedSeats: number }

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * "Restore from file" on the home screen (spec section 11): pick a backup
 * file, see what it holds, then restore it as a new wedding with each step
 * shown as it goes. A failed step can be tried again; the steps already done
 * are not done twice.
 */
export function RestoreButton() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<State>({ kind: 'idle' })

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setState({ kind: 'reading' })
    const read = await readBackupFile(file)
    // One job id per file pick: trying again resumes the same restore.
    setState(read.ok ? { kind: 'ready', backup: read.backup, jobId: randomId() } : { kind: 'bad-file', message: read.message })
  }

  async function restore(backup: BackupFile, jobId: string) {
    let last: RestoreProgress | null = null
    setState({ kind: 'running', backup, jobId, progress: { label: 'Starting', done: 0, total: 1 } })
    try {
      const result = await runRestore(backup, jobId, (progress) => {
        last = progress
        setState({ kind: 'running', backup, jobId, progress })
      })
      setState({ kind: 'done', weddingId: result.weddingId, weddingName: result.weddingName, droppedSeats: result.droppedSeats })
      router.refresh()
    } catch (err) {
      setState({ kind: 'failed', backup, jobId, message: errorMessage(err), progress: last })
    }
  }

  const running = state.kind === 'running'
  const open = state.kind !== 'idle' && state.kind !== 'reading'

  return (
    <>
      <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={onPick} data-testid="restore-file" />
      <button type="button" className={secondaryButton} onClick={() => inputRef.current?.click()} disabled={state.kind === 'reading'}>
        {state.kind === 'reading' ? 'Reading…' : 'Restore from file'}
      </button>
      <Dialog open={open} onClose={() => setState({ kind: 'idle' })} title="Restore from file" dismissable={!running} testId="restore-dialog">
        {state.kind === 'bad-file' && (
          <>
            <p role="alert" className={errorClass}>
              {state.message}
            </p>
            <DialogActions>
              <button type="button" className={secondaryButton} onClick={() => setState({ kind: 'idle' })}>
                Close
              </button>
            </DialogActions>
          </>
        )}

        {(state.kind === 'ready' || state.kind === 'running' || state.kind === 'failed') && (
          <>
            <p className="text-sm text-stone-700">
              <span className="font-medium text-stone-900">{state.backup.wedding.name}</span> with{' '}
              {plural(state.backup.guests.length, 'guest')}, {plural(state.backup.layouts.length, 'layout')} and{' '}
              {plural(state.backup.rules.length, 'rule')}. It is restored as a new wedding; your other weddings stay as they are.
            </p>
            {state.kind !== 'ready' && state.progress && <Progress progress={state.progress} />}
            {state.kind === 'failed' && (
              <p role="alert" className={`${errorClass} mt-3`}>
                Restore stopped. {state.message}
              </p>
            )}
            <DialogActions>
              <button type="button" className={secondaryButton} onClick={() => setState({ kind: 'idle' })} disabled={running}>
                Cancel
              </button>
              <button
                type="button"
                className={primaryButton}
                disabled={running}
                onClick={() => void restore(state.backup, state.jobId)}
              >
                {running ? 'Restoring…' : state.kind === 'failed' ? 'Try again' : 'Restore'}
              </button>
            </DialogActions>
          </>
        )}

        {state.kind === 'done' && (
          <>
            <p role="status" className="text-sm text-stone-700">
              Restored as <span className="font-medium text-stone-900">{state.weddingName}</span>.
              {state.droppedSeats > 0 && ` ${plural(state.droppedSeats, 'seat')} pointed at guests not in the file and were left empty.`}
            </p>
            <DialogActions>
              <button type="button" className={secondaryButton} onClick={() => setState({ kind: 'idle' })}>
                Close
              </button>
              <button type="button" className={primaryButton} onClick={() => router.push(`/w/${state.weddingId}/layouts`)}>
                Open wedding
              </button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  )
}

function Progress({ progress }: { progress: RestoreProgress }) {
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <div className="mt-4" data-testid="restore-progress">
      <div className="flex justify-between gap-2 text-sm text-stone-700">
        <span aria-live="polite">{progress.label}</span>
        <span>
          {progress.done} of {progress.total}
        </span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-stone-200"
        role="progressbar"
        aria-label="Restore progress"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
      >
        <div className="h-full bg-blue-900 transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
