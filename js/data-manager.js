'use strict';
/**
 * ── TourCast data-manager.js ──
 * Konsolidiertes Modul für Storage, GPX, Sharing und Cloud-Export.
 */

const STORAGE_KEY_ROUTES    = 'tourcast_routes_v2';
const STORAGE_KEY_PROFILE   = 'tourcast_profile_v2';
const STORAGE_KEY_SESSION   = 'tourcast_session_v2';
const STORAGE_KEY_FAVORITES = 'tourcast_favorites_v1';
const MAX_SAVED_ROUTES      = 50;

// ── 1. Local Storage & Archiv ──

function loadAllRoutes() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_ROUTES) || '[]'); }
  catch { return []; }
}

function saveRoute(name) {
  const routes = loadAllRoutes();
  const obj = {
    id: `route_${Date.now()}`,
    name: name || `Tour ${new Date().toLocaleDateString('de')}`,
    savedAt: new Date().toISOString(),
    from: document.getElementById('input-from')?.value || '',
    to: document.getElementById('input-to')?.value || '',
    waypoints: waypoints.map(wp => ({ ...wp })),
    coords: lastRouteCoords.map(c => ({ lat: c.lat, lng: c.lng })),
    distKm: lastRouteDistKm,
    durationMin: lastRouteDurMin,
    profile: { ...profile },
    gngStatus: lastGngStatus || null
  };

  // Verbesserter Duplikat-Check (ignoriert leere Rundtour-Felder)
  const dup = routes.find(r => r.from === obj.from && r.to === obj.to && obj.from !== '' && Math.abs(new Date(r.savedAt) - new Date(obj.savedAt)) < 60000);
  if (dup) { showToast('Route bereits gespeichert'); return null; }

  routes.unshift(obj);
  if (routes.length > MAX_SAVED_ROUTES) routes.splice(MAX_SAVED_ROUTES);

  try {
    localStorage.setItem(STORAGE_KEY_ROUTES, JSON.stringify(routes));
    showToast(`✅ „${obj.name}" gespeichert`, 'success');
    renderSavedRoutesList();
    return obj.id;
  } catch(e) {
    showToast('⚠️ Speicher voll');
    return null;
  }
}

async function loadRouteById(id) {
  const routes = loadAllRoutes();
  const route = routes.find(r => r.id === id);
  if (!route) return;

  const fromEl = document.getElementById('input-from');
  const toEl = document.getElementById('input-to');
  
  // Wichtig: Koordinaten-Zustand für calculateRoute wiederherstellen
  if (fromEl) { 
    fromEl.value = route.from;
    if (route.coords?.length) fromEl._selectedLatLng = route.coords[0];
  }
  if (toEl) {
    toEl.value = route.to;
    if (route.coords?.length) toEl._selectedLatLng = route.coords[route.coords.length - 1];
  }

  waypoints = route.waypoints || [];
  if (typeof renderWaypointList === 'function') renderWaypointList();
  
  if (route.profile) {
    Object.assign(profile, route.profile);
    if (typeof applyProfileToUI === 'function') applyProfileToUI();
  }

  await calculateRoute();
  switchTab('route');
  showToast(`📍 „${route.name}" geladen`, 'success');
}

function deleteRoute(id) {
  let routes = loadAllRoutes();
  routes = routes.filter(r => r.id !== id);
  localStorage.setItem(STORAGE_KEY_ROUTES, JSON.stringify(routes));
  renderSavedRoutesList();
  showToast('🗑️ Route gelöscht');
}

/** Rendert die Liste der gespeicherten Routen im Archiv-Tab */
function renderSavedRoutesList() {
  const container = document.getElementById('saved-routes-list');
  if (!container) return;

  const routes = loadAllRoutes();
  if (!routes.length) {
    container.innerHTML = `
      <div class="saved-routes-empty">
        <p>Noch keine gespeicherten Routen.<br>
           Berechne eine Route und tippe auf <strong>Speichern</strong>.</p>
      </div>`;
    return;
  }

  container.innerHTML = routes.map(r => {
    const date = new Date(r.savedAt).toLocaleDateString('de');
    const km   = r.distKm ? `${r.distKm.toFixed(0)} km` : '– km';
    const mode = r.profile?.preset ? r.profile.preset.toUpperCase() : 'TOUR';

    return `
      <div class="saved-route-card">
        <div class="saved-route-head">
          <div class="saved-route-info" onclick="loadRouteById('${r.id}')">
            <span class="saved-route-name">${escapeHtml(r.name)}</span>
            <div class="saved-route-meta">
              <span class="route-tag">${mode}</span>
              <span>${date}</span> • <span>${km}</span>
            </div>
          </div>
          <button class="saved-route-del" onclick="deleteRoute('${r.id}')" title="Löschen">✕</button>
        </div>
        <div class="saved-route-actions">
          <button class="src-btn" onclick="loadRouteById('${r.id}')">📂 Laden</button>
          <button class="src-btn" onclick="exportSavedRouteGPX('${r.id}')">📤 GPX</button>
          <button class="src-btn" onclick="openSavedRouteInGoogleMaps('${r.id}')">🗺️ Maps</button>
        </div>
      </div>`;
  }).join('');
}

/** Spezial-Export für Archiv-Einträge ohne die globale lastRouteCoords zu nutzen */
async function exportSavedRouteGPX(id) {
  const routes = loadAllRoutes();
  const route = routes.find(r => r.id === id);
  if (!route) return;

  // Temporär das UI-Checked-Element simulieren oder Default nutzen
  const gpxContent = buildGPXContent(route.coords, route.name);
  const filename = `${sanitizeFilename(route.name)}.gpx`;

  if (window.electronAPI) {
    await window.electronAPI.saveGPX(gpxContent, filename);
  } else {
    downloadText(gpxContent, filename, 'application/gpx+xml');
  }
  showToast(`📤 Export gestartet: ${route.name}`, 'success');
}

// ── 2. GPX Engine (Import & Export) ──

function buildGPXContent(customCoords = null, customName = null) {
  const coords = customCoords || lastRouteCoords;
  const name = customName || buildGPXName();
  const asTrack = document.getElementById('gpx-export-as-track')?.checked !== false;

  let gpxBody = '';
  if (asTrack) {
    const trkpts = coords.map(c => `    <trkpt lat="${c.lat.toFixed(6)}" lon="${c.lng.toFixed(6)}"/>`).join('\n');
    gpxBody = `  <trk>\n    <name>${escapeHtml(name)}</name>\n    <trkseg>\n${trkpts}\n    </trkseg>\n  </trk>`;
  } else {
    const start = coords[0];
    const end = coords[coords.length - 1];
    let rtepts = `    <rtept lat="${start.lat.toFixed(6)}" lon="${start.lng.toFixed(6)}"><name>Start</name></rtept>\n`;
    rtepts += waypoints.map(wp => `    <rtept lat="${wp.latlng.lat.toFixed(6)}" lon="${wp.latlng.lng.toFixed(6)}"><name>${escapeHtml(wp.name)}</name></rtept>`).join('\n');
    rtepts += `\n    <rtept lat="${end.lat.toFixed(6)}" lon="${end.lng.toFixed(6)}"><name>Ziel</name></rtept>`;
    gpxBody = `  <rte>\n    <name>${escapeHtml(name)}</name>\n${rtepts}\n  </rte>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TourCast ${APP.VERSION}" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeHtml(name)}</name><time>${new Date().toISOString()}</time></metadata>
${gpxBody}
</gpx>`;
}

/**
 * Optimierter Export für Desktop-Anwendungen.
 * Nutzt das File System Access API für echte "Speichern unter"-Dialoge.
 */
async function exportLocal() {
  if (!lastRouteCoords.length) return showToast('⚠️ Keine Route');
  const name = buildGPXName();
  const gpxData = buildGPXContent();

  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${sanitizeFilename(name)}.gpx`,
        types: [{ description: 'GPX File', accept: { 'application/gpx+xml': ['.gpx'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(gpxData);
      await writable.close();
      showToast('💾 GPX direkt gespeichert', 'success');
    } catch (e) { console.warn('Export abgebrochen oder Fehler'); }
  } else {
    downloadText(gpxData, `${sanitizeFilename(name)}.gpx`, 'application/gpx+xml');
    showToast('💾 GPX heruntergeladen', 'success');
  }
}
function exportGPX() { exportLocal(); } // Alias für Konsistenz

function exportGeoJSON() {
  if (!lastRouteCoords.length) return;
  const name = buildGPXName();
  const geojson = {
    type: "Feature",
    properties: { name: name, creator: "TourCast" },
    geometry: { type: "LineString", coordinates: lastRouteCoords.map(c => [parseFloat(c.lng.toFixed(6)), parseFloat(c.lat.toFixed(6))]) }
  };
  downloadText(JSON.stringify(geojson, null, 2), `${sanitizeFilename(name)}.geojson`, 'application/geo+json');
}

function importGPX() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gpx';
  input.onchange = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => parseGPXFile(ev.target.result, file.name);
    reader.readAsText(file);
  };
  input.click();
}

async function parseGPXFile(xmlText, filename) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    const pts = Array.from(doc.querySelectorAll('trkpt, rtept, wpt')).map(pt => ({
      lat: parseFloat(pt.getAttribute('lat')),
      lng: parseFloat(pt.getAttribute('lon'))
    })).filter(p => !isNaN(p.lat));

    if (pts.length < 2) throw new Error('Zu wenige Punkte');
    
    lastRouteCoords = pts;
    lastRouteDistKm = (typeof haversineKm === 'function') ? calcRouteDistKm(pts) : 0;
    
    if (typeof drawImportedRoute === 'function') drawImportedRoute(pts, filename);
    if (typeof renderRouteInfoBar === 'function') renderRouteInfoBar(lastRouteDistKm, 0);
    if (typeof buildWeatherTimeline === 'function') buildWeatherTimeline(pts, lastRouteDistKm);
    if (typeof buildColoredRouteLayer === 'function') buildColoredRouteLayer(pts);
    
    showToast(`📥 ${filename} geladen`, 'success');
  } catch (e) { showToast('⚠️ GPX Fehler: ' + e.message); }
}

// ── 3. Sharing (Link & Google Maps) ──

function shareRouteAsLink() {
  if (!lastRouteCoords.length) return showToast('⚠️ Keine Route');
  const payload = {
    v: 2, name: buildGPXName(), dist: Math.round(lastRouteDistKm),
    coords: lastRouteCoords.filter((_, i) => i % 3 === 0 || i === lastRouteCoords.length - 1)
      .map(c => [parseFloat(c.lat.toFixed(4)), parseFloat(c.lng.toFixed(4))])
  };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const url = `${location.origin}${location.pathname}#route=${b64}`;
  
  navigator.clipboard.writeText(url).then(() => {
    showToast('🔗 Link kopiert!', 'success');
    if (typeof renderShareModal === 'function') renderShareModal(url);
  });
}

async function loadRouteFromHash() {
  const hash = location.hash;
  if (!hash.startsWith('#route=')) return;
  try {
    const payload = JSON.parse(decodeURIComponent(escape(atob(hash.slice(7)))));
    const coords = payload.coords.map(([lat, lng]) => ({ lat, lng }));
    lastRouteCoords = coords;
    lastRouteDistKm = payload.dist || calcRouteDistKm(coords);
    drawImportedRoute(coords, payload.name || 'Geteilte Route');
    renderRouteInfoBar(lastRouteDistKm, 0);
    if (typeof buildWeatherTimeline === 'function') buildWeatherTimeline(coords, lastRouteDistKm);
    if (typeof buildColoredRouteLayer === 'function') buildColoredRouteLayer(coords);
    history.replaceState(null, '', location.pathname);
    showToast('📍 Route geladen');
  } catch (e) { showToast('⚠️ Link ungültig'); }
}

function checkTankWarning(distKm) {
  const range = profile.tankRange;
  const warn = document.getElementById('route-tank-warn');
  if (!warn) return;
  if (distKm > range) {
    warn.textContent = `⛽ TANKWARNUNG: Strecke (${distKm.toFixed(0)}km) > Reichweite (${range}km)`;
    warn.style.display = 'block';
  } else {
    warn.style.display = 'none';
  }
}

function openInGoogleMaps() {
  if (!lastRouteCoords.length) return;
  const start = lastRouteCoords[0];
  const end = lastRouteCoords[lastRouteCoords.length - 1];
  // Fix: Eigenschaftsname von wp.latlng auf wp.lat/lng korrigiert
  const wps   = waypoints.slice(0, 8).map(wp => `${wp.lat},${wp.lng}`).join('|');
  const url = `https://www.google.com/maps/dir/?api=1&origin=${start.lat},${start.lng}&destination=${end.lat},${end.lng}${wps ? '&waypoints='+wps : ''}&travelmode=driving`;
  window.open(url, '_blank');
}

// ── 4. Cloud Export (Stubs & Fallbacks) ──

function exportToOneDrive() {
  if (!APP.oneDriveClientId) {
    showToast('ℹ️ Lokaler Download (OneDrive Key fehlt)');
    return exportLocal();
  }
  if (typeof OneDrive !== 'undefined') {
    OneDrive.save({
      clientId: APP.oneDriveClientId, action: 'save', sourceInputElementId: '__od_dummy__',
      success: () => showToast('✅ OneDrive gespeichert', 'success'),
      error: (e) => showToast('⚠️ OneDrive Fehler')
    });
  }
}

function exportToGoogleDrive() {
  if (!APP.googleClientId) {
    showToast('ℹ️ Lokaler Download (Google Key fehlt)');
    return exportLocal();
  }
  showToast('Google Drive Integration wird gestartet...');
}

// ── 5. Favoriten & Session ──

function loadFavorites() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_FAVORITES) || '[]'); }
  catch { return []; }
}

function toggleFavorite(name, lat, lng) {
  let favs = loadFavorites();
  const idx = favs.findIndex(f => f.lat == lat && f.lng == lng);
  if (idx > -1) {
    favs.splice(idx, 1);
    showToast('⭐ Favorit entfernt');
  } else {
    favs.unshift({ name, lat, lng, id: Date.now() });
    if (favs.length > 15) favs.pop();
    showToast('⭐ Favorit gespeichert', 'success');
  }
  localStorage.setItem(STORAGE_KEY_FAVORITES, JSON.stringify(favs));
  return idx === -1;
}

function saveActiveSession() {
  const session = {
    from: document.getElementById('input-from')?.value || '',
    to: document.getElementById('input-to')?.value || '',
    waypoints: waypoints.map(wp => ({ ...wp })),
    activeTab: typeof activeTab !== 'undefined' ? activeTab : 'route'
  };
  localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
}

function loadActiveSession() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_SESSION)); }
  catch { return null; }
}

function saveProfile() {
  localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(profile));
}

function loadProfile() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY_PROFILE));
    if (stored) Object.assign(profile, stored);
  } catch(e) {}
}

// ── 6. Hilfsfunktionen ──

function buildGPXName() {
  const from = document.getElementById('input-from')?.value?.split(',')[0]?.trim();
  const to = document.getElementById('input-to')?.value?.split(',')[0]?.trim();
  return (from && to) ? `${from}_to_${to}` : `Tour_${new Date().toISOString().slice(0,10)}`;
}

function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_').slice(0, 80);
}

function downloadText(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function calcRouteDistKm(coords) {
  let dist = 0;
  for (let i = 1; i < coords.length; i++) {
    dist += haversineKm(coords[i-1].lat, coords[i-1].lng, coords[i].lat, coords[i].lng);
  }
  return dist;
}

/**
 * Öffnet eine gespeicherte Route direkt in Google Maps.
 */
function openSavedRouteInGoogleMaps(id) {
  const routes = loadAllRoutes();
  const route  = routes.find(r => r.id === id);
  if (!route || !route.coords?.length) return;
  const start = route.coords[0];
  const end   = route.coords[route.coords.length - 1];
  let wpStr = '';
  if (route.waypoints && route.waypoints.length) {
    wpStr = '&waypoints=' + route.waypoints.slice(0, 8).map(wp => `${wp.latlng.lat},${wp.latlng.lng}`).join('|');
  }
  window.open(`https://www.google.com/maps/dir/?api=1&origin=${start.lat},${start.lng}&destination=${end.lat},${end.lng}${wpStr}&travelmode=driving`, '_blank');
}