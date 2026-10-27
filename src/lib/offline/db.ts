/**
 * Small IndexedDB wrapper for everything the app keeps for working without
 * signal: the site list, the product list and the queue of unsent jobs.
 *
 * If IndexedDB is unavailable (some private-browsing modes) the same calls
 * fall back to memory, so the app still works - it just cannot remember
 * anything across a reload.
 */

export type StoreName = 'kv' | 'products' | 'queue'

const DB_NAME = 'tex-trak-offline'
const VERSION = 1

let dbPromise: Promise<IDBDatabase | null> | null = null
const memory: Record<StoreName, Map<string, unknown>> = {
  kv: new Map(),
  products: new Map(),
  queue: new Map(),
}
const KEY_PATH: Record<StoreName, string> = { kv: 'key', products: 'qr_code', queue: 'opId' }

function open(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, VERSION)
        req.onupgradeneeded = () => {
          const db = req.result
          db.createObjectStore('kv', { keyPath: 'key' })
          const products = db.createObjectStore('products', { keyPath: 'qr_code' })
          products.createIndex('installation_id', 'installation_id')
          products.createIndex('bay_id', 'bay_id')
          db.createObjectStore('queue', { keyPath: 'opId' })
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
        req.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }
  return dbPromise
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function memKey(store: StoreName, value: unknown): string {
  return String((value as Record<string, unknown>)[KEY_PATH[store]])
}

export async function dbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open()
  if (!db) return memory[store].get(key) as T | undefined
  return (await wrap(db.transaction(store).objectStore(store).get(key))) as T | undefined
}

export async function dbGetAll<T>(store: StoreName): Promise<T[]> {
  const db = await open()
  if (!db) return Array.from(memory[store].values()) as T[]
  return (await wrap(db.transaction(store).objectStore(store).getAll())) as T[]
}

export async function dbCount(store: StoreName): Promise<number> {
  const db = await open()
  if (!db) return memory[store].size
  return wrap(db.transaction(store).objectStore(store).count())
}

export async function dbGetByIndex<T>(store: StoreName, index: string, key: string): Promise<T[]> {
  const db = await open()
  if (!db) {
    return Array.from(memory[store].values()).filter(
      (v) => (v as Record<string, unknown>)[index] === key,
    ) as T[]
  }
  return (await wrap(db.transaction(store).objectStore(store).index(index).getAll(key))) as T[]
}

export async function dbPut(store: StoreName, value: unknown): Promise<void> {
  await dbPutMany(store, [value])
}

export async function dbPutMany(store: StoreName, values: unknown[]): Promise<void> {
  if (values.length === 0) return
  const db = await open()
  if (!db) {
    for (const v of values) memory[store].set(memKey(store, v), v)
    return
  }
  const tx = db.transaction(store, 'readwrite')
  const os = tx.objectStore(store)
  for (const v of values) os.put(v)
  await done(tx)
}

export async function dbDelete(store: StoreName, key: string): Promise<void> {
  const db = await open()
  if (!db) {
    memory[store].delete(key)
    return
  }
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).delete(key)
  await done(tx)
}

export async function dbClear(store: StoreName): Promise<void> {
  const db = await open()
  if (!db) {
    memory[store].clear()
    return
  }
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).clear()
  await done(tx)
}

/** Key/value convenience over the `kv` store. */
export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await dbGet<{ key: string; value: T }>('kv', key)
  return row?.value
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await dbPut('kv', { key, value })
}
