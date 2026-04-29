import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { readGeoTiffAsImageOverlay } from './geotiffOverlay';
import { type DepthRaster, readDepthRaster, sampleDepthMeters } from './depthRaster';

type LastGpsPoint = {
  lat: number;
  lng: number;
  timeMs: number;
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="app">
    <div id="map"></div>

    <section class="top-panel">
      <div>
        <div class="app-title">KayNav</div>
        <div id="statusText" class="status-text">Import map and depth files.</div>
      </div>

      <div class="file-actions">
        <label class="file-button">
          Map
          <input id="overlayInput" type="file" accept=".tif,.tiff,.geotiff,image/tiff" />
        </label>

        <label class="file-button secondary">
          Depth
          <input id="depthInput" type="file" accept=".tif,.tiff,.geotiff,image/tiff" />
        </label>
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

      <button id="startGpsButton">Start GPS</button>
    </section>
  </main>
`;

const statusText = document.querySelector<HTMLElement>('#statusText')!;
const overlayInput = document.querySelector<HTMLInputElement>('#overlayInput')!;
const depthInput = document.querySelector<HTMLInputElement>('#depthInput')!;
const startGpsButton = document.querySelector<HTMLButtonElement>('#startGpsButton')!;
const speedValue = document.querySelector<HTMLElement>('#speedValue')!;
const depthValue = document.querySelector<HTMLElement>('#depthValue')!;
const gpsStatus = document.querySelector<HTMLElement>('#gpsStatus')!;

const map = L.map('map', {
  zoomControl: false
}).setView([45.815, 15.982], 15);

L.control.zoom({ position: 'bottomright' }).addTo(map);

// Optional online background. Your imported GeoTIFF still works without internet.
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

let overlayLayer: L.ImageOverlay | null = null;
let gpsMarker: L.CircleMarker | null = null;
let accuracyCircle: L.Circle | null = null;
let lastGpsPoint: LastGpsPoint | null = null;
let latestGpsPoint: LastGpsPoint | null = null;
let watchId: number | null = null;
let depthRaster: DepthRaster | null = null;

overlayInput.addEventListener('change', async () => {
  const file = overlayInput.files?.[0];

  if (!file) return;

  try {
    statusText.textContent = 'Reading map overlay...';

    const overlay = await readGeoTiffAsImageOverlay(file);

    if (overlayLayer) {
      map.removeLayer(overlayLayer);
      overlayLayer = null;
    }

    overlayLayer = L.imageOverlay(overlay.imageUrl, overlay.bounds, {
      opacity: 1,
      interactive: false
    }).addTo(map);

    map.fitBounds(overlay.bounds, {
      padding: [20, 20]
    });

    statusText.textContent = `Loaded map: ${file.name}`;
  } catch (error) {
    console.error(error);
    statusText.textContent =
      error instanceof Error ? error.message : 'Could not load map overlay.';
  }
});

depthInput.addEventListener('change', async () => {
  const file = depthInput.files?.[0];

  if (!file) return;

  try {
    statusText.textContent = 'Reading depth raster...';

    depthRaster = await readDepthRaster(file);

    statusText.textContent = `Loaded depth: ${file.name}`;
    updateDepthDisplay();
  } catch (error) {
    console.error(error);
    depthRaster = null;
    depthValue.textContent = '-- m';
    statusText.textContent =
      error instanceof Error ? error.message : 'Could not load depth raster.';
  }
});

startGpsButton.addEventListener('click', () => {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    startGpsButton.textContent = 'Start GPS';
    gpsStatus.textContent = 'Off';
    return;
  }

  if (!navigator.geolocation) {
    gpsStatus.textContent = 'Unsupported';
    statusText.textContent = 'GPS is not supported in this browser.';
    return;
  }

  gpsStatus.textContent = 'Starting...';
  statusText.textContent = 'Requesting GPS permission...';

  watchId = navigator.geolocation.watchPosition(
    handleGpsPosition,
    (error) => {
      console.error(error);
      gpsStatus.textContent = 'Error';
      statusText.textContent = error.message;
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000
    }
  );

  startGpsButton.textContent = 'Stop GPS';
});

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
  statusText.textContent = `GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;

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

  // Ignore tiny GPS jitter.
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