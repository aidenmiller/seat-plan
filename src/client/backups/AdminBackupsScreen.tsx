'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { adminBackupDownloadUrl, adminBackups, adminRestoreBackup, runBackupsNow } from '@/client/backups-api'
import { ApiRequestError, errorMessage } from '@/client/api'
import { useNow } from '@/client/ui/clock'
import { RelativeTime } from '@/client/ui/RelativeTime'
import { errorClass, inputClass, labelClass, primaryButton, secondaryButton } from '@/client/ui/styles'
import { plural } from '@/domain/wording'
import type { AdminBackupsReply, AdminBackupSummary, BackupRunInfo, RunBackupsReply } from '@/shared/backups-api'
import { backupCounts, backupTime, formatSize, kindLabel, nightlyStatus } from './outcomes'
import { RestoreBackupDialog } from './RestoreBackupDialog'

const cell = 'border-b border-stone-200 px-3 py-2 align-top'
const head = 'border-b border-stone-200 px-3 py-2 font-semibold'
const smallButton = `${secondaryButton} px-3`

type RunMessage = { tone: 'ok' | 'info' | 'error'; text: string }

function runMessage(reply: RunBackupsReply): RunMessage {
  const counts = `${reply.backedUp} backed up, ${reply.unchanged} unchanged, ${reply.failed} failed.`
  if (reply.error) return { tone: 'error', text: `The run stopped. ${reply.error} ${counts}` }
  if (reply.failed > 0 || reply.status === 'partial') return { tone: 'error', text: `The run finished with failures. ${counts}` }
  if (reply.remaining > 0) return { tone: 'info', text: `The run ran out of time. ${counts} ${plural(reply.remaining, 'wedding')} left for tomorrow night.` }
  return { tone: 'ok', text: `The run finished. ${counts}` }
}

/**
 * Admin: whether backups are set up and the nightly run is healthy, a button
 * to run it now, the recent runs with their failures, and every stored backup
 * (deleted weddings' too) with Download and Restore as a new wedding.
 */
export function AdminBackupsScreen() {
  const [data, setData] = useState<AdminBackupsReply | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<RunMessage | null>(null)
  const [restoring, setRestoring] = useState<AdminBackupSummary | null>(null)
  const now = useNow()

  const load = useCallback(async () => {
    try {
      setData(await adminBackups())
      setLoadError(null)
    } catch (err) {
      setLoadError(`Could not load the backups. ${errorMessage(err)}`)
    }
  }, [])

  useEffect(() => {
    // Loading when the page opens is the point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function runNow() {
    if (running) return
    setRunning(true)
    setMessage(null)
    try {
      setMessage(runMessage(await runBackupsNow()))
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        setMessage({ tone: 'info', text: 'A backup run is already in progress. Try again shortly.' })
      } else if (err instanceof ApiRequestError && err.status === 503) {
        setMessage({ tone: 'error', text: 'Backups are not set up yet.' })
      } else {
        setMessage({ tone: 'error', text: `Could not run the backup. ${errorMessage(err)}` })
      }
    }
    await load()
    setRunning(false)
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-4 py-6">
      <h2 className="text-xl font-semibold tracking-tight">Backups</h2>
      {loadError && (
        <p role="alert" className={errorClass}>
          {loadError}
        </p>
      )}
      {!data && !loadError && <p className="text-sm text-stone-600">Loading…</p>}
      {data && now !== null && (
        <>
          <BackupStatus data={data} nowMs={now} running={running} message={message} onRun={() => void runNow()} />
          <RunsSection runs={data.runs} />
          <BackupsSection data={data} onRestore={setRestoring} />
        </>
      )}
      <RestoreBackupDialog
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        description={restoring ? `${restoring.weddingName}: the backup from ${backupTime(restoring.createdAt)}.` : ''}
        send={(jobId) => adminRestoreBackup(restoring?.id ?? '', jobId)}
      />
    </main>
  )
}

/** Whether backups are set up, when the nightly run last worked, the storage used, and Run now. */
export function BackupStatus({
  data,
  nowMs,
  running,
  message,
  onRun,
}: {
  data: AdminBackupsReply
  /** The time now, in milliseconds. */
  nowMs: number
  running: boolean
  message: RunMessage | null
  onRun: () => void
}) {
  const status = nightlyStatus(data.configured, data.lastSuccessfulCronRunAt, nowMs, data.lastCronRun)
  return (
    <section aria-labelledby="backup-status-heading" className="space-y-3">
      <h3 id="backup-status-heading" className="text-lg font-semibold tracking-tight">
        Status
      </h3>
      {status.state === 'not-set-up' && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-800" data-testid="backup-banner" data-state="not-set-up">
          Backups are not set up. This deployment has no backup store. On Vercel, connect a private Blob store to Production.
        </p>
      )}
      {status.state === 'never' && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-800" data-testid="backup-banner" data-state="never">
          The nightly backup has never run. Check the schedule in Vercel.
        </p>
      )}
      {status.state === 'stale' && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-800" data-testid="backup-banner" data-state="stale">
          The nightly backup has not run since {backupTime(status.lastIso)}. Check the schedule in Vercel.
        </p>
      )}
      {status.state === 'failed' && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-800" data-testid="backup-banner" data-state="failed">
          The last nightly backup, at {backupTime(status.failedIso)}, failed or could not start. See Recent runs below.
        </p>
      )}
      <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-stone-200 bg-white p-4 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-xs font-medium uppercase tracking-wide text-stone-600 sm:text-sm sm:normal-case sm:tracking-normal sm:text-stone-700">Backups</dt>
        <dd className="mb-2 sm:mb-0" data-testid="backup-configured">
          {data.configured ? `Set up (${data.storeKind === 'vercel-blob' ? 'Vercel Blob' : data.storeKind === 'filesystem' ? 'a local folder' : 'in memory'})` : 'Not set up'}
        </dd>
        <dt className="text-xs font-medium uppercase tracking-wide text-stone-600 sm:text-sm sm:normal-case sm:tracking-normal sm:text-stone-700">Nightly run last worked</dt>
        <dd className="mb-2 sm:mb-0" data-testid="backup-last-success">
          {data.lastSuccessfulCronRunAt ? (
            <>
              {backupTime(data.lastSuccessfulCronRunAt)} (<RelativeTime iso={data.lastSuccessfulCronRunAt} />)
            </>
          ) : (
            'Never'
          )}
        </dd>
        <dt className="text-xs font-medium uppercase tracking-wide text-stone-600 sm:text-sm sm:normal-case sm:tracking-normal sm:text-stone-700">Storage used</dt>
        <dd className="mb-2 sm:mb-0" data-testid="backup-storage">
          {formatSize(data.storage.totalBytes)} ({plural(data.storage.backupCount, 'backup')}, {plural(data.storage.imageCount, 'floor plan image')})
        </dd>
        <dt className="text-xs font-medium uppercase tracking-wide text-stone-600 sm:text-sm sm:normal-case sm:tracking-normal sm:text-stone-700">Uploads in 30 days</dt>
        <dd className="mb-2 sm:mb-0" data-testid="backup-uploads">
          {data.uploadsLast30Days} of {data.uploadLimit30Days} (by hand: {data.manualUploadsLast30Days} of the {data.manualUploadLimit30Days} Back up now may use)
        </dd>
      </dl>
      <div>
        <button type="button" className={primaryButton} onClick={onRun} disabled={running || !data.configured}>
          {running ? 'Running the backup…' : 'Run now'}
        </button>
        <p className="mt-1 text-sm text-stone-600">Runs the nightly job now, for every wedding that changed. It can take a few minutes.</p>
        {message && (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={message.tone === 'error' ? `${errorClass} mt-2` : 'mt-2 text-sm text-stone-700'}
            data-testid="run-result"
          >
            {message.text}
          </p>
        )}
      </div>
    </section>
  )
}

function triggerText(run: BackupRunInfo): string {
  if (run.trigger === 'cron') return 'Nightly schedule'
  const who = run.startedByName ?? 'someone'
  return run.trigger === 'admin' ? `Run now by ${who}` : `Back up now by ${who}`
}

function statusText(status: BackupRunInfo['status']): string {
  switch (status) {
    case 'running':
      return 'Running'
    case 'ok':
      return 'Finished'
    case 'partial':
      return 'Finished with failures'
    case 'failed':
      return 'Failed'
  }
}

/** The recent runs, with the wedding and message of each failure. */
export function RunsSection({ runs }: { runs: BackupRunInfo[] }) {
  return (
    <section aria-labelledby="backup-runs-heading">
      <h3 id="backup-runs-heading" className="text-lg font-semibold tracking-tight">
        Recent runs
      </h3>
      {runs.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-stone-300 bg-white p-6 text-center text-stone-600">No runs yet.</p>
      ) : (
        <div className="relative mt-3 overflow-x-auto overscroll-x-contain rounded-xl border border-stone-200 bg-white" data-testid="backup-runs-box">
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm" data-testid="backup-runs">
            <thead className="text-left text-xs uppercase tracking-wide text-stone-600">
              <tr>
                <th scope="col" className={head}>When</th>
                <th scope="col" className={head}>Started by</th>
                <th scope="col" className={head}>Result</th>
                <th scope="col" className={head}>Backed up</th>
                <th scope="col" className={head}>Unchanged</th>
                <th scope="col" className={head}>Failed</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <Fragment key={run.id}>
                  <tr data-testid="backup-run" data-run-id={run.id}>
                    <td className={cell}>
                      <RelativeTime iso={run.startedAt} />
                    </td>
                    <td className={cell}>{triggerText(run)}</td>
                    <td className={cell}>{statusText(run.status)}</td>
                    <td className={cell}>{run.backedUp}</td>
                    <td className={cell}>{run.unchanged}</td>
                    <td className={cell}>{run.failed}</td>
                  </tr>
                  {(run.failures.length > 0 || run.error) && (
                    <tr>
                      <td colSpan={6} className={`${cell} bg-red-50 text-red-800`} data-testid="backup-run-failures">
                        {run.error && <p>{run.error}</p>}
                        {run.failures.map((f) => (
                          <p key={f.weddingId}>
                            <span className="font-medium">{f.weddingName ?? 'A wedding that is gone'}:</span> {f.message}
                          </p>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** Every stored backup, filtered to one wedding when one is picked. */
export function BackupsSection({ data, onRestore }: { data: AdminBackupsReply; onRestore: (backup: AdminBackupSummary) => void }) {
  const [weddingId, setWeddingId] = useState('')
  const weddings = new Map<string, string>()
  for (const b of data.backups) if (!weddings.has(b.weddingId)) weddings.set(b.weddingId, b.weddingName)
  const shown = weddingId ? data.backups.filter((b) => b.weddingId === weddingId) : data.backups
  return (
    <section aria-labelledby="backup-list-heading">
      <h3 id="backup-list-heading" className="text-lg font-semibold tracking-tight">
        All backups
      </h3>
      {data.backups.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-stone-300 bg-white p-6 text-center text-stone-600">No backups yet.</p>
      ) : (
        <>
          <div className="mt-3 max-w-sm">
            <label htmlFor="backup-wedding-filter" className={labelClass}>
              Show backups of
            </label>
            <select id="backup-wedding-filter" className={`${inputClass} mt-1`} value={weddingId} onChange={(e) => setWeddingId(e.target.value)}>
              <option value="">All weddings</option>
              {[...weddings].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          {data.totalBackups > data.backups.length && (
            <p className="mt-2 text-sm text-stone-600">
              Showing the newest {data.backups.length} of {data.totalBackups}.
            </p>
          )}
          <div className="relative mt-3 overflow-x-auto overscroll-x-contain rounded-xl border border-stone-200 bg-white" data-testid="backups-box">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm" data-testid="backups">
              <thead className="text-left text-xs uppercase tracking-wide text-stone-600">
                <tr>
                  <th scope="col" className={head}>Wedding</th>
                  <th scope="col" className={head}>Made</th>
                  <th scope="col" className={head}>Kind</th>
                  <th scope="col" className={head}>Size</th>
                  <th scope="col" className={head}>Holds</th>
                  <th scope="col" className={head}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id} data-testid="backup-row" data-backup-id={b.id} data-wedding-id={b.weddingId}>
                    <td className={`${cell} font-medium`}>
                      {b.weddingName}
                      {b.weddingState !== 'live' && <span className="block text-xs font-medium uppercase tracking-wide text-red-700">Deleted</span>}
                    </td>
                    <td className={cell}>
                      <time dateTime={b.createdAt}>{backupTime(b.createdAt)}</time>
                    </td>
                    <td className={cell}>{kindLabel(b.kind)}</td>
                    <td className={cell}>{formatSize(b.byteSize)}</td>
                    <td className={cell}>{backupCounts(b)}</td>
                    <td className={cell}>
                      {b.inThisStore ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <a href={adminBackupDownloadUrl(b.id)} download className={smallButton} aria-label={`Download the backup of ${b.weddingName} from ${backupTime(b.createdAt)}`}>
                            Download
                          </a>
                          <button type="button" className={smallButton} onClick={() => onRestore(b)}>
                            Restore as a new wedding
                          </button>
                        </div>
                      ) : (
                        <p className="text-right text-stone-600">In a store this deployment no longer uses.</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
