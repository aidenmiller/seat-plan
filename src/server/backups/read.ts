import 'server-only'
import { gunzipSync } from 'node:zlib'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { StoredBackupHead, StoredBackupImage } from '@/domain/backup/schema'
import { backupImages, backups } from '../db/schema'
import type { Db } from '../locks'
import { BackupIntegrityError, type ImageReader } from './assemble'
import { checkStoredHead, MAX_HEAD_BYTES } from './format'
import { sha256Hex } from './hash'
import { imagePathname, type BackupStore } from './store'

export type OpenedBackup = { ok: true; head: StoredBackupHead } | { ok: false; problem: string }

/**
 * A stored backup's head, checked before anything uses it: the file is there,
 * its bytes match the sha256 recorded when it was written, it unzips, it is
 * JSON, and it fits the backup format. A failure says which, as a short
 * phrase by name only (never a guest's data). A store that cannot be reached
 * throws instead: that is not a broken backup, and trying again may work.
 */
export async function openStoredBackup(store: BackupStore, backup: { pathname: string; blobSha256: string }): Promise<OpenedBackup> {
  const bytes = await store.get(backup.pathname)
  if (!bytes) return { ok: false, problem: 'its file is missing from the backup store' }
  if (sha256Hex(bytes) !== backup.blobSha256) return { ok: false, problem: 'its file does not match its checksum' }
  let text: string
  try {
    text = gunzipSync(bytes, { maxOutputLength: MAX_HEAD_BYTES }).toString('utf8')
  } catch {
    return { ok: false, problem: 'its file could not be unzipped' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, problem: 'its file is not valid JSON' }
  }
  const checked = checkStoredHead(raw)
  if (!checked.ok) return { ok: false, problem: `its file does not fit the backup format (${checked.problem})` }
  return { ok: true, head: checked.head }
}

/** What a person is told about a stored backup that cannot be read: what is wrong, and what to do. */
export function unreadableMessage(problem: string): string {
  return `This backup is unreadable: ${problem}. Use Back up now to make a fresh one.`
}

/**
 * Marks a stored backup unreadable, once: it is never again what "unchanged"
 * compares with, so the next run makes a fresh backup of its wedding.
 */
export async function markUnreadable(db: Db, backupId: string): Promise<void> {
  await db
    .update(backups)
    .set({ unreadableAt: sql`now()`, verifiedAt: sql`now()` })
    .where(and(eq(backups.id, backupId), isNull(backups.unreadableAt)))
}

/**
 * Forgets a floor plan image whose file is missing from the store or does not
 * match: its backup_images row goes, so the next backup that needs the image
 * uploads it again (by content, to the same path, which mends every backup
 * that names it) instead of trusting a row with no file behind it.
 */
export async function forgetBrokenImage(db: Db, storeId: string, sha256: string): Promise<void> {
  await db.delete(backupImages).where(and(eq(backupImages.storeId, storeId), eq(backupImages.sha256, sha256)))
}

/**
 * An image's bytes from the backup store, where each is kept once by sha256.
 * The caller checks the sha256. With `db`, an image that is missing or does
 * not match is forgotten (forgetBrokenImage) as it is found.
 */
export function storeImageReader(store: BackupStore, db?: Db): ImageReader {
  return async (ref) => {
    const bytes = await store.get(imagePathname(ref.sha256, ref.contentType))
    if (db && (!bytes || sha256Hex(bytes) !== ref.sha256)) await forgetBrokenImage(db, store.id, ref.sha256)
    return bytes
  }
}

/**
 * An image from the backup store, checked: throws BackupIntegrityError when it
 * is missing or does not match. With `db`, such an image is forgotten too.
 */
export async function readVerifiedImage(store: BackupStore, ref: StoredBackupImage, db?: Db): Promise<Uint8Array> {
  const bytes = await store.get(imagePathname(ref.sha256, ref.contentType))
  const problem = !bytes ? 'is missing from the backup store' : sha256Hex(bytes) !== ref.sha256 ? 'does not match its checksum' : null
  if (problem) {
    if (db) await forgetBrokenImage(db, store.id, ref.sha256)
    throw new BackupIntegrityError(`its floor plan image ${ref.id} ${problem}`)
  }
  return bytes!
}
