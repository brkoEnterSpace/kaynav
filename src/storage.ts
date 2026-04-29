const DB_NAME = 'kaynav-db';
const DB_VERSION = 1;
const STORE_NAME = 'maps';

export type StoredMapPackage = {
  id: string;
  name: string;
  createdAt: number;
  overlayBlob: Blob;
  depthBlob: Blob;
};

export type MapSummary = {
  id: string;
  name: string;
  createdAt: number;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error ?? new Error('Could not open KayNav database.'));
    };

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id'
        });

        store.createIndex('createdAt', 'createdAt');
        store.createIndex('name', 'name');
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed.'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    };

    transaction.onabort = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    };
  });
}

export async function saveMapPackage(input: {
  name: string;
  overlayBlob: Blob;
  depthBlob: Blob;
}): Promise<MapSummary> {
  const db = await openDatabase();

  const record: StoredMapPackage = {
    id: crypto.randomUUID(),
    name: input.name,
    createdAt: Date.now(),
    overlayBlob: input.overlayBlob,
    depthBlob: input.depthBlob
  };

  const transaction = db.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).put(record);

  await transactionComplete(transaction);
  db.close();

  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt
  };
}

export async function listMapSummaries(): Promise<MapSummary[]> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, 'readonly');
  const request = transaction.objectStore(STORE_NAME).getAll();

  const records = await requestToPromise<StoredMapPackage[]>(request);
  db.close();

  return records
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((record) => ({
      id: record.id,
      name: record.name,
      createdAt: record.createdAt
    }));
}

export async function getMapPackage(id: string): Promise<StoredMapPackage> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, 'readonly');
  const request = transaction.objectStore(STORE_NAME).get(id);

  const record = await requestToPromise<StoredMapPackage | undefined>(request);
  db.close();

  if (!record) {
    throw new Error('Saved map was not found.');
  }

  return record;
}

export async function deleteMapPackage(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, 'readwrite');

  transaction.objectStore(STORE_NAME).delete(id);

  await transactionComplete(transaction);
  db.close();
}