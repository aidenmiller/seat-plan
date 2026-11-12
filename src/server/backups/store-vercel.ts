import 'server-only'
import { assertBackupPathname, BackupStoreError, type BackupStore } from './store'

/** The parts of @vercel/blob this store uses. list() is deliberately not among them (store.ts). */
export type BlobSdk = Pick<typeof import('@vercel/blob'), 'put' | 'get' | 'del'>

const loadSdk = async (): Promise<BlobSdk> => import('@vercel/blob')

/**
 * The SDK's error class (its errors all say name "Error") and its message,
 * which is generic ("This store has been suspended.", "Failed to fetch blob:
 * 403 Forbidden"); pathnames hold only ids. Cut short to be safe.
 */
function sdkFailure(op: string, err: unknown): BackupStoreError {
  const kind = err instanceof Error ? err.constructor.name || err.name : 'unknown error'
  const message = err instanceof Error ? err.message.replace(/\s+/g, ' ').slice(0, 200) : ''
  return new BackupStoreError(`Vercel Blob ${op} failed (${kind}${message ? `: ${message}` : ''})`)
}

/** Reads a whole stream into one array. */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

/**
 * A PRIVATE Vercel Blob store. The SDK finds its credentials itself: on
 * Vercel, the OIDC token and BLOB_STORE_ID that connecting the store to the
 * project provides; elsewhere, BLOB_READ_WRITE_TOKEN. Pathnames are used as
 * they are (no random suffix), so the database's pathname is the blob's.
 */
export function createVercelBlobStore(storeId: string, load: () => Promise<BlobSdk> = loadSdk): BackupStore {
  return {
    kind: 'vercel-blob',
    id: `vercel-blob:${storeId}`,
    async put(pathname, bytes, contentType, opts) {
      assertBackupPathname(pathname)
      const sdk = await load()
      try {
        await sdk.put(pathname, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
          access: 'private',
          contentType,
          addRandomSuffix: false,
          allowOverwrite: opts?.overwrite ?? false,
        })
      } catch (err) {
        throw sdkFailure('upload', err)
      }
    },
    async get(pathname) {
      assertBackupPathname(pathname)
      const sdk = await load()
      let result: Awaited<ReturnType<BlobSdk['get']>>
      try {
        result = await sdk.get(pathname, { access: 'private' })
      } catch (err) {
        // The SDK answers null for a missing blob; be safe in case a version throws this instead.
        if (err instanceof Error && err.constructor.name === 'BlobNotFoundError') return null
        throw sdkFailure('read', err)
      }
      if (!result) return null
      if (result.statusCode !== 200) throw new BackupStoreError(`Vercel Blob read answered ${result.statusCode}`)
      try {
        return await readAll(result.stream)
      } catch (err) {
        throw sdkFailure('read', err)
      }
    },
    async delete(pathnames) {
      for (const pathname of pathnames) assertBackupPathname(pathname)
      if (pathnames.length === 0) return
      const sdk = await load()
      try {
        await sdk.del([...pathnames])
      } catch (err) {
        throw sdkFailure('delete', err)
      }
    },
  }
}
