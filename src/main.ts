import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';

import { readGeoTiffAsImageOverlay } from './geotiffOverlay';
import { type DepthRaster, readDepthRaster, sampleDepthMeters } from './depthRaster';
import {
  deleteMapPackage,
  getMapPackage,
  listMapSummaries,
  saveMapPackage,
  type MapSummary,
  type StoredMapPackage
} from './storage';

type LastGpsPoint = {
  lat: number;
  lng: number;
  timeMs: number;
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="app">
    <div id="map"></div>

    <button id="menuButton" class="menu-button" aria-label="Open menu" aria-expanded="false">
      ☰
    </button>

    <section id="topPanel" class="top-panel hidden">
      <div>
        <div class="app-title">KayNav</div>
        <div id="statusText" class="status-text">Choose a saved map or add a new one.</div>
      </div>

      <div class="menu-content">
        <button id="addMapButton" class="menu-action-button">Add new map</button>

        <select id="mapSelect" class="map-select" aria-label="Saved maps">
          <option value="">Loading saved maps...</option>
        </select>

        <div id="selectedMapActions" class="selected-map-actions hidden">
          <button id="openMapButton" class="menu-action-button">Open</button>
          <button id="deleteMapButton" class="menu-action-button danger">Delete</button>
        </div>

        <button id="closeMenuButton" class="close-menu-button" aria-label="Close menu">
          ×
        </button>
      </div>
    </section>

    <section class="bottom-panel">
      <div class="metric">
        <span>Speed</span>
        <strong id="speedValue">-- km/h</strong>
      </div>

      <div class="metric">
        <span>Depth</span>
        <strong id="depthValue">-- m</strong>
      </div>

      <div class="metric">
        <span>GPS</span>
        <strong id="gpsStatus">Off</strong>
      </div>
    </section>

    <div id="addMapModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
      <section class="modal-card">
        <h2>Add new map</h2>

        <label class="form-field">
          <span>Map name</span>
          <input id="mapNameInput" type="text" placeholder="Example: House test map" />
        </label>

        <label class="file-picker">
          <span>Choose map overlay GeoTIFF</span>
          <input id="newOverlayInput" type="file" accept=".tif,.tiff,.geotiff,image/tiff" />
        </label>
        <div id="overlayFileName" class="picked-file">No map overlay selected</div>

        <label class="file-picker secondary">
          <span>Choose depth GeoTIFF</span>
          <input id="newDepthInput" type="file" accept=".tif,.tiff,.geotiff,image/tiff" />
        </label>
        <div id="depthFileName" class="picked-file">No depth raster selected</div>

        <div class="modal-actions">
          <button id="cancelAddMapButton" class="modal-button muted">Cancel</button>
          <button id="saveMapButton" class="modal-button primary">Save map</button>
        </div>
      </section>
    </div>
  </main>
`;

const statusText = document.querySelector<HTMLElement>('#statusText')!;
const menuButton = document.querySelector<HTMLButtonElement>('#menuButton')!;
const closeMenuButton = document.querySelector<HTMLButtonElement>('#closeMenuButton')!;
const topPanel = document.querySelector<HTMLElement>('#topPanel')!;

const addMapButton = document.querySelector<HTMLButtonElement>('#addMapButton')!;
const mapSelect = document.querySelector<HTMLSelectElement>('#mapSelect')!;
const selectedMapActions = document.querySelector<HTMLElement>('#selectedMapActions')!;
const openMapButton = document.querySelector<HTMLButtonElement>('#openMapButton')!;
const deleteMapButton = document.querySelector<HTMLButtonElement>('#deleteMapButton')!;

const addMapModal = document.querySelector<HTMLElement>('#addMapModal')!;
const mapNameInput = document.querySelector<HTMLInputElement>('#mapNameInput')!;
const newOverlayInput = document.querySelector<HTMLInputElement>('#newOverlayInput')!;
const newDepthInput = document.querySelector<HTMLInputElement>('#newDepthInput')!;
const overlayFileName = document.querySelector<HTMLElement>('#overlayFileName')!;
const depthFileName = document.querySelector<HTMLElement>('#depthFileName')!;
const cancelAddMapButton = document.querySelector<HTMLButtonElement>('#cancelAddMapButton')!;
const saveMapButton = document.querySelector<HTMLButtonElement>('#saveMapButton')!;

const speedValue = document.querySelector<HTMLElement>('#speedValue')!;
const depthValue = document.querySelector<HTMLElement>('#depthValue')!;
const gpsStatus = document.querySelector<HTMLElement>('#gpsStatus')!;

const map = L.map('map', {
  zoomControl: false
}).setView([45.815, 15.982], 15);

map.createPane('localOverlayPane');

const localOverlayPane = map.getPane('localOverlayPane');

if (localOverlayPane) {
  localOverlayPane.style.zIndex = '350';
}

L.control.zoom({ position: 'bottomright' }).addTo(map);

const baseLayers = {
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 22,
    attribution: '&copy; OpenStreetMap contributors'
  }),

  satellite: L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      attribution:
        'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    }
  )
};

baseLayers.satellite.addTo(map);

L.control
  .layers(
    {
      Satellite: baseLayers.satellite,
      OpenStreetMap: baseLayers.osm
    },
    {},
    {
      position: 'topright'
    }
  )
  .addTo(map);

let savedMaps: MapSummary[] = [];
let activeMapId: string | null = null;
let overlayLayer: L.ImageOverlay | null = null;
let gpsMarker: L.CircleMarker | null = null;
let accuracyCircle: L.Circle | null = null;
let lastGpsPoint: LastGpsPoint | null = null;
let latestGpsPoint: LastGpsPoint | null = null;
let depthRaster: DepthRaster | null = null;

function setMenuOpen(isOpen: boolean): void {
  topPanel.classList.toggle('hidden', !isOpen);
  menuButton.setAttribute('aria-expanded', String(isOpen));
}

function setAddMapModalOpen(isOpen: boolean): void {
  addMapModal.classList.toggle('hidden', !isOpen);
}

function resetAddMapModal(): void {
  mapNameInput.value = '';
  newOverlayInput.value = '';
  newDepthInput.value = '';
  overlayFileName.textContent = 'No map overlay selected';
  depthFileName.textContent = 'No depth raster selected';
}

function updateSelectedMapActions(): void {
  selectedMapActions.classList.toggle('hidden', !mapSelect.value);
}

async function refreshSavedMaps(preferredSelectedId?: string): Promise<void> {
  savedMaps = await listMapSummaries();

  mapSelect.innerHTML = '';

  if (savedMaps.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No saved maps yet';
    mapSelect.append(option);
    updateSelectedMapActions();
    return;
  }

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose saved map';
  mapSelect.append(placeholder);

  for (const savedMap of savedMaps) {
    const option = document.createElement('option');
    option.value = savedMap.id;
    option.textContent = savedMap.name;
    mapSelect.append(option);
  }

  if (preferredSelectedId) {
    mapSelect.value = preferredSelectedId;
  }

  updateSelectedMapActions();
}

async function openStoredMap(mapPackage: StoredMapPackage): Promise<void> {
  statusText.textContent = `Opening ${mapPackage.name}...`;

  const overlay = await readGeoTiffAsImageOverlay(mapPackage.overlayBlob);
  const nextDepthRaster = await readDepthRaster(mapPackage.depthBlob);

  if (overlayLayer) {
    map.removeLayer(overlayLayer);
    overlayLayer = null;
  }

  overlayLayer = L.imageOverlay(overlay.imageUrl, overlay.bounds, {
    opacity: 1,
    interactive: false,
    pane: 'localOverlayPane'
  }).addTo(map);

  depthRaster = nextDepthRaster;
  activeMapId = mapPackage.id;

  map.fitBounds(overlay.bounds, {
    padding: [20, 20]
  });

  updateDepthDisplay();

  statusText.textContent = `Opened ${mapPackage.name}`;
}

menuButton.addEventListener('click', () => {
  setMenuOpen(topPanel.classList.contains('hidden'));
});

closeMenuButton.addEventListener('click', () => {
  setMenuOpen(false);
});

addMapButton.addEventListener('click', () => {
  resetAddMapModal();
  setAddMapModalOpen(true);
});

cancelAddMapButton.addEventListener('click', () => {
  setAddMapModalOpen(false);
});

addMapModal.addEventListener('click', (event) => {
  if (event.target === addMapModal) {
    setAddMapModalOpen(false);
  }
});

newOverlayInput.addEventListener('change', () => {
  overlayFileName.textContent =
    newOverlayInput.files?.[0]?.name ?? 'No map overlay selected';
});

newDepthInput.addEventListener('change', () => {
  depthFileName.textContent =
    newDepthInput.files?.[0]?.name ?? 'No depth raster selected';
});

saveMapButton.addEventListener('click', async () => {
  const name = mapNameInput.value.trim();
  const overlayFile = newOverlayInput.files?.[0];
  const depthFile = newDepthInput.files?.[0];

  if (!name) {
    statusText.textContent = 'Enter a map name.';
    return;
  }

  if (!overlayFile) {
    statusText.textContent = 'Choose a map overlay GeoTIFF.';
    return;
  }

  if (!depthFile) {
    statusText.textContent = 'Choose a depth GeoTIFF.';
    return;
  }

  try {
    saveMapButton.disabled = true;
    statusText.textContent = `Saving ${name}...`;

    const savedMap = await saveMapPackage({
      name,
      overlayBlob: overlayFile,
      depthBlob: depthFile
    });

    await refreshSavedMaps(savedMap.id);

    setAddMapModalOpen(false);
    statusText.textContent = `Saved ${name}.`;
  } catch (error) {
    console.error(error);
    statusText.textContent =
      error instanceof Error ? error.message : 'Could not save map.';
  } finally {
    saveMapButton.disabled = false;
  }
});

mapSelect.addEventListener('change', () => {
  updateSelectedMapActions();
});

openMapButton.addEventListener('click', async () => {
  const selectedId = mapSelect.value;

  if (!selectedId) return;

  try {
    const mapPackage = await getMapPackage(selectedId);
    await openStoredMap(mapPackage);
    setMenuOpen(false);
  } catch (error) {
    console.error(error);
    statusText.textContent =
      error instanceof Error ? error.message : 'Could not open saved map.';
  }
});

deleteMapButton.addEventListener('click', async () => {
  const selectedId = mapSelect.value;

  if (!selectedId) return;

  const selectedMap = savedMaps.find((item) => item.id === selectedId);
  const selectedName = selectedMap?.name ?? 'this map';

  const confirmed = window.confirm(
    `Are you sure you want to delete "${selectedName}"?\n\nThis removes the locally saved map and depth files from KayNav.`
  );

  if (!confirmed) return;

  try {
    await deleteMapPackage(selectedId);

    if (activeMapId === selectedId) {
      if (overlayLayer) {
        map.removeLayer(overlayLayer);
        overlayLayer = null;
      }

      depthRaster = null;
      activeMapId = null;
      depthValue.textContent = '-- m';
    }

    await refreshSavedMaps();

    statusText.textContent = `Deleted ${selectedName}.`;
  } catch (error) {
    console.error(error);
    statusText.textContent =
      error instanceof Error ? error.message : 'Could not delete map.';
  }
});

function startGpsAutomatically(): void {
  if (!navigator.geolocation) {
    gpsStatus.textContent = 'Unsupported';
    statusText.textContent = 'GPS is not supported in this browser.';
    return;
  }

  gpsStatus.textContent = 'Starting...';
  statusText.textContent = 'Starting GPS...';

  navigator.geolocation.watchPosition(
    handleGpsPosition,
    (error) => {
      console.error(error);
      gpsStatus.textContent = 'GPS error';
      statusText.textContent = error.message;
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000
    }
  );
}

function handleGpsPosition(position: GeolocationPosition): void {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;
  const accuracyM = position.coords.accuracy;
  const timeMs = position.timestamp;

  const currentGpsPoint: LastGpsPoint = {
    lat,
    lng,
    timeMs
  };

  const speedMps = getSpeedMetersPerSecond(position, currentGpsPoint);
  const speedKmh = speedMps === null ? null : speedMps * 3.6;

  latestGpsPoint = currentGpsPoint;

  gpsStatus.textContent = `±${Math.round(accuracyM)} m`;
  speedValue.textContent = speedKmh === null ? '-- km/h' : `${speedKmh.toFixed(1)} km/h`;

  updateDepthDisplay();

  const latLng: L.LatLngExpression = [lat, lng];

  if (!gpsMarker) {
    gpsMarker = L.circleMarker(latLng, {
      radius: 8,
      color: '#ffffff',
      weight: 3,
      fillColor: '#38bdf8',
      fillOpacity: 1
    }).addTo(map);
  } else {
    gpsMarker.setLatLng(latLng);
  }

  if (!accuracyCircle) {
    accuracyCircle = L.circle(latLng, {
      radius: accuracyM,
      color: '#38bdf8',
      weight: 1,
      fillColor: '#38bdf8',
      fillOpacity: 0.12
    }).addTo(map);
  } else {
    accuracyCircle.setLatLng(latLng);
    accuracyCircle.setRadius(accuracyM);
  }

  map.panTo(latLng, {
    animate: true,
    duration: 0.5
  });

  lastGpsPoint = currentGpsPoint;
}

function updateDepthDisplay(): void {
  if (!depthRaster || !latestGpsPoint) {
    depthValue.textContent = '-- m';
    return;
  }

  const depthM = sampleDepthMeters(
    depthRaster,
    latestGpsPoint.lat,
    latestGpsPoint.lng
  );

  if (depthM === null) {
    depthValue.textContent = 'No data';
    return;
  }

  depthValue.textContent = `${depthM.toFixed(1)} m`;
}

function getSpeedMetersPerSecond(
  position: GeolocationPosition,
  currentPoint: LastGpsPoint
): number | null {
  if (position.coords.speed !== null && Number.isFinite(position.coords.speed)) {
    return position.coords.speed;
  }

  if (!lastGpsPoint) {
    return null;
  }

  const seconds = (currentPoint.timeMs - lastGpsPoint.timeMs) / 1000;

  if (seconds <= 0) {
    return null;
  }

  const meters = haversineMeters(
    lastGpsPoint.lat,
    lastGpsPoint.lng,
    currentPoint.lat,
    currentPoint.lng
  );

  if (meters < 1.5) {
    return 0;
  }

  return meters / seconds;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusM = 6371000;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * earthRadiusM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

refreshSavedMaps().catch((error) => {
  console.error(error);
  statusText.textContent = 'Could not load saved maps.';
});

startGpsAutomatically();