'use strict';
// ── TourCast poi.js – POIs, Tankwarnung, Via-Punkt hinzufügen ──
// Must-Have:
//   ✅ Tankstellen, Parkplätze, Gaststätten, Cafés
//   ✅ Nur entlang der Route (5 km Puffer)
//   ✅ Als Via-Punkt hinzufügbar

// ── State ─────────────────────────────────────────────────
let poiMarkers    = [];       // [{ type, marker, lat, lon, name }]
let activePOITypes = new Set();
let poiControllers = {};      // { type: AbortController }

// ── POI-Typen ─────────────────────────────────────────────
const POI_TYPES = {
  fuel: {
    label: 'TANKSTELLEN',
    query: 'node["amenity"="fuel"]',
    color: 'var(--accent)',      zIndex: 600,
    icon:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 22L15 22"/><path d="M4 9L14 9"/><path d="M14 22V4C14 2.89543 13.1046 2 12 2H6C4.89543 2 4 2.89543 4 4V22"/><path d="M18 5V11"/><path d="M21 10.3201C21 12.4001 20.1 13.6001 18 13.6001"/></svg>`
  },
  parking: {
    label: 'PARKPLÄTZE',
    query: 'node["amenity"="parking"]',
    color: 'var(--grip-wet)',    zIndex: 590,
    icon:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17V7H14C15.6569 7 17 8.34315 17 10C17 11.6569 15.6569 13 14 13H9"/></svg>`
  },
  viewpoint: {
    label: 'AUSSICHT',
    query: 'node["tourism"="viewpoint"]',
    color: 'var(--go)',          zIndex: 580,
    icon:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>`
  },
  restaurant: {
    label: 'RESTAURANTS',
    query: 'node["amenity"="restaurant"]',
    color: 'var(--caution)',     zIndex: 570,
    icon:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Z"/></svg>`
  },
  cafe: {
    label: 'CAFÉS',
    query: 'node["amenity"="cafe"]',
    color: 'var(--caution)',     zIndex: 560,
    icon:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8Z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>`
  },
  charging_station: {
    label: 'LADESTATIONEN',
    query: 'node["amenity"="charging_station"]',
    color: 'var(--grip-warn)',   zIndex: 550,
    icon:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 18H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.19M15 6h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3.19"/><path d="M23 13V11"/><polyline points="11 6 7 12 13 12 9 18"/></svg>`
  }
};

// ── POI-Buttons rendern ───────────────────────────────────
function renderPOIBar() {
  const bar = document.getElementById('poi-bar');
  if (!bar) return;
  bar.innerHTML = Object.entries(POI_TYPES).map(([type, cfg]) =>
    '<button id="poi-btn-' + type + '" class="poi-btn"'
    + ' onclick="safeTogglePOI(\'' + type + '\')">'
    + cfg.icon
    + '<span>' + cfg.label + '</span>'
    + '</button>'
  ).join('');
}

async function togglePOI(type) {
  const btn = document.getElementById('poi-btn-' + type);
  if (!btn) return;

  // Low-Data-Mode Check: Nur Tankstellen erlaubt
  if (profile.lowDataMode && type !== 'fuel') {
    showToast('ℹ️ Low-Data-Mode: Nur Tankstellen verfügbar');
    return;
  }

  // Wenn bereits aktiv oder Suche läuft -> Ausschalten/Abbrechen
  if (activePOITypes.has(type)) {
    if (poiControllers[type]) {
      poiControllers[type].abort();
      delete poiControllers[type];
    }
    activePOITypes.delete(type);
    btn.classList.remove('active', 'loading');
    removePOIMarkers(type);
    return;
  }

  // Suche starten
  activePOITypes.add(type);
  btn.classList.add('active');
  poiControllers[type] = new AbortController();

  try {
    poiLog(`🔄 togglePOI(${type}): lastRouteCoords.length=${lastRouteCoords?.length ?? 'undef'}, distKm=${lastRouteDistKm}, lat=${currentLat}, lng=${currentLng}`);
    if (lastRouteCoords?.length) {
      await loadPOIsAlongRoute(type, poiControllers[type].signal);
    } else {
      poiLog(`  ↪ kein Route-State → Radius-Suche (${Math.min((profile.radius||30)*1000,20000)/1000} km)`);
      await loadPOIs(currentLat, currentLng, type, poiControllers[type].signal);
    }
  } finally {
    btn.classList.remove('loading');
    delete poiControllers[type];
  }
}

// ── POIs im Standort-Radius laden ────────────────────────
async function loadPOIs(lat, lng, type = null, signal = null) {
  const types  = type ? [type] : [...activePOITypes];
  if (!types.length) return;
  const radius = Math.min((profile.radius || 30) * 1000, 20000);

  for (const t of types) {
    const cfg = POI_TYPES[t];
    if (!cfg) continue;

    const query = '[out:json][timeout:15];\n'
      + '(' + cfg.query + '(around:' + radius + ',' + lat + ',' + lng + '););\n'
      + 'out body 30;';

    const btn = document.getElementById('poi-btn-' + t);
    if (btn) btn.classList.add('loading');

    try {
      const resp = await fetch(APP.overpass, {
        method:  'POST',
        body:    'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal:  signal
      });

      if (!resp.ok) throw new Error(await translateOverpassError(resp.status));

      const data = await resp.json();
      removePOIMarkers(t);
      addPOIMarkers(data.elements || [], t, cfg, null);
    } catch (e) {
      if (e.name !== 'AbortError') showToast(`⚠️ ${cfg.label}: ${e.message}`);
    } finally {
      if (btn) btn.classList.remove('loading');
    }
  }
}

// ── POI-Diagnose Log ─────────────────────────────────────
window.poiLastDiag = null;
function poiLog(...args) { console.log('[POI]', ...args); }

// ── POIs entlang Route laden (5 km Puffer) – Batch-Strategie ────────────────
async function loadPOIsAlongRoute(type = null, signal = null) {
  if (!lastRouteCoords?.length) {
    poiLog('❌ loadPOIsAlongRoute: lastRouteCoords leer, abgebrochen');
    return;
  }
  const types = type ? [type] : [...activePOITypes];
  if (!types.length) return;

  for (const t of types) {
    const cfg = POI_TYPES[t];
    if (!cfg) continue;

    // Abtastpunkte: alle 20 km entlang der Route, max. 12 Punkte (= max. 3 Batches)
    const samplingDist = 20;
    const distKm = lastRouteDistKm || 1;
    const step = Math.max(1, Math.floor((lastRouteCoords.length / distKm) * samplingDist));
    const sampledPoints = [];
    for (let i = 0; i < lastRouteCoords.length; i += step) {
      sampledPoints.push(lastRouteCoords[i]);
    }
    sampledPoints.push(lastRouteCoords[lastRouteCoords.length - 1]);
    // Auf 12 Punkte deckeln (absolutes Sicherheitsnetz)
    const points = sampledPoints.slice(0, 12);

    poiLog(`🔍 ${t}: Route ${distKm.toFixed(1)} km, ${lastRouteCoords.length} Pts, Step ${step}, ${points.length} Abtastpunkte, ${Math.ceil(points.length/4)} Batches`);

    // In Batches à 4 Punkte aufteilen → max. 4 around-Subqueries pro Anfrage
    const BATCH_SIZE = 4;
    const batches = [];
    for (let b = 0; b < points.length; b += BATCH_SIZE) {
      batches.push(points.slice(b, b + BATCH_SIZE));
    }

    const btn = document.getElementById('poi-btn-' + t);
    if (btn) btn.classList.add('loading');

    const seenIds    = new Set();
    const allElements = [];

    try {
      for (const batch of batches) {
        if (signal?.aborted) break;

        const aroundQ = batch
          .map(p => `${cfg.query}(around:5000,${p.lat.toFixed(5)},${p.lng.toFixed(5)})`)
          .join(';');
        const query = `[out:json][timeout:15];(${aroundQ};);out body 60;`;

        // Eigenes Timeout je Batch: 15 s – unabhängig vom übergeordneten AbortSignal
        const batchTimeout = AbortSignal.timeout(15000);
        const batchSignal  = signal
          ? AbortSignal.any([signal, batchTimeout])
          : batchTimeout;

        try {
          const resp = await fetch(APP.overpass, {
            method:  'POST',
            body:    'data=' + encodeURIComponent(query),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            signal:  batchSignal
          });

          // 504/429 wie ein Client-Timeout behandeln: Batch stumm überspringen
          if (resp.status === 504 || resp.status === 429) {
            console.warn(`POI-Batch HTTP ${resp.status} übersprungen (${t})`);
            // Bei Rate-Limiting: 2s warten bevor nächster Batch
            if (resp.status === 429) await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          if (!resp.ok) throw new Error(await translateOverpassError(resp.status));

          const data = await resp.json();
          const batchRaw = data.elements?.length || 0;
          let batchPassed = 0;
          for (const el of (data.elements || [])) {
            // FIX: Gegen die tatsächlichen Abfrage-Punkte prüfen (nicht Step-Optimierung)
            // Ein POI, der von around:5000 eines Abtastpunkts zurückgegeben wurde, ist
            // garantiert innerhalb 5 km dieses Abtastpunkts. Wir prüfen gegen sampledPoints.
            if (!seenIds.has(el.id) && el.lat && el.lon && isWithinPointsPuffer(el.lat, el.lon, points, 5)) {
              seenIds.add(el.id);
              allElements.push(el);
              batchPassed++;
            }
          }
          poiLog(`  Batch: ${batchRaw} Overpass-Ergebnisse → ${batchPassed} bestanden Filter`);
          // Kurze Pause zwischen Batches um Overpass-Rate-Limiting zu reduzieren
          await new Promise(r => setTimeout(r, 400));
        } catch (batchErr) {
          if (batchErr.name === 'AbortError' && signal?.aborted) throw batchErr; // User-Abbruch weiterleiten
          if (batchErr.name === 'TimeoutError' || batchErr.name === 'AbortError') {
            // Einzelner Batch-Timeout → überspringen, weiter mit nächstem Batch
            console.warn(`POI-Batch Timeout übersprungen (${t})`);
            continue;
          }
          throw batchErr;
        }
      }

      removePOIMarkers(t);
      poiLog(`✅ ${t}: ${allElements.length} POIs nach Filter, werden jetzt auf Karte gesetzt (map=${!!map})`);
      if (allElements.length === 0) {
        showToast(`ℹ️ ${cfg.label}: Keine POIs entlang der Route gefunden`);
      }
      addPOIMarkers(allElements, t, cfg, lastRouteCoords);
    } catch (e) {
      if (e.name !== 'AbortError') showToast(`⚠️ ${cfg.label}: ${e.message}`);
    } finally {
      if (btn) btn.classList.remove('loading');
    }
  }
}

// ── 5 km Puffer-Check gegen exakte Punktliste ─────────────
// Prüft ob (lat,lon) innerhalb pufferKm irgendeines Punktes aus 'points' liegt.
// Verwendet für die Batch-Filterung gegen Abtastpunkte (garantiert korrekt).
function isWithinPointsPuffer(lat, lon, points, pufferKm) {
  for (const c of points) {
    if (haversineKm(lat, lon, c.lat, c.lng) <= pufferKm) return true;
  }
  return false;
}

// ── 5 km Puffer-Check gegen Route (Step-optimiert) ────────
// Für allgemeine Nutzung. Achtung: Step-Optimierung kann Randpunkte verpassen.
function isWithinRoutePuffer(lat, lon, pufferKm) {
  const step = Math.max(1, Math.floor(lastRouteCoords.length / 80));
  for (let i = 0; i < lastRouteCoords.length; i += step) {
    const c = lastRouteCoords[i];
    if (haversineKm(lat, lon, c.lat, c.lng) <= pufferKm) return true;
  }
  return false;
}

// ── Route Bounding-Box ────────────────────────────────────
function routeBbox(coords) {
  const PAD = 0.05; // ~5 km
  const lats = coords.map(c => c.lat);
  const lngs = coords.map(c => c.lng);
  return {
    s: Math.min(...lats) - PAD,
    n: Math.max(...lats) + PAD,
    w: Math.min(...lngs) - PAD,
    e: Math.max(...lngs) + PAD
  };
}

// ── Hilfsfunktion: Kürzeste Distanz zur Route ──────────────
function calcMinDistToRoute(lat, lon, coords) {
  if (!coords || coords.length === 0) return null;
  let minD = Infinity;
  const step = Math.max(1, Math.floor(coords.length / 100));
  for (let i = 0; i < coords.length; i += step) {
    const d = haversineKm(lat, lon, coords[i].lat, coords[i].lng);
    if (d < minD) minD = d;
  }
  return minD;
}

// ── Hilfsfunktion: POI-Icon generieren ────────────────────
function getPoiIcon(cfg) {
  const baseSize = 24;
  return L.divIcon({
    className: '',
    html: `<div class="poi-marker-icon" style="background:${cfg.color}; border-radius:50%; width:${baseSize}px; height:${baseSize}px; display:flex; align-items:center; justify-content:center; border:2px solid rgba(255,255,255,0.9); box-shadow:0 2px 6px rgba(0,0,0,0.5); cursor:pointer">`
        + (cfg.icon || '')
        + `</div>`,
    iconSize:   [baseSize, baseSize],
    iconAnchor: [baseSize/2, baseSize/2]
  });
}

// ── Marker hinzufügen ─────────────────────────────────────
function addPOIMarkers(elements, type, cfg, routeCoords) {
  if (!map) {
    poiLog('❌ addPOIMarkers: map ist null – kein Marker gesetzt!');
    return;
  }
  poiLog(`📍 addPOIMarkers: ${elements.length} Elemente für ${type}`);
  elements.slice(0, 60).forEach(el => {
    if (!el.lat || !el.lon) return;

    const name   = el.tags?.name || el.tags?.brand || cfg.label;
    const addr   = buildAddress(el.tags);
    const extra  = buildExtraInfo(type, el.tags);

    const distToRoute = calcMinDistToRoute(el.lat, el.lon, routeCoords || lastRouteCoords);

    const icon = getPoiIcon(cfg);

    const marker = L.marker([el.lat, el.lon], {
      icon,
      zIndexOffset: cfg.zIndex
    }).addTo(map);

    // Popup mit Via-Punkt-Button
    const popupId = 'poi-popup-' + type + '-' + el.id;
    const popup   = L.popup({ maxWidth: 300, className: 'poi-popup' })
      .setContent(buildPoiPopupHtml(popupId, type, cfg, name, addr, extra, el.lat, el.lon, distToRoute, el));

    marker.bindPopup(popup);

    poiMarkers.push({ type, marker, lat: el.lat, lon: el.lon, name });
  });
}

// ── POI-Größen bei Zoom aktualisieren (CSS-Transform, kein setIcon) ─────────────────────
function updatePOIMarkerSizes() {
  if (!map || !poiMarkers.length) return;
  const zoom  = map.getZoom();
  const scale = Math.max(0.55, Math.min(1.55, 0.55 + (zoom - 8) * 0.1));
  poiMarkers.forEach(p => {
    const el = p.marker.getElement()?.querySelector('.poi-marker-icon');
    if (el) {
      // FIX #17: animation-fill-mode:both blockiert style.transform (Animations > Inline-Styles).
      // Animation zurücksetzen damit der Transform-Wert greifen kann.
      el.style.animation = 'none';
      el.style.transform = `scale(${scale})`;
    }
  });
}

// ── Zentrale POI-Normalisierung ───────────────────────────
/**
 * Überführt ein rohes OSM-Element in ein einheitliches Anzeigemodell.
 * Alle display-seitigen Funktionen arbeiten nur noch mit diesem Objekt.
 */
function normalizePoiForDisplay(type, el, cfg) {
  const t = el.tags || {};
  const name = t.name || t.brand || t['name:de'] || cfg.label;

  function yn(val) {
    return val === 'yes' ? 'yes' : val === 'no' ? 'no' : null;
  }

  const paymentCard =
    (t['payment:credit_cards'] === 'yes' || t['payment:debit_cards'] === 'yes' ||
     t['payment:cards'] === 'yes' || t['payment:visa'] === 'yes' ||
     t['payment:mastercard'] === 'yes') ? 'yes'
    : (t['payment:cash_only'] === 'yes' ? 'no' : null);

  const fuelTypes = [];
  if (t['fuel:diesel'] === 'yes')                               fuelTypes.push('Diesel');
  if (t['fuel:octane_95'] === 'yes' || t['fuel:e5'] === 'yes') fuelTypes.push('Benzin');
  if (t['fuel:octane_98'] === 'yes' || t['fuel:super_e10'] === 'yes') fuelTypes.push('Super');
  if (t['fuel:lpg'] === 'yes')                                  fuelTypes.push('LPG');
  if (t['fuel:adblue'] === 'yes')                               fuelTypes.push('AdBlue');
  if (t['fuel:e10'] === 'yes' && !fuelTypes.includes('Benzin')) fuelTypes.push('E10');

  const services = [];
  if (t.toilets === 'yes' || t['toilets:number'])       services.push('WC');
  if (t.shop && t.shop !== 'no')                        services.push('Shop');
  if (t.atm === 'yes')                                  services.push('Geldautomat');
  if (t.car_wash === 'yes')                             services.push('Waschanlage');
  if (t.compressed_air === 'yes')                       services.push('Druckluft');
  if (t.wifi === 'yes' || t.internet_access === 'wlan') services.push('WLAN');
  if (t.outdoor_seating === 'yes')                      services.push('Außensitzbereich');

  const rawWeb = t.website || t['contact:website'] || t.url || null;
  const websiteDisplay = rawWeb
    ? rawWeb.replace(/^https?:\/\/(www\.)?/, '').split('/')[0].slice(0, 30)
    : null;

  const phone    = t.phone || t['contact:phone'] || null;
  const phoneTel = phone ? phone.replace(/[^0-9+]/g, '') : null;

  return {
    id:                 el.id,
    category:           type,
    categoryLabel:      cfg.label,
    iconSvg:            cfg.icon,
    color:              cfg.color,
    name,
    address:            buildAddress(t),
    latitude:           el.lat,
    longitude:          el.lon,
    phone,
    phoneTel,
    websiteDisplay,
    openingHours:       t.opening_hours || null,
    brand:              t.brand || null,
    paymentCard,
    fuelTypes,
    motorcycleSuitable: type === 'parking_motorcycle' ? 'yes' : yn(t.motorcycle),
    toiletAvailable:    yn(t.toilets) || (t['toilets:number'] ? 'yes' : null),
    fee:                yn(t.fee),
    capacity:           t.capacity || null,
    access:             t.access ? t.access.charAt(0).toUpperCase() + t.access.slice(1) : null,
    elevation:          t.ele ? t.ele + '\u202fm' : null,
    description:        t.description ? t.description.slice(0, 120) : null,
    cuisine:            t.cuisine ? t.cuisine.replace(/;/g, ', ') : null,
    takeaway:           (type === 'restaurant' || type === 'cafe') ? yn(t.takeaway) : null,
    chargingType:       type === 'charging_station'
      ? (t['socket:type2'] ? 'Typ\u202f2' : (t['socket:ccs'] ? 'CCS' : (t['socket:schuko'] ? 'Schuko' : null)))
      : null,
    chargingOperator:   type === 'charging_station' ? (t.operator || null) : null,
    services,
    operator:           (t.operator && type !== 'charging_station') ? t.operator : null,
  };
}

// ── Detail-Rows HTML aus normalisiertem Modell ────────────
/** Liefert den inneren HTML-Inhalt der Detailsektion für das POI-Popup. */
function renderPoiDetailHtml(poi) {
  const parts = [];
  const type  = poi.category;

  function detailRow(label, valueHtml) {
    if (!valueHtml) return;
    parts.push(
      '<div class="poi-detail-row">'
      + '<span class="poi-detail-label">' + label + '</span>'
      + '<span class="poi-detail-value">' + valueHtml + '</span>'
      + '</div>'
    );
  }

  function statusBadge(val, yes, no, unk) {
    if (val === 'yes') return '<span class="poi-status poi-status-yes">\u2713\u202f' + yes + '</span>';
    if (val === 'no')  return '<span class="poi-status poi-status-no">\u2717\u202f' + no  + '</span>';
    return unk ? '<span class="poi-status poi-status-unknown">?\u202f' + unk + '</span>' : '';
  }

  function chips(arr) {
    if (!arr || !arr.length) return '';
    return '<div class="poi-chip-group">'
      + arr.map(s => '<span class="poi-chip">' + escapeHtml(s) + '</span>').join('')
      + '</div>';
  }

  function chipsRow(label, arr) {
    if (!arr || !arr.length) return;
    parts.push('<div class="poi-detail-label poi-chips-label">' + label + '</div>' + chips(arr));
  }

  function hoursRow(oh) {
    if (!oh) return;
    parts.push('<div class="poi-detail-label poi-chips-label">ÖFFNUNGSZEITEN</div>'
      + '<div class="poi-hours">' + escapeHtml(oh) + '</div>');
  }

  if (type === 'fuel') {
    if (poi.brand) detailRow('MARKE', escapeHtml(poi.brand));
    detailRow('KARTENZAHLUNG', statusBadge(poi.paymentCard, 'JA', 'NEIN', 'UNBEKANNT'));
    chipsRow('KRAFTSTOFFE', poi.fuelTypes);
    hoursRow(poi.openingHours);
  }

  if (type === 'parking_motorcycle') {
    detailRow('MOTORRAD', statusBadge(poi.motorcycleSuitable, 'GEEIGNET', 'UNGEEIGNET', 'UNBEKANNT'));
    detailRow('WC',       statusBadge(poi.toiletAvailable, 'VORHANDEN', 'FEHLT', 'UNBEKANNT'));
    detailRow('GEBÜHR',   statusBadge(poi.fee, 'KOSTENPFLICHTIG', 'KOSTENLOS', 'UNBEKANNT'));
    if (poi.capacity) detailRow('STELLPLÄTZE', escapeHtml(poi.capacity));
    if (poi.access)   detailRow('ZUGANG', escapeHtml(poi.access));
    hoursRow(poi.openingHours);
  }

  if (type === 'viewpoint') {
    if (poi.elevation)   detailRow('HÖHE', escapeHtml(poi.elevation));
    if (poi.description) parts.push('<div class="poi-popup-extra-text">' + escapeHtml(poi.description) + '</div>');
    hoursRow(poi.openingHours);
  }

  if (type === 'restaurant' || type === 'cafe') {
    if (poi.cuisine) detailRow('KÜCHE', escapeHtml(poi.cuisine));
    if (poi.takeaway !== null) detailRow('MITNAHME', statusBadge(poi.takeaway, 'JA', 'NEIN'));
    hoursRow(poi.openingHours);
  }

  if (type === 'charging_station') {
    if (poi.chargingType)     detailRow('STECKER',    escapeHtml(poi.chargingType));
    if (poi.chargingOperator) detailRow('BETREIBER',  escapeHtml(poi.chargingOperator));
    if (poi.capacity)         detailRow('LADEPUNKTE', escapeHtml(poi.capacity));
    hoursRow(poi.openingHours);
  }

  chipsRow('SERVICES', poi.services);

  if (poi.phone) {
    parts.push(
      '<div class="poi-detail-row">'
      + '<span class="poi-detail-label">TEL</span>'
      + '<span class="poi-detail-value"><a href="tel:' + poi.phoneTel + '" class="poi-tel-link">'
      + escapeHtml(poi.phone) + '</a></span>'
      + '</div>'
    );
  }
  if (poi.websiteDisplay) detailRow('WEB', escapeHtml(poi.websiteDisplay));

  return parts.join('');
}

// ── Popup HTML ────────────────────────────────────────────
function buildPoiPopupHtml(id, type, cfg, name, addr, extra, lat, lon, dist, el) {
  const distStr = dist !== null
    ? '<div class="poi-route-dist">ENTFERNUNG ZUR ROUTE: <span>' + dist.toFixed(1) + ' km</span></div>'
    : '';

  // Mit normalisiertem Modell (wenn rohes OSM-Element vorhanden)
  if (el) {
    const poi        = normalizePoiForDisplay(type, el, cfg);
    const detailHtml = renderPoiDetailHtml(poi);
    const viaName    = escapeHtml(poi.name).replace(/'/g, '&#39;');
    return '<div class="poi-popup-inner" id="' + id + '">'
      + '<div class="poi-popup-header">'
      +   '<span class="poi-popup-ico">' + cfg.icon + '</span>'
      +   '<span class="poi-popup-name">' + escapeHtml(poi.name) + '</span>'
      + '</div>'
      + distStr
      + (poi.address ? '<div class="poi-popup-addr">' + escapeHtml(poi.address) + '</div>' : '')
      + (detailHtml ? '<div class="poi-detail-section">' + detailHtml + '</div>' : '')
      + '<button class="poi-via-btn" onclick="addPOIAsWaypoint(' + poi.latitude + ',' + poi.longitude + ',\'' + viaName + '\',\'\')">'
      + '➕ Via-Punkt hinzufügen</button>'
      + '</div>';
  }

  // Fallback ohne rohes Element (bisherige Logik bleibt erhalten)
  const plainDesc = (addr + ' ' + extra).replace(/<[^>]*>?/gm, ' ').replace(/'/g, '').trim();
  return '<div class="poi-popup-inner" id="' + id + '">'
    + '<div class="poi-popup-header">'
    +   '<span class="poi-popup-name">' + escapeHtml(name) + '</span>'
    + '</div>'
    + distStr
    + (addr ? '<div class="poi-popup-addr">' + escapeHtml(addr) + '</div>' : '')
    + '<div class="sp-divider" style="margin: 8px 0"></div>'
    + (extra ? '<div class="poi-popup-extra">' + extra + '</div>' : '')
    + '<button class="poi-via-btn"'
    +   ' onclick="addPOIAsWaypoint(' + lat + ',' + lon + ',\'' + escapeHtml(name) + '\',\'' + plainDesc + '\')">'
    +   '➕ Via-Punkt hinzufügen'
    + '</button>'
    + '</div>';
}

// ── POI als Via-Punkt zur Route hinzufügen ────────────────
function addPOIAsWaypoint(lat, lon, name, desc = '') {
  if (typeof addWaypoint !== 'function') {
    showToast('⚠️ Routenplanung nicht aktiv');
    return;
  }

  addWaypoint({ lat, lng: lon }, name, desc);
  map.closePopup();
  showToast(name + ' als Via-Punkt hinzugefügt', 2000);

  if (typeof switchTab === 'function') switchTab('route');

  // Route neu berechnen wenn bereits Start + Ziel gesetzt
  const fromEl = document.getElementById('input-from');
  const toEl   = document.getElementById('input-to');
  if (fromEl?.value && toEl?.value && typeof calculateRoute === 'function') {
    calculateRoute();
  }
}

// ── Tankstellen entlang Route laden (Reichweite) ──────────
async function loadFuelAlongRoute(coords, distKm) {
  if (!coords?.length) return;

  // Tankwarnung aus profile.js
  if (typeof checkTankWarning === 'function') {
    checkTankWarning(distKm);
  }

  // Tankstellen nur laden wenn Strecke > 60 % der Reichweite
  const range = (typeof calcAutoRange === 'function')
    ? calcAutoRange()
    : (profile.tankRange || 300);

  if (distKm <= range * 0.6) return;

  const cfg   = POI_TYPES.fuel;
  const btn   = document.getElementById('poi-btn-fuel');
  
  if (btn) { btn.classList.add('active', 'loading'); btn.textContent = 'SUCHE...'; }
  activePOITypes.add('fuel');

  // Auch hier: Korridor-Sampling für Tankstellen
  const step = Math.max(1, Math.floor((coords.length / distKm) * 15));
  const sampled = [];
  for (let i = 0; i < coords.length; i += step) sampled.push(coords[i]);
  sampled.push(coords[coords.length - 1]);

  const aroundQueries = sampled
    .map(p => `${cfg.query}(around:5000,${p.lat.toFixed(5)},${p.lng.toFixed(5)})`)
    .join(';');

  const query = `[out:json][timeout:20];(${aroundQueries};);out body 80;`;

  try {
    const resp  = await fetch(APP.overpass, {
      method:  'POST',
      body:    'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (!resp.ok) throw new Error(await translateOverpassError(resp.status));

    const data  = await resp.json();
    const elems = data.elements || [];

    removePOIMarkers('fuel');
    addPOIMarkers(elems, 'fuel', cfg, coords);

    if (elems.length) {
      showToast(elems.length + ' Tankstellen entlang der Route', 2500);
    } else {
      showToast('Keine Tankstellen im Korridor gefunden', 2500);
    }
  } catch (e) {
    showToast(`⚠️ Tankstellen: ${e.message}`);
  } finally {
    if (btn) { btn.classList.remove('loading'); btn.textContent = cfg.label; }
  }
}

// ── Marker entfernen ──────────────────────────────────────
function removePOIMarkers(type) {
  const keep = [];
  poiMarkers.forEach(p => {
    if (p.type === type) {
      map.removeLayer(p.marker);
    } else {
      keep.push(p);
    }
  });
  poiMarkers = keep;
}

function clearAllPOIMarkers() {
  poiMarkers.forEach(p => map.removeLayer(p.marker));
  poiMarkers = [];
  activePOITypes.clear();
  document.querySelectorAll('.poi-btn').forEach(b => b.classList.remove('active'));
}

// ── Adresse aus Tags ──────────────────────────────────────
function buildAddress(tags) {
  if (!tags) return '';
  const street = tags['addr:street'] || tags['street'];
  const house  = tags['addr:housenumber'] || tags['housenumber'];
  const post   = tags['addr:postcode'] || tags['postcode'];
  const city   = tags['addr:city'] || tags['city'];

  const parts = [
    street ? (street + (house ? ' ' + house : '')) : null,
    post ? (post + (city ? ' ' + city : '')) : city
  ].filter(Boolean);
  return parts.join(', ');
}

// ── Zusatzinfos je POI-Typ ────────────────────────────────
function buildExtraInfo(type, tags) {
  if (!tags) return '';
  const lines = [];

  // Gemeinsame Daten für fast alle POIs
  const phone = tags.phone || tags['contact:phone'];
  const web   = tags.website || tags['contact:website'] || tags.url;
  const oh    = tags.opening_hours;

  if (type === 'fuel') {
    if (tags.brand) lines.push('<div class="poi-tag">MARKE: <span>' + escapeHtml(tags.brand) + '</span></div>');
    const cards = tags['payment:credit_cards'] === 'yes' || tags['payment:debit_cards'] === 'yes' || tags['payment:cards'] === 'yes';
    lines.push('<div class="poi-tag">KARTENZAHLUNG: <span>' + (cards ? 'JA' : 'UNBEKANNT') + '</span></div>');
    if (oh) lines.push('<div class="poi-tag">OFFEN: <span>' + escapeHtml(oh) + '</span></div>');
    lines.push('<div class="poi-tag">PREISE: <span>NUR VOR ORT</span></div>');
  }

  if (type === 'restaurant' || type === 'cafe') {
    if (tags.cuisine) lines.push('<div class="poi-tag">KÜCHE: <span>' + escapeHtml(tags.cuisine) + '</span></div>');
    if (oh)           lines.push('<div class="poi-tag">OFFEN: <span>' + escapeHtml(oh) + '</span></div>');
    if (tags.takeaway) lines.push('<div class="poi-tag">MITNAHME: <span>' + (tags.takeaway === 'yes' ? 'JA' : 'NEIN') + '</span></div>');
  }

  if (type === 'parking_motorcycle') {
    if (tags.fee)      lines.push('<div class="poi-tag">GEBÜHR: <span>' + (tags.fee === 'yes' ? 'JA' : 'NEIN') + '</span></div>');
    if (tags.capacity) lines.push('<div class="poi-tag">PLÄTZE: <span>' + tags.capacity + '</span></div>');
    if (tags.access)   lines.push('<div class="poi-tag">ZUGANG: <span>' + escapeHtml(tags.access.toUpperCase()) + '</span></div>');
  }

  if (type === 'charging_station') {
    if (tags['socket:type2']) lines.push('<div class="poi-tag">TYP2: <span>' + tags['socket:type2'] + '</span></div>');
    if (tags['capacity'])     lines.push('<div class="poi-tag">PLÄTZE: <span>' + tags['capacity'] + '</span></div>');
    if (tags.operator)        lines.push('<div class="poi-tag">BETREIBER: <span>' + escapeHtml(tags.operator) + '</span></div>');
  }

  if (type === 'viewpoint') {
    if (tags.ele)         lines.push('<div class="poi-tag">HÖHE: <span>' + tags.ele + ' m</span></div>');
    if (tags.description) lines.push('<div class="poi-popup-extra-text">' + escapeHtml(tags.description.slice(0, 80)) + '</div>');
  }

  // Übergreifende Zusatzinfos (Telefon & Web)
  if (phone) {
    // Bereinigung für tel: URI (nur Ziffern und + behalten)
    const telUri = phone.replace(/[^0-9+]/g, '');
    lines.push('<div class="poi-tag">TEL: <span><a href="tel:' + telUri + '" '
      + 'style="color:inherit;text-decoration:none;border-bottom:1px dashed var(--accent)">'
      + escapeHtml(phone) + '</a></span></div>');
  }
  if (web) {
    // URL für die Anzeige kürzen (Pro-Look)
    const displayWeb = web.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
    lines.push('<div class="poi-tag">WEB: <span>' + escapeHtml(displayWeb.slice(0, 24)) + '</span></div>');
  }

  return lines.join('');
}

/** Übersetzt Overpass API Statuscodes */
async function translateOverpassError(status) {
  switch (status) {
    case 400: return 'Ungültige Anfrage an den Kartenserver.';
    case 429: return 'Zu viele Anfragen. Bitte einen Moment warten (Rate Limit).';
    case 504: return 'Server-Timeout. Das Suchgebiet ist evtl. zu groß.';
    case 500:
    case 502:
    case 503: return 'Der Kartenserver ist aktuell überlastet.';
    default:  return `Verbindung fehlgeschlagen (Status ${status})`;
  }
}
