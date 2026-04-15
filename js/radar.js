/* ═══════════════════════════════════════════════════════════════════════
   radar.js  –  TourCast 2.0
   Radar + Bewölkung via RainViewer API
   Version: 1.5.1-clean

   Abhängigkeiten (Globals aus app.js / map.js):
     S       – App-State (radarGroup, satGroup, radarTimer, radarTiles,
                          radarIdx, radarHost, satTiles, radarSource, layer)
     APP     – Konfig   (RAINVIEWER_KEY, RADAR_PAST_MIN, RADAR_FRAME_MS)
     map     – Leaflet-Kartenobjekt
     toast() – UI-Feedback-Funktion

   Pane-z-Index-Übersicht:
     200  tilePane   → CartoDB Basiskarte
     210  satPane    → RainViewer Infrarot-Satelliten (Wolken)
     220  radarPane  → RainViewer Niederschlag-Animation
     230  gripPane   → Grip-Heatmap-Punkte
     600  markerPane → Leaflet User-Marker
═══════════════════════════════════════════════════════════════════════ */

'use strict';

/* ── Defaults ── */
const RADAR_PAST_MIN = APP.RADAR_PAST_MIN || 60;
const RADAR_FRAME_MS = APP.RADAR_FRAME_MS || 800;

/* ── Tile-Optionen ──────────────────────────────────────────────────── */

/** RainViewer 512px-Tiles – zoomOffset:-1 ist Pflicht bei tileSize:512 */
const RV_BASE = {
  tileSize:          512,
  zoomOffset:        -1,
  crossOrigin:       '',
  maxZoom:           19,
  updateWhenIdle:    false,
  updateWhenZooming: false,
};

/** OWM 256px Standard-Tiles */
const OWM_BASE = {
  crossOrigin:       '',
  maxZoom:           19,
  updateWhenIdle:    false,
  updateWhenZooming: false,
};

/* ── Satelliten-Animationsstate ─────────────────────────────────────── */
const SAT = {
  idx:      0,
  timer:    null,
  owmLayer: null,
  owmTimer: null,
};


/* ═══════════════════════════════════════════════════════════════════════
   HAUPT-LADEFUNCTION
   Stoppt laufende Timer, leert Layer-Gruppen und lädt neu.
═══════════════════════════════════════════════════════════════════════ */
async function loadRadar() {
  // Safety check: Map muss existieren und bereit sein
  if (!map || !map._container || !S.radarGroup) {
    console.warn('⚠️ Radar: Karte nicht bereit, versuche später...');
    setTimeout(() => loadRadar(), 500); // Erneut versuchen
    return;
  }

  if (profile.lowDataMode) return;

  /* Laufende Timer stoppen */
  if (S.radarTimer)  { clearInterval(S.radarTimer);  S.radarTimer  = null; }
  if (SAT.timer)     { clearInterval(SAT.timer);      SAT.timer     = null; }
  if (SAT.owmTimer)  { clearInterval(SAT.owmTimer);   SAT.owmTimer  = null; }

  /* Layer-Gruppen leeren */
  S.satGroup.clearLayers();
  S.radarGroup.clearLayers();

  /* Niederschlag-Animation (RainViewer Radar) */
  await loadRainViewer();
}

/* ── Animations-Steuerung ── */
function startRadarAnimation() {
  if (!S.radarTimer) loadRainViewer();
}

function stopRadarAnimation() {
  if (S.radarTimer) { clearInterval(S.radarTimer); S.radarTimer = null; }
  if (SAT.timer)    { clearInterval(SAT.timer);    SAT.timer    = null; }
  if (SAT.owmTimer) { clearInterval(SAT.owmTimer); SAT.owmTimer = null; }
  
  S.radarGroup?.clearLayers();
  S.satGroup?.clearLayers();
  
  const badge = document.getElementById('radar-badge');
  if (badge) badge.style.display = 'none';
}


/* ═══════════════════════════════════════════════════════════════════════
   WOLKEN-LAYER  –  RainViewer Infrarot-Satellit
═══════════════════════════════════════════════════════════════════════ */
async function loadSatFallback() {
  if (profile.lowDataMode) return;

  if (!map || !S.satGroup) return;
  try {
    const key  = APP.RAINVIEWER_KEY ? `?apikey=${APP.RAINVIEWER_KEY}` : '';
    const resp = await fetch(`https://api.rainviewer.com/public/weather-maps.json${key}`);
    if (!resp.ok) return;

    const json = await resp.json();
    S.radarHost = json.host || S.radarHost;
    S.satTiles  = json.satellite?.infrared || [];

    if (!S.satTiles.length) {
      console.warn('[Sat] Keine Infrarot-Tiles verfügbar');
      return;
    }

    /* Startindex: nächster Frame ab (jetzt − RADAR_PAST_MIN) */
    const startTs = (Date.now() / 1000) - RADAR_PAST_MIN * 60;
    SAT.idx = Math.max(0, S.satTiles.findIndex(t => t.time >= startTs));

    showSatFrame();

    SAT.timer = setInterval(() => {
      if (!map || !S.satGroup) {
        clearInterval(SAT.timer);
        SAT.timer = null;
        return;
      }
      if (typeof activeLayer !== 'undefined' && activeLayer !== 'radar' && activeLayer !== 'sun') {
        clearInterval(SAT.timer);
        SAT.timer = null;
        return;
      }
      SAT.idx = (SAT.idx + 1) % S.satTiles.length;
      showSatFrame();
    }, RADAR_FRAME_MS * 1.6);

  } catch (e) {
    console.warn('[Sat] Offline oder Fehler:', e.message);
  }
}

/** Zeigt den aktuellen Satelliten-Frame in satGroup an. */
function showSatFrame() {
  if (!map || !S.satGroup) return;
  
  const st = S.satTiles[SAT.idx];
  if (!st) return;

  const path = st.path
    ? `${S.radarHost}${st.path}/512/{z}/{x}/{y}/0/0_1.png`
    : `${S.radarHost}/v2/satellite/infrared/${st.time}/512/{z}/{x}/{y}/0/0_1.png`;

  const layer = L.tileLayer(path, {
    ...RV_BASE,
    pane:    'satPane',
    opacity: 0.50,
    fadeAnimation: false
  });

  // Guard gegen Leaflet-Bug: _fadeAnimated TypeError wenn Layer vor Tile-Load entfernt wird
  layer._tileReady = function(coords, err, tile) {
    if (!this._map) return;
    try {
      L.TileLayer.prototype._tileReady.call(this, coords, err, tile);
    } catch (e) {
      // Karte wurde während des Tile-Ladens entfernt — sicher ignorierbar
    }
  };
  
  layer.on('load', () => {
    if (!S.satGroup || !map) return;
    try {
      const layers = S.satGroup.getLayers();
      if (layers.length > 1 && map.hasLayer(layer)) {
        layers.slice(0, -1).forEach(l => S.satGroup.removeLayer(l));
      }
    } catch (e) {
      console.warn('⚠️ Fehler beim Aktualisieren Sat-Layer:', e.message);
    }
  });

  if (map && S.satGroup) {
    layer.addTo(S.satGroup);
  }
}


/* ═══════════════════════════════════════════════════════════════════════
   NIEDERSCHLAG-ANIMATION  –  RainViewer Radar
   Lädt vergangene Frames + Nowcast (~30 min).
   Primärquelle für Regenerkennung.
═══════════════════════════════════════════════════════════════════════ */
async function loadRainViewer() {
  if (!map || !map._container || !S.radarGroup) {
    console.warn('⚠️ RainViewer: Karte nicht bereit');
    return;
  }
  try {
    const key  = APP.RAINVIEWER_KEY ? `?apikey=${APP.RAINVIEWER_KEY}` : '';
    const resp = await fetch(`https://api.rainviewer.com/public/weather-maps.json${key}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const json = await resp.json();

    S.radarHost   = json.host || 'https://tilecache.rainviewer.com';
    S.radarSource = 'rainviewer';
    S.radarTiles  = [
      ...(json.radar?.past    || []),
      ...(json.radar?.nowcast || []),
    ];

    if (!S.radarTiles || !S.radarTiles.length) {
      if (typeof showToast === 'function') showToast('Keine Radardaten verfügbar');
      return;
    }

    /* Startindex: nächster Frame ab (jetzt − RADAR_PAST_MIN) */
    const startTs = (Date.now() / 1000) - RADAR_PAST_MIN * 60;
    S.radarIdx = S.radarTiles.findIndex(t => t.time >= startTs);
    if (S.radarIdx < 0) S.radarIdx = 0;

    showRadarFrame();

    S.radarTimer = setInterval(() => {
      if (!map || !map._container || !S.radarGroup) {
        clearInterval(S.radarTimer);
        S.radarTimer = null;
        return;
      }
      if (typeof activeLayer !== 'undefined' && activeLayer !== 'radar') {
        clearInterval(S.radarTimer);
        S.radarTimer = null;
        return;
      }
      S.radarIdx = (S.radarIdx + 1) % S.radarTiles.length;
      showRadarFrame();
    }, RADAR_FRAME_MS);

  } catch (e) {
    if (typeof showToast === 'function') showToast('Radar-Fehler: ' + e.message);
  }
}

/** Zeigt den aktuellen Radar-Frame in radarGroup an + aktualisiert Badge. */
function showRadarFrame() {
  // Safety checks
  if (!map || !map._container || !S.radarGroup) {
    console.warn('⚠️ Radar: Karte oder radarGroup nicht bereit');
    return;
  }
  
  const ts = S.radarTiles[S.radarIdx];
  if (!ts) return;

  try {
    const path = ts.path
      ? `${S.radarHost}${ts.path}/512/{z}/{x}/{y}/6/1_1.png`
      : `${S.radarHost}/v2/radar/${ts.time}/512/{z}/{x}/{y}/6/1_1.png`;

    const layer = L.tileLayer(path, {
      ...RV_BASE,
      pane:        'radarPane',
      opacity:     0.72,
      attribution: '© RainViewer',
      fadeAnimation: false
    });

    // Guard gegen Leaflet-Bug: _fadeAnimated TypeError wenn Layer vor Tile-Load entfernt wird
    // Guard läuft zu früh — _map wird null WÄHREND dem Prototype-Call → try-catch als zweite Sicherung
    layer._tileReady = function(coords, err, tile) {
      if (!this._map) return;
      try {
        L.TileLayer.prototype._tileReady.call(this, coords, err, tile);
      } catch (e) {
        // Karte wurde während des Tile-Ladens entfernt — sicher ignorierbar
      }
    };

    // FIX Radar Ruckeln: fehlgeschlagene Tiles zählen
    layer._tc_failCount = 0;
    layer._tc_loadCount = 0;
    layer.on('tileerror', () => { layer._tc_failCount++; });
    layer.on('tileload',  () => { layer._tc_loadCount++; });

    layer.on('load', () => {
      if (!S.radarGroup || !map) return;
      try {
        // Frame überspringen wenn >40% der Tiles fehlgeschlagen sind (ruckelfreie Animation)
        const total = layer._tc_loadCount + layer._tc_failCount;
        if (total > 0 && layer._tc_failCount / total > 0.40) {
          S.radarGroup.removeLayer(layer);
          return; // Frame überspringen, alten Frame sichtbar lassen
        }
        const layers = S.radarGroup.getLayers();
        if (layers.length > 1 && map && map.hasLayer(layer)) {
          layers.slice(0, -1).forEach(l => {
            try { S.radarGroup.removeLayer(l); } catch (e) {}
          });
        }
      } catch (e) {
        console.warn('⚠️ Fehler beim Aktualisieren runder Radar-Layer:', e.message);
      }
    });

    // Guard: Prüfe nochmal vor addTo
    if (map && S.radarGroup) {
      layer.addTo(S.radarGroup);
    }

    /* ── Radar-Badge aktualisieren ──────────────────────────────── */
    const badge = document.getElementById('radar-badge');
    if (!badge) return;

    const zeit = new Date(ts.time * 1000).toLocaleTimeString('de-DE', {
      hour:   '2-digit',
      minute: '2-digit',
    });

    badge.textContent   = `RADAR ${zeit}`;
    badge.style.display = 'block';
  } catch (e) {
    console.error('❌ Fehler beim Laden des Radar-Frames:', e);
  }
}