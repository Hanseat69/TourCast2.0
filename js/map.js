'use strict';
// ── W11-TourCast map.js – Leaflet Engine & Layer-Management ──
// NOTE: OpenStreetMap Standard tiles automatically show road colors:
// Motorways = Blue, Federal Roads = Orange, Local Roads = Yellow

let map          = null;
let userMarker   = null;
let radiusCircle = null;

let tileLayerStreet    = null;
let tileLayerSatellite = null;
let tileLayerTopo      = null;
let currentTileLayer   = null;

const MAP_LAYERS = {
    street: {
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attribution: '© OpenStreetMap contributors, © CartoDB', maxZoom: 19
    },
    satellite: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: '© Esri', maxZoom: 19
    },
    topo: {
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: '© OpenTopoMap', maxZoom: 17
    }
};

function initMapLayers() {
    tileLayerStreet = L.tileLayer(MAP_LAYERS.street.url, { 
        attribution: MAP_LAYERS.street.attribution, 
        maxZoom: MAP_LAYERS.street.maxZoom 
    });
    tileLayerSatellite = L.tileLayer(MAP_LAYERS.satellite.url, { 
        attribution: MAP_LAYERS.satellite.attribution, 
        maxZoom: MAP_LAYERS.satellite.maxZoom 
    });
    tileLayerTopo = L.tileLayer(MAP_LAYERS.topo.url, { 
        attribution: MAP_LAYERS.topo.attribution, 
        maxZoom: MAP_LAYERS.topo.maxZoom 
    });
    
    tileLayerStreet.addTo(map);
    currentTileLayer = tileLayerStreet;
}

function switchLayer(layerName) {
    if (!map) return;
    const layerMap = { street: tileLayerStreet, satellite: tileLayerSatellite, topo: tileLayerTopo };
    const newLayer = layerMap[layerName];
    if (!newLayer || newLayer === currentTileLayer) return;
    if (currentTileLayer && map.hasLayer(currentTileLayer)) map.removeLayer(currentTileLayer);
    newLayer.addTo(map);
    currentTileLayer = newLayer;
}

// ── Karte initialisieren ───────────────────────────────────
function initMap() {
  map = L.map('map', {
    center:          APP.defaultCenter || [51.5, 10.0],
    zoom:            APP.defaultZoom || 6,
    zoomControl:     false,
    attributionControl: true
  });

  // Panes für korrektes Stacking erstellen
  map.createPane('satPane');
  map.getPane('satPane').style.zIndex = 210;
  map.createPane('radarPane');
  map.getPane('radarPane').style.zIndex = 220;
  map.createPane('gripPane');
  map.getPane('gripPane').style.zIndex = 230;

  // Gruppen initialisieren und zur Karte hinzufügen
  S.satGroup   = L.layerGroup().addTo(map);
  S.radarGroup = L.layerGroup().addTo(map);
  S.gripGroup  = L.layerGroup();

  // Layer-Initialisierung jetzt intern
  initMapLayers();

  // Grip-Heatmap bei Zoom aktualisieren (für neue Dichte)
  map.on('zoomend', () => {
    if (currentWeather?.hourly && activeLayer === 'grip') {
      const ci = currentHourIndex(currentWeather);
      buildGripHeatmap(currentLat, currentLng, currentWeather.hourly, ci);
    }
    if (typeof updatePOIMarkerSizes === 'function') {
      updatePOIMarkerSizes();
    }
  });

  // Klick auf Karte → Wettermarker setzen (Wetter-Tab)
  map.on('click', e => {
    if (document.getElementById('tab-weather')?.classList.contains('active')) {
      setWeatherTabLocation(e.latlng, `📍 ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`);
    }
  });
}

// ── Nutzer-Standort ermitteln ──────────────────────────────
function locateUser(onSuccess) {
  if (!navigator.geolocation) {
    onSuccess && onSuccess(currentLat, currentLng);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;
      setUserMarker(currentLat, currentLng);
      onSuccess && onSuccess(currentLat, currentLng);
    },
    () => {
      onSuccess && onSuccess(currentLat, currentLng);
    },
    { timeout: 8000, enableHighAccuracy: true }
  );
}

// ── Nutzer-Marker ──────────────────────────────────────────
function setUserMarker(lat, lng) {
  const icon = L.divIcon({
    className: 'gps-pulse-container',
    html: '<div class="gps-dot-core"></div><div class="gps-pulse-ring"></div>',
    iconSize:   [24, 24],
    iconAnchor: [12, 12]
  });

  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
  } else {
    userMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 })
      .addTo(map)
      .on('click', () => showPositionBadge(lat, lng));
  }
}

// ── Position-Badge: Adresse und GPS-Daten ──────────────────
async function showPositionBadge(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
  try {
    const resp = await fetch(url, { headers: { 'Accept-Language': 'de' } });
    const data = await resp.json();
    const addr = data.address;
    const street = addr.road || addr.pedestrian || 'Unbekannte Straße';
    const city = addr.city || addr.town || addr.village || '';
    
    const content = `
      <div style="font-family:var(--font-ui); min-width:160px">
        <div style="font-weight:800; color:var(--accent); font-size:10px; margin-bottom:4px">AKTUELLE POSITION</div>
        <div style="font-weight:700; font-size:14px; line-height:1.2">${street}</div>
        <div style="font-size:12px; color:var(--text-mid); margin-bottom:8px">${city}</div>
        <div style="font-family:var(--font-mono); font-size:10px; background:var(--surface-2); padding:4px; border-radius:4px; text-align:center">
          ${lat.toFixed(6)}, ${lng.toFixed(6)}
        </div>
      </div>
    `;
    userMarker.bindPopup(content, { offset: [0, -10] }).openPopup();
  } catch (e) {
    console.warn('Position badge error:', e);
    showToast('Standort-Details konnten nicht geladen werden');
  }
}

// ── Karte auf Bereich zoomen ───────────────────────────────
function fitMapToBounds(coords) {
  if (!coords || coords.length < 2) return;
  const bounds = L.latLngBounds(coords);
  map.fitBounds(bounds, { padding: [40, 40] });
}

// ── Radius-Kreis ───────────────────────────────────────────
function showRadiusCircle(lat, lng, radiusKm) {
  if (radiusCircle) map.removeLayer(radiusCircle);
  radiusCircle = L.circle([lat, lng], {
    radius:    radiusKm * 1000,
    color:     '#FF6200',
    weight:    1.5,
    opacity:   0.55,
    fillColor: '#FF6200',
    fillOpacity: 0.04,
    dashArray: '6 6'
  }).addTo(map);
}

function hideRadiusCircle() {
  if (radiusCircle) { 
    map.removeLayer(radiusCircle); 
    radiusCircle = null; 
  }
}

// ── grantAccess – App starten ──────────────────────────────
function grantAccess(name) {
  document.getElementById('lockscreen').style.display = 'none';

  const nameEl = document.getElementById('user-name');
  if (nameEl) nameEl.textContent = (name && name !== 'Testmodus') ? `👤 ${name}` : '';

  loadProfile();
  setDefaultDepartureTime();
  initMap();
  updateBadge();

  locateUser((lat, lng) => {
    map.setView([lat, lng], 12);
    loadWeather(lat, lng);
    loadPOIs(lat, lng);
    showRadiusCircle(lat, lng, profile.radius);
  });

  initWeatherTabExtras();
  initSWUpdateHandler();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .catch(e => console.warn('SW:', e));
  }

  if (name && name !== 'Testmodus' && !localStorage.getItem(ONBOARD_KEY)) {
    setTimeout(openOnboarding, 800);
  }
}

console.log('✓ map.js (Leaflet mit OpenStreetMap) geladen');
