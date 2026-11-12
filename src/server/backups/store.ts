import 'server-only'
import { createFilesystemStore } from './store-fs'
import { createVercelBlobStore } from './store-vercel'

/**
 * Where stored backups live. Three kinds, one contract (store.test.ts runs
 * the same test against the memory and filesystem stores):
 *
 *  - 'vercel-blob': a PRIVATE Vercel Blob store, on the production deployment
 *    only. @vercel/blob is loaded with a dynamic import, so local runs and
 *    tests never need it. list() is never called: on the Hobby plan it is an
 *    "advanced operation", and going over 2,000 of those in a month locks the
 *    store for 30 days. The database (backups, backup_images) is the index.
 *  - 'filesystem': a folder (BACKUP_STORE_DIR), for local runs and e2e tests.
 *  - 'memory': for tests.
 *
 * Reads return the whole file as bytes rather than a stream: every read is
 * checked against its sha256 before anything is used or sent, and the files
 * are small (a gzipped backup is a few hundred KB at most; a floor plan image
 * is at most 3.5 MB), read one at a time.
 *
 * Every pathname must match BACKUP_PATHNAME_RE, so no store can be pointed
 * outside its own folders (no "..", no absolute paths, nothing but ids,
 * dates and hashes). Pathnames never hold a name.
 */

export type BackupStoreKind = 'vercel-blob' | 'filesystem' | 'memory'

export interface BackupStore {
  readonly kind: BackupStoreKind
  /** Writes the file. Throws when it already exists, unless `overwrite`. */
  put(pathname: string, bytes: Uint8Array, contentType: string, opts?: { overwrite?: boolean }): Promise<void>
  /** The file's bytes, or null when there is none. */
  get(pathname: string): Promise<Uint8Array | null>
  /** Deletes the files. A file that is not there is not an error. */
  delete(pathnames: readonly string[]): Promise<void>
}

/** A store error whose message is safe to record (no file contents, no names). */
export class BackupStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupStoreError'
  }
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const BACKUP_FILE_RE = new RegExp(`^backups/w/${UUID}/\\d{4}/\\d{2}/\\d{8}T\\d{6}Z-(nightly|manual|final)-${UUID}\\.json\\.gz$`)
const IMAGE_FILE_RE = /^backups\/images\/[0-9a-f]{64}\.(png|jpg)$/

/** True for the only two shapes of pathname a store accepts. */
export function isBackupPathname(pathname: string): boolean {
  return BACKUP_FILE_RE.test(pathname) || IMAGE_FILE_RE.test(pathname)
}

export function assertBackupPathname(pathname: string): void {
  if (!isBackupPathname(pathname)) throw new BackupStoreError('Refused a backup store path that is not a backup or image path')
}

/** 2026-11-11T08:03:09.123Z → 20261111T080309Z (ISO 8601 basic: no colons, which some file systems refuse). */
function compactTimestamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '')
}

/** backups/w/<weddingId>/<YYYY>/<MM>/<timestamp>-<kind>-<backupId>.json.gz */
export function backupPathname(weddingId: string, createdAt: Date, kind: 'nightly' | 'manual' | 'final', backupId: string): string {
  const iso = createdAt.toISOString()
  const pathname = `backups/w/${weddingId.toLowerCase()}/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${compactTimestamp(createdAt)}-${kind}-${backupId.toLowerCase()}.json.gz`
  assertBackupPathname(pathname)
  return pathname
}

/** backups/images/<sha256>.<png|jpg> */
export function imagePathname(sha256: string, contentType: 'image/png' | 'image/jpeg'): string {
  const pathname = `backups/images/${sha256}.${contentType === 'image/png' ? 'png' : 'jpg'}`
  assertBackupPathname(pathname)
  return pathname
}

/**
 * The store this deployment uses, or null when backups are not set up
 * (callers answer "Backups are not set up").
 *
 *  - The production deployment on Vercel (VERCEL=1 and VERCEL_ENV=production)
 *    uses Vercel Blob when a store is connected (BLOB_STORE_ID, which comes
 *    with the connection and authenticates through OIDC, or a
 *    BLOB_READ_WRITE_TOKEN). BACKUP_STORE_DIR is ignored there: a Vercel
 *    function's disk does not last.
 *  - Any other Vercel deployment (preview, development) has none. A preview
 *    pruning against its own database could otherwise delete images that
 *    production's backups still use.
 *  - Off Vercel, BACKUP_STORE_DIR names a folder; without it, none. So a
 *    laptop never writes to the production store, even with a Blob token in
 *    its environment.
 */
export function getBackupStore(env: Readonly<Record<string, string | undefined>> = process.env): BackupStore | null {
  if (env.VERCEL_ENV === 'production') {
    const connected = Boolean(env.BLOB_STORE_ID || env.BLOB_READ_WRITE_TOKEN)
    return env.VERCEL === '1' && connected ? createVercelBlobStore() : null
  }
  if (env.VERCEL_ENV === 'preview') return null
  const dir = env.BACKUP_STORE_DIR?.trim()
  return dir ? createFilesystemStore(dir) : null
}
