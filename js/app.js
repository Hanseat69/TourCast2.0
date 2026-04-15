'use strict';
// ── TourCast app.js – Initialisierung, Standort, Auto-Refresh, State ──

// Sicherer Storage-Wrapper – fällt auf in-memory zurück wenn sessionStorage gesperrt ist
const SafeSession = (() => {
  const mem = {};
  let useStorage = true;
  try { sessionStorage.setItem('__test', '1'); sessionStorage.removeItem('__test'); }
  catch(e) { useStorage = false; }
  return {
    get: (k)    => useStorage ? sessionStorage.getItem(k)    : (mem[k] ?? null),
    set: (k, v) => useStorage ? sessionStorage.setItem(k, v) : (mem[k] = v),
    del: (k)    => useStorage ? sessionStorage.removeItem(k) : (delete mem[k])
  };
})();

// ── Renderer-Console → Log-Datei (nur WARN + ERROR, nicht LOG — zu rauschig) ──
(function _patchRendererConsole() {
  if (!window.electronAPI?.logRendererError) return; // nur in Electron
  const _origWarn  = console.warn.bind(console);
  const _origError = console.error.bind(console);

  function _send(level, args) {
    try {
      const msg = args.map(a =>
        typeof a === 'object' ? JSON.stringify(a) : String(a)
      ).join(' ');
      window.electronAPI.logRendererError({ level, msg, state: _captureState() })
        ?.catch?.(() => {});
    } catch (_) {}
  }

  console.warn = function(...args) {
    _origWarn(...args);
    _send('WARN', args);
  };
  console.error = function(...args) {
    _origError(...args);
    _send('ERROR', args);
  };
})();

// ── State-Snapshot für Log-Kontext ───────────────────────
function _captureState() {
  const parts = [];
  try {
    if (typeof currentLat !== 'undefined' && currentLat !== null)
      parts.push(`lat=${Number(currentLat).toFixed(4)}`);
    if (typeof currentLng !== 'undefined' && currentLng !== null)
      parts.push(`lng=${Number(currentLng).toFixed(4)}`);
    if (typeof lastRouteCoords !== 'undefined')
      parts.push(`routeLen=${lastRouteCoords.length}`);
    if (typeof S !== 'undefined' && S.activeLayer)
      parts.push(`layer=${S.activeLayer}`);
    if (typeof map !== 'undefined' && map && map.getZoom)
      parts.push(`zoom=${map.getZoom()}`);
  } catch (_) { /* immer stabil bleiben */ }
  return parts.length ? parts.join(', ') : 'n/a';
}

// ── Globaler Error-Handler ──
window.onerror = function(message, source, lineno, colno, error) {
  const file = source ? source.split('/').pop() : 'Unbekannt';
  const errInfo = `⚠️ Fehler: ${message} (${file}:${lineno})`;
  
  console.error('🚀 TourCast UI Error:', { message, file, lineno, colno, stack: error?.stack });

  // → Strukturiertes Logging in Log-Datei (via Electron IPC)
  window.electronAPI?.logRendererError?.({
    level: 'ERROR',
    msg:   String(message),
    file:  file,
    line:  lineno,
    stack: error?.stack || '',
    state: _captureState()
  })?.catch?.(() => {});
  
  // Fehler ins DOM schreiben für Debugging
  const debugEl = document.getElementById('status-debug');
  if (debugEl) {
    debugEl.innerHTML += `<br>❌ ERROR: ${errInfo}<br>${error?.stack || ''}`;
  }
  
  // Nur Toast zeigen, wenn UI bereit ist
  if (typeof showToast === 'function') {
    showToast(errInfo, 'error');
  }
  return false; // Browser-Standard-Logging beibehalten
};

window.onunhandledrejection = function(event) {
  const reason = event.reason?.message || event.reason || 'Unbekannter Promise-Fehler';
  console.error('🚀 Unhandled Promise Rejection:', event.reason);

  // → Strukturiertes Logging in Log-Datei (via Electron IPC)
  window.electronAPI?.logRendererError?.({
    level: 'PROMISE',
    msg:   String(reason),
    stack: event.reason?.stack || '',
    state: _captureState()
  })?.catch?.(() => {});
  
  // Fehler ins DOM schreiben
  const debugEl = document.getElementById('status-debug');
  if (debugEl) {
    debugEl.innerHTML += `<br>❌ PROMISE ERROR: ${reason}`;
  }
  
  if (typeof showToast === 'function') {
    showToast(`⚠️ API/Netzwerk Fehler: ${reason}`, 'error');
  }
};


// ── Rider-Profil (Defaults) ───────────────────────────────
// profile wird in state.js definiert

// ── Leaflet + Grip-Layer State ────────────────────────────
const S = {
  gripGroup:    null,
  gripRenderer: null,
  gripPane:     null,
  sunData:      null,
  uvIndex:      null,
  cloudCover:   null,
  gripHourOffset: 0,
  radarGroup:   null,
  satGroup:     null,
  radarTimer:   null,
  radarTiles:   [],
  radarIdx:     0,
  radarHost:    'https://tilecache.rainviewer.com',
  satTiles:     [],
  radarSource:  'rainviewer'
};

// ── App-Konstanten (aus HTML APP-Config) ──────────────────
// APP-Objekt wird in index.html definiert:
// const APP = { NAME, VERSION, openmeteo, overpass,
//               elevationApi, RADIUSKM, ... }

// ── App initialisieren ────────────────────────────────────
async function initApp() {
  console.log('🚀 initApp() START');
  
  // Profil aus localStorage laden
  loadProfile();
  applyTheme('light');
  document.documentElement.style
    .setProperty('--ui-scale', profile.uiScale || 1);

  // ORS-Key sicherstellen: initializeOrsKey() in index.html ist async →
  // abwarten bevor wir den Key prüfen
  if (typeof initializeOrsKey === 'function') {
    await initializeOrsKey().catch(() => {});
  }

  // Validierung: ORS API Key vorhanden?
  if (!APP.orsKey || APP.orsKey.includes('YOUR_ORS_API_KEY')) {
    console.error('ORS API Key fehlt oder ist ungültig!');
    setTimeout(() => showToast('⚠️ Routing-Key (ORS) fehlt! Bitte in index.html prüfen.', 'error'), 3000);
  }

  // Departure Time default
  setDefaultDepartureTime();

  console.log('🗺️ Initializing map...');
  // Karte initialisieren (falls noch nicht geschehen)
  if (!map) initMap();    // ← window.map → map

  // Loader-Text
  const lm = document.getElementById('loader-msg');
  if (lm) lm.textContent = 'Wetterdaten werden geladen…';

  // FALLBACK ZUERST: Sofort mit München starten, dann GPS im Hintergrund versuchen
  currentLat = 48.1374;
  currentLng = 11.5755;
  console.log('📍 Fallback position set: München', currentLat, currentLng);
  
  // Versuche GPS zu laden (asynchron mit kurzzeitigem Timeout)
  getPositionNonBlocking()
    .then(pos => {
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;
      console.log('✅ GPS gefunden:', currentLat, currentLng);
      if (typeof setUserMarker === 'function') setUserMarker(currentLat, currentLng);
      
      // Karte und Grip-Map auf neue GPS-Position zentrieren
      if (map) {
        map.setView([currentLat, currentLng], 11);
      }
      loadWeather(currentLat, currentLng).then(wx => {
        if (wx) {
          updateStatusBubble(wx);
          if (activeLayer === 'sun') updateSunPanel();
          // Grip-Heatmap FIX: nach GPS-Update mit korrekter Position neu aufbauen
          if (activeLayer === 'grip' && wx.hourly && typeof buildGripHeatmap === 'function') {
            const ci = currentHourIndex(wx);
            buildGripHeatmap(currentLat, currentLng, wx.hourly, ci);
            if (typeof updateRadiusCircle === 'function') updateRadiusCircle();
          }
        }
      }).catch(() => {});
    })
    .catch(err => {
      // GPS fehlgeschlagen – stumm ignorieren, weitere mit Fallback
      console.log('📍 GPS nicht verfügbar, verwende München Fallback:', err.message);
    });


  APP.RADIUSKM = profile.radius;

  // Karte zentrieren mit Fallback-Position
  if (map) {
    map.setView([currentLat, currentLng], 11);  // Leaflet
    if (typeof setUserMarker === 'function') setUserMarker(currentLat, currentLng);
  }

  // Wetter laden mit Fallback-Position
  console.log('☀️ Loading weather...');
  const wx = await loadWeather(currentLat, currentLng);
  console.log('☀️ Weather loaded:', wx ? 'YES' : 'NO');

  // UI updaten
  if (wx) {
    updateStatusBubble(wx);
    if (activeLayer === 'sun')       updateSunPanel();
  }

  // 8-Tage Forecast
  if (wx?.daily) renderForecastSheet(wx);

  // Sonderdaten: UV, Sonne, AQI, Wolken
  console.log('📊 Loading extra data...');
  await loadExtraData(currentLat, currentLng);
  console.log('📊 Extra data loaded');

  // Loader ausblenden
  const loader = document.getElementById('loader');
  if (loader) {
    loader.classList.add('fade-out');
    setTimeout(() => { loader.style.display = 'none'; }, 800);
  }

  // Tabs und POI-Bar
  renderTabs();
  renderPOIBar();
  setVersionLabels();
  renderProfileTab();

  // Session wiederherstellen
  if (typeof restoreSession === 'function') await restoreSession();

  return wx;
}

// ── Geolocation Promise ───────────────────────────────────
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation nicht unterstützt'));
      return;
    }
    // FIX GPS: Windows Location Services (WinRT via Electron) braucht bis zu 15s
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout:            15000,
      maximumAge:         0
    });
  });
}

// ── Non-Blocking Geolocation (mit Timeout-Fallback für Startup) ────
// Versucht 6s lang eine Position zu ermitteln, fällt danach auf München zurück.
// Startet zusätzlich watchPosition für dauerhaft laufende GPS-Aktualisierungen.
let _gpsWatchId = null;

function getPositionNonBlocking() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation nicht unterstützt'));
      return;
    }
    // 6s Startup-Timeout – danach läuft watchPosition im Hintergrund weiter
    const timeoutId = setTimeout(() => {
      reject(new Error('GPS-Timeout – München als Fallback'));
    }, 6000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timeoutId);
        resolve(pos);
        startGPSWatch(); // Dauerhaft weiter aktualisieren
      },
      (err) => {
        clearTimeout(timeoutId);
        reject(err);
        startGPSWatch(); // Auch bei Fehler: Watch starten für späteren Fix
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
    );
  });
}

// ── Dauerhaft laufender GPS-Watch ────────────────────────────────────────
function startGPSWatch() {
  if (!navigator.geolocation || _gpsWatchId !== null) return;
  _gpsWatchId = navigator.geolocation.watchPosition(
    pos => {
      const newLat = pos.coords.latitude;
      const newLng = pos.coords.longitude;
      // Nur updaten wenn sich Position >50m geändert hat (vermeidet unnötige Renders)
      const distM = typeof haversineKm === 'function'
        ? haversineKm(currentLat, currentLng, newLat, newLng) * 1000
        : 9999;
      if (distM < 50 && currentLat !== 48.1374) return;

      currentLat = newLat;
      currentLng = newLng;
      if (typeof setUserMarker === 'function') setUserMarker(currentLat, currentLng);

      // Grip-Heatmap neu aufbauen wenn Grip-Modus aktiv
      if (activeLayer === 'grip' && typeof buildGripHeatmap === 'function') {
        loadWeather(currentLat, currentLng).then(wx => {
          if (wx?.hourly && typeof buildGripHeatmap === 'function') {
            const ci = currentHourIndex(wx);
            buildGripHeatmap(currentLat, currentLng, wx.hourly, ci);
            if (activeLayer === 'grip' && typeof updateRadiusCircle === 'function') updateRadiusCircle();
          }
        }).catch(() => {});
      }
    },
    err => console.log('GPS-Watch Fehler:', err.message),
    { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 }
  );
}

// ── Aktueller Stunden-Index in Open-Meteo Hourly ──────────
function currentHourIndex(wx) {
  const now   = new Date();
  const times = wx?.hourly?.time ?? [];
  let   best  = 0;
  for (let i = 0; i < times.length; i++) {
    if (new Date(times[i]) <= now) best = i;
    else break;
  }
  return best;
}

// ── Sonderdaten: UV, AQI, Sonne ───────────────────────────
async function loadExtraData(lat, lng) {
  try {
    // Sonnenzeiten + UV via Open-Meteo daily
    const url = `${APP.openmeteo}?latitude=${lat}&longitude=${lng}` +
      `&daily=sunrise,sunset,uv_index_max,precipitation_hours` +
      `&current=cloud_cover` +
      `&timezone=auto&forecast_days=1`;

    const resp = await fetch(url);
    const data = await resp.json();

    S.sunData = {
      sunrise:    data.daily?.sunrise?.[0]    ?? null,
      sunset:     data.daily?.sunset?.[0]     ?? null,
      goldenHour: calcGoldenHour(data.daily?.sunset?.[0])
    };
    S.uvIndex    = data.daily?.uv_index_max?.[0]  ?? 0;
    S.cloudCover = data.current?.cloud_cover      ?? 50;

    if (activeLayer === 'sun') updateSunPanel();

    // AQI via Open-Meteo Air Quality
    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality` +
      `?latitude=${lat}&longitude=${lng}` +
      `&current=european_aqi,pm2_5,ozone&timezone=auto`;

    const aqResp = await fetch(aqUrl);
    const aqData = await aqResp.json();
    updateAQIPanel(aqData.current);

  } catch(e) {
    // Nicht-kritisch – still ignorieren
  }
}

// ── Goldene Stunde berechnen ──────────────────────────────
function calcGoldenHour(sunsetIso) {
  if (!sunsetIso) return null;
  const d = new Date(sunsetIso);
  d.setMinutes(d.getMinutes() - 60);
  return d.toISOString();
}

// ── AQI-Panel befüllen ────────────────────────────────────
function updateAQIPanel(aq) {
  if (!aq) return;
  const aqi    = aq.european_aqi ?? null;
  const pm25   = aq.pm2_5        ?? null;
  const o3     = aq.ozone        ?? null;

  const el = id => document.getElementById(id);
  if (aqi !== null) {
    const info = aqiInfo(aqi);
    el('aqi-val')   && (el('aqi-val').textContent   = aqi);
    el('aqi-val')   && (el('aqi-val').style.color   = info.color);
    el('aqi-label') && (el('aqi-label').textContent = info.label);
    el('aqi-label') && (el('aqi-label').style.color = info.color);
  }
  if (pm25 !== null)
    el('aqi-pm25') && (el('aqi-pm25').textContent = `${pm25.toFixed(1)} µg`);
  if (o3 !== null)
    el('aqi-o3')   && (el('aqi-o3').textContent   = `${o3.toFixed(0)} µg`);
}

// ── 8-Tage Forecast Sheet ─────────────────────────────────
function renderForecastSheet(wx) {
  const body = document.getElementById('sheet-body');
  if (!body || !wx?.daily) return;

  const d     = wx.daily;
  const days  = d.time?.length ?? 0;
  const today = new Date().toDateString();

  // Condition cards – aktuelle Werte
  const condCards = [
    { val: wx.temperature_2m     !== null
            ? `${Math.round(wx.temperature_2m)}°`    : '–', lbl: 'TEMPERATUR',  },
    { val: wx.apparent_temperature !== null
            ? `${Math.round(wx.apparent_temperature)}°` : '–', lbl: 'GEFÜHLT', },
    { val: `${Math.round(wx.wind_speed_10m ?? 0)} km/h`, lbl: 'WIND',  },
    { val: `${wx.precipitation ?? 0} mm`,                lbl: 'REGEN',  },
    { val: `${Math.round(wx.visibility ?? 10000) / 1000} km`, lbl: 'SICHTWEITE',  }
  ];

  const condHtml = `
    <div class="cond-section-title">Aktuell</div>
    <div class="cond-row">
      ${condCards.map(c => `
        <div class="cond-card">
          <span class="cond-val">${c.val}</span>
          <span class="cond-lbl">${c.lbl}</span>
        </div>`).join('')}
    </div>
    <div class="sheet-sep"></div>`;

  // Tages-Karten
  const dayHtml = `
    <div class="cond-section-title" style="margin-top:10px">8-Tage Vorschau</div>
    <div class="forecast-row">
      ${Array.from({ length: days }, (_, i) => {
        const date   = new Date(d.time[i]);
        const isToday = date.toDateString() === today;
        const name   = isToday ? 'Heute'
          : date.toLocaleDateString('de', { weekday: 'short' });
        const info   = wmoInfo(d.weathercode?.[i] ?? 0);
        const hi     = d.temperature_2m_max?.[i] ?? null;
        const lo     = d.temperature_2m_min?.[i] ?? null;
        const rain   = d.precipitation_sum?.[i]  ?? 0;
        const prob   = d.precipitation_probability_max?.[i] ?? 0;
        const uv     = d.uv_index_max?.[i] ?? 0;
        const sunH   = Math.round((d.sunshine_duration?.[i] ?? 0) / 3600);
        const wind   = d.wind_speed_10m_max?.[i] ?? 0;
        const dot    = dayScore(lo ?? 20, wind, rain);

        // Bekleidungsempfehlung für den Tag (basierend auf Max-Temp & Profil-Speed)
        const dayWc = (typeof calcWindchill === 'function')
          ? calcWindchill(hi ?? 15, profile.speedKmh || 80)
          : (hi ?? 15);
        let dayGear = 'KOMBI';
        if (dayWc < 7)       dayGear = 'THERMO';
        else if (dayWc < 15) dayGear = 'INLAY';
        else if (dayWc > 24) dayGear = 'MESH';

        return `
          <div class="day-card${isToday ? ' today' : ''}">
            <span class="day-name">${name}</span>
            <span class="day-code">${info.icon}</span>
            <div class="day-temps">
              <span class="day-hi">${hi !== null ? Math.round(hi) + '°' : '–'}</span>
              <span class="day-lo">${lo !== null ? Math.round(lo) + '°' : '–'}</span>
            </div>
            ${rain > 0.1 || prob > 10
              ? `<span class="day-rain">${prob}% · ${rain.toFixed(1)} mm</span>`
              : '<span class="day-rain" style="opacity:0.3">–</span>'}
            <span class="day-wind">${Math.round(wind)} km/h</span>
            <div class="day-gear">${dayGear}</div>
            <div class="day-sun">UV ${Math.round(uv)} · ${sunH}h</div>
            <div class="day-dot" style="background:${dot};box-shadow:0 0 8px ${dot}80"></div>
          </div>`;
      }).join('')}
    </div>`;

  body.innerHTML = condHtml + dayHtml;
}

// ── Grip-Zeitversatz (Slider) ─────────────────────────────
function setGripTimeOffset(val) {
  S.gripHourOffset = parseInt(val);
  const disp = document.getElementById('gt-time-disp');
  if (disp) {
    if (S.gripHourOffset === 0) {
      disp.textContent = 'Jetzt';
    } else {
      const t = new Date(Date.now() + S.gripHourOffset * 3600000);
      disp.textContent = t.toLocaleTimeString('de',
        { hour: '2-digit', minute: '2-digit' });
    }
  }
  // Heatmap neu aufbauen
  if (currentWeather?.hourly) {
    const ci = currentHourIndex(currentWeather);
    buildGripHeatmap(currentLat, currentLng, currentWeather.hourly, ci);
  }
}

function gripTimeNow() {
  const slider = document.getElementById('grip-time-slider');
  if (slider) slider.value = 0;
  setGripTimeOffset(0);
}

// ── Auto-Refresh (15 min) ─────────────────────────────────
let autoRefreshTimer = null;

function startAutoRefresh() {
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    weatherCache = {};
    loadWeather(currentLat, currentLng).then(wx => {
      if (!wx) return;
      if (activeLayer === 'windchill') updateWindchill();
      if (activeLayer === 'sun')       updateSunPanel();
      if (wx.daily) renderForecastSheet(wx);
      if (wx.hourly) {
        const ci = currentHourIndex(wx);
        buildGripHeatmap(currentLat, currentLng, wx.hourly, ci);
      }
    });
    loadExtraData(currentLat, currentLng);
  }, 15 * 60 * 1000);
}

// ── DOMContentLoaded ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initApp().then(() => {
    startAutoRefresh();
  });

  // Page Visibility API – Refresh bei Tab-Rückkehr > 10 min
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;

  const last = parseInt(SafeSession.get('lastRefresh') || '0');
  if (Date.now() - last < 10 * 60 * 1000) return; // < 10 min – kein Refresh nötig

  SafeSession.set('lastRefresh', String(Date.now()));

  // Nur Wetter und State neu laden – kein UI-Re-Render
  weatherCache = {};
  if (currentLat && currentLng) {
    loadWeather(currentLat, currentLng).then(wx => {
      if (wx) {
        updateStatusBubble(wx);
        renderForecastSheet(wx);
        if (wx.hourly) {
          const ci = currentHourIndex(wx);
          buildGripHeatmap(currentLat, currentLng, wx.hourly, ci);
        }
      }
    });
    loadExtraData(currentLat, currentLng);
  }
});
});

/**
 * Manueller GPS-Refresh für Nutzer
 * Versucht, die aktuelle Position neu zu ermitteln
 */
async function manualGPSRefresh() {
  const btn = document.getElementById('gps-refresh-btn');
  if (btn) {
    btn.classList.add('spinning');
    btn.disabled = true;
  }

  try {
    console.log('🔄 GPS-Refresh gestartet...');
    const pos = await getPosition(); // Mit regulärem Timeout (nicht-blocking)
    
    currentLat = pos.coords.latitude;
    currentLng = pos.coords.longitude;
    
    console.log(`✅ GPS aktualisiert: ${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}`);
    showToast(`📍 Position aktualisiert: ${currentLat.toFixed(4)}, ${currentLng.toFixed(4)}`, 'success');
    
    // Update Karte
    if (map) {
      map.setView([currentLat, currentLng], 12);  // Leaflet
    }
    
    // Update Marker
    if (typeof setUserMarker === 'function') {
      setUserMarker(currentLat, currentLng);
    }
    
    // Update Radius-Kreis (nur im Grip-Modus)
    if (activeLayer === 'grip') updateRadiusCircle();
    
    // Wetter neu laden
    const wx = await loadWeather(currentLat, currentLng);
    if (wx && typeof updateStatusBubble === 'function') {
      updateStatusBubble(wx);
    }
    
    // Grip-Heatmap ebenfalls aktualisieren
    if (activeLayer === 'grip' && typeof buildGripHeatmap === 'function') {
      loadWeather(currentLat, currentLng).then(wx => {
        if (wx?.hourly) {
          const ci = currentHourIndex(wx);
          buildGripHeatmap(currentLat, currentLng, wx.hourly, ci);
          if (typeof updateRadiusCircle === 'function') updateRadiusCircle();
        }
      }).catch(() => {});
    }

  } catch (err) {
    console.error('❌ GPS-Refresh fehlgeschlagen:', err.message);
    // Benutzerfreundliche Fehlermeldung statt rohem Browser-Fehlertext
    const msg = err.code === 1 ? 'Standortzugriff verweigert'
              : err.code === 2 ? 'Standort nicht ermittelbar'
              : err.code === 3 ? 'GPS-Zeitüberschreitung – bitte erneut versuchen'
              : 'GPS nicht verfügbar';
    showToast(`GPS: ${msg}`, 'error');
  } finally {
    if (btn) {
      btn.classList.remove('spinning');
      btn.disabled = false;
    }
  }
}