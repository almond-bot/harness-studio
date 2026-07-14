// Remembers the last file/folder opened in hosted mode. FileSystemHandles are
// not JSON-serializable, so they can't live in localStorage — IndexedDB
// structured-clones them, which is the supported way to persist them.

const DB_NAME = "ahs-session";
const STORE = "last-opened";
const KEY = "last";

export interface LastOpened {
  kind: "file" | "directory";
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  /** For directories: the file that was selected inside the folder */
  fileName?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveLastOpened(record: LastOpened): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.put(record, KEY));
  } catch {
    // persistence is best-effort
  }
}

export async function loadLastOpened(): Promise<LastOpened | null> {
  try {
    const record = await withStore<unknown>("readonly", (store) => store.get(KEY));
    if (record && typeof record === "object" && "handle" in record) {
      return record as LastOpened;
    }
  } catch {
    // treat as no saved session
  }
  return null;
}

export async function clearLastOpened(): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.delete(KEY));
  } catch {
    // best-effort
  }
}
