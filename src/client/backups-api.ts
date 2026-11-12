/**
 * The browser's calls for stored backups (src/shared/backups-api.ts): the
 * owner's list, "Back up now" and restore for one wedding, and the admin's
 * list, run and restore. Downloads are plain links, so the browser saves the
 * file as it arrives.
 */
import type { AdminBackupsReply, BackupNowReply, RestoredBackupReply, RunBackupsReply, WeddingBackupsReply } from '@/shared/backups-api'
import { request } from './api'

const enc = encodeURIComponent

export const listWeddingBackups = (weddingId: string) =>
  request<WeddingBackupsReply>('GET', `/api/weddings/${enc(weddingId)}/backups`)

export const backupNow = (weddingId: string) => request<BackupNowReply>('POST', `/api/weddings/${enc(weddingId)}/backups`)

export const weddingBackupDownloadUrl = (weddingId: string, backupId: string) =>
  `/api/weddings/${enc(weddingId)}/backups/${enc(backupId)}`

export const restoreWeddingBackup = (weddingId: string, backupId: string, jobId: string) =>
  request<RestoredBackupReply>('POST', `/api/weddings/${enc(weddingId)}/backups/${enc(backupId)}/restore`, { jobId })

export const adminBackups = () => request<AdminBackupsReply>('GET', '/api/admin/backups')

export const runBackupsNow = () => request<RunBackupsReply>('POST', '/api/admin/backups/run')

export const adminBackupDownloadUrl = (backupId: string) => `/api/admin/backups/${enc(backupId)}`

export const adminRestoreBackup = (backupId: string, jobId: string) =>
  request<RestoredBackupReply>('POST', `/api/admin/backups/${enc(backupId)}/restore`, { jobId })
