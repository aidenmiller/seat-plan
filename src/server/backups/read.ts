import 'server-only'
import { gunzipSync } from 'node:zlib'
import { storedBackupHeadSchema, type StoredBackupHead, type StoredBackupImage } from '@/domain/backup/schema'
import { BackupIntegrityError, type ImageReader } from './assemble'
import { sha256Hex } from './hash'
import { imagePathname, type BackupStore } from './store'

/** The most a gzipped backup may grow to when read: far above any real wedding (BACKUP_LIMITS), so a damaged file cannot fill memory. */
const MAX_HEAD_BYTES = 64 * 1024 * 1024

export type OpenedBackup = { ok: true; head: StoredBackupHead } | { ok: false; message: string }

/**
 * A stored backup's head, checked before anything uses it: the file is there,
 * its bytes match the sha256 recorded when it was written, it unzips, it is
 * JSON, and it fits the backup format. Each failure says which, by name only
 * (never a guest's data). A store that cannot be reached throws instead: that
 * is not a broken backup, and trying again may work.
 */
export async function openStoredBackup(store: BackupStore, backup: { pathname: string; blobSha256: string }): Promise<OpenedBackup> {
  const bytes = await store.get(backup.pathname)
  if (!bytes) return { ok: false, message: 'The backup file is missing from the backup store.' }
  if (sha256Hex(bytes) !== backup.blobSha256) return { ok: false, message: 'The backup file does not match its checksum.' }
  let text: string
  try {
    text = gunzipSync(bytes, { maxOutputLength: MAX_HEAD_BYTES }).toString('utf8')
  } catch {
    return { ok: false, message: 'The backup file could not be unzipped.' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: 'The backup file is not valid JSON.' }
  }
  const parsed = storedBackupHeadSchema.safeParse(raw)
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.map(String).join('.')
    return { ok: false, message: `The backup file does not fit the backup format${where ? ` (at ${where})` : ''}.` }
  }
  return { ok: true, head: parsed.data }
}

/** An image's bytes from the backup store, where each is kept once by sha256. The caller checks the sha256. */
export function storeImageReader(store: BackupStore): ImageReader {
  return (ref) => store.get(imagePathname(ref.sha256, ref.contentType))
}

/** An image from the backup store, checked: throws BackupIntegrityError when it is missing or does not match. */
export async function readVerifiedImage(store: BackupStore, ref: StoredBackupImage): Promise<Uint8Array> {
  const bytes = await store.get(imagePathname(ref.sha256, ref.contentType))
  if (!bytes) throw new BackupIntegrityError(`The floor plan image ${ref.id} is missing from the backup store.`)
  if (sha256Hex(bytes) !== ref.sha256) throw new BackupIntegrityError(`The floor plan image ${ref.id} does not match its checksum.`)
  return bytes
}
