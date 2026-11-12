import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { backupPathname, blobStoreId, BackupStoreError, getBackupStore, imagePathname, isBackupPathname, type BackupStore } from './store'
import { createFilesystemStore } from './store-fs'
import { createMemoryStore } from './store-memory'
import { createVercelBlobStore, type BlobSdk } from './store-vercel'

const WEDDING = '0b7e6a5c-1d2e-4f30-8a4b-5c6d7e8f9a0b'
const BACKUP = '9f8e7d6c-5b4a-4321-8fed-cba987654321'
const SHA = 'a'.repeat(64)
const AT = new Date('2026-11-11T08:03:09.123Z')

const temps: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'backup-store-'))
  temps.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

describe('backup pathnames', () => {
  it('names files by wedding, month, time, kind and backup id, and images by sha256', () => {
    expect(backupPathname(WEDDING, AT, 'nightly', BACKUP)).toBe(`backups/w/${WEDDING}/2026/11/20261111T080309Z-nightly-${BACKUP}.json.gz`)
    expect(backupPathname(WEDDING.toUpperCase(), AT, 'final', BACKUP)).toBe(`backups/w/${WEDDING}/2026/11/20261111T080309Z-final-${BACKUP}.json.gz`)
    expect(imagePathname(SHA, 'image/png')).toBe(`backups/images/${SHA}.png`)
    expect(imagePathname(SHA, 'image/jpeg')).toBe(`backups/images/${SHA}.jpg`)
  })

  it('accepts nothing else: no traversal, no absolute paths, no other folders or names', () => {
    const good = backupPathname(WEDDING, AT, 'manual', BACKUP)
    expect(isBackupPathname(good)).toBe(true)
    for (const bad of [
      '',
      '../etc/passwd',
      `backups/w/${WEDDING}/../../../x.json.gz`,
      `/backups/images/${SHA}.png`,
      `backups/images/${SHA}.png/..`,
      `backups\\images\\${SHA}.png`,
      `backups/images/${SHA}.gif`,
      `backups/images/${SHA.slice(1)}.png`,
      `backups/images/${SHA.toUpperCase()}.png`,
      `backups/images/../${SHA}.png`,
      `C:/backups/images/${SHA}.png`,
      `backups/w/${WEDDING}/2026/11/20261111T080309Z-weekly-${BACKUP}.json.gz`,
      `backups/w/${WEDDING}/2026/11/Noa and Aiden-nightly-${BACKUP}.json.gz`,
      `${good}\n`,
      `${good}/`,
      `x/${good}`,
    ]) {
      expect(isBackupPathname(bad), bad).toBe(false)
    }
    expect(() => imagePathname('../../x', 'image/png')).toThrow(BackupStoreError)
    expect(() => backupPathname('../x', AT, 'nightly', BACKUP)).toThrow(BackupStoreError)
  })
})

/** The one contract every store keeps. */
function contract(name: string, make: () => BackupStore) {
  describe(`${name} store`, () => {
    const file = () => backupPathname(WEDDING, AT, 'nightly', randomUUID())
    const image = () => imagePathname(randomUUID().replace(/-/g, '').padEnd(64, '0'), 'image/png')

    it('gives back exactly the bytes it was given, and null for a file it does not have', async () => {
      const store = make()
      const pathname = file()
      const bytes = new Uint8Array([0, 1, 2, 250, 255])
      await store.put(pathname, bytes, 'application/gzip')
      bytes[0] = 99 // changing the caller's array afterwards changes nothing stored
      expect(await store.get(pathname)).toEqual(new Uint8Array([0, 1, 2, 250, 255]))
      expect(await store.get(file())).toBeNull()
      // An empty file is a file.
      const empty = file()
      await store.put(empty, new Uint8Array(), 'application/gzip')
      expect(await store.get(empty)).toEqual(new Uint8Array())
    })

    it('refuses to overwrite unless told to', async () => {
      const store = make()
      const pathname = image()
      await store.put(pathname, new Uint8Array([1]), 'image/png')
      await expect(store.put(pathname, new Uint8Array([2]), 'image/png')).rejects.toThrow(BackupStoreError)
      expect(await store.get(pathname)).toEqual(new Uint8Array([1]))
      await store.put(pathname, new Uint8Array([3]), 'image/png', { overwrite: true })
      expect(await store.get(pathname)).toEqual(new Uint8Array([3]))
    })

    it('deletes, and deleting what is not there is not an error', async () => {
      const store = make()
      const a = file()
      const b = image()
      await store.put(a, new Uint8Array([1]), 'application/gzip')
      await store.put(b, new Uint8Array([2]), 'image/png')
      await store.delete([a, b, file()])
      expect(await store.get(a)).toBeNull()
      expect(await store.get(b)).toBeNull()
      await store.delete([])
    })

    it('refuses a pathname outside the pattern in every operation, touching nothing', async () => {
      const store = make()
      for (const bad of ['../outside.json.gz', `backups/images/../../${SHA}.png`, '/etc/passwd']) {
        await expect(store.put(bad, new Uint8Array([1]), 'image/png')).rejects.toThrow(BackupStoreError)
        await expect(store.get(bad)).rejects.toThrow(BackupStoreError)
        await expect(store.delete([bad])).rejects.toThrow(BackupStoreError)
      }
      // A bad name in a delete list stops the whole delete before any file goes.
      const good = file()
      await store.put(good, new Uint8Array([1]), 'application/gzip')
      await expect(store.delete([good, '../x'])).rejects.toThrow(BackupStoreError)
      expect(await store.get(good)).toEqual(new Uint8Array([1]))
    })
  })
}

contract('memory', () => createMemoryStore())
contract('filesystem', () => createFilesystemStore(tempDir()))

describe('filesystem store', () => {
  it('keeps every file inside its folder, writing through a temporary file', async () => {
    const root = tempDir()
    const store = createFilesystemStore(root)
    const pathname = backupPathname(WEDDING, AT, 'final', BACKUP)
    await store.put(pathname, new Uint8Array([7, 8]), 'application/gzip')
    expect(existsSync(path.join(root, ...pathname.split('/')))).toBe(true)
    // Nothing else left behind (no temporary file), nothing written beside the folder.
    const dir = path.join(root, 'backups', 'w', WEDDING, '2026', '11')
    expect(readdirSync(dir)).toEqual([pathname.split('/').pop()])
    expect(readdirSync(path.dirname(root)).filter((n) => n.startsWith('backups'))).toEqual([])
  })
})

describe('vercel blob store', () => {
  function fakeSdk() {
    const files = new Map<string, Uint8Array>()
    const sdk = {
      put: vi.fn(async (pathname: string, body: unknown) => {
        files.set(pathname, new Uint8Array(body as Buffer))
        return { pathname, url: '', downloadUrl: '', contentType: '', contentDisposition: '', etag: '' }
      }),
      get: vi.fn(async (pathname: string) => {
        const bytes = files.get(pathname)
        if (!bytes) return null
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            // Two chunks, as a real response may arrive.
            controller.enqueue(bytes.slice(0, 1))
            controller.enqueue(bytes.slice(1))
            controller.close()
          },
        })
        return { statusCode: 200, stream, headers: new Headers(), blob: { pathname, contentType: 'x', size: bytes.byteLength } }
      }),
      del: vi.fn(async (pathnames: string[]) => {
        for (const p of pathnames) files.delete(p)
      }),
      list: vi.fn(async () => {
        throw new Error('list() must never be called')
      }),
    }
    return sdk
  }

  it('passes private access, the content type, no random suffix and the overwrite flag, and never lists', async () => {
    const sdk = fakeSdk()
    const store = createVercelBlobStore('abc123', async () => sdk as unknown as BlobSdk)
    expect(store.kind).toBe('vercel-blob')
    expect(store.id).toBe('vercel-blob:abc123')
    const pathname = backupPathname(WEDDING, AT, 'nightly', BACKUP)
    await store.put(pathname, new Uint8Array([1, 2, 3]), 'application/gzip')
    expect(sdk.put).toHaveBeenCalledWith(pathname, expect.any(Buffer), {
      access: 'private',
      contentType: 'application/gzip',
      addRandomSuffix: false,
      allowOverwrite: false,
    })
    await store.put(imagePathname(SHA, 'image/png'), new Uint8Array([9]), 'image/png', { overwrite: true })
    expect(sdk.put).toHaveBeenLastCalledWith(imagePathname(SHA, 'image/png'), expect.any(Buffer), {
      access: 'private',
      contentType: 'image/png',
      addRandomSuffix: false,
      allowOverwrite: true,
    })

    expect(await store.get(pathname)).toEqual(new Uint8Array([1, 2, 3]))
    expect(sdk.get).toHaveBeenCalledWith(pathname, { access: 'private' })
    expect(await store.get(backupPathname(WEDDING, AT, 'nightly', randomUUID()))).toBeNull()

    await store.delete([pathname])
    expect(sdk.del).toHaveBeenCalledWith([pathname])
    await store.delete([])
    expect(sdk.del).toHaveBeenCalledTimes(1)
    expect(sdk.list).not.toHaveBeenCalled()
  })

  it('refuses a bad pathname before loading the SDK, and wraps SDK errors without their details', async () => {
    const load = vi.fn(async () => fakeSdk() as unknown as BlobSdk)
    const store = createVercelBlobStore('abc123', load)
    await expect(store.put('../x', new Uint8Array([1]), 'image/png')).rejects.toThrow(BackupStoreError)
    await expect(store.get('../x')).rejects.toThrow(BackupStoreError)
    expect(load).not.toHaveBeenCalled()

    class BlobStoreSuspendedError extends Error {}
    const failing = {
      put: vi.fn(async () => {
        throw new BlobStoreSuspendedError('Vercel Blob: This store has been suspended.')
      }),
      get: vi.fn(async () => ({ statusCode: 304, stream: null })),
      del: vi.fn(async () => {
        throw new Error('boom')
      }),
    }
    const broken = createVercelBlobStore('abc123', async () => failing as unknown as BlobSdk)
    const pathname = imagePathname(SHA, 'image/png')
    await expect(broken.put(pathname, new Uint8Array([1]), 'image/png')).rejects.toThrow(
      /^Vercel Blob upload failed \(BlobStoreSuspendedError: Vercel Blob: This store has been suspended\.\)$/,
    )
    await expect(broken.get(pathname)).rejects.toThrow(/answered 304/)
    await expect(broken.delete([pathname])).rejects.toThrow(BackupStoreError)
  })
})

describe('getBackupStore', () => {
  it('uses Vercel Blob only on the production deployment, with a store connected', () => {
    expect(getBackupStore({ VERCEL: '1', VERCEL_ENV: 'production', BLOB_STORE_ID: 'store_x' })?.kind).toBe('vercel-blob')
    expect(getBackupStore({ VERCEL: '1', VERCEL_ENV: 'production', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x_secret' })?.kind).toBe('vercel-blob')
    expect(getBackupStore({ VERCEL: '1', VERCEL_ENV: 'production', BLOB_STORE_ID: 'store_AbC9' })?.id).toBe('vercel-blob:abc9')
    // A token the store id cannot be read from: not set up, rather than guess.
    expect(getBackupStore({ VERCEL: '1', VERCEL_ENV: 'production', BLOB_READ_WRITE_TOKEN: 'not-a-token' })).toBeNull()
    // Production without a store: none (the build refuses this, but the routes must still say so plainly).
    expect(getBackupStore({ VERCEL: '1', VERCEL_ENV: 'production' })).toBeNull()
    // A folder setting is ignored on production: a function's disk does not last.
    expect(getBackupStore({ VERCEL: '1', VERCEL_ENV: 'production', BACKUP_STORE_DIR: '/tmp/x' })).toBeNull()
    expect(getBackupStore({ VERCEL: '1', VERCEL_ENV: 'production', BLOB_STORE_ID: 's', BACKUP_STORE_DIR: '/tmp/x' })?.kind).toBe('vercel-blob')
  })

  it('never uses the Blob store from a preview deployment or a laptop', () => {
    expect(getBackupStore({ VERCEL: '1', VERCEL_ENV: 'preview', BLOB_STORE_ID: 'store_x' })).toBeNull()
    expect(getBackupStore({ VERCEL: '1', VERCEL_ENV: 'preview', BLOB_STORE_ID: 'store_x', BACKUP_STORE_DIR: '.backups' })).toBeNull()
    expect(getBackupStore({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x' })).toBeNull()
    expect(getBackupStore({ VERCEL_ENV: 'development', BLOB_STORE_ID: 'store_x' })).toBeNull()
    expect(getBackupStore({})).toBeNull()
    expect(getBackupStore({ BACKUP_STORE_DIR: '  ' })).toBeNull()
  })

  it('uses a folder off Vercel when BACKUP_STORE_DIR names one, even with a Blob token about', () => {
    expect(getBackupStore({ BACKUP_STORE_DIR: '.backups' })?.kind).toBe('filesystem')
    expect(getBackupStore({ BACKUP_STORE_DIR: '.backups', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x' })?.kind).toBe('filesystem')
    expect(getBackupStore({ VERCEL_ENV: 'development', BACKUP_STORE_DIR: '.backups' })?.kind).toBe('filesystem')
  })
})

describe('store ids', () => {
  it('reads the Blob store id as the SDK does: BLOB_STORE_ID, else the id inside the token', () => {
    expect(blobStoreId({ BLOB_STORE_ID: 'store_Ab12' })).toBe('ab12')
    expect(blobStoreId({ BLOB_STORE_ID: 'ab12' })).toBe('ab12')
    expect(blobStoreId({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_Zz99_secretpart' })).toBe('zz99')
    // The connection's store id wins over a token, as OIDC does in the SDK.
    expect(blobStoreId({ BLOB_STORE_ID: 'one', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_two_secret' })).toBe('one')
    for (const env of [{}, { BLOB_STORE_ID: '' }, { BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw' }, { BLOB_STORE_ID: 'a/b' }]) expect(blobStoreId(env)).toBeNull()
  })

  it('tells stores apart: each folder, each memory store, each Blob store', () => {
    const a = tempDir()
    expect(createFilesystemStore(a).id).toBe(`filesystem:${path.resolve(a)}`)
    expect(createFilesystemStore(a).id).toBe(createFilesystemStore(a).id)
    expect(createFilesystemStore(tempDir()).id).not.toBe(createFilesystemStore(a).id)
    expect(createMemoryStore().id).not.toBe(createMemoryStore().id)
    expect(createVercelBlobStore('one').id).not.toBe(createVercelBlobStore('two').id)
  })
})
