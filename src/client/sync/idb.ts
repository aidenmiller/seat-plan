/**
 * Opening and deleting the app's IndexedDB databases. Each database holds one
 * object store, the way idb-keyval lays them out, and works with idb-keyval's
 * get, set, del and entries.
 *
 * openKeyvalStore is idb-keyval's createStore plus one thing: a connection
 * closes itself when another page (or this one) asks to delete or upgrade its
 * database (the versionchange event), so signing out, which deletes the
 * user's databases, is never held up by a connection this app left open. The
 * next use opens the database again.
 */
import { promisifyRequest, type UseStore } from 'idb-keyval'

export function openKeyvalStore(dbName: string, storeName: string): UseStore {
  let dbp: Promise<IDBDatabase> | undefined
  const getDB = (): Promise<IDBDatabase> => {
    if (dbp) return dbp
    const request = indexedDB.open(dbName)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName)
    }
    const opened = promisifyRequest(request)
    dbp = opened
    opened.then(
      (db) => {
        const forget = () => {
          if (dbp === opened) dbp = undefined
        }
        // Safari sometimes closes a connection by itself.
        db.onclose = forget
        db.onversionchange = () => {
          db.close()
          forget()
        }
      },
      () => {
        if (dbp === opened) dbp = undefined
      },
    )
    return opened
  }
  return (txMode, callback) => getDB().then((db) => callback(db.transaction(storeName, txMode).objectStore(storeName)))
}

/**
 * Opens a database only if it already exists; null when there is none (the
 * upgrade that would create it is aborted, so looking never makes one). The
 * connection closes itself when another page asks to delete or upgrade the
 * database; the caller closes it when done.
 */
export function openExistingDatabase(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(name)
    } catch (error) {
      reject(error)
      return
    }
    let missing = false
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) {
        missing = true
        request.transaction?.abort()
      }
    }
    request.onerror = (event) => {
      event.preventDefault()
      if (missing) resolve(null)
      else reject(request.error)
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
  })
}

export type StoredEntry = { key: IDBValidKey; value: unknown }

/** Every key and value in one store of an open database. */
export function readAllEntries(db: IDBDatabase, storeName: string): Promise<StoredEntry[]> {
  const store = db.transaction(storeName, 'readonly').objectStore(storeName)
  return Promise.all([promisifyRequest(store.getAllKeys()), promisifyRequest(store.getAll())]).then(([keys, values]) =>
    keys.map((key, i) => ({ key, value: values[i] })),
  )
}

/**
 * Every entry of a database's store, without making the database: [] when the
 * database or its store does not exist. Rejects when the database is there but
 * cannot be read.
 */
export async function readExistingStore(dbName: string, storeName: string): Promise<StoredEntry[]> {
  const db = await openExistingDatabase(dbName)
  if (!db) return []
  try {
    return db.objectStoreNames.contains(storeName) ? await readAllEntries(db, storeName) : []
  } finally {
    db.close()
  }
}

export type DeleteOutcome = 'deleted' | 'blocked' | 'failed' | 'timeout'

/**
 * Deletes a database. Resolves 'deleted' once it is gone; 'blocked' when an
 * open connection elsewhere (a tab of an older app version) holds it, in which
 * case the browser deletes it once that connection closes; 'timeout' after
 * `waitMs`; 'failed' when the browser refuses or has no IndexedDB.
 */
export function deleteDatabase(name: string, waitMs = 2000): Promise<DeleteOutcome> {
  return new Promise((resolve) => {
    let settled = false
    const done = (outcome: DeleteOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }
    const timer = setTimeout(() => done('timeout'), waitMs)
    try {
      if (typeof indexedDB === 'undefined') return done('failed')
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => done('deleted')
      request.onerror = () => done('failed')
      request.onblocked = () => done('blocked')
    } catch {
      done('failed')
    }
  })
}
