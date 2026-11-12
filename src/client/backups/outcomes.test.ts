import { describe, expect, it, vi } from 'vitest'
import { ApiRequestError } from '@/client/api'
import type { BackupNowReply, BackupSummary, RestoredBackupReply } from '@/shared/backups-api'
import { createRestoreAttempt, formatSize, kindLabel, nightlyStatus, runBackupNow, STALE_AFTER_MS } from './outcomes'

const backup: BackupSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  weddingId: '22222222-2222-4222-8222-222222222222',
  weddingName: 'Mira and Theo',
  kind: 'manual',
  createdAt: '2026-11-10T15:00:00.000Z',
  checkedAt: '2026-11-10T15:00:00.000Z',
  byteSize: 2048,
  guestCount: 3,
  layoutCount: 1,
  createdByName: 'Ada',
}

const fail = (status: number, body: unknown = null) => () => Promise.reject(new ApiRequestError(status, body, `failed ${status}`))

describe('kindLabel and formatSize', () => {
  it('says the kinds in plain words', () => {
    expect(kindLabel('nightly')).toBe('Nightly')
    expect(kindLabel('manual')).toBe('Made by hand')
    expect(kindLabel('final')).toBe('Final copy')
  })

  it('writes sizes short', () => {
    expect(formatSize(900)).toBe('900 B')
    expect(formatSize(2048)).toBe('2 KB')
    expect(formatSize(1.5 * 1024 * 1024)).toBe('1.5 MB')
  })
})

describe('runBackupNow', () => {
  it('says a backup was made, and asks for the list again', async () => {
    const reply: BackupNowReply = { status: 'created', backup }
    expect(await runBackupNow(() => Promise.resolve(reply))).toEqual({ tone: 'ok', message: 'Backed up.', reload: true })
  })

  it('says nothing was needed when nothing changed', async () => {
    const result = await runBackupNow(() => Promise.resolve({ status: 'unchanged', backup }))
    expect(result.tone).toBe('info')
    expect(result.message).toContain('Nothing has changed')
  })

  it('says it was already backed up in the last few minutes (429)', async () => {
    const result = await runBackupNow(fail(429, { error: 'too_soon' }))
    expect(result).toEqual({ tone: 'info', message: 'This wedding was already backed up in the last few minutes.', reload: false })
  })

  it('says why Back up now is paused: this person’s backups by hand for the day, or the uploads kept for the nightly run (429)', async () => {
    const daily = await runBackupNow(fail(429, { error: 'daily_limit', message: 'You have made 10 backups by hand in the last 24 hours.' }))
    expect(daily).toEqual({ tone: 'info', message: 'You have made 10 backups by hand in the last 24 hours.', reload: false })
    const budget = await runBackupNow(fail(429, { error: 'upload_limit', message: 'Back up now is paused: backups made by hand used 500 of the 500 uploads.' }))
    expect(budget.message).toMatch(/^Back up now is paused/)
  })

  it('says a run is in progress (409), in the server’s words when it gives them', async () => {
    const result = await runBackupNow(fail(409, { error: 'busy' }))
    expect(result.message).toBe('A backup run is in progress. Try again shortly.')
    const wedding = await runBackupNow(fail(409, { error: 'busy', message: 'This wedding is being backed up right now. Try again in a minute.' }))
    expect(wedding.message).toBe('This wedding is being backed up right now. Try again in a minute.')
  })

  it('says backups are not set up (503)', async () => {
    const result = await runBackupNow(fail(503, { error: 'not_configured' }))
    expect(result).toMatchObject({ tone: 'error', message: 'Backups are not set up yet.' })
  })

  it('shows the server message when the backup failed (500), and a plain line for a lost connection', async () => {
    const failed = await runBackupNow(fail(500, { error: 'backup_failed', message: 'The store refused the upload.' }))
    expect(failed.message).toBe('The backup did not work. The store refused the upload.')
    const offline = await runBackupNow(fail(0))
    expect(offline.tone).toBe('error')
    expect(offline.message).toContain('Could not reach the server')
  })
})

describe('createRestoreAttempt', () => {
  const restored: RestoredBackupReply = { jobId: 'x', weddingId: 'w', weddingName: 'Mira and Theo (restored)', droppedSeats: 0, ownersAdded: 0 }

  it('sends the same job id on every try, so Try again never makes a second wedding', async () => {
    const send = vi
      .fn<(jobId: string) => Promise<RestoredBackupReply>>()
      .mockRejectedValueOnce(new ApiRequestError(0, null, 'offline'))
      .mockResolvedValueOnce(restored)
    const attempt = createRestoreAttempt(send, () => 'job-1')
    const first = await attempt.run()
    expect(first.ok).toBe(false)
    if (!first.ok) expect(first.message).toContain('Could not reach the server')
    const second = await attempt.run()
    expect(second).toEqual({ ok: true, reply: restored })
    expect(send.mock.calls).toEqual([['job-1'], ['job-1']])
  })

  it('picks a new job id for a new attempt', () => {
    const send = () => Promise.resolve(restored)
    expect(createRestoreAttempt(send).jobId).not.toBe(createRestoreAttempt(send).jobId)
  })

  it('says why a backup that fails its checks cannot be restored, in the server’s words', async () => {
    const message = 'This backup is unreadable: its file does not match its checksum. Use Back up now to make a fresh one.'
    const attempt = createRestoreAttempt(fail(500, { error: 'corrupt', message }), () => 'job-2')
    expect(await attempt.run()).toEqual({ ok: false, message })
    const bare = createRestoreAttempt(fail(500, { error: 'corrupt' }), () => 'job-3')
    expect(await bare.run()).toEqual({ ok: false, message: 'This backup cannot be restored.' })
  })
})

describe('nightlyStatus', () => {
  const now = Date.parse('2026-11-11T12:00:00.000Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()

  it('is fresh within 36 hours, stale after, never without a run, and not set up without a store', () => {
    expect(nightlyStatus(true, ago(3 * 3600_000), now).state).toBe('fresh')
    expect(nightlyStatus(true, ago(STALE_AFTER_MS - 1000), now).state).toBe('fresh')
    expect(nightlyStatus(true, ago(STALE_AFTER_MS + 1000), now).state).toBe('stale')
    expect(nightlyStatus(true, null, now).state).toBe('never')
    expect(nightlyStatus(false, ago(1000), now).state).toBe('not-set-up')
  })

  it('says the last nightly run failed when a failed one (or one that could not start) came after the last that worked', () => {
    const lastGood = ago(25 * 3600_000)
    expect(nightlyStatus(true, lastGood, now, { startedAt: ago(3600_000), status: 'failed' })).toEqual({ state: 'failed', lastIso: lastGood, failedIso: ago(3600_000) })
    // An older failure, or a newer run that only partly worked (it ran out of time), is not one.
    expect(nightlyStatus(true, lastGood, now, { startedAt: ago(30 * 3600_000), status: 'failed' }).state).toBe('fresh')
    expect(nightlyStatus(true, lastGood, now, { startedAt: ago(3600_000), status: 'partial' }).state).toBe('fresh')
    // Stale wins: it says more.
    expect(nightlyStatus(true, ago(STALE_AFTER_MS + 1000), now, { startedAt: ago(3600_000), status: 'failed' }).state).toBe('stale')
  })
})
