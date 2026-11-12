import 'server-only'
import { assertBackupPathname, BackupStoreError, type BackupStore } from './store'

export type MemoryStore = BackupStore & {
  /** Every stored pathname, sorted (tests only: the real stores have no listing). */
  pathnames(): string[]
  /** The content type a file was written with. */
  contentTypeOf(pathname: string): string | null
  /** Replaces a stored file's bytes, to make a corrupt backup in a test. */
  tamper(pathname: string, bytes: Uint8Array): void
  /** How many times each operation ran. */
  readonly calls: { put: number; get: number; delete: number }
}

/** Backups in memory, for tests. It copies bytes in and out, so a caller can never change what is stored. */
export function createMemoryStore(): MemoryStore {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>()
  const calls = { put: 0, get: 0, delete: 0 }
  return {
    kind: 'memory',
    calls,
    async put(pathname, bytes, contentType, opts) {
      calls.put++
      assertBackupPathname(pathname)
      if (files.has(pathname) && !opts?.overwrite) throw new BackupStoreError('The backup store already has a file at that path')
      files.set(pathname, { bytes: new Uint8Array(bytes), contentType })
    },
    async get(pathname) {
      calls.get++
      assertBackupPathname(pathname)
      const file = files.get(pathname)
      return file ? new Uint8Array(file.bytes) : null
    },
    async delete(pathnames) {
      calls.delete++
      for (const pathname of pathnames) assertBackupPathname(pathname)
      for (const pathname of pathnames) files.delete(pathname)
    },
    pathnames: () => [...files.keys()].sort(),
    contentTypeOf: (pathname) => files.get(pathname)?.contentType ?? null,
    tamper(pathname, bytes) {
      const file = files.get(pathname)
      if (!file) throw new Error(`no file at ${pathname}`)
      files.set(pathname, { ...file, bytes: new Uint8Array(bytes) })
    },
  }
}
