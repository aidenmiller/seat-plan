import type { NextRequest } from 'next/server'
import { notFound } from '@/server/api-route'
import { withWeddingRole } from '@/server/auth/guards'
import { byWeddingId } from '@/server/auth/resolvers'
import { backupIdParam, notConfigured, storedBackupDownload } from '@/server/backups/http'
import { getBackupStore } from '@/server/backups/store'
import { getDb } from '@/server/db/client'
import { getWeddingBackup } from '@/server/repo/backups'

type Context = { params: Promise<{ id: string; backupId: string }> }

/**
 * One stored backup of this wedding, as a normal backup file (the same
 * format and file name as Download backup, with the backup's date), which
 * Restore from file reads. The backup must be this wedding's: another
 * wedding's backup id answers 404, as a missing one does. Owners only.
 */
export const GET = withWeddingRole<Context>(byWeddingId, 'owner', async (_req: NextRequest, ctx: Context, access) => {
  const backupId = await backupIdParam(ctx)
  if (!backupId) return notFound()
  const backup = await getWeddingBackup(getDb(), access.weddingId, backupId)
  if (!backup) return notFound()
  const store = getBackupStore()
  if (!store) return notConfigured()
  return storedBackupDownload(store, backup)
})
