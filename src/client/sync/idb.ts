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
