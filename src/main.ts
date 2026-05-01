import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';

import { readGeoTiffAsImageOverlay } from './geotiffOverlay';
import {
  maxDepthInRadiusMeters,
  type DepthRaster,
  readDepthRaster,
  sampleDepthMeters
} from './depthRaster';

import {
  deleteMapPackage,
  getMapPackage,
  getRoute,
  listMapSummaries,
  listRouteSummariesForMap,
  saveMapPackage,
  saveRoute,
  type MapSummary,
  type RoutePoint,
  type RouteSummary,
  type StoredMapPackage
} from './storage';

const ACTIVE_MAP_ID_STORAGE_KEY = 'kaynav-active-map-id';
const METERS_PER_SECOND_TO_KNOTS = 1.9438444924406;

type LastGpsPoint = {
  lat: number;
  lng: number;
  timeMs: number;
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="rangeModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
    <section class="modal-card">
      <h2>Range</h2>

      <label class="form-field">
        <span>Casting range</span>
        <select id="rangeSelect" class="map-select">
          <option value="20">20 m</option>
          <option value="30">30 m</option>
          <option value="40">40 m</option>
          <option value="50" selected>50 m</option>
          <option value="60">60 m</option>
          <option value="70">70 m</option>
          <option value="80">80 m</option>
          <option value="90">90 m</option>
          <option value="100">100 m</option>
        </select>
      </label>

      <div class="modal-actions">
        <button id="cancelRangeModalButton" class="modal-button muted">Cancel</button>
        <button id="startRangeButton" class="modal-button primary">Choose point</button>
      </div>
    </section>
  </div>

  <main class="app">
    <div id="map"></div>

    <button id="menuButton" class="menu-button" aria-label="Open menu" aria-expanded="false">
      ☰
    </button>
    <button id="locateButton" class="locate-button active" aria-label="Center on my location">
      ⌖
    </button>
    <button id="cancelRangeButton" class="cancel-range-button hidden" aria-label="Exit range mode">
      ×
    </button>

    <section id="topPanel" class="top-panel hidden">
      <div class="menu-content">
        <button id="addMapButton" class="menu-action-button">Add new map</button>
        <button id="startRouteButton" class="menu-action-button route-start">Start</button>
        <button id="stopRouteButton" class="menu-action-button route-stop hidden">Stop</button>
        <button id="routesButton" class="menu-action-button">Routes</button>
        <button id="rangeButton" class="menu-action-button">Range</button>

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

    <div id="statusText" class="status-text hidden">Ready.</div>

    <div id="recordingBanner" class="recording-banner hidden">
      RECORDING
    </div>

    <section class="bottom-panel">
      <div class="metric">
        <span>Speed</span>
        <strong id="speedValue">-- kt</strong>
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

    <div id="routesModal" class="modal-backdrop hidden" role="dialog" aria-modal="true">
      <section class="modal-card routes-card">
        <div class="modal-header">
          <h2>Routes</h2>
          <button id="closeRoutesButton" class="close-menu-button" aria-label="Close routes">
            ×
          </button>
        </div>

        <div id="routesList" class="routes-list">
          No active map.
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

const startRouteButton = document.querySelector<HTMLButtonElement>('#startRouteButton')!;
const stopRouteButton = document.querySelector<HTMLButtonElement>('#stopRouteButton')!;
const routesButton = document.querySelector<HTMLButtonElement>('#routesButton')!;
const routesModal = document.querySelector<HTMLElement>('#routesModal')!;
const routesList = document.querySelector<HTMLElement>('#routesList')!;
const closeRoutesButton = document.querySelector<HTMLButtonElement>('#closeRoutesButton')!;

const recordingBanner = document.querySelector<HTMLElement>('#recordingBanner')!;

const rangeButton = document.querySelector<HTMLButtonElement>('#rangeButton')!;
const rangeModal = document.querySelector<HTMLElement>('#rangeModal')!;
const rangeSelect = document.querySelector<HTMLSelectElement>('#rangeSelect')!;
const startRangeButton = document.querySelector<HTMLButtonElement>('#startRangeButton')!;
const cancelRangeModalButton = document.querySelector<HTMLButtonElement>('#cancelRangeModalButton')!;
const cancelRangeButton = document.querySelector<HTMLButtonElement>('#cancelRangeButton')!;
const locateButton = document.querySelector<HTMLButtonElement>('#locateButton')!;

const map = L.map('map', {
  zoomControl: false
}).setView([45.815, 15.982], 15);

map.createPane('localOverlayPane');

const localOverlayPane = map.getPane('localOverlayPane');

if (localOverlayPane) {
  localOverlayPane.style.zIndex = '350';
}

map.createPane('routePane');

const routePane = map.getPane('routePane');

if (routePane) {
  routePane.style.zIndex = '520';
}

map.createPane('gpsPane');

const gpsPane = map.getPane('gpsPane');

if (gpsPane) {
  gpsPane.style.zIndex = '650';
}

map.createPane('rangePane');

const rangePane = map.getPane('rangePane');

if (rangePane) {
  rangePane.style.zIndex = '610';
}

L.control.zoom({ position: 'bottomright' }).addTo(map);

map.on('dragstart', () => {
  isFollowingLocation = false;
  updateLocateButtonState();
});

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
let activeMapName: string | null = null;
let savedRoutesForActiveMap: RouteSummary[] = [];
let isRecordingRoute = false;
let recordedRoutePoints: RoutePoint[] = [];
const visibleRouteIds = new Set<string>();
const routeOverlays = new Map<string, L.Polyline>();
let liveRouteOverlay: L.Polyline | null = null;
let overlayLayer: L.ImageOverlay | null = null;
let gpsMarker: L.CircleMarker | null = null;
let accuracyCircle: L.Circle | null = null;
let lastGpsPoint: LastGpsPoint | null = null;
let latestGpsPoint: LastGpsPoint | null = null;
let depthRaster: DepthRaster | null = null;
let isRangeModeActive = false;
let selectedRangeMeters = 50;
let rangeDot: L.CircleMarker | null = null;
let rangeCircle: L.Circle | null = null;
let rangeLabel: L.Marker | null = null;
let rangeMaxDepthLine: L.Polyline | null = null;
let rangeMaxDepthDot: L.CircleMarker | null = null;
let isFollowingLocation = true;

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

function rememberActiveMapId(id: string): void {
  localStorage.setItem(ACTIVE_MAP_ID_STORAGE_KEY, id);
}

function getRememberedActiveMapId(): string | null {
  return localStorage.getItem(ACTIVE_MAP_ID_STORAGE_KEY);
}

function clearRememberedActiveMapId(): void {
  localStorage.removeItem(ACTIVE_MAP_ID_STORAGE_KEY);
}

function setRangeModalOpen(isOpen: boolean): void {
  rangeModal.classList.toggle('hidden', !isOpen);
}

function clearRangeOverlay(): void {
  if (rangeDot) {
    map.removeLayer(rangeDot);
    rangeDot = null;
  }

  if (rangeCircle) {
    map.removeLayer(rangeCircle);
    rangeCircle = null;
  }

  if (rangeLabel) {
    map.removeLayer(rangeLabel);
    rangeLabel = null;
  }

  if (rangeMaxDepthLine) {
    map.removeLayer(rangeMaxDepthLine);
    rangeMaxDepthLine = null;
  }

  if (rangeMaxDepthDot) {
    map.removeLayer(rangeMaxDepthDot);
    rangeMaxDepthDot = null;
  }
}

function stopRangeMode(): void {
  isRangeModeActive = false;
  cancelRangeButton.classList.add('hidden');
  clearRangeOverlay();
}

function startRangeMode(rangeMeters: number): void {
  if (!depthRaster) {
    statusText.textContent = 'Open a map with depth data before using Range.';
    return;
  }

  selectedRangeMeters = rangeMeters;
  isRangeModeActive = true;

  cancelRangeButton.classList.remove('hidden');
  clearRangeOverlay();

  statusText.textContent = `Tap map to check max depth within ${rangeMeters} m.`;
  setMenuOpen(false);
  setRangeModalOpen(false);
}

function showRangeAtPoint(lat: number, lng: number): void {
  if (!depthRaster) {
    statusText.textContent = 'No depth raster loaded.';
    return;
  }

  clearRangeOverlay();

  const maxDepthResult = maxDepthInRadiusMeters(
    depthRaster,
    lat,
    lng,
    selectedRangeMeters
  );

  rangeCircle = L.circle([lat, lng], {
    pane: 'rangePane',
    radius: selectedRangeMeters,
    color: '#ef4444',
    weight: 2,
    fillColor: '#ef4444',
    fillOpacity: 0.08
  }).addTo(map);

  rangeDot = L.circleMarker([lat, lng], {
    pane: 'rangePane',
    radius: 7,
    color: '#ffffff',
    weight: 2,
    fillColor: '#ef4444',
    fillOpacity: 1
  }).addTo(map);

  if (maxDepthResult !== null) {
    rangeMaxDepthLine = L.polyline(
      [
        [lat, lng],
        [maxDepthResult.lat, maxDepthResult.lon]
      ],
      {
        pane: 'rangePane',
        color: '#facc15',
        weight: 4,
        opacity: 0.95,
        dashArray: '8 8'
      }
    ).addTo(map);

    rangeMaxDepthDot = L.circleMarker([maxDepthResult.lat, maxDepthResult.lon], {
      pane: 'rangePane',
      radius: 6,
      color: '#000000',
      weight: 2,
      fillColor: '#facc15',
      fillOpacity: 1
    }).addTo(map);
  }

  const labelText =
    maxDepthResult === null
      ? `No depth data<br>${selectedRangeMeters} m range`
      : `Max depth ${maxDepthResult.depthM.toFixed(1)} m<br>${selectedRangeMeters} m range`;

  const labelIcon = L.divIcon({
    className: 'range-depth-label',
    html: labelText,
    iconSize: [150, 44],
    iconAnchor: [75, 54]
  });

  rangeLabel = L.marker([lat, lng], {
    pane: 'rangePane',
    icon: labelIcon,
    interactive: false
  }).addTo(map);
}

function updateLocateButtonState(): void {
  locateButton.classList.toggle('active', isFollowingLocation);
}

function centerMapOnCurrentLocation(): void {
  if (!latestGpsPoint) {
    statusText.textContent = 'Waiting for GPS position...';
    return;
  }

  isFollowingLocation = true;
  updateLocateButtonState();

  map.setView([latestGpsPoint.lat, latestGpsPoint.lng], Math.max(map.getZoom(), 17), {
    animate: true
  });
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

function setRoutesModalOpen(isOpen: boolean): void {
  routesModal.classList.toggle('hidden', !isOpen);
}

function formatRouteTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function getRouteNameForActiveMap(): string {
  const safeMapName = activeMapName ?? 'Map';
  return `${safeMapName}-${formatRouteTimestamp()}`;
}

function updateRouteRecordingButtons(): void {
  startRouteButton.classList.toggle('hidden', isRecordingRoute);
  stopRouteButton.classList.toggle('hidden', !isRecordingRoute);
  recordingBanner.classList.toggle('hidden', !isRecordingRoute);

  const hasActiveMap = activeMapId !== null;

  startRouteButton.disabled = !hasActiveMap;
  routesButton.disabled = !hasActiveMap;
}

function clearRouteOverlays(): void {
  for (const polyline of routeOverlays.values()) {
    map.removeLayer(polyline);
  }

  routeOverlays.clear();
  visibleRouteIds.clear();

  if (liveRouteOverlay) {
    map.removeLayer(liveRouteOverlay);
    liveRouteOverlay = null;
  }
}

async function refreshRoutesForActiveMap(): Promise<void> {
  if (!activeMapId) {
    savedRoutesForActiveMap = [];
    renderRoutesList();
    return;
  }

  savedRoutesForActiveMap = await listRouteSummariesForMap(activeMapId);
  renderRoutesList();
}

function renderRoutesList(): void {
  routesList.innerHTML = '';

  if (!activeMapId) {
    routesList.textContent = 'Open a saved map first.';
    return;
  }

  if (savedRoutesForActiveMap.length === 0) {
    routesList.textContent = 'No routes recorded for this map yet.';
    return;
  }

  for (const route of savedRoutesForActiveMap) {
    const row = document.createElement('label');
    row.className = 'route-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = visibleRouteIds.has(route.id);

    checkbox.addEventListener('change', async () => {
      if (checkbox.checked) {
        await showRouteOverlay(route.id);
      } else {
        hideRouteOverlay(route.id);
      }
    });

    const text = document.createElement('span');
    text.textContent = `${route.name} (${route.pointCount} pts)`;

    row.append(checkbox, text);
    routesList.append(row);
  }
}

async function showRouteOverlay(routeId: string): Promise<void> {
  if (routeOverlays.has(routeId)) {
    visibleRouteIds.add(routeId);
    return;
  }

  const route = await getRoute(routeId);

  if (!activeMapId || route.mapId !== activeMapId) {
    return;
  }

  const latLngs = route.points.map((point) => [point.lat, point.lng] as L.LatLngExpression);

  if (latLngs.length < 2) {
    return;
  }

  const polyline = L.polyline(latLngs, {
    pane: 'routePane',
    color: '#f97316',
    weight: 5,
    opacity: 0.95
  }).addTo(map);

  routeOverlays.set(routeId, polyline);
  visibleRouteIds.add(routeId);
}

function hideRouteOverlay(routeId: string): void {
  const polyline = routeOverlays.get(routeId);

  if (polyline) {
    map.removeLayer(polyline);
  }

  routeOverlays.delete(routeId);
  visibleRouteIds.delete(routeId);
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

  clearRouteOverlays();
  stopRangeMode();

  depthRaster = nextDepthRaster;
  activeMapId = mapPackage.id;
  activeMapName = mapPackage.name;
  rememberActiveMapId(mapPackage.id);
  updateRouteRecordingButtons();

  await refreshRoutesForActiveMap();

  map.fitBounds(overlay.bounds, {
    padding: [20, 20]
  });

  updateDepthDisplay();

  statusText.textContent = `Opened ${mapPackage.name}`;
}

async function openRememberedMapIfAvailable(): Promise<void> {
  const rememberedMapId = getRememberedActiveMapId();

  if (!rememberedMapId) {
    return;
  }

  const rememberedMapExists = savedMaps.some((savedMap) => savedMap.id === rememberedMapId);

  if (!rememberedMapExists) {
    clearRememberedActiveMapId();
    return;
  }

  mapSelect.value = rememberedMapId;
  updateSelectedMapActions();

  const mapPackage = await getMapPackage(rememberedMapId);
  await openStoredMap(mapPackage);
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

startRouteButton.addEventListener('click', () => {
  if (!activeMapId || !activeMapName) {
    statusText.textContent = 'Open a saved map before recording a route.';
    return;
  }

  isRecordingRoute = true;
  recordedRoutePoints = [];

  if (liveRouteOverlay) {
    map.removeLayer(liveRouteOverlay);
  }

  liveRouteOverlay = L.polyline([], {
    pane: 'routePane',
    color: '#22c55e',
    weight: 6,
    opacity: 0.95
  }).addTo(map);

  updateRouteRecordingButtons();

  statusText.textContent = `Recording route for ${activeMapName}...`;
  setMenuOpen(false);
});

stopRouteButton.addEventListener('click', async () => {
  if (!isRecordingRoute) return;

  isRecordingRoute = false;
  updateRouteRecordingButtons();
  if (liveRouteOverlay) {
    map.removeLayer(liveRouteOverlay);
    liveRouteOverlay = null;
  }

  if (!activeMapId || !activeMapName) {
    recordedRoutePoints = [];
    statusText.textContent = 'No active map. Route was not saved.';
    return;
  }

  if (recordedRoutePoints.length < 2) {
    recordedRoutePoints = [];
    statusText.textContent = 'Route too short. Nothing saved.';
    return;
  }

  const routeName = getRouteNameForActiveMap();

  try {
    const savedRoute = await saveRoute({
      mapId: activeMapId,
      mapName: activeMapName,
      name: routeName,
      points: recordedRoutePoints
    });

    recordedRoutePoints = [];
    await refreshRoutesForActiveMap();
    await showRouteOverlay(savedRoute.id);
    renderRoutesList();

    statusText.textContent = `Saved route ${savedRoute.name}.`;
  } catch (error) {
    console.error(error);
    recordedRoutePoints = [];
    statusText.textContent =
      error instanceof Error ? error.message : 'Could not save route.';
  }
});

routesButton.addEventListener('click', async () => {
  await refreshRoutesForActiveMap();
  setRoutesModalOpen(true);
});

closeRoutesButton.addEventListener('click', () => {
  setRoutesModalOpen(false);
});

routesModal.addEventListener('click', (event) => {
  if (event.target === routesModal) {
    setRoutesModalOpen(false);
  }
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
      activeMapName = null;
      depthValue.textContent = '-- m';
      clearRouteOverlays();
      updateRouteRecordingButtons();
    }

    if (getRememberedActiveMapId() === selectedId) {
      clearRememberedActiveMapId();
    }

    await refreshSavedMaps();

    statusText.textContent = `Deleted ${selectedName}.`;
  } catch (error) {
    console.error(error);
    statusText.textContent =
      error instanceof Error ? error.message : 'Could not delete map.';
  }
});

rangeButton.addEventListener('click', () => {
  if (!activeMapId || !depthRaster) {
    statusText.textContent = 'Open a saved map before using Range.';
    return;
  }

  setRangeModalOpen(true);
});

cancelRangeModalButton.addEventListener('click', () => {
  setRangeModalOpen(false);
});

rangeModal.addEventListener('click', (event) => {
  if (event.target === rangeModal) {
    setRangeModalOpen(false);
  }
});

startRangeButton.addEventListener('click', () => {
  const rangeMeters = Number(rangeSelect.value);
  startRangeMode(rangeMeters);
});

cancelRangeButton.addEventListener('click', () => {
  stopRangeMode();
});

locateButton.addEventListener('click', () => {
  centerMapOnCurrentLocation();
});

map.on('click', (event) => {
  if (!isRangeModeActive) {
    return;
  }

  showRangeAtPoint(event.latlng.lat, event.latlng.lng);
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
  const speedKnots = speedMps === null ? null : speedMps * METERS_PER_SECOND_TO_KNOTS;

  latestGpsPoint = currentGpsPoint;
  if (isRecordingRoute && activeMapId) {
    const routePoint: RoutePoint = {
      lat,
      lng,
      timeMs,
      accuracyM,
      speedMps
    };

    recordedRoutePoints.push(routePoint);

    if (liveRouteOverlay) {
      liveRouteOverlay.addLatLng([lat, lng]);
    }
  }

  gpsStatus.textContent = `±${Math.round(accuracyM)} m`;
  speedValue.textContent = speedKnots === null ? '-- kt' : `${speedKnots.toFixed(1)} kt`;

  updateDepthDisplay();

  const latLng: L.LatLngExpression = [lat, lng];

  if (!gpsMarker) {
    gpsMarker = L.circleMarker(latLng, {
      pane: 'gpsPane',
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
      pane: 'gpsPane',
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

  if (isFollowingLocation) {
    map.panTo(latLng, {
      animate: true,
      duration: 0.5
    });
  }

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

async function initializeApp(): Promise<void> {
  updateRouteRecordingButtons();
  updateLocateButtonState();
  
  try {
    await refreshSavedMaps();
    await openRememberedMapIfAvailable();
    updateRouteRecordingButtons();
  } catch (error) {
    console.error(error);
    statusText.textContent = 'Could not load saved maps.';
  }

  startGpsAutomatically();
}

initializeApp();