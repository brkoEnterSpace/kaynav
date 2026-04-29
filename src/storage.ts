const DB_NAME = 'kaynav-db';
const DB_VERSION = 2;

const MAPS_STORE_NAME = 'maps';
const ROUTES_STORE_NAME = 'routes';

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

export type RoutePoint = {
  lat: number;
  lng: number;
  timeMs: number;
  accuracyM: number;
  speedMps: number | null;
};

export type StoredRoute = {
  id: string;
  mapId: string;
  mapName: string;
  name: string;
  createdAt: number;
  points: RoutePoint[];
};

export type RouteSummary = {
  id: string;
  mapId: string;
  name: string;
  createdAt: number;
  pointCount: number;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error ?? new Error('Could not open KayNav database.'));
    };

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(MAPS_STORE_NAME)) {
        const store = db.createObjectStore(MAPS_STORE_NAME, {
          keyPath: 'id'
        });

        store.createIndex('createdAt', 'createdAt');
        store.createIndex('name', 'name');
      }

      if (!db.objectStoreNames.contains(ROUTES_STORE_NAME)) {
        const store = db.createObjectStore(ROUTES_STORE_NAME, {
          keyPath: 'id'
        });

        store.createIndex('mapId', 'mapId');
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

  const transaction = db.transaction(MAPS_STORE_NAME, 'readwrite');
  transaction.objectStore(MAPS_STORE_NAME).put(record);

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
  const transaction = db.transaction(MAPS_STORE_NAME, 'readonly');
  const request = transaction.objectStore(MAPS_STORE_NAME).getAll();

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
  const transaction = db.transaction(MAPS_STORE_NAME, 'readonly');
  const request = transaction.objectStore(MAPS_STORE_NAME).get(id);

  const record = await requestToPromise<StoredMapPackage | undefined>(request);
  db.close();

  if (!record) {
    throw new Error('Saved map was not found.');
  }

  return record;
}

export async function deleteMapPackage(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([MAPS_STORE_NAME, ROUTES_STORE_NAME], 'readwrite');

  transaction.objectStore(MAPS_STORE_NAME).delete(id);

  const routesStore = transaction.objectStore(ROUTES_STORE_NAME);
  const routeIndex = routesStore.index('mapId');
  const routeRequest = routeIndex.openCursor(IDBKeyRange.only(id));

  routeRequest.onsuccess = () => {
    const cursor = routeRequest.result;

    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };

  await transactionComplete(transaction);
  db.close();
}

export async function saveRoute(input: {
  mapId: string;
  mapName: string;
  name: string;
  points: RoutePoint[];
}): Promise<RouteSummary> {
  const db = await openDatabase();

  const record: StoredRoute = {
    id: crypto.randomUUID(),
    mapId: input.mapId,
    mapName: input.mapName,
    name: input.name,
    createdAt: Date.now(),
    points: input.points
  };

  const transaction = db.transaction(ROUTES_STORE_NAME, 'readwrite');
  transaction.objectStore(ROUTES_STORE_NAME).put(record);

  await transactionComplete(transaction);
  db.close();

  return {
    id: record.id,
    mapId: record.mapId,
    name: record.name,
    createdAt: record.createdAt,
    pointCount: record.points.length
  };
}

export async function listRouteSummariesForMap(mapId: string): Promise<RouteSummary[]> {
  const db = await openDatabase();
  const transaction = db.transaction(ROUTES_STORE_NAME, 'readonly');
  const store = transaction.objectStore(ROUTES_STORE_NAME);
  const index = store.index('mapId');
  const request = index.getAll(mapId);

  const records = await requestToPromise<StoredRoute[]>(request);
  db.close();

  return records
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((record) => ({
      id: record.id,
      mapId: record.mapId,
      name: record.name,
      createdAt: record.createdAt,
      pointCount: record.points.length
    }));
}

export async function getRoute(id: string): Promise<StoredRoute> {
  const db = await openDatabase();
  const transaction = db.transaction(ROUTES_STORE_NAME, 'readonly');
  const request = transaction.objectStore(ROUTES_STORE_NAME).get(id);

  const record = await requestToPromise<StoredRoute | undefined>(request);
  db.close();

  if (!record) {
    throw new Error('Route was not found.');
  }

  return record;
}

export async function deleteRoutesForMap(mapId: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(ROUTES_STORE_NAME, 'readwrite');
  const store = transaction.objectStore(ROUTES_STORE_NAME);
  const index = store.index('mapId');
  const request = index.openCursor(IDBKeyRange.only(mapId));

  request.onsuccess = () => {
    const cursor = request.result;

    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };

  await transactionComplete(transaction);
  db.close();
}