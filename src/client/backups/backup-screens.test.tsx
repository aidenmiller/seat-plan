import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AdminBackupsReply, AdminBackupSummary, BackupRunInfo, BackupSummary } from '@/shared/backups-api'
import { BackupsSection, BackupStatus, RunsSection } from './AdminBackupsScreen'
import { RestoreBackupDialog } from './RestoreBackupDialog'
import { SavedBackupsView } from './SavedBackups'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('@/client/ui/Dialog', () => ({
  Dialog: ({ open, title, children }: { open: boolean; title: string; children?: ReactNode }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
  DialogActions: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

const WEDDING = '22222222-2222-4222-8222-222222222222'
const backup = (id: string, extra: Partial<BackupSummary> = {}): BackupSummary => ({
  id,
  weddingId: WEDDING,
  weddingName: 'Mira and Theo',
  kind: 'nightly',
  createdAt: '2026-11-10T15:00:00.000Z',
  checkedAt: '2026-11-10T15:00:00.000Z',
  byteSize: 2048,
  guestCount: 12,
  layoutCount: 2,
  createdByName: null,
  ...extra,
})

const view = (props: Partial<Parameters<typeof SavedBackupsView>[0]>) =>
  renderToStaticMarkup(
    <SavedBackupsView
      data={{ configured: true, backups: [] }}
      loadError={null}
      backingUp={false}
      result={null}
      weddingId={WEDDING}
      onBackUp={() => undefined}
      onRestore={() => undefined}
      {...props}
    />,
  )

describe('SavedBackupsView', () => {
  it('lists backups with their kind in words, size and counts, and a download and restore for each', () => {
    const markup = view({
      data: {
        configured: true,
        backups: [backup('a1111111-1111-4111-8111-111111111111'), backup('b1111111-1111-4111-8111-111111111111', { kind: 'manual' }), backup('c1111111-1111-4111-8111-111111111111', { kind: 'final' })],
      },
    })
    expect(markup.match(/data-testid="backup-row"/g)).toHaveLength(3)
    expect(markup).toContain('Nightly')
    expect(markup).toContain('Made by hand')
    expect(markup).toContain('Final copy')
    expect(markup).toContain('2 KB')
    expect(markup).toContain('12 guests, 2 layouts')
    expect(markup).toContain(`href="/api/weddings/${WEDDING}/backups/a1111111-1111-4111-8111-111111111111"`)
    expect(markup.match(/Restore as a new wedding/g)).toHaveLength(3)
    // The list scrolls inside its own box.
    expect(markup).toContain('overflow-y-auto')
  })

  it('says there are no backups yet', () => {
    expect(view({})).toContain('No backups yet. The first one is made tonight.')
  })

  it('says backups are not set up, and offers no button', () => {
    const markup = view({ data: { configured: false, backups: [] } })
    expect(markup).toContain('Backups are not set up yet.')
    expect(markup).not.toContain('Back up now')
  })

  it('shows each outcome of Back up now', () => {
    expect(view({ result: { tone: 'ok', message: 'Backed up.', reload: true } })).toContain('Backed up.')
    const soon = view({ result: { tone: 'info', message: 'This wedding was already backed up in the last few minutes.', reload: false } })
    expect(soon).toContain('already backed up in the last few minutes')
    expect(soon).toContain('role="status"')
    const failed = view({ result: { tone: 'error', message: 'Backups are not set up yet.', reload: false } })
    expect(failed).toContain('role="alert"')
  })

  it('disables the button and says so while backing up', () => {
    const markup = view({ backingUp: true })
    expect(markup).toContain('Backing up…')
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Backing up…/)
  })

  it('shows a load failure', () => {
    expect(view({ data: null, loadError: 'Could not load the saved backups. The server had a problem. Try again.' })).toContain('Could not load')
  })
})

describe('RestoreBackupDialog', () => {
  it('explains that it makes a new wedding and changes nothing in this one', () => {
    const markup = renderToStaticMarkup(
      <RestoreBackupDialog open onClose={() => undefined} description="The backup from Nov 10, 10:00 am." send={() => Promise.reject(new Error('unused'))} />,
    )
    expect(markup).toContain('This makes a new wedding')
    expect(markup).toContain('changes nothing in any existing wedding')
    expect(markup).toContain('Restore as a new wedding')
  })
})

const NOW = Date.parse('2026-11-11T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()

const admin = (extra: Partial<AdminBackupsReply> = {}): AdminBackupsReply => ({
  configured: true,
  storeKind: 'vercel-blob',
  backups: [],
  totalBackups: 0,
  runs: [],
  storage: { backupCount: 4, backupBytes: 4096, imageCount: 1, imageBytes: 1024 * 1024, totalBytes: 1024 * 1024 + 4096 },
  lastSuccessfulCronRunAt: hoursAgo(5),
  lastCronRun: null,
  uploadsLast30Days: 10,
  uploadLimit30Days: 1000,
  manualUploadsLast30Days: 3,
  manualUploadLimit30Days: 500,
  ...extra,
})

const status = (data: AdminBackupsReply, props: Partial<Parameters<typeof BackupStatus>[0]> = {}) =>
  renderToStaticMarkup(<BackupStatus data={data} nowMs={NOW} running={false} message={null} onRun={() => undefined} {...props} />)

describe('BackupStatus', () => {
  it('shows no warning when the nightly run worked within 36 hours', () => {
    const markup = status(admin())
    expect(markup).not.toContain('backup-banner')
    expect(markup).toContain('Run now')
    expect(markup).toContain('1.0 MB')
  })

  it('warns in red when it last worked more than 36 hours ago', () => {
    const markup = status(admin({ lastSuccessfulCronRunAt: hoursAgo(40) }))
    expect(markup).toContain('data-state="stale"')
    expect(markup).toContain('The nightly backup has not run since')
    expect(markup).toContain('Check the schedule in Vercel.')
    expect(markup).toContain('text-red-800')
  })

  it('warns when the newest nightly run failed or could not start, after the last that worked', () => {
    const markup = status(admin({ lastSuccessfulCronRunAt: hoursAgo(25), lastCronRun: { startedAt: hoursAgo(1), status: 'failed' } }))
    expect(markup).toContain('data-state="failed"')
    expect(markup).toContain('failed or could not start. See Recent runs below.')
  })

  it('shows the uploads of the last 30 days against the limit, and those made by hand against their share', () => {
    expect(status(admin())).toContain('10 of 1000 (by hand: 3 of the 500 Back up now may use)')
  })

  it('warns when it has never run', () => {
    const markup = status(admin({ lastSuccessfulCronRunAt: null }))
    expect(markup).toContain('data-state="never"')
    expect(markup).toContain('Check the schedule in Vercel.')
  })

  it('says backups are not set up, and disables Run now', () => {
    const markup = status(admin({ configured: false, storeKind: null, lastSuccessfulCronRunAt: null }))
    expect(markup).toContain('data-state="not-set-up"')
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Run now/)
  })

  it('shows progress while running and the result after', () => {
    expect(status(admin(), { running: true })).toContain('Running the backup…')
    expect(status(admin(), { message: { tone: 'info', text: 'A backup run is already in progress. Try again shortly.' } })).toContain('already in progress')
  })
})

describe('RunsSection', () => {
  const run = (extra: Partial<BackupRunInfo>): BackupRunInfo => ({
    id: '33333333-3333-4333-8333-333333333333',
    trigger: 'cron',
    startedByName: null,
    startedAt: hoursAgo(5),
    heartbeatAt: hoursAgo(5),
    finishedAt: hoursAgo(5),
    status: 'ok',
    backedUp: 4,
    unchanged: 9,
    failed: 0,
    remaining: 0,
    failures: [],
    error: null,
    ...extra,
  })

  it('shows who started a run and its counts', () => {
    const markup = renderToStaticMarkup(
      <RunsSection runs={[run({}), run({ id: '44444444-4444-4444-8444-444444444444', trigger: 'admin', startedByName: 'Ada' })]} />,
    )
    expect(markup).toContain('Nightly schedule')
    expect(markup).toContain('Run now by Ada')
    expect(markup).toContain('Finished')
    expect(markup).not.toContain('backup-run-failures')
  })

  it('names the wedding and message of each failure, inside a table that scrolls in its own box', () => {
    const markup = renderToStaticMarkup(
      <RunsSection
        runs={[run({ status: 'partial', failed: 1, failures: [{ weddingId: WEDDING, weddingName: 'Mira and Theo', message: 'The store refused the upload.' }] })]}
      />,
    )
    expect(markup).toContain('Finished with failures')
    expect(markup).toContain('Mira and Theo:')
    expect(markup).toContain('The store refused the upload.')
    expect(markup).toContain('relative mt-3 overflow-x-auto')
  })

  it('says when there are no runs', () => {
    expect(renderToStaticMarkup(<RunsSection runs={[]} />)).toContain('No runs yet.')
  })
})

describe('BackupsSection', () => {
  const adminBackup = (id: string, extra: Partial<AdminBackupSummary> = {}): AdminBackupSummary => ({
    ...backup(id),
    weddingState: 'live',
    inThisStore: true,
    ...extra,
  })

  it('marks deleted weddings and offers download and restore, except for a backup from another store', () => {
    const backups = [
      adminBackup('a1111111-1111-4111-8111-111111111111'),
      adminBackup('b1111111-1111-4111-8111-111111111111', { weddingId: '55555555-5555-4555-8555-555555555555', weddingName: 'Gone wedding', weddingState: 'deleted', kind: 'final' }),
      adminBackup('c1111111-1111-4111-8111-111111111111', { inThisStore: false }),
    ]
    const markup = renderToStaticMarkup(<BackupsSection data={admin({ backups, totalBackups: 3 })} onRestore={() => undefined} />)
    expect(markup.match(/data-testid="backup-row"/g)).toHaveLength(3)
    expect(markup).toContain('Gone wedding')
    expect(markup).toContain('Deleted')
    expect(markup).toContain('Final copy')
    expect(markup).toContain('href="/api/admin/backups/a1111111-1111-4111-8111-111111111111"')
    expect(markup.match(/Restore as a new wedding/g)).toHaveLength(2)
    expect(markup).toContain('no longer uses')
    // A filter by wedding, one entry per wedding.
    expect(markup).toContain('All weddings')
    expect(markup.match(/<option/g)).toHaveLength(3)
  })

  it('says when the list is cut short', () => {
    const markup = renderToStaticMarkup(
      <BackupsSection data={admin({ backups: [adminBackup('a1111111-1111-4111-8111-111111111111')], totalBackups: 1500 })} onRestore={() => undefined} />,
    )
    expect(markup).toContain('Showing the newest 1 of 1500.')
  })
})
