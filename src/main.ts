import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main class="app">
    <section class="panel">
      <h1>KayNav</h1>
      <p>Offline kayak GPS map with speed and approximate depth.</p>

      <div class="status-grid">
        <div>
          <span class="label">GPS</span>
          <strong id="gpsStatus">Not started</strong>
        </div>
        <div>
          <span class="label">Speed</span>
          <strong id="speedValue">-- km/h</strong>
        </div>
        <div>
          <span class="label">Depth</span>
          <strong id="depthValue">-- m</strong>
        </div>
      </div>

      <button id="startGpsButton">Start GPS</button>
    </section>
  </main>
`;

const gpsStatus = document.querySelector<HTMLElement>('#gpsStatus')!;
const speedValue = document.querySelector<HTMLElement>('#speedValue')!;
const startGpsButton = document.querySelector<HTMLButtonElement>('#startGpsButton')!;

startGpsButton.addEventListener('click', () => {
  if (!navigator.geolocation) {
    gpsStatus.textContent = 'GPS not supported';
    return;
  }

  gpsStatus.textContent = 'Requesting permission...';

  navigator.geolocation.watchPosition(
    (position) => {
      gpsStatus.textContent = `±${Math.round(position.coords.accuracy)} m`;

      const speedMetersPerSecond = position.coords.speed;

      if (speedMetersPerSecond !== null) {
        const speedKmH = speedMetersPerSecond * 3.6;
        speedValue.textContent = `${speedKmH.toFixed(1)} km/h`;
      } else {
        speedValue.textContent = '-- km/h';
      }
    },
    (error) => {
      gpsStatus.textContent = error.message;
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000
    }
  );
});