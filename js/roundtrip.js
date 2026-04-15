'use strict';
// ── TourCast roundtrip.js – Rundtour-Generator ──
// Must-Have: Rundtour-Generator (Radius + Himmelsrichtung + Kurven-Intensität)

// ── State ─────────────────────────────────────────────────
const roundtrip = {
  radiusKm:    80,       // Aktionsradius der Rundtour
  direction:   0,        // Hauptrichtung in Grad (0=N, 90=E, 180=S, 270=W)
  curveLevel:  2,        // 1=gering | 2=mittel | 3=kurvig
  origin:      null,     // { lat, lng } Startpunkt
  routeLayer:  null,     // Leaflet-Layer der aktuellen Rundtour
  visualCircle: null,    // Vorschau-Kreis auf der Karte
  marker:      null      // Start/Ziel Marker
};

// ── Kurven-Intensität → ORS-Parameter ────────────────────
const CURVE_PROFILES = {
  1: { weight: 0.2, label: 'DIREKT' }, // emoji: '➡️'
  2: { weight: 0.6, label: 'STANDARD' }, // emoji: '〰️'
  3: { weight: 1.0, label: 'KURVIG' } // emoji: '🌀'
};

// ── Himmelsrichtungen ─────────────────────────────────────
const DIRECTIONS = [
  { deg: 0,   label: 'Nord' }, // emoji: '⬆️'
  { deg: 45,  label: 'Nordost' }, // emoji: '↗️'
  { deg: 90,  label: 'Ost' }, // emoji: '➡️'
  { deg: 135, label: 'Südost' }, // emoji: '↘️'
  { deg: 180, label: 'Süd' }, // emoji: '⬇️'
  { deg: 225, label: 'Südwest' }, // emoji: '↙️'
  { deg: 270, label: 'West' }, // emoji: '⬅️'
  { deg: 315, label: 'Nordwest' } // emoji: '↖️'
];

// ── Rundtour UI rendern ───────────────────────────────────
function renderRoundtripControls() {
  const container = document.getElementById('rt-controls');
  if (!container) return;

  // Kompass-Layout: Wir ordnen die Richtungen für ein 3x3 Grid an
  // NW(315) N(0) NE(45) | W(270) center E(90) | SW(225) S(180) SE(135)
  const gridOrder = [315, 0, 45, 270, null, 90, 225, 180, 135];

  container.innerHTML = `
    <!-- Tourenlänge / Zielentfernung -->
    <div class="sett-row" style="padding:8px 14px 0">
      <span class="sett-label">Tourenlänge</span>
      <span class="sett-val mono" id="rt-radius-val">${roundtrip.radiusKm} km</span>
    </div>
    <div class="range-wrap" style="padding:4px 14px 10px">
      <span class="range-a">20</span>
      <input type="range" id="rt-radius" class="tc-range"
             min="20" max="100" step="10"
             value="${Math.min(roundtrip.radiusKm, 100)}"
             oninput="onRtRadiusChange(this.value)">
      <span class="range-a">100</span>
    </div>

    <!-- Himmelsrichtung (Kompass) -->
    <div class="route-section-title" style="margin:4px 0 6px">
      Himmelsrichtung (Fahrtrichtung)
    </div>
    <div class="rt-compass-grid" id="rt-compass-grid">
      ${gridOrder.map(deg => {
        if (deg === null) return `<div class="rt-center-icon" style="display:flex;align-items:center;justify-content:center;opacity:0.3">📍</div>`;
        const d = DIRECTIONS.find(x => x.deg === deg);
        return `
          <button class="rt-dir-btn${d.deg === roundtrip.direction ? ' active' : ''}"
                  data-deg="${d.deg}"
                  onclick="setRtDirection(${d.deg})"
                  title="${d.label}">
            <span class="rt-dir-lbl">${getShortDir(d.label)}</span>
          </button>`;
      }).join('')}
    </div>

    <!-- Kurven-Intensität -->
    <div class="route-section-title" style="margin:10px 0 6px">
      Kurven-Intensität
    </div>
    <div class="rt-curve-seg">
      ${Object.entries(CURVE_PROFILES).map(([lvl, cfg]) => `
        <button class="seg-btn${parseInt(lvl) === roundtrip.curveLevel ? ' active' : ''}"
                data-lvl="${lvl}"
                onclick="setRtCurveLevel(${lvl})">
          ${cfg.label}
        </button>`).join('')}
    </div>

    <!-- Startpunkt -->
    <div class="route-section-title" style="margin:10px 0 4px">
      Startpunkt
    </div>
    <div class="route-input-wrap" style="margin:0 14px 10px; display:block">
      <input type="text" id="rt-origin-input" class="route-input"
             placeholder="Startpunkt (leer = mein Standort)"
             oninput="tcAutocomplete(this,'rt-origin')">
      <div class="autocomplete-list" id="ac-rt-origin"></div>
    </div>

    <!-- Abfahrtszeit -->
    <div class="route-depart-row">
      <span class="route-depart-lbl">🕐 Abfahrt</span>
      <input type="time" id="departure-time-rt" class="route-time-input"
             onchange="onDepartureTimeChange(this.value)">
    </div>

    <!-- Generieren -->
    <div class="route-actions">
      <button class="route-btn btn-random" onclick="setRandomRoundtrip()" title="Radius und Richtung würfeln">
        🎲 Zufall
      </button>
      <button class="route-btn primary" onclick="generateRoundTrip()">
        🔄 Rundtour generieren
      </button>
      <button class="route-btn" onclick="reverseRoute()"
              id="btn-rt-reverse" style="display:none">
        🔃 Umdrehen
      </button>
    </div>

    <!-- Info nach Berechnung -->
    <div id="rt-info-bar" style="display:none"></div>
  `;

  // Abfahrtszeit synchronisieren
  const dtEl = document.getElementById('departure-time-rt');
  if (dtEl && departureTime) {
    dtEl.value = departureTime.toTimeString().slice(0, 5);
  }
}

// ── Slider Handler ────────────────────────────────────────
function onRtRadiusChange(val) {
  roundtrip.radiusKm = parseInt(val);
  const el = document.getElementById('rt-radius-val');
  if (el) el.textContent = `${roundtrip.radiusKm} km`;
  updateRtVisualCircle();
}

/** Synchronisiert den Radius-Slider visuell mit einem Kreis auf der Karte */
function updateRtVisualCircle() {
  if (typeof map === 'undefined' || !map) return;

  // Alten Vorschau-Kreis entfernen
  if (roundtrip.visualCircle) {
    map.removeLayer(roundtrip.visualCircle);
    roundtrip.visualCircle = null;
  }

  // Zentrum bestimmen: Geocodiertes Startfeld -> Letzte Rundtour -> Aktueller Standort
  const input = document.getElementById('rt-origin-input');
  let center = null;

  if (input && input._selectedLatLng) {
    center = input._selectedLatLng;
  } else if (roundtrip.origin) {
    center = roundtrip.origin;
  } else if (typeof currentLat !== 'undefined' && currentLat) {
    center = { lat: currentLat, lng: currentLng };
  }

  if (!center) return;

  roundtrip.visualCircle = L.circle([center.lat, center.lng], {
    radius:      roundtrip.radiusKm * 1000,
    color:       '#FF6200',
    weight:      2,
    dashArray:   '5, 10',
    fillColor:   '#FF6200',
    fillOpacity: 0.1,
    interactive: false
  }).addTo(map);
}

function getShortDir(label) {
  return label.replace('Nordost','NO').replace('Nordwest','NW').replace('Südost','SO').replace('Südwest','SW')
              .replace('Nord','N').replace('Süd','S').replace('West','W').replace('Ost','O');
}

// ── Richtung setzen ───────────────────────────────────────
function setRtDirection(deg) {
  roundtrip.direction = deg;
  document.querySelectorAll('.rt-dir-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.deg) === deg);
  });
}

/** Wählt zufällige Werte für Radius und Richtung aus */
function setRandomRoundtrip() {
  // 1. Zufälliger Radius (zwischen 20 und 300, in 10er Schritten)
  const min = 20, max = 100, step = 10;
  const stepsCount = (max - min) / step;
  const randomStep = Math.floor(Math.random() * (stepsCount + 1));
  const newRadius = min + (randomStep * step);

  // 2. Zufällige Richtung aus dem DIRECTIONS Array
  const randomDirIndex = Math.floor(Math.random() * DIRECTIONS.length);
  const newDir = DIRECTIONS[randomDirIndex].deg;

  // 3. UI & State synchronisieren
  const radiusSlider = document.getElementById('rt-radius');
  if (radiusSlider) radiusSlider.value = newRadius;
  
  // Bestehende Handler aufrufen für Map-Preview und Button-Styles
  onRtRadiusChange(newRadius);
  setRtDirection(newDir);

  showToast(`🎲 Überraschung: ${newRadius} km nach ${DIRECTIONS[randomDirIndex].label}`, 2000);
}

// ── Kurven-Level setzen ───────────────────────────────────
function setRtCurveLevel(lvl) {
  roundtrip.curveLevel = parseInt(lvl);
  document.querySelectorAll('.rt-curve-seg .seg-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.lvl) === roundtrip.curveLevel);
  });
}

// ── Rundtour generieren ───────────────────────────────────
async function generateRoundTrip() {
  // Startpunkt ermitteln
  let origin = await resolveRtOrigin();
  if (!origin) return;
  roundtrip.origin = origin;

  // Zentraler Reset aller Karten-Layer und Routing-Daten (nachhaltige Lösung)
  if (typeof resetNavigation === 'function') resetNavigation();

  document.getElementById('calc-loader')?.classList.remove('hidden'); // show loader
  showToast('Rundtour wird berechnet…', 2000); // no emoji
  document.getElementById('btn-rt-reverse') &&
    (document.getElementById('btn-rt-reverse').style.display = 'none');

  try {
    // Wegpunkte berechnen
    const viaPoints = buildRoundtripWaypoints(
      origin, roundtrip.radiusKm, roundtrip.direction, roundtrip.curveLevel
    );

    // ORS Round-Trip-Routing abrufen
    const data = await fetchRoundtripRoute(origin, viaPoints);
    
    // Robustere Pfad-Extraktion (analog zu navigation.js)
    const route = (data.features && data.features.length > 0) ? data.features[0] : 
                  (data.routes && data.routes.length > 0) ? data.routes[0] : null;

    if (!route) throw new Error('Keine Route berechnet');

    // Geometrie-Dekodierung: Unterstützt nun GeoJSON-Objekte und Encoded Polylines (String)
    const coords = (route.geometry && typeof route.geometry === 'object')
      ? route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }))
      : decodePolyline(route.geometry).map(([lat, lng]) => ({ lat, lng }));

    const summary = route.properties ? route.properties.summary : route.summary;

    // Route auf Karte zeichnen
    drawRoundtripRoute(coords);

    // Distanz + Dauer berechnen
    lastRouteCoords  = coords;
    lastRouteDistKm  = summary.distance;
    lastRouteDurMin  = Math.round(summary.duration / 60);

    // Info-Bar
    renderRtInfoBar(lastRouteDistKm, lastRouteDurMin);

    // Nachgelagerte Module
    await buildElevationProfile(coords);
    await buildWeatherTimeline(coords, lastRouteDistKm);
    if (lastRouteDistKm > (profile.tankRange || 300) * 0.6)
      await loadFuelAlongRoute(coords, lastRouteDistKm);

    // Reverse-Button einblenden
    const revBtn = document.getElementById('btn-rt-reverse');
    if (revBtn) revBtn.style.display = '';

    showToast(`Rundtour ${lastRouteDistKm.toFixed(0)} km`, 2500);

  } catch(e) {
    console.error('Rundtour fehlgeschlagen:', e.message);
    showToast(`Rundtour fehlgeschlagen: ${e.message}`);
  } finally {
    document.getElementById('calc-loader')?.classList.add('hidden');
  }
}

// ── Startpunkt auflösen ───────────────────────────────────
async function resolveRtOrigin() {
  const input = document.getElementById('rt-origin-input');
  const val   = input?.value.trim();

  // Leer → aktueller Standort
  if (!val) {
    if (currentLat && currentLng) return { lat: currentLat, lng: currentLng };
    showToast('⚠️ Standort nicht verfügbar');
    return null;
  }

  // Bereits durch Autocomplete gesetzt?
  if (input._selectedLatLng) return input._selectedLatLng;

  // Geocodierung via Nominatim
  try {
    const url  = `${APP.nominatim}/search?q=${encodeURIComponent(val)}&format=json&limit=1&countrycodes=de,at,ch`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.length) { showToast('⚠️ Ort nicht gefunden'); return null; }
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    showToast('⚠️ Geocodierung fehlgeschlagen');
    return null;
  }
}

// ── Wegpunkte für Rundtour berechnen ─────────────────────
/**
 * Erzeugt via-Punkte entlang eines Bogens in der gewählten
 * Hauptrichtung, gefärbt durch die Kurven-Intensität.
 */
function buildRoundtripWaypoints(origin, radiusKm, dirDeg, curveLevel) {
  const R      = 6371;
  const r      = radiusKm / R;               // in Radiant
  const dirRad = dirDeg * Math.PI / 180;
  const lat0   = origin.lat * Math.PI / 180;
  const lng0   = origin.lng * Math.PI / 180;

  // Anzahl Zwischenpunkte je nach Kurven-Intensität
  const numPts  = curveLevel === 1 ? 2 : curveLevel === 2 ? 4 : 6;

  // Bogenwinkel: Hauptrichtung ± Spread
  const spread  = curveLevel === 1
    ? Math.PI / 3          // 60° statt 30°
    : curveLevel === 2
      ? Math.PI / 1.5      // 120° statt 72°
      : Math.PI * 1.2;     // 216° statt 153° – erzwingt weiten Bogen

  const points = [];
  for (let i = 0; i < numPts; i++) {
    // Gleichmäßig über den Bogen verteilen
    const t      = numPts === 1 ? 0.5 : i / (numPts - 1);
    // Bogen: von (dir - spread/2) bis (dir + spread/2)
    const angle  = dirRad - spread / 2 + t * spread;

    // Distanz: Wir erhöhen den Mindestabstand (0.8), damit die Tour nicht am Start "klebt"
    const distFrac = Math.sin(Math.PI * t); 
    const dist     = r * (0.8 + distFrac * 0.2);

    // Sphärische Verschiebung
    const lat1 = Math.asin(
      Math.sin(lat0) * Math.cos(dist) +
      Math.cos(lat0) * Math.sin(dist) * Math.cos(angle)
    );
    const lng1 = lng0 + Math.atan2(
      Math.sin(angle) * Math.sin(dist) * Math.cos(lat0),
      Math.cos(dist) - Math.sin(lat0) * Math.sin(lat1)
    );

    points.push({
      lat: lat1 * 180 / Math.PI,
      lng: lng1 * 180 / Math.PI
    });
  }
  return points;
}

// ── ORS-Routing für Rundtour ──────────────────────────────
// FIX Tourenlänge: Nutzt ORS native round_trip API (options.round_trip.length).
// Diese Methode respektiert die gewünschte Länge direkt – im Gegensatz zur
// manuellen Via-Punkte-Methode, die nur den Radius steuerte (nicht die Länge).
async function fetchRoundtripRoute(origin, viaPoints) {
  // roundtrip.radiusKm enthält die GEWÜNSCHTE TOURENLÄNGE in km
  // ORS Free-Tier Limit: max. 100.000 m (= 100 km)
  const targetLengthM = Math.min(Math.round(roundtrip.radiusKm * 1000), 100_000);

  // direction (0-359°) als seed für ORS (grobe Richtungssteuerung)
  const seed = roundtrip.direction;

  const body = {
    coordinates: [[origin.lng, origin.lat]],
    preference:  'fastest',
    units:       'km',
    language:    'de',
    options: {
      round_trip: {
        length: targetLengthM,
        points: 5,
        seed
      }
    }
  };

  // Nur gültige ORS avoid_features hinzufügen ('unpaved'/'tracks' sind nicht gültig)
  const avoidOpts = buildOrsOptionsRt();
  if (avoidOpts.avoid_features && avoidOpts.avoid_features.length > 0) {
    body.options.avoid_features = avoidOpts.avoid_features;
  }

  const apiUrl = APP.orsApi.replace('/geojson', '') + `?api_key=${encodeURIComponent(APP.orsKey)}`;

  const resp = await fetch(apiUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  });

  if (!resp.ok) {
    let errDetail = `ORS ${resp.status}`;
    try {
      const body = await resp.text();
      const parsed = JSON.parse(body);
      errDetail = parsed?.error?.message || parsed?.message || body.slice(0, 200);
    } catch (_) {}
    console.error(`Rundtour ORS ${resp.status}:`, errDetail);
    throw new Error(`ORS ${resp.status}: ${errDetail}`);
  }
  return await resp.json();
}

// ── ORS Avoid-Options (gemeinsam mit routing.js) ──────────
function buildOrsOptionsRt() {
  const avoid = [];
  if (avoidState.highways) avoid.push('highways');
  if (avoidState.tolls)    avoid.push('tollways');
  if (avoidState.ferries)  avoid.push('ferries');
  // HINWEIS: 'unpaved' und 'tracks' sind KEINE gültigen ORS v2 avoid_features → weggelassen
  const opts = {};
  if (avoid.length) opts.avoid_features = avoid;
  return opts;
}

// ── Route zeichnen ────────────────────────────────────────
function drawRoundtripRoute(coords) {
  // Bestehende Route entfernen
  if (roundtrip.routeLayer) {
    map.removeLayer(roundtrip.routeLayer);
  }
  if (roundtrip.marker) {
    map.removeLayer(roundtrip.marker);
  }

  const latlngs = coords.map(c => [c.lat, c.lng]);
  roundtrip.routeLayer = L.polyline(latlngs, {
    color:     '#FF6200',
    weight:    5,
    opacity:   0.88,
    lineJoin:  'round',
    lineCap:   'round'
  }).addTo(map);
  if (typeof animateRouteDraw === 'function') animateRouteDraw(roundtrip.routeLayer);
  if (typeof startRoutePulse  === 'function') startRoutePulse(roundtrip.routeLayer);
  if (typeof addDirectionArrows === 'function') addDirectionArrows(coords);

  // Start-Marker
  roundtrip.marker = L.marker([coords[0].lat, coords[0].lng], {
    icon: L.divIcon({
      className: '',
      html: `<div style="
        width:22px;height:22px;border-radius:50%;
        background:#00FF87;border:3px solid #fff;
        box-shadow:0 2px 8px rgba(0,0,0,0.5)"></div>`,
      iconSize: [22, 22], iconAnchor: [11, 11]
    })
  }).addTo(map).bindPopup('Start / Ziel');

  map.fitBounds(roundtrip.routeLayer.getBounds(), { padding: [40, 40] });
}

// ── Info-Bar nach Berechnung ──────────────────────────────
function renderRtInfoBar(distKm, durMin) {
  const bar = document.getElementById('rt-info-bar');
  if (!bar) return;

  const h   = Math.floor(durMin / 60);
  const m   = durMin % 60;
  const dir = DIRECTIONS.find(d => d.deg === roundtrip.direction);
  const crv = CURVE_PROFILES[roundtrip.curveLevel];

  bar.style.display = '';
  bar.innerHTML = `
    <div class="route-info-bar">
      <div class="route-stat">
        <span class="route-stat-val mono">${distKm.toFixed(0)} km</span>
        <span class="route-stat-lbl">DISTANZ</span>
      </div>
      <div class="route-stat">
        <span class="route-stat-val mono">${h}h ${m}min</span>
        <span class="route-stat-lbl">FAHRZEIT</span>
      </div>
      <div class="route-stat">
        <span class="route-stat-val">${dir?.label || 'N'}</span>
        <span class="route-stat-lbl">Richtung</span>
      </div>
      <div class="route-stat">
        <span class="route-stat-val">${crv.label}</span>
        <span class="route-stat-lbl">Kurven</span>
      </div>
    </div>`;
}

// ── Route umdrehen ────────────────────────────────────────
function reverseRoute() {
  if (!lastRouteCoords.length) return;
  lastRouteCoords = [...lastRouteCoords].reverse();

  if (roundtrip.routeLayer) map.removeLayer(roundtrip.routeLayer);
  if (window.routeLayer)    map.removeLayer(window.routeLayer);

  drawRoundtripRoute(lastRouteCoords);
  buildElevationProfile(lastRouteCoords);
  buildWeatherTimeline(lastRouteCoords, lastRouteDistKm);
  showToast('Route umgedreht');
}

// ── Rundtour-Route zurücksetzen ───────────────────────────
function clearRoundtripRoute() {
  if (roundtrip.routeLayer) {
    map.removeLayer(roundtrip.routeLayer);
    roundtrip.routeLayer = null;
  }
  if (roundtrip.marker) {
    map.removeLayer(roundtrip.marker);
    roundtrip.marker = null;
  }
  lastRouteCoords = [];
  lastRouteDistKm = 0;
  lastRouteDurMin = 0;
  const bar = document.getElementById('rt-info-bar');
  if (bar) bar.style.display = 'none';
  const revBtn = document.getElementById('btn-rt-reverse');
  if (revBtn) revBtn.style.display = 'none';
}

// openRoundtripPlanner wurde in navigation.js konsolidiert