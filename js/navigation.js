'use strict';
/**
 * ── TourCast navigation.js ──
 * Konsolidiertes Modul für A-B Routing, Rundtouren und POIs.
 */

// ── Zentrale Konstanten ──
// POI_TYPES ist in poi.js definiert und wird vor navigation.js geladen

let routingController = null;
let routeLayer = null;
let startMarker = null;
let endMarker = null;
let plannerMode = 'ab';
let _routePulseRaf = null;   // RAF-Handle für Routen-Pulsanimation
// activePOITypes, poiMarkers, poiControllers sind in poi.js definiert
let routingInitialized = false;
let wpIdCounter = 0;
let dragSrcId = null;

// Länder-Konfiguration
const COUNTRIES = [
  { code: 'de', flag: '🇩🇪', name: 'Deutschland' }, { code: 'at', flag: '🇦🇹', name: 'Österreich' },
  { code: 'ch', flag: '🇨🇭', name: 'Schweiz' },     { code: 'fr', flag: '🇫🇷', name: 'Frankreich' },
  { code: 'it', flag: '🇮🇹', name: 'Italien' },     { code: 'es', flag: '🇪🇸', name: 'Spanien' },
  { code: 'nl', flag: '🇳🇱', name: 'Niederlande' }, { code: 'be', flag: '🇧🇪', name: 'Belgien' }
];
let selectedCountries = { from: 'de', to: 'de' };

// Debounce-Timer pro Eingabefeld
const _acTimers = {};
const avoidState = { 
    highways: false, 
    tolls: false, 
    ferries: false,
    unpaved: false,
    unsuitable: false
};

/** Toggelt Vermeidungs-Optionen und berechnet die Route neu */
function toggleAvoid(type) {
    if (avoidState[type] === undefined) return;
    avoidState[type] = !avoidState[type];
    document.getElementById(`btn-avoid-${type}`)?.classList.toggle('active', avoidState[type]);
    
    if (lastRouteCoords && lastRouteCoords.length > 0) {
        if (plannerMode === 'ab') calculateRoute();
        else if (typeof generateRoundTrip === 'function') generateRoundTrip();
    }
}

// Zentraler Reset für Map und UI-Elemente
function resetNavigation() {
    if (routingController) routingController.abort();
    stopRoutePulse();       // Pulsanimation anhalten
    clearDirectionArrows(); // Fahrtrichtungspfeile entfernen
    
    // Layer sicher säubern (Gegen TypeError _fadeAnimated)
    if (!map) return;
    if (routeLayer && map.hasLayer(routeLayer)) map.removeLayer(routeLayer);
    if (startMarker && map.hasLayer(startMarker)) map.removeLayer(startMarker);
    if (endMarker && map.hasLayer(endMarker)) map.removeLayer(endMarker);

    // Rundtour-Layer ebenfalls säubern
    if (typeof roundtrip !== 'undefined') {
        if (roundtrip.routeLayer && map.hasLayer(roundtrip.routeLayer)) map.removeLayer(roundtrip.routeLayer);
        if (roundtrip.marker && map.hasLayer(roundtrip.marker)) map.removeLayer(roundtrip.marker);
        if (roundtrip.visualCircle && map.hasLayer(roundtrip.visualCircle)) map.removeLayer(roundtrip.visualCircle);
        roundtrip.routeLayer = null;
        roundtrip.marker = null;
    }

    if (typeof clearAllPOIMarkers === 'function') clearAllPOIMarkers();
    
    routeLayer = null;
    startMarker = null;
    endMarker = null;
    
    // State zurücksetzen
    lastRouteCoords = [];
    lastRouteDistKm = 0;
    lastRouteDurMin = 0;

    // UI Badges/Bars verstecken
    const barAB = document.getElementById('route-info-bar-ab');
    if (barAB) { barAB.style.display = 'none'; barAB.innerHTML = ''; }
    
    if (typeof clearElevationProfile === 'function') clearElevationProfile();
    if (typeof clearWeatherTimeline === 'function') clearWeatherTimeline();
    
    const saveBtn = document.getElementById('btn-save-route');
    if (saveBtn) saveBtn.style.display = 'none';
}

/** Standard Abfahrtszeit setzen */
function setDefaultDepartureTime() {
  const now = new Date();
  now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
  departureTime = now;
  ['departure-time', 'departure-time-rt'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = now.toTimeString().slice(0, 5);
  });
}

function onDepartureTimeChange(val) {
  const [h, m] = val.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  departureTime = d;
  if (lastRouteCoords.length)
    buildWeatherTimeline(lastRouteCoords, lastRouteDistKm);
}

// Umschalten zwischen A-B und Rundtour
function setPlannerMode(mode) {
    plannerMode = mode;
    const ab = document.getElementById('ab-controls');
    const rt = document.getElementById('rt-controls');
    if (!ab || !rt) return;

    if (mode === 'roundtrip') {
        ab.style.display = 'none';
        rt.style.display = 'block';
        if (typeof renderRoundtripControls === 'function') renderRoundtripControls();
    } else {
        ab.style.display = 'block';
        rt.style.display = 'none';
    }

    const barAB = document.getElementById('route-info-bar-ab');
    if (barAB && lastRouteCoords.length) barAB.style.display = 'flex';

    document.getElementById('btn-nav-toggle')?.classList.toggle('active', mode === 'ab');
    document.getElementById('btn-nav-rt')?.classList.toggle('active', mode === 'roundtrip');
}

// A-B Routing Integration (Referenziert die Logik aus routing.js)
async function handleCalculateRoute() {
  try {
    await calculateRoute();
  } catch (e) {
    console.error('Routing Error:', e);
    showToast('Routing-Fehler: ' + e.message, 'error');
  }
}

// POI-Handling – State-Variablen und Funktionen sind in poi.js definiert
// safeTogglePOI ist ein Guard-Wrapper hier
function safeTogglePOI(type) {
  if (!lastRouteCoords.length && plannerMode === 'ab') {
    showToast("Zuerst Route berechnen!");
    return;
  }
  togglePOI(type);
}

/**
 * Öffnet/schließt den klassischen A-B Planer (Toggle).
 */
function openABPlanner() {
    const panel = document.getElementById('route-panel');
    const wasHidden = panel?.classList.contains('panel-hidden') ?? true;

    if (typeof toggleRoutePanel === 'function') toggleRoutePanel();

    // Tab und Fokus nur beim Öffnen setzen, nicht beim Schließen
    if (wasHidden) {
        if (typeof switchTab === 'function') switchTab('route');
        setTimeout(() => {
            const cityField = document.getElementById('city-from');
            if (cityField) cityField.focus();
        }, 80);
    }
}

/**
 * Öffnet den Rundtour-Modus.
 */
function openRoundtripPlanner() {
    openABPlanner();
}

/** Autocomplete Logik (ehemals routing.js) */
function tcAutocomplete(input, field) {
  // Sammle Werte der strukturierten Felder
  const street = document.getElementById(`street-${field}`)?.value.trim() || '';
  const nr     = document.getElementById(`nr-${field}`)?.value.trim() || '';
  const zip    = document.getElementById(`zip-${field}`)?.value.trim() || '';
  const city   = document.getElementById(`city-${field}`)?.value.trim() || '';
  
  const listContainer = document.getElementById(`ac-${field}`);
  if (listContainer) listContainer.innerHTML = '';

  // Suche bereits ab 2 Zeichen für bessere Reaktivität
  if (street.length < 2 && city.length < 2) return;

  // Baue strukturierte Query
  const query = `${street} ${nr}, ${zip} ${city}`.trim();

  // Debounce: 250 ms (schneller als vorher)
  clearTimeout(_acTimers[field]);
  _acTimers[field] = setTimeout(async () => {
    try {
      // Nutze Photon API für Fuzzy Search und Autocomplete
      const url = `https://photon.komoot.io/api/`
        + `?q=${encodeURIComponent(query)}`
        + `&limit=5&lang=de`;

      const resp = await fetch(url);
      const results = await resp.json();
      if (!results || !results.features || !results.features.length || !listContainer) return;

      const ul = document.createElement('ul');
      ul.className = 'autocomplete-dropdown';

      results.features.forEach(feature => {
        const props = feature.properties;
        const [lng, lat] = feature.geometry.coordinates;
        
        // Baue lesbaren Anzeigenamen
        const parts = [
          props.street ? `${props.street} ${props.housenumber || ''}` : props.name,
          props.postcode,
          props.city || props.town
        ].filter(Boolean);
        const displayName = parts.join(', ');

        const li = document.createElement('li');
        li.className = 'ac-item';
        li.textContent = displayName;
        li.addEventListener('click', () => {
          const sField = document.getElementById(`street-${field}`);
          const nField = document.getElementById(`nr-${field}`);
          const zField = document.getElementById(`zip-${field}`);
          const cField = document.getElementById(`city-${field}`);

          if (nField) nField.value = props.housenumber || '';
          if (zField) zField.value = props.postcode || '';

          // Ortsname: city → town → village → locality → name (Fallback-Kette)
          const cityName = props.city || props.town || props.village || props.locality || props.name || '';
          if (cField) cField.value = cityName;

          // Straße: props.street vorrangig. Falls kein street-Key vorhanden (z.B. Marienplatz),
          // props.name verwenden – aber NUR wenn er sich vom cityName unterscheidet
          // (sonst würde z.B. "München" → beide Felder "München" eingetragen).
          const streetName = props.street || (props.name && cityName && props.name !== cityName ? props.name : '');
          if (sField) sField.value = streetName;

          // Koordinaten auf Street-Feld (primär) UND City-Feld (Fallback für calculateRoute)
          const coord = { lat: String(lat), lng: String(lng) };
          if (sField) { sField.dataset.lat = coord.lat; sField.dataset.lng = coord.lng; }
          if (cField) { cField.dataset.lat = coord.lat; cField.dataset.lng = coord.lng; }

          listContainer.innerHTML = '';
        });
        ul.appendChild(li);
      });

      listContainer.appendChild(ul);

      const closeHandler = (e) => {
        if (listContainer && !listContainer.contains(e.target) && e.target !== input) {
          listContainer.innerHTML = '';
          document.removeEventListener('click', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
    } catch (e) {
      console.warn('Autocomplete Fehler:', e);
    }
  }, 300);
}

/** Toggelt das Länder-Auswahlmenü */
window.toggleCountryPicker = function(field) {
  const picker = document.getElementById(`picker-${field}`);
  if (!picker) return;
  
  if (picker.style.display === 'grid') {
    picker.style.display = 'none';
    return;
  }
  
  picker.style.display = 'grid';
  picker.innerHTML = COUNTRIES.map(c => `
    <div style="cursor:pointer; font-size:24px; text-align:center" 
         onclick="selectCountry('${field}', '${c.code}', '${c.flag}')" title="${c.name}">
      ${c.flag}
    </div>
  `).join('');
};

/** Setzt das gewählte Land */
window.selectCountry = function(field, code, flag) {
  selectedCountries[field] = code;
  document.getElementById(`flag-${field}`).textContent = flag;
  document.getElementById(`picker-${field}`).style.display = 'none';
  showToast(`Suche eingeschränkt auf: ${code.toUpperCase()}`, 'info');
};

/** Nutzt die aktuellen GPS-Koordinaten für ein Eingabefeld */
async function useCurrentLocation(field, overrideLat, overrideLng) {
  const lat = overrideLat || currentLat;
  const lng = overrideLng || currentLng;

  if (!lat || !lng) {
    showToast('⚠️ Standort noch nicht ermittelt');
    return;
  }
  const input = document.getElementById(`input-${field}`);
  if (!input) return;

  input._selectedLatLng = { lat, lng };
  input.value = "Ermittle Adresse...";

  try {
    const url = `${APP.nominatim}/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const resp = await fetch(url);
    const data = await resp.json();
    input.value = formatNominatimAddr(data);
  } catch (e) {
    input.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
  if (typeof saveActiveSession === 'function') saveActiveSession();
}

/** Formatiert Nominatim-Daten in eine saubere Kurzadresse */
function formatNominatimAddr(r) {
  const a = r.address;
  if (!a) return r.display_name;
  const street = a.road || a.pedestrian || r.display_name.split(',')[0];
  const nr     = a.house_number ? ' ' + a.house_number : '';
  const city   = a.city || a.town || a.village || '';
  const plz    = a.postcode ? a.postcode + ' ' : '';
  return `${street}${nr}, ${plz}${city}`;
}
/**
 * Exportiert die aktuelle Route als GPX, optimiert für TomTom Rider 500.
 * Nutzt einen Track für die Präzision und Wegpunkte für die Stopps.
 */
async function exportRouteGPX() {
  if (!lastRouteCoords || lastRouteCoords.length === 0) {
    showToast('Keine Route zum Exportieren vorhanden', 'error');
    return;
  }

  const name = "TourCast_" + new Date().toISOString().slice(0,10);
  
  // GPX Header (Version 1.1 ist Standard für moderne Navis)
  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TourCast 2.0" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
    <desc>Erstellt mit TourCast - Wetteroptimierte Motorradroute</desc>
  </metadata>`;

  // 1. Wegpunkte (Stopps) - Start, Zwischenziele und Ziel
  // Startpunkt
  const start = lastRouteCoords[0];
  gpx += `\n  <wpt lat="${start.lat.toFixed(6)}" lon="${start.lng.toFixed(6)}"><name>START</name></wpt>`;

  // Zwischen-Wegpunkte
  waypoints.forEach((wp, idx) => {
    const lat = wp.lat || wp.latlng?.lat;
    const lng = wp.lng || wp.latlng?.lng;
    if (lat && lng) {
      gpx += `\n  <wpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><name>${escapeHtml(wp.label || 'Wegpunkt ' + (idx+1))}</name></wpt>`;
    }
  });

  // Zielpunkt
  const end = lastRouteCoords[lastRouteCoords.length - 1];
  gpx += `\n  <wpt lat="${end.lat.toFixed(6)}" lon="${end.lng.toFixed(6)}"><name>ZIEL</name></wpt>`;

  // 2. Der Track (Trk) - Optimierung via Douglas-Peucker (ca. 2m Toleranz)
  const optimizedCoords = simplifyPath(lastRouteCoords, 0.00002);

  gpx += `\n  <trk>\n    <name>${name} (Track)</name>\n    <trkseg>`;
  optimizedCoords.forEach(pt => {
    gpx += `\n      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lng.toFixed(6)}"></trkpt>`;
  });
  gpx += `\n    </trkseg>\n  </trk>\n</gpx>`;

  const reduction = 100 - Math.round((optimizedCoords.length / lastRouteCoords.length) * 100);
  console.log(`GPX Optimierung: ${lastRouteCoords.length} -> ${optimizedCoords.length} Punkte (-${reduction}%)`);

  // Export via Electron IPC (W11-main.js) oder Browser-Download
  if (window.electronAPI && window.electronAPI.saveGPX) {
    const res = await window.electronAPI.saveGPX({ content: gpx, filename: `${name}.gpx` });
    if (res.success) showToast('GPX erfolgreich exportiert', 'success');
  } else {
    // Fallback für Browser/PWA
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
/** Route berechnen Logik */
async function calculateRoute() {
  // Erkennt PWA (input-from) und Windows 11 (street-from)
  const fromEl = document.getElementById('input-from') || document.getElementById('street-from');
  const toEl   = document.getElementById('input-to')   || document.getElementById('street-to');
  const cityFrom = document.getElementById('city-from');
  const cityTo   = document.getElementById('city-to');

  // Prüfung ob Start und Ziel (entweder Straße oder Stadt) befüllt sind
  if (!(fromEl?.value.trim() || cityFrom?.value.trim()) || !(toEl?.value.trim() || cityTo?.value.trim())) {
    return showToast('Start und Ziel eingeben', 'error');
  }

  // Koordinaten abrufen (bevorzugt vom Street-Feld, Fallback Stadt-Feld)
  const startLat = parseFloat(fromEl?.dataset.lat || cityFrom?.dataset.lat || fromEl?._selectedLatLng?.lat);
  const startLng = parseFloat(fromEl?.dataset.lng || cityFrom?.dataset.lng || fromEl?._selectedLatLng?.lng);
  const endLat   = parseFloat(toEl?.dataset.lat   || cityTo?.dataset.lat   || toEl?._selectedLatLng?.lat);
  const endLng   = parseFloat(toEl?.dataset.lng   || cityTo?.dataset.lng   || toEl?._selectedLatLng?.lng);

  console.log('🔹 [Coordinates Validation]');
  console.log('  startLat:', startLat, 'startLng:', startLng);
  console.log('  endLat:', endLat, 'endLng:', endLng);
  console.log('  isNaN(startLat):', isNaN(startLat), 'isNaN(startLng):', isNaN(startLng));
  console.log('  isNaN(endLat):', isNaN(endLat), 'isNaN(endLng):', isNaN(endLng));

  if (isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
    return showToast('⚠️ Bitte Adresse aus der Vorschlagsliste wählen oder Karte nutzen', 'error');
  }
  
  resetNavigation();
  
  const coords = [[startLng, startLat]];
  // Unterstützung für verschiedene Wegpunkt-Datenstrukturen
  waypoints.forEach(wp => {
    const lat = wp.lat || wp.latlng?.lat;
    const lng = wp.lng || wp.latlng?.lng;
    if (lat && lng) coords.push([lng, lat]);
  });
  coords.push([endLng, endLat]);

  // Mapping der Präferenz: 'standard' wird zu 'recommended' für ORS Kompatibilität
  const pref = (profile.routingPreference === 'standard') ? 'recommended' : (profile.routingPreference || 'recommended');

  const avoidFeatures = [];
  if (avoidState.highways) avoidFeatures.push('highways');
  if (avoidState.tolls)    avoidFeatures.push('tollways');
  if (avoidState.ferries)  avoidFeatures.push('ferries');
  if (avoidState.unpaved)  avoidFeatures.push('unpaved');
  if (avoidState.unsuitable) avoidFeatures.push('tracks');

  // Build request body - nur include avoid_features wenn vorhanden
  const body = {
    coordinates: coords,
    preference: pref,
    units: 'km',
    language: 'de',
    instructions: true
  };

  // Nur avoid_features hinzufügen wenn welche vorhanden sind
  if (avoidFeatures.length > 0) {
    body.options = { avoid_features: avoidFeatures };
  }

  if (routingController) routingController.abort();
  routingController = new AbortController();
  showToast('Route wird berechnet…', 'info');

  // Wir nutzen das Auto-Profil (Motorrad-Profil existiert nicht bei ORS)
  // URL vorbereiten (entferne /geojson if present) und füge API-Key hinzu
  const apiUrl = APP.orsApi
    .replace('/geojson', '')
    .replace(/#/g, 'HASH_PLACEHOLDER')  // Escape Hashes
    + `?api_key=${encodeURIComponent(APP.orsKey)}`;

  console.log('🔹 [ORS Request Debug]');
  console.log('  URL:', apiUrl.substring(0, 80) + '...');
  console.log('  API-Key:', APP.orsKey ? `${APP.orsKey.substring(0, 20)}...` : 'MISSING');
  console.log('  Coordinates:', JSON.stringify(coords));
  console.log('  Body:', JSON.stringify(body, null, 2));

  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },  // ← NO Authorization header!
      body: JSON.stringify(body),
      signal: routingController.signal
    });

    console.log('🔹 [ORS Response]', resp.status, resp.statusText);

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error('🔹 [ORS Error Response]:', errorText);
      throw new Error(`ORS HTTP ${resp.status}: ${errorText}`);
    }
    const data = await resp.json();

    // Robustere Prüfung der Server-Antwort (Features für GeoJSON, Routes für Standard-JSON)
    const route = (data.features && data.features.length > 0) ? data.features[0] : 
                  (data.routes && data.routes.length > 0) ? data.routes[0] : null;

    if (!route) {
      const apiErr = data.error?.message || data.message || 'Keine Route in der Antwort gefunden';
      throw new Error(apiErr);
    }

    const summary  = route.properties ? route.properties.summary : route.summary;
    
    // Geometrie-Extraktion: GeoJSON liefert Arrays, Standard-JSON liefert Encoded Polylines (String)
    const coords2D = (route.geometry && typeof route.geometry === 'object')
      ? route.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] })) // GeoJSON: [lng, lat] -> {lat, lng}
      : decodePolyline(route.geometry).map(c => ({ lat: c[0], lng: c[1] })); // String -> [lat, lng] -> {lat, lng}

    if (!coords2D || coords2D.length === 0) throw new Error('Routengeometrie konnte nicht verarbeitet werden');

    lastRouteCoords  = coords2D;
    lastRouteDistKm  = Math.round(summary.distance * 10) / 10;
    lastRouteDurMin  = Math.round(summary.duration / 60);

    routeLayer = L.polyline(coords2D, { color: 'var(--accent)', weight: 4, opacity: 0.85 }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
    animateRouteDraw(routeLayer);
    startRoutePulse(routeLayer);
    addDirectionArrows(coords2D);

    // Start-Marker: grüne animierte Startfahne
    const startIcon = L.divIcon({
      className: 'marker-flag-container',
      html: '<div class="flag-marker">'
          + '<div class="flag-pole"></div>'
          + '<div class="flag-base flag-base-start"></div>'
          + '<div class="flag-cloth flag-cloth-start"></div>'
          + '</div>',
      iconSize:   [38, 46],
      iconAnchor: [5, 46]
    });
    startMarker = L.marker([startLat, startLng], { icon: startIcon }).addTo(map).bindPopup('Start: ' + fromEl.value);

    // Ziel-Marker: schwarz-weiße Zielfahne (kariert)
    const endIcon = L.divIcon({
      className: 'marker-flag-container',
      html: '<div class="flag-marker">'
          + '<div class="flag-pole"></div>'
          + '<div class="flag-base flag-base-end"></div>'
          + '<div class="flag-cloth flag-cloth-end"></div>'
          + '</div>',
      iconSize:   [38, 46],
      iconAnchor: [5, 46]
    });
    endMarker = L.marker([endLat, endLng], { icon: endIcon }).addTo(map).bindPopup('Ziel: ' + toEl.value);

    // Folge-Aktionen
    const barAB = document.getElementById('route-info-bar-ab');
    if (barAB) barAB.style.display = 'flex';

    renderRouteInfoBar(lastRouteDistKm, lastRouteDurMin, 'ab');
    buildWeatherTimeline(lastRouteCoords, lastRouteDistKm);
    // Folge-Aktionen gemäß FIX 09
    if (typeof buildGripAlongRoute === 'function') buildGripAlongRoute(lastRouteCoords);
    if (typeof buildElevationProfile === 'function') buildElevationProfile(lastRouteCoords);
    
    const saveBtn = document.getElementById('btn-save-route');
    if (saveBtn) saveBtn.style.display = 'inline-flex';

    // Anzeige von Warnungen (z.B. zeitweise Sperrungen oder Einschränkungen)
    if (route.warnings && route.warnings.length > 0) {
      const warningMsg = route.warnings.map(w => w.message).join(', ');
      showToast(`Streckenhinweis: ${warningMsg}`, 'info');
    }
  } catch (e) {
    if (e.name !== 'AbortError') showToast('Routing fehlgeschlagen: ' + e.message, 'error');
  }
}

/** Route Info-Bar rendern */
function renderRouteInfoBar(distKm, durMin, mode = 'ab') {
  const barId = 'route-info-bar-ab';
  const bar = document.getElementById(barId);
  if (!bar) return;
  
  const h   = Math.floor(durMin / 60);
  const m   = durMin % 60;
  const dur = h > 0 ? `${h}h ${m}min` : `${m}min`;

  bar.innerHTML = `
    <div class="route-stat">
      <span class="route-stat-val mono">${distKm.toFixed(1)} km</span>
      <span class="route-stat-lbl">DISTANZ</span>
    </div>
    <div class="route-stat">
      <span class="route-stat-val mono">${dur}</span>
      <span class="route-stat-lbl">FAHRZEIT</span>
    </div>
  `;
}

function drawImportedRoute(coords, name) {
  resetNavigation();
  routeLayer = L.polyline(coords, { color: '#FF6200', weight: 5, opacity: 0.88 }).addTo(map);
  animateRouteDraw(routeLayer);
  startRoutePulse(routeLayer);
  addDirectionArrows(coords);
  const importStartIcon = L.divIcon({
    className: 'marker-flag-container',
    html: '<div class="flag-marker"><div class="flag-pole"></div><div class="flag-base flag-base-start"></div><div class="flag-cloth flag-cloth-start"></div></div>',
    iconSize: [38, 46], iconAnchor: [5, 46]
  });
  const importEndIcon = L.divIcon({
    className: 'marker-flag-container',
    html: '<div class="flag-marker"><div class="flag-pole"></div><div class="flag-base flag-base-end"></div><div class="flag-cloth flag-cloth-end"></div></div>',
    iconSize: [38, 46], iconAnchor: [5, 46]
  });
  startMarker = L.marker([coords[0].lat, coords[0].lng], { icon: importStartIcon }).addTo(map).bindPopup(name + ' (Start)');
  endMarker = L.marker([coords[coords.length-1].lat, coords[coords.length-1].lng], { icon: importEndIcon }).addTo(map).bindPopup(name + ' (Ziel)');
  map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
}

/** Zeichnet nummerierte Marker für alle Wegpunkte */
function renderWaypointMarkers() {
  waypoints.forEach((wp, index) => {
    const lat = wp.lat || wp.latlng?.lat;
    const lng = wp.lng || wp.latlng?.lng;
    if (!lat || !lng) return;

    if (wp.marker && map.hasLayer(wp.marker)) map.removeLayer(wp.marker);

    const icon = L.divIcon({ 
      className: 'marker-container', 
      html: `<div class="map-marker-custom marker-wp">${(index + 1)}</div>`, 
      iconSize: [22, 22], 
      iconAnchor: [11, 11] 
    });
    wp.marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
    wp.marker.bindPopup(`<b>Wegpunkt ${index + 1}</b><br>${wp.label || wp.name}<br><button onclick="removeWaypoint(${wp.id})">Entfernen</button>`);
  });
}

/**
 * Fügt einen Zwischenwegpunkt zur Routenliste hinzu und re-rendert die Wegpunkt-UI.
 * @param {{lat: number, lng: number}} coords
 * @param {string} label - Anzeigename des Wegpunkts
 * @param {string} desc - Zusätzliche Informationen (Adresse, etc.)
 */
function addWaypoint(coords, label, desc = "") {
  if (!coords?.lat || !coords?.lng) return;

  const id = ++wpIdCounter;
  waypoints.push({ id, lat: coords.lat, lng: coords.lng, label: label || `Wegpunkt ${id}`, desc: desc });

  renderWaypointMarkers();
  renderWaypointList();
  showToast(`Wegpunkt hinzugefügt: ${label}`, 'success');
}

/**
 * Entfernt einen Wegpunkt aus Liste und Karte.
 * @param {number} id - wpIdCounter-ID des Wegpunkts
 */
function removeWaypoint(id) {
  const idx = waypoints.findIndex(w => w.id === id);
  if (idx === -1) return;
  const wp = waypoints[idx];
  if (wp.marker && map.hasLayer(wp.marker)) map.removeLayer(wp.marker);
  waypoints.splice(idx, 1);
  renderWaypointList();
}

/**
 * Rendert die Wegpunkt-Liste in der UI (Drag-Reorder).
 */
function renderWaypointList() {
  const container = document.getElementById('waypoint-list');
  if (!container) return;

  container.innerHTML = waypoints.map(wp => `
    <div class="waypoint-item" draggable="true" data-id="${wp.id}">
      <span class="wp-grip">⠿</span>
      <span class="wp-label">${wp.label}</span>
      <button class="wp-remove" onclick="removeWaypoint(${wp.id})">✕</button>
    </div>
  `).join('');

  // Drag-Reorder aktivieren
  container.querySelectorAll('.waypoint-item').forEach(el => {
    el.addEventListener('dragstart', () => { dragSrcId = parseInt(el.dataset.id); });
    el.addEventListener('dragover',  e => e.preventDefault());
    el.addEventListener('drop', () => {
      const dropId = parseInt(el.dataset.id);
      if (dragSrcId === dropId) return;
      const from = waypoints.findIndex(w => w.id === dragSrcId);
      const to   = waypoints.findIndex(w => w.id === dropId);
      waypoints.splice(to, 0, waypoints.splice(from, 1)[0]);
      renderWaypointList();
    });
  });
}

// addPOIAsWaypoint, decodePolyline, buildAddress, buildExtraInfo,
// translateOverpassError, buildPoiPopupHtml, renderPOIBar sind in poi.js definiert

/** Kehrt die Route um (Start ↔ Ziel) inkl. aller Zwischenziele */
function reverseABRoute() {
  const fields = ['street', 'nr', 'zip', 'city', 'input'];

  // 1. Textwerte, Datasets und Koordinaten für alle möglichen Quellfelder tauschen
  fields.forEach(f => {
    const fEl = document.getElementById(`${f}-from`);
    const tEl = document.getElementById(`${f}-to`);
    if (fEl && tEl) {
      // Textwerte tauschen
      const val = fEl.value;
      fEl.value = tEl.value;
      tEl.value = val;

      // Koordinaten-Datasets (Nominatim) tauschen
      const lat = fEl.dataset.lat;
      const lng = fEl.dataset.lng;
      fEl.dataset.lat = tEl.dataset.lat || '';
      fEl.dataset.lng = tEl.dataset.lng || '';
      tEl.dataset.lat = lat || '';
      tEl.dataset.lng = lng || '';

      // Objekt-Referenz für Standorte (GPS/Map-Pick) tauschen
      const tmpLoc = fEl._selectedLatLng;
      fEl._selectedLatLng = tEl._selectedLatLng;
      tEl._selectedLatLng = tmpLoc;
    }
  });

  // 3. Länder & Flaggen tauschen
  const tmpCountry = selectedCountries.from;
  selectedCountries.from = selectedCountries.to;
  selectedCountries.to = tmpCountry;
  selectCountry('from', selectedCountries.from, COUNTRIES.find(c => c.code === selectedCountries.from).flag);
  selectCountry('to',   selectedCountries.to,   COUNTRIES.find(c => c.code === selectedCountries.to).flag);

  // 4. Wegpunkte umkehren und neu berechnen
  waypoints.reverse();
  if (lastRouteCoords.length) calculateRoute();
}

// ── Fahrtrichtungspfeile ──────────────────────────────────────────────────
let directionArrowMarkers = [];

function addDirectionArrows(coords) {
  clearDirectionArrows();
  if (!coords || coords.length < 2 || !map) return;

  // Koordinaten normalisieren: {lat,lng} Objekte UND [lat,lng] Arrays unterstützen
  const norm = coords.map(c => Array.isArray(c)
    ? { lat: c[0], lng: c[1] }
    : { lat: c.lat, lng: c.lng }
  );

  // Pfeile gleichmäßig verteilt, min. 3, max. 12
  const numArrows = Math.max(3, Math.min(12, Math.floor(norm.length / 20)));
  const step = Math.floor(norm.length / (numArrows + 1));

  for (let i = 1; i <= numArrows; i++) {
    const idx = i * step;
    if (idx >= norm.length - 1) break;

    const p1 = norm[idx];
    const p2 = norm[Math.min(idx + 5, norm.length - 1)];
    if (!p1 || !p2 || p1.lat == null || p1.lng == null) continue;

    // Bearing berechnen (Fahrtrichtung in Grad von Nord)
    const lat1 = p1.lat * Math.PI / 180;
    const lat2 = p2.lat * Math.PI / 180;
    const dLng = (p2.lng - p1.lng) * Math.PI / 180;
    const y    = Math.sin(dLng) * Math.cos(lat2);
    const x    = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;

    // Quadratischer 20×20 Wrapper: CSS-Rotation auf dem div verschiept nie den Layout-Anker.
    // Ohne quadratische Box würde Rotation eines 10×16 Icons den visuellen Mittelpunkt versetzen.
    // fill="#1565C0" = kräftiges Blau, gut sichtbar auf hellem CartoDB-Hintergrund
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:20px;height:20px;transform:rotate(${bearing}deg);transform-origin:50% 50%"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 3L17 15L10 12L3 15Z" fill="#1565C0" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg></div>`,
      iconSize:   [20, 20],
      iconAnchor: [10, 10]
    });

    const m = L.marker([p1.lat, p1.lng], { icon, interactive: false, zIndexOffset: -200 }).addTo(map);
    directionArrowMarkers.push(m);
  }
}

function clearDirectionArrows() {
  directionArrowMarkers.forEach(m => { try { if (map && map.hasLayer(m)) map.removeLayer(m); } catch(e) {} });
  directionArrowMarkers = [];
}

// ── Route Draw-Animation (stroke-dashoffset) ──────────────────────────────
// Zeichnet die Route visually von Anfang bis Ende in ~1.2s
function animateRouteDraw(layer) {
  requestAnimationFrame(() => {
    const p = layer?._path;
    if (!p || typeof p.getTotalLength !== 'function') return;
    const len = p.getTotalLength();
    p.style.strokeDasharray  = `${len}px`;
    p.style.strokeDashoffset = `${len}px`;
    p.style.transition       = 'stroke-dashoffset 1.2s ease-out';
    // Zweiter RAF stellt sicher, dass der Browser den Anfangszustand gerendert hat
    requestAnimationFrame(() => { p.style.strokeDashoffset = '0px'; });
    // Nach Animation: dasharray/dashoffset entfernen → solide Linie
    // Leaflet zeichnet SVG-Pfad beim Zoomen mit neuen Pixelwerten neu,
    // ohne Reset w\u00fcrde der alte dasharray-Wert Teile der Route ausblenden
    setTimeout(() => {
      const path = layer?._path;
      if (path) {
        path.style.transition      = '';
        path.style.strokeDasharray  = '';
        path.style.strokeDashoffset = '';
      }
    }, 1400);
  });
}

// ── Routen-Pulsanimation (RAF-Loop, gentles Atmen) ────────────────────────
// FIX #18: Direkte DOM-Manipulation statt layer.setStyle() – letzteres ruft
// Leaflets _updateStyle() auf, das strokeDashoffset/strokeDasharray zurücksetzt
// und damit die Draw-Animation zerstört. Zusätzlich 1.3s Verzögerung damit die
// Draw-Animation (1.2s) vollständig abläuft bevor der Puls startet.
function startRoutePulse(layer) {
  stopRoutePulse();
  if (!layer) return;
  let t = 0;
  const startPulse = () => {
    function tick() {
      t++;
      // Sanftes Atmen: 0.72 … 0.92, ~2s Zyklus bei 60 fps
      const opacity = 0.72 + 0.20 * (0.5 + 0.5 * Math.sin((t * Math.PI) / 60));
      try {
        const p = layer._path;
        if (p) p.style.opacity = String(opacity); // Direkte DOM-Manipulation – kein _updateStyle()
      } catch(e) { return; }
      _routePulseRaf = requestAnimationFrame(tick);
    }
    _routePulseRaf = requestAnimationFrame(tick);
  };
  // 1.3s warten damit die Draw-Animation abgeschlossen ist (1.2s ease-out)
  setTimeout(startPulse, 1300);
}

function stopRoutePulse() {
  if (_routePulseRaf) { cancelAnimationFrame(_routePulseRaf); _routePulseRaf = null; }
}