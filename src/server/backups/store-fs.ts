import 'server-only'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assertBackupPathname, BackupStoreError, type BackupStore } from './store'

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined
}

/**
 * Backups in a folder on this machine (BACKUP_STORE_DIR), for local runs and
 * the e2e tests. A pathname must match the store's strict pattern, and the
 * resolved path must still sit inside the folder. A write goes to a
 * temporary file first and is renamed into place, so a reader never sees half
 * a file.
 */
export function createFilesystemStore(root: string): BackupStore {
  const base = path.resolve(root)

  function fullPath(pathname: string): string {
    assertBackupPathname(pathname)
    const full = path.resolve(base, ...pathname.split('/'))
    if (full !== base && !full.startsWith(base + path.sep)) throw new BackupStoreError('Refused a backup store path outside the store')
    return full
  }

  return {
    kind: 'filesystem',
    id: `filesystem:${base}`,
    async put(pathname, bytes, _contentType, opts) {
      const full = fullPath(pathname)
      if (!opts?.overwrite) {
        const exists = await stat(full).then(
          () => true,
          (err: unknown) => {
            if (errorCode(err) === 'ENOENT') return false
            throw err
          },
        )
        if (exists) throw new BackupStoreError('The backup store already has a file at that path')
      }
      await mkdir(path.dirname(full), { recursive: true })
      const temp = `${full}.${randomBytes(6).toString('hex')}.tmp`
      try {
        await writeFile(temp, bytes)
        await rename(temp, full)
      } catch (err) {
        await rm(temp, { force: true })
        throw err
      }
    },
    async get(pathname) {
      const full = fullPath(pathname)
      try {
        return new Uint8Array(await readFile(full))
      } catch (err) {
        if (errorCode(err) === 'ENOENT') return null
        throw err
      }
    },
    async delete(pathnames) {
      const fulls = pathnames.map(fullPath)
      for (const full of fulls) await rm(full, { force: true })
    },
  }
}
