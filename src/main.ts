import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { readGeoTiffAsImageOverlay } from './geotiffOverlay';

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
        <div id="statusText" class="status-text">Import your map overlay to begin.</div>
      </div>

      <label class="file-button">
        Import map
        <input id="overlayInput" type="file" accept=".tif,.tiff,.geotiff,image/tiff" />
      </label>
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
const startGpsButton = document.querySelector<HTMLButtonElement>('#startGpsButton')!;
const speedValue = document.querySelector<HTMLElement>('#speedValue')!;
const gpsStatus = document.querySelector<HTMLElement>('#gpsStatus')!;

const map = L.map('map', {
  zoomControl: false
}).setView([45.815, 15.982], 15);

L.control.zoom({ position: 'bottomright' }).addTo(map);

// Optional online background. Your imported GeoTIFF still works without internet.
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 22,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let overlayLayer: L.ImageOverlay | null = null;
let gpsMarker: L.CircleMarker | null = null;
let accuracyCircle: L.Circle | null = null;
let lastGpsPoint: LastGpsPoint | null = null;
let watchId: number | null = null;

overlayInput.addEventListener('change', async () => {
  const file = overlayInput.files?.[0];

  if (!file) return;

  try {
    statusText.textContent = 'Reading GeoTIFF overlay...';

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

    statusText.textContent = `Loaded ${file.name} (${overlay.width} × ${overlay.height})`;
  } catch (error) {
    console.error(error);
    statusText.textContent =
      error instanceof Error ? error.message : 'Could not load GeoTIFF overlay.';
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

  const speedMps = getSpeedMetersPerSecond(position, {
    lat,
    lng,
    timeMs
  });

  const speedKmh = speedMps === null ? null : speedMps * 3.6;

  gpsStatus.textContent = `±${Math.round(accuracyM)} m`;
  speedValue.textContent = speedKmh === null ? '-- km/h' : `${speedKmh.toFixed(1)} km/h`;
  statusText.textContent = `GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;

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

  lastGpsPoint = {
    lat,
    lng,
    timeMs
  };
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