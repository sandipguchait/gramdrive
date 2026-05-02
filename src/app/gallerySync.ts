export type GalleryQueueItem = {
  id: string;
  name: string;
  type: string;
  size: number;
  folderId: string;
  queuedAt: string;
};

type GalleryQueueRecord = GalleryQueueItem & {
  file: File;
};

const dbName = "gramdrive-gallery-sync";
const dbVersion = 1;
const storeName = "gallery-queue";

function createId() {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function toQueueItem(record: GalleryQueueRecord): GalleryQueueItem {
  const { file: _file, ...item } = record;
  return item;
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Gallery queue request failed."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Gallery queue transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Gallery queue transaction was cancelled."));
  });
}

function openGalleryDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open gallery queue."));
  });
}

function sortQueue(items: GalleryQueueItem[]) {
  return [...items].sort(
    (a, b) => new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime()
  );
}

export async function queueGalleryFiles(files: File[], folderId: string) {
  const db = await openGalleryDb();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  const now = new Date().toISOString();
  const records: GalleryQueueRecord[] = files.map((file) => ({
    id: createId(),
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    folderId,
    queuedAt: now,
    file
  }));

  for (const record of records) {
    store.put(record);
  }

  await transactionDone(transaction);
  db.close();
  return records.map(toQueueItem);
}

export async function listGalleryQueue() {
  const db = await openGalleryDb();
  const transaction = db.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  const records = await requestToPromise<GalleryQueueRecord[]>(store.getAll());
  await transactionDone(transaction);
  db.close();
  return sortQueue(records.map(toQueueItem));
}

export async function readGalleryQueueItem(id: string) {
  const db = await openGalleryDb();
  const transaction = db.transaction(storeName, "readonly");
  const store = transaction.objectStore(storeName);
  const record = await requestToPromise<GalleryQueueRecord | undefined>(store.get(id));
  await transactionDone(transaction);
  db.close();
  return record ?? null;
}

export async function deleteGalleryQueueItem(id: string) {
  const db = await openGalleryDb();
  const transaction = db.transaction(storeName, "readwrite");
  const store = transaction.objectStore(storeName);
  store.delete(id);
  await transactionDone(transaction);
  db.close();
}
