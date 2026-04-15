'use strict';
/**
 * ── TourCast weather-engine.js ──
 * Konsolidiertes Modul für Wetterdaten, Grip-Score, Windchill, Heatmap und farbige Routen-Segmente.
 */

let weatherCache = {};
const CACHE_TTL_MS = 15 * 60 * 1000;

// ── Global State für Routen-Segmente ──
let routeSegmentLayers = [];
let routeSegmentData = [];

// ── Global State für Grip-Heatmap ──
let gripHeatmapData = {}; // Speichert Daten für Heatmap-Punkte
let gripHeatmapPerformance = { renderTime: 0, pointCount: 0, memoryUsage: 0 };

// ── Moderne Wetter-Icons (SVG) ──
const WX_SVG = {
  sun:   (c='#FFB300') => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
  moon:  (c='#94A3B8') => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`,
  cloud: (c='#94A3B8') => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10a5.5 5.5 0 0 0-10.7-1.7A5 5 0 1 0 10 18h7.5a3.5 3.5 0 1 0 0-7Z"/></svg>`,
  mix:   (c='#94A3B8') => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2m4.93 2.93l1.41 1.41M20 12h2m-8.71-7.07A5.5 5.5 0 0 0 5.4 11.23A5 5 0 1 0 9 20h7.5a3.5 3.5 0 1 0 0-7c0-1.21-.41-2.32-1.1-3.21"/></svg>`,
  rain:  (c='#3DB9FF') => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 20l-2 2m4-2l-2 2m4-2l-2 2M20 10a5.5 5.5 0 0 0-10.7-1.7A5 5 0 1 0 10 18h7.5a3.5 3.5 0 1 0 0-7Z"/></svg>`,
  snow:  (c='#FFFFFF') => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m8 20 4-2 4 2M12 20v-4m-4-8 4 2 4-2M12 6V2m-8 8 2 4-2 4M6 14h4m14-4-2 4 2 4m-4-4h4"/></svg>`,
  thunder: (c='#C855FF') => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10a5.5 5.5 0 0 0-10.7-1.7A5 5 0 1 0 10 18h7.5a3.5 3.5 0 1 0 0-7Z"/><path d="m13 22-3-5h6l-3-5" stroke="#FFD700"/></svg>`,
  fog:   (c='#64748B') => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>`
};

// ── Wetter Daten-Logik ──
async function loadWeather(lat, lng) {
  // ── Höhere Precision (4 Dezimalstellen ≈ 11m statt 111m) ──
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (weatherCache[key] && Date.now() - weatherCache[key].ts < CACHE_TTL_MS) {
    currentWeather = weatherCache[key].data;
    renderWeatherBar(currentWeather);
    return weatherCache[key].data;
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout
    
    const params = `latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weathercode,visibility,is_day&hourly=temperature_2m,precipitation,wind_speed_10m,weathercode&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,uv_index_max,sunshine_duration,wind_speed_10m_max,weathercode&timezone=auto&forecast_days=8`;
    const resp = await fetch(`${APP.openmeteo}?${params}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    
    const data = await resp.json();
    if (!data.current) throw new Error('Keine Wetterdaten');
    
    currentWeather = parseWeather(data);
    weatherCache[key] = { data: currentWeather, ts: Date.now() };
    renderWeatherBar(currentWeather);
    return currentWeather;
  } catch(e) {
    console.warn('Wetter-Fehler:', e);
    // Fallback mit gespeicherten oder Default-Daten
    const fallback = currentWeather || { 
      temperature_2m: 15, precipitation: 0, wind_speed_10m: 10, 
      apparent_temperature: 15, wind_gusts_10m: 15, wind_direction_10m: 0,
      weathercode: 0, is_day: 1, visibility: 10000,
      hourly: {}, daily: {}, timezone: 'auto' 
    };
    return fallback;
  }
}

function parseWeather(data) {
  const c = data.current || {};
  return {
    temperature_2m: c.temperature_2m ?? null,
    apparent_temperature: c.apparent_temperature ?? null,
    precipitation: c.precipitation ?? 0,
    wind_speed_10m: c.wind_speed_10m ?? 0,
    wind_gusts_10m: c.wind_gusts_10m ?? 0,
    wind_direction_10m: c.wind_direction_10m ?? 0,
    weathercode: c.weathercode ?? 0,
    visibility: c.visibility ?? 10000,
    is_day: c.is_day ?? 1,
    hourly: data.hourly || {},
    daily: data.daily || {},
    timezone: data.timezone || 'auto'
  };
}

function wmoInfo(code, isDay = 1) {
  const d = isDay === 1;
  const map = {
    0:  { icon: d ? WX_SVG.sun()            : WX_SVG.moon(),          text: d ? 'Sonnig' : 'Klar' },
    1:  { icon: WX_SVG.mix(),               text: 'Heiter' },
    2:  { icon: WX_SVG.mix(),               text: 'Leicht bewölkt' },
    3:  { icon: WX_SVG.cloud(),             text: 'Bedeckt' },
    45: { icon: WX_SVG.fog(),               text: 'Nebel' },
    48: { icon: WX_SVG.fog('#B0C4DE'),      text: '⚠️ Gefrierender Nebel' },
    51: { icon: WX_SVG.rain('#90CAF9'),     text: 'Nieselregen leicht' },
    53: { icon: WX_SVG.rain('#64B5F6'),     text: 'Nieselregen' },
    55: { icon: WX_SVG.rain('#42A5F5'),     text: 'Nieselregen stark' },
    61: { icon: WX_SVG.rain(),              text: 'Leichter Regen' },
    63: { icon: WX_SVG.rain(),              text: 'Regen' },
    65: { icon: WX_SVG.rain('#2563EB'),     text: 'Starker Regen' },
    66: { icon: WX_SVG.rain('#B0C4DE'),     text: '⚠️ Gefrierender Regen leicht' },
    67: { icon: WX_SVG.rain('#87CEEB'),     text: '⚠️ Gefrierender Regen' },
    71: { icon: WX_SVG.snow(),              text: 'Leichter Schneefall' },
    73: { icon: WX_SVG.snow(),              text: 'Schneefall' },
    75: { icon: WX_SVG.snow('#E0F0FF'),     text: 'Starker Schneefall' },
    77: { icon: WX_SVG.snow('#CFE8FF'),     text: 'Schneekörner' },
    80: { icon: WX_SVG.rain('#4FC3F7'),     text: 'Regenschauer leicht' },
    81: { icon: WX_SVG.rain('#29B6F6'),     text: 'Regenschauer' },
    82: { icon: WX_SVG.rain('#0288D1'),     text: 'Starke Regenschauer' },
    85: { icon: WX_SVG.snow(),              text: 'Schneeschauer leicht' },
    86: { icon: WX_SVG.snow('#DCEEFF'),     text: 'Schneeschauer stark' },
    95: { icon: WX_SVG.thunder(),           text: 'Gewitter' },
    96: { icon: WX_SVG.thunder('#FF6F00'),  text: '⚠️ Gewitter mit Hagel' },
    99: { icon: WX_SVG.thunder('#E65100'),  text: '⚠️ Schweres Gewitter mit Hagel' },
  };
  return map[code] || { icon: WX_SVG.cloud(), text: `Code ${code}` };
}

// ── Grip & Windchill Logik ──
function calcGripScore(wx) {
  if (!wx) return 70;
  let score = 100;
  const rain  = wx.precipitation  ?? 0;
  const temp  = wx.temperature_2m ?? 10;
  const gusts = wx.wind_gusts_10m ?? 0;

  // Niederschlag
  if      (rain >= 2.0) score -= 55;
  else if (rain >= 0.5) score -= 35;
  else if (rain >= 0.1) score -= 20;

  // Temperatur (Eisgefahr)
  if      (temp < 0) score -= 30;
  else if (temp < 8) score -= 8;

  // Böen (fahrdynamischer Einfluss)
  if      (gusts > 100) score -= 20;
  else if (gusts > 70)  score -= 10;
  else if (gusts > 50)  score -= 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function gripLabel(score) {
  if (score >= 85) return { label: 'Trocken', color: 'var(--grip-dry)' };
  if (score >= 65) return { label: 'Trocknet ab', color: 'var(--grip-damp)' };
  if (score >= 45) return { label: 'Nass', color: 'var(--grip-wet)' };
  return { label: 'Schmierfilm-Gefahr', color: 'var(--grip-warn)' };
}

function calcWindchill(tempC, speedKmh) {
  // Formel nur gültig bis 10 °C und ab 5 km/h (Environment Canada)
  if (tempC > 10) return Math.round(tempC);
  const v = Math.max(speedKmh, 5);
  return Math.round(13.12 + 0.6215 * tempC - 11.37 * Math.pow(v, 0.16) + 0.3965 * tempC * Math.pow(v, 0.16));
}

function calcGoNoGo(wx) {
  if (!wx) return { color: 'var(--caution)', label: 'CAUTION', reasons: [], status: 'caution', grip: 70 };

  const thr = profile.thresholds;
  const reasons = [];
  let level = 'go';

  const temp   = wx.temperature_2m  ?? 15;
  const rain   = wx.precipitation   ?? 0;
  const wind   = wx.wind_speed_10m  ?? 0;
  const gusts  = wx.wind_gusts_10m  ?? 0;
  const grip   = calcGripScore(wx);

  // DANGER – sofortiger Abbruch der Auswertung nach erstem Treffer
  if (temp  < thr.tempDanger)  { level = 'danger'; reasons.push({ text: 'Zu kalt – Glatteis-Gefahr' }); }
  if (rain  > thr.rainDanger)  { level = 'danger'; reasons.push({ text: 'Starkregen' }); }
  if (wind  > thr.windDanger)  { level = 'danger'; reasons.push({ text: 'Sturm' }); }
  if (gusts > thr.gustDanger)  { level = 'danger'; reasons.push({ text: 'Extreme Böen' }); }
  if (grip  < thr.gripDanger)  { level = 'danger'; reasons.push({ text: 'Kein Grip – Schmierfilm' }); }

  if (level === 'danger') {
    return { color: 'var(--danger)', label: 'NO-GO', reasons, status: 'danger', grip };
  }

  // CAUTION
  if (temp  < thr.tempCaution)  { level = 'caution'; reasons.push({ text: 'Kalt – Vorsicht' }); }
  if (rain  > thr.rainCaution)  { level = 'caution'; reasons.push({ text: 'Leichter Regen' }); }
  if (wind  > thr.windCaution)  { level = 'caution'; reasons.push({ text: 'Starker Wind' }); }
  if (gusts > thr.gustCaution)  { level = 'caution'; reasons.push({ text: 'Böen – aufmerksam fahren' }); }
  if (grip  < thr.gripCaution)  { level = 'caution'; reasons.push({ text: 'Reduzierter Grip' }); }

  if (level === 'caution') {
    return { color: 'var(--caution)', label: 'CAUTION', reasons, status: 'caution', grip };
  }

  return { color: 'var(--go)', label: 'GO', reasons: [{ text: 'Gute Fahrt!' }], status: 'go', grip };
}

function dayScore(minT, maxWind, precip) {
  const thr = profile.thresholds;
  if (minT < thr.tempDanger || maxWind > thr.windDanger || precip > thr.rainDanger * 2.5) {
    return 'var(--danger)';
  }
  if (minT < thr.tempCaution || maxWind > thr.windCaution || precip > thr.rainCaution) {
    return 'var(--caution)';
  }
  return 'var(--go)';
}

// ── UI Rendering ──
function renderWeatherBar(wx) {
  const bar = document.getElementById('bar-weather');
  if (!bar || !wx) return;
  const gng = calcGoNoGo(wx);
  const info = wmoInfo(wx.weathercode, wx.is_day);
  const wc = calcWindchill(wx.temperature_2m ?? 10, profile.speedKmh || 80);
  
  bar.style.display = 'flex';
  bar.className = 'route-info-bar';
  bar.innerHTML = `
    <div class="route-stat">
      <span class="route-stat-val mono">${Math.round(wx.temperature_2m)}° <small>(${wc}°)</small></span>
      <span class="route-stat-lbl">${info.icon} ${info.text}</span>
    </div>
    <div class="route-stat">
      <span class="route-stat-val mono">${Math.round(wx.wind_speed_10m)} km/h</span>
      <span class="route-stat-lbl">Wind</span>
    </div>
    <div class="route-stat">
      <span class="route-stat-val mono" style="color:${gng.color}">${gng.grip}%</span>
      <span class="route-stat-lbl">Grip</span>
    </div>`;
}

async function buildWeatherTimeline(coords, distKm) {
  const container = document.getElementById('weather-timeline');
  const scroll = document.getElementById('wt-scroll');
  if (!container || !scroll || !coords.length) return;
  container.style.display = 'block';
  scroll.innerHTML = '<div class="wt-loading">Wetter wird geladen…</div>';

  const STOPS = 8;
  
  // ── PARALLELE Anfragen (statt sequenziell) ──
  const stopIndices = Array.from({ length: STOPS }, (_, i) => 
    Math.min(Math.floor((coords.length / STOPS) * i), coords.length - 1)
  );
  const stopCoords = stopIndices.map(idx => coords[idx]);
  
  try {
    const wxResults = await Promise.all(
      stopCoords.map(coord => loadWeather(coord.lat, coord.lng))
    );
    
    // ── Cards mit erweiterten Daten ──
    const cards = [];
    wxResults.forEach((wx, i) => {
      if (!wx) return;
      
      const info = wmoInfo(wx.weathercode, wx.is_day);
      const grip = calcGripScore(wx);
      const gripLbl = gripLabel(grip);
      const wind = Math.round(wx.wind_speed_10m);
      const distAtStop = ((distKm / STOPS) * i).toFixed(0);
      
      // ── Colored Dot basierend auf Grip ──
      const dotStyle = `background:${gripLbl.color};width:6px;height:6px;border-radius:50%;`;
      
      cards.push(`<div class="wt-card">
        <span class="wt-km mono">${distAtStop} km</span>
        <span class="wt-ico">${info.icon}</span>
        <span class="wt-temp mono">${Math.round(wx.temperature_2m)}°</span>
        <span class="wt-wind" title="Wind ${wind} km/h">💨 ${wind} km/h</span>
        <span class="wt-grip" style="color:${gripLbl.color};" title="${gripLbl.label} (${grip}%)">${grip}%</span>
      </div>`);
    });
    
    scroll.innerHTML = cards.join('');
    
  } catch(e) {
    console.warn('Weather Timeline Fehler:', e);
    scroll.innerHTML = '<div class="wt-error">⚠️ Wetterdaten konnte nicht geladen werden</div>';
  }
}

function buildGripHeatmap(lat, lon, hourly, ci) {
  if (!S.gripGroup || !map) return;
  
  const startTime = performance.now();
  S.gripGroup.clearLayers();
  gripHeatmapData = {}; // Reset
  
  // CSS-Variablen zu Hex-Farben
  const colorMap = {
    'var(--grip-dry)': '#22C55E',
    'var(--grip-warn)': '#FBBF24',
    'var(--grip-wet)': '#3DB9FF',
    'var(--danger)': '#FF3355'
  };
  
  // ── ZOOM-ADAPTIVE PUNKT-DICHTE ──
  // Bei Zoom raus (< 11): Weniger Punkte für bessere Performance
  // Bei Zoom 11-13: Normale Dichte
  // Bei Zoom rein (> 13): Maximale Dichte für maximale Details
  
  const zoomLevel = map.getZoom();
  let rings, basePointsPerRing;
  
  if (zoomLevel < 11) {
    // Performance Modus: Nur 4 Ringe, 6-18 Punkte = ~66 Punkte (ursprüngliche Dichte)
    rings = [0.15, 0.40, 0.70, 0.95];
    basePointsPerRing = 6;
  } else if (zoomLevel < 13) {
    // Balanced Modus: 6 Ringe, 9-33 Punkte = ~150 Punkte (mittlere Dichte)
    rings = [0.15, 0.28, 0.40, 0.60, 0.80, 0.95];
    basePointsPerRing = 9;
  } else {
    // Detail Modus: 8 Ringe, 12-40 Punkte = ~260 Punkte (maximale Dichte)
    rings = [0.08, 0.18, 0.28, 0.38, 0.50, 0.65, 0.80, 0.95];
    basePointsPerRing = 12;
  }
  
  let pointCount = 0;
  
  rings.forEach((frac, ri) => {
    const r = frac * (APP.RADIUSKM || 150);
    const n = basePointsPerRing + ri * 4;
    
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI / n) * i;
      const plat = lat + (r / 111.32) * Math.cos(angle);
      const plon = lon + (r / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle);
      const pointId = `${plat.toFixed(4)}_${plon.toFixed(4)}`;
      
      // Wetterdaten für diesen Punkt
      const temp = 15;
      const wind = 10;
      const rain = hourly.precipitation?.[ci] ?? 0;
      const windSpeed = hourly.wind_speed_10m?.[ci] ?? 0;
      
      // Grip-Berechnung
      let mainGrip = 100;
      if (rain >= 2.0) mainGrip -= 55;
      else if (rain >= 0.5) mainGrip -= 35;
      else if (rain >= 0.1) mainGrip -= 20;
      mainGrip = Math.max(0, Math.min(100, mainGrip));
      
      // Farbgebung
      let cssVar;
      if (rain > 2.0 || mainGrip < 20) cssVar = 'var(--danger)';
      else if (rain > 0.5 || mainGrip < 45) cssVar = 'var(--grip-wet)';
      else if (rain > 0.1 || mainGrip < 65) cssVar = 'var(--grip-warn)';
      else cssVar = 'var(--grip-dry)';
      
      const hexColor = colorMap[cssVar] || '#22C55E';
      const baseRadius = 6 + (mainGrip < 45 ? 3 : 0);
      
      const marker = L.circleMarker([plat, plon], {
        radius: baseRadius,
        weight: 1,
        color: hexColor,
        fillColor: hexColor,
        fillOpacity: mainGrip < 45 ? 0.8 : 0.6,
        pane: 'gripPane'
      }).addTo(S.gripGroup);
      
      // Hover-Effekt (Event Delegation Alternative: nur kritische Punkte)
      if (mainGrip < 45) {
        marker.on('mouseover', () => {
          marker.setStyle({ radius: baseRadius + 2, weight: 2, color: '#fff' });
        });
        marker.on('mouseout', () => {
          marker.setStyle({ radius: baseRadius, weight: 1, color: hexColor });
        });
      }
      
      // Click-Handler (mit Stoppage zur Performance)
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        showGripPointModal(plat, plon, {
          lat: plat,
          lng: plon,
          grip: mainGrip,
          temp: temp,
          rain: rain,
          wind: windSpeed,
          weatherCondition: cssVar === 'var(--danger)' ? 'KRITISCH' :
                            cssVar === 'var(--grip-wet)' ? 'NASS' :
                            cssVar === 'var(--grip-warn)' ? 'FEUCHTER' : 'TROCKEN'
        });
      });
      
      // Daten speichern
      gripHeatmapData[pointId] = {
        lat: plat,
        lng: plon,
        grip: mainGrip,
        temp: temp,
        rain: rain,
        wind: windSpeed
      };
      
      pointCount++;
    }
  });
  
  // ── Performance Monitoring ──
  const renderTime = performance.now() - startTime;
  gripHeatmapPerformance = {
    renderTime: Math.round(renderTime),
    pointCount: pointCount,
    zoomLevel: zoomLevel,
    mode: zoomLevel < 11 ? 'Performance' : zoomLevel < 13 ? 'Balanced' : 'Detail',
    memoryUsage: Math.round((JSON.stringify(gripHeatmapData).length / 1024) * 100) / 100 // KB
  };
  
  console.log(`✅ Grip-Heatmap (${gripHeatmapPerformance.mode}): ${pointCount} Punkte in ${renderTime.toFixed(0)}ms | Memory: ${gripHeatmapPerformance.memoryUsage} KB | Zoom: ${zoomLevel}`);
}

function interpolateWeather(lat, lng) {
  // Versuche nearby cache zu nutzen (Toleranz 0.01 = ~1km)
  const tolerance = 0.01;
  for (const [key, cache] of Object.entries(weatherCache)) {
    const [clat, clng] = key.split(',').map(Number);
    if (Math.abs(clat - lat) < tolerance && Math.abs(clng - lng) < tolerance) {
      if (Date.now() - cache.ts < CACHE_TTL_MS) {
        return cache.data;
      }
    }
  }
  // Fallback
  return currentWeather || { temperature_2m: 15, precipitation: 0, wind_speed_10m: 10, 
                              weathercode: 0, is_day: 1, wind_gusts_10m: 15,
                              apparent_temperature: 15, hourly: {}, daily: {} };
}

function clearWeatherTimeline() {
  const container = document.getElementById('weather-timeline');
  if (container) container.style.display = 'none';
  const bar = document.getElementById('bar-weather');
  if (bar) bar.style.display = 'none';
}

// ── Zusätzliche Umwelt-Infos ──
function uvInfo(uv) {
  if (uv <= 2) return { label: 'Niedrig', cls: 'uv-low' };
  if (uv <= 5) return { label: 'Mäßig', cls: 'uv-mod' };
  return { label: 'Hoch', cls: 'uv-high' };
}

function aqiInfo(aqi) {
  if (aqi <= 40) return { label: 'Gut', color: 'var(--go)' };
  return { label: 'Mäßig', color: 'var(--caution)' };
}

function heatInfo(temp, cloud) {
  const eff = temp + (cloud < 30 ? 4 : 0);
  if (eff < 30) return { label: 'Gering', cls: 'sp-ok' };
  return { label: 'Hoch', cls: 'sp-warn' };
}

function glareWarning(rise, set, cloud) {
  const now = new Date();
  const isNearSunrise = Math.abs(now - new Date(rise)) < 3600000;
  const isNearSunset = Math.abs(now - new Date(set)) < 3600000;
  return (isNearSunrise || isNearSunset) && cloud < 40;
}

// ── FARBIGE ROUTEN-SEGMENTE ──────────────────────────────────

/**
 * Analysiert ein Routen-Segment und gibt Farbe + Warnungen zurück
 * @param {Object} segment - { start, end, weather }
 * @returns {Object} - { color, level, warnings }
 */
function analyzeSegmentConditions(segment) {
  const wx = segment.weather;
  if (!wx) return { color: '#FF6200', level: 'unknown', warnings: [] };

  const thr = profile.thresholds || {};
  const warnings = [];
  let level = 'good';
  let color = '#22C55E'; // Grün = Gut

  // Wetterbedingungen analysieren
  const temp = wx.temperature_2m ?? 15;
  const rain = wx.precipitation ?? 0;
  const wind = wx.wind_speed_10m ?? 0;
  const gusts = wx.wind_gusts_10m ?? 0;
  const grip = calcGripScore(wx);

  // KRITISCH (Rot)
  if (temp < (thr.tempDanger ?? 0) || rain > (thr.rainDanger ?? 5) || 
      wind > (thr.windDanger ?? 50) || gusts > (thr.gustDanger ?? 80) ||
      grip < (thr.gripDanger ?? 20)) {
    level = 'danger';
    color = '#FF3355'; // Rot
    if (temp < (thr.tempDanger ?? 0)) warnings.push('⚠️ Zu kalt – Glatteis-Gefahr');
    if (rain > (thr.rainDanger ?? 5)) warnings.push('☔ Starkregen');
    if (wind > (thr.windDanger ?? 50)) warnings.push('💨 Sturm');
    if (gusts > (thr.gustDanger ?? 80)) warnings.push('💨 Extreme Böen');
    if (grip < (thr.gripDanger ?? 20)) warnings.push('🛣️ Kein Grip – Schmierfilm');
  }
  // WARNUNG (Orange)
  else if (temp < (thr.tempCaution ?? 8) || rain > (thr.rainCaution ?? 1) ||
           wind > (thr.windCaution ?? 35) || gusts > (thr.gustCaution ?? 60) ||
           grip < (thr.gripCaution ?? 45)) {
    level = 'caution';
    color = '#FFB800'; // Orange
    if (temp < (thr.tempCaution ?? 8)) warnings.push('Kalt – Vorsicht');
    if (rain > (thr.rainCaution ?? 1)) warnings.push('Leichter Regen');
    if (wind > (thr.windCaution ?? 35)) warnings.push('Starker Wind');
    if (gusts > (thr.gustCaution ?? 60)) warnings.push('Böen – aufmerksam fahren');
    if (grip < (thr.gripCaution ?? 45)) warnings.push('Reduzierter Grip');
  }
  // NORMAL (Grün)
  else {
    level = 'good';
    color = '#22C55E';
    warnings.push('Gute Bedingungen');
  }

  return { color, level, warnings, grip, temp, wind, rain };
}

/**
 * Erstellt farbige Routen-Segmente basierend auf Wetterdaten
 * Jedes Segment ist klickbar und zeigt Detailinformationen
 * @param {Array} coords - Koordinaten-Array
 * @param {number} totalDistKm - Gesamt-Distanz
 */
async function buildColoredRouteLayer(coords) {
  if (!map || !coords || coords.length < 2) return;

  // Alte Segmente entfernen
  routeSegmentLayers.forEach(layer => {
    if (map.hasLayer(layer)) map.removeLayer(layer);
  });
  routeSegmentLayers = [];
  routeSegmentData = [];

  const SEGMENT_SIZE = Math.max(5, Math.floor(coords.length / 16)); // 16 Segmente oder weniger
  
  try {
    for (let i = 0; i < coords.length - SEGMENT_SIZE; i += SEGMENT_SIZE) {
      const segment = coords.slice(i, i + SEGMENT_SIZE + 1);
      const startCoord = segment[0];
      const endCoord = segment[segment.length - 1];

      // Mittelpunkt für Wetter-Abfrage
      const midLat = (startCoord.lat + endCoord.lat) / 2;
      const midLng = (startCoord.lng + endCoord.lng) / 2;

      // Wetterdaten laden
      const wx = await loadWeather(midLat, midLng);
      
      // Segment analysieren
      const segData = analyzeSegmentConditions({ start: startCoord, end: endCoord, weather: wx });
      segData.startIdx = i;
      segData.endIdx = Math.min(i + SEGMENT_SIZE, coords.length - 1);
      segData.weather = wx;
      
      // Polyline für Segment erstellen
      const latlngs = segment.map(c => [c.lat, c.lng]);
      const polyline = L.polyline(latlngs, {
        color: segData.color,
        weight: 5,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round',
        className: `route-segment route-segment-${segData.level}` // Für CSS-Animation
      }).addTo(map);

      // Click-Handler für Modal
      polyline.on('click', (e) => {
        showSegmentModal(i, segData);
        L.DomEvent.stopPropagation(e);
      });

      // Hover-Effekt
      polyline.on('mouseover', () => {
        polyline.setStyle({ weight: 7, opacity: 1 });
      });
      polyline.on('mouseout', () => {
        polyline.setStyle({ weight: 5, opacity: 0.85 });
      });

      routeSegmentLayers.push(polyline);
      routeSegmentData.push(segData);
    }

    console.log(`✅ ${routeSegmentLayers.length} Routen-Segmente mit Wetter-Daten erstellt`);
  } catch (e) {
    console.warn('Fehler beim Erstellen der farbigen Route:', e);
  }
}

/**
 * Zeigt Modal mit Detailinformationen für ein Routen-Segment
 * @param {number} segIdx - Segment-Index
 * @param {Object} segData - Segment-Daten mit Wetter & Warnungen
 */
function showSegmentModal(segIdx, segData) {
  const modal = document.getElementById('segment-modal-overlay');
  if (!modal) return;

  const box = document.getElementById('segment-modal-box');
  if (!box) return;

  const wx = segData.weather;
  const tempLabel = wx?.temperature_2m !== null 
    ? `${Math.round(wx.temperature_2m)}°C` 
    : '–';
  const windLabel = `${Math.round(wx?.wind_speed_10m ?? 0)} km/h`;
  const gustLabel = `${Math.round(wx?.wind_gusts_10m ?? 0)} km/h`;
  const rainLabel = `${(wx?.precipitation ?? 0).toFixed(2)} mm/h`;
  const info = wmoInfo(wx?.weathercode ?? 0, wx?.is_day ?? 1);

  const statusColor = segData.color;
  const statusLabel = segData.level === 'danger' ? 'KRITISCH' : 
                      segData.level === 'caution' ? 'WARNUNG' : 'OK';

  box.innerHTML = `
    <button class="go-modal-close" onclick="closeSegmentModal()">✕</button>
    <div class="segment-modal-content">
      <div class="segment-modal-header">
        <div class="gng-dot" style="background:${statusColor};box-shadow:0 0 14px ${statusColor}"></div>
        <span class="segment-status" style="color:${statusColor}">${statusLabel}</span>
      </div>

      <div class="segment-modal-section">
        <h3>🌦️ Wetterlage</h3>
        <div class="segment-rows">
          <div class="segment-row">
            <span class="segment-lbl">Zustand</span>
            <span style="display:flex;align-items:center;gap:6px">${info.icon} ${info.text}</span>
          </div>
          <div class="segment-row">
            <span class="segment-lbl">Temperatur</span>
            <span>${tempLabel}</span>
          </div>
          <div class="segment-row">
            <span class="segment-lbl">Niederschlag</span>
            <span>${rainLabel}</span>
          </div>
        </div>
      </div>

      <div class="segment-modal-section">
        <h3>💨 Wind & Böen</h3>
        <div class="segment-rows">
          <div class="segment-row">
            <span class="segment-lbl">Wind</span>
            <span>${windLabel}</span>
          </div>
          <div class="segment-row">
            <span class="segment-lbl">Böen</span>
            <span style="color:#FFD700;font-weight:700">${gustLabel}</span>
          </div>
        </div>
      </div>

      <div class="segment-modal-section">
        <h3>🏍️ Fahroberfläche (Grip)</h3>
        <div class="segment-rows">
          <div class="segment-row">
            <span class="segment-lbl">Grip-Score</span>
            <span style="color:${segData.color};font-weight:700;font-size:1.2em">${segData.grip}%</span>
          </div>
        </div>
      </div>

      <div class="segment-modal-section">
        <h3>⚠️ Warnungen & Hinweise</h3>
        <div class="segment-warnings">
          ${segData.warnings.map(w => `<div class="segment-warning-item">${w}</div>`).join('')}
        </div>
      </div>

      <button class="route-btn primary" style="width:100%;margin-top:12px" onclick="closeSegmentModal()">Schließen</button>
    </div>`;

  modal.classList.add('open');
}

/**
 * Schließt das Segment-Modal
 */
function closeSegmentModal() {
  const modal = document.getElementById('segment-modal-overlay');
  if (modal) modal.classList.remove('open');
}

// ── GRIP-HEATMAP PUNKT MODALS ────────────────────────────

/**
 * Zeigt Modal mit Details für einen Grip-Heatmap-Punkt
 * Lädt auch OSM-Straßenverhältnisse asynchron
 * @param {number} lat, lng - Koordinaten des Punkts
 * @param {Object} pointData - {grip, temp, rain, wind, weatherCondition}
 */
async function showGripPointModal(lat, lng, pointData) {
  const modal = document.getElementById('grip-point-modal-overlay');
  const box = document.getElementById('grip-point-modal-box');
  if (!modal || !box) return;

  // Initialer Content mit Ladenanzeige
  box.innerHTML = `
    <button class="go-modal-close" onclick="closeGripPointModal()">✕</button>
    <div class="grip-point-modal-content">
      <div class="grip-point-header">
        <span class="grip-point-coords">📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}</span>
      </div>
      <div class="loading-spinner">Straßenverhältnisse werden ermittelt…</div>
    </div>`;

  modal.classList.add('open');

  // Straßenverhältnisse parallel laden
  try {
    const streetInfo = await fetchStreetSurfaceInfo(lat, lng);
    
    // Grip-Farbe & Status bestimmen
    const gripColor = pointData.grip >= 65 ? '#22C55E' :
                      pointData.grip >= 45 ? '#FFB800' : '#FF3355';
    const gripStatus = pointData.grip >= 65 ? 'GUT' :
                       pointData.grip >= 45 ? 'VORSICHT' : 'KRITISCH';

    // Modal mit allen Infos aktualisieren
    box.innerHTML = `
      <button class="go-modal-close" onclick="closeGripPointModal()">✕</button>
      <div class="grip-point-modal-content">
        <div class="grip-point-header">
          <span class="grip-point-coords">📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}</span>
        </div>

        <div class="grip-point-section">
          <h3>🏍️ Grip-Status</h3>
          <div class="grip-point-status-bar">
            <div class="grip-point-dot" style="background:${gripColor};box-shadow:0 0 12px ${gripColor}"></div>
            <span style="color:${gripColor};font-weight:700;font-size:1.1em">${gripStatus}</span>
          </div>
          <div class="grip-point-score">Grip-Index: <strong style="color:${gripColor};font-size:1.3em">${pointData.grip}%</strong></div>
        </div>

        <div class="grip-point-section">
          <h3>🌦️ Wetterverhältnisse</h3>
          <div class="grip-point-rows">
            <div class="grip-point-row">
              <span class="grip-label">Temperatur</span>
              <span>${pointData.temp}°C</span>
            </div>
            <div class="grip-point-row">
              <span class="grip-label">Niederschlag</span>
              <span>${pointData.rain.toFixed(2)} mm/h</span>
            </div>
            <div class="grip-point-row">
              <span class="grip-label">Wind</span>
              <span>${Math.round(pointData.wind)} km/h</span>
            </div>
            <div class="grip-point-row">
              <span class="grip-label">Zustand</span>
              <span style="font-weight:700">${pointData.weatherCondition}</span>
            </div>
          </div>
        </div>

        <div class="grip-point-section">
          <h3>🛣️ Straßenverhältnisse</h3>
          <div class="grip-point-surface-info">
            <div class="surface-item">
              <span class="surface-label">Oberflächentyp</span>
              <span class="surface-value">${streetInfo.surface}</span>
            </div>
            <div class="surface-item">
              <span class="surface-label">Zustand</span>
              <span class="surface-value">${streetInfo.smoothness}</span>
            </div>
            <div class="surface-item">
              <span class="surface-label">Straßenklasse</span>
              <span class="surface-value">${streetInfo.highway}</span>
            </div>
          </div>
          <div class="surface-notes">
            <strong>ℹ️ Hinweise:</strong><br>
            ${streetInfo.notes}
          </div>
        </div>

        <button class="route-btn primary" style="width:100%;margin-top:12px" onclick="closeGripPointModal()">Schließen</button>
      </div>`;

  } catch (e) {
    console.warn('Fehler beim Laden der Straßenverhältnisse:', e);
    // Grip-Daten sind bekannt – trotzdem anzeigen, nur Straßeninfo fehlt
    const gripColor = pointData.grip >= 65 ? '#22C55E' :
                      pointData.grip >= 45 ? '#FFB800' : '#FF3355';
    const gripStatus = pointData.grip >= 65 ? 'GUT' :
                       pointData.grip >= 45 ? 'VORSICHT' : 'KRITISCH';
    box.innerHTML = `
      <button class="go-modal-close" onclick="closeGripPointModal()">✕</button>
      <div class="grip-point-modal-content">
        <div class="grip-point-header">
          <span class="grip-point-coords">📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}</span>
        </div>
        <div class="grip-point-section">
          <h3>🏍️ Grip-Status</h3>
          <div class="grip-point-status-bar">
            <div class="grip-point-dot" style="background:${gripColor};box-shadow:0 0 12px ${gripColor}"></div>
            <span style="color:${gripColor};font-weight:700;font-size:1.1em">${gripStatus}</span>
          </div>
          <div class="grip-point-score">Grip-Index: <strong style="color:${gripColor};font-size:1.3em">${pointData.grip}%</strong></div>
        </div>
        <div class="grip-point-section">
          <h3>🌦️ Wetterverhältnisse</h3>
          <div class="grip-point-rows">
            <div class="grip-point-row"><span class="grip-label">Temperatur</span><span>${pointData.temp}°C</span></div>
            <div class="grip-point-row"><span class="grip-label">Niederschlag</span><span>${pointData.rain.toFixed(2)} mm/h</span></div>
            <div class="grip-point-row"><span class="grip-label">Wind</span><span>${Math.round(pointData.wind)} km/h</span></div>
            <div class="grip-point-row"><span class="grip-label">Zustand</span><span style="font-weight:700">${pointData.weatherCondition}</span></div>
          </div>
        </div>
        <div class="grip-point-section">
          <h3>🛣️ Straßenverhältnisse</h3>
          <p style="font-size:0.85rem;color:var(--text-mid)">⚠️ Straßendaten konnten nicht geladen werden.</p>
        </div>
        <button class="route-btn primary" style="width:100%;margin-top:12px" onclick="closeGripPointModal()">Schließen</button>
      </div>`;
  }
}

/**
 * Schließt das Grip-Punkt-Modal
 */
function closeGripPointModal() {
  const modal = document.getElementById('grip-point-modal-overlay');
  if (modal) modal.classList.remove('open');
}

/**
 * Ruft OSM/Overpass-Daten ab für Straßenoberfläche an einer Koordinate.
 * Wenn der Punkt auf einem Waldweg, Gewässer oder unzugänglichem Gelände liegt,
 * wird er automatisch auf die nächste befestigte Straße verschoben (Snap-to-Road).
 * @param {number} lat, lng
 * @returns {Promise<Object>} - {surface, smoothness, highway, notes}
 */

// Straßentypen, die für Motorräder nicht geeignet sind
const UNSUITABLE_HIGHWAY_TYPES = new Set([
  'track', 'path', 'footway', 'bridleway', 'cycleway',
  'steps', 'pedestrian', 'construction', 'corridor'
]);

async function fetchStreetSurfaceInfo(lat, lng) {
  try {
    // Überweise-Abfrage: Straßen in 80m Radius
    const query = `[out:json][timeout:5];(way["highway"](around:80,${lat},${lng}););out tags;`;

    const resp = await fetch(APP.overpass, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();

    if (!data.elements || data.elements.length === 0) {
      // Kein Weg gefunden → Snap auf nächste befahrbare Straße
      return await snapToNearestRoad(lat, lng, 'no_road');
    }

    // Bevorzuge geeignete Straßen (asphalt/primary/secondary etc.)
    const bestWay = data.elements.find(el =>
      el.tags && !UNSUITABLE_HIGHWAY_TYPES.has(el.tags.highway)
    ) || data.elements.find(el => el.tags);

    if (!bestWay?.tags) return getDefaultStreetInfo();

    const tags = bestWay.tags;

    // Wenn Waldweg/Pfad/ungeeignet → Snap auf nächste taugliche Straße
    if (UNSUITABLE_HIGHWAY_TYPES.has(tags.highway)) {
      return await snapToNearestRoad(lat, lng, tags.highway);
    }

    const surface    = getSurfaceText(tags.surface);
    const smoothness = getSmoothnessText(tags.smoothness);
    const highway    = getHighwayClass(tags.highway);
    const notes      = generateSurfaceNotes(tags.surface, tags.smoothness, tags.highway);

    return { surface, smoothness, highway, notes };
  } catch (e) {
    console.warn('Overpass API Fehler:', e);
    return getDefaultStreetInfo();
  }
}

/**
 * Sucht nächste befahrbare Straße in 400m Radius (Snap-to-Road).
 * Berücksichtigt Waldwege, Gewässer und unzugängliches Gelände.
 * @param {number} lat, lng
 * @param {string} reason – Warum gesnapped wird ('track', 'no_road', etc.)
 */
async function snapToNearestRoad(lat, lng, reason = 'unknown') {
  try {
    // Bevorzuge: befestigte Straßen, Brücken, Fähren; schließe Waldwege/Pfade aus
    const query = `[out:json][timeout:8];(
      way["highway"]["highway"!~"^(track|path|footway|bridleway|cycleway|steps|pedestrian|construction|corridor)$"](around:400,${lat},${lng});
      way["route"="ferry"](around:400,${lat},${lng});
      way["man_made"="bridge"](around:400,${lat},${lng});
    );out tags 1;`;

    const resp = await fetch(APP.overpass, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();

    if (!data.elements?.length) return getDefaultStreetInfo();

    const way = data.elements.find(el => el.tags);
    if (!way?.tags) return getDefaultStreetInfo();

    const tags     = way.tags;
    const isFerry  = tags.route === 'ferry';
    const isBridge = tags.man_made === 'bridge';

    // Snap-Hinweis je nach Ursache
    let snapNote;
    if (isFerry)  {
      snapNote = '• ⛴️ Fähre: Grip-Daten von nächster Fährlinie\n';
    } else if (isBridge) {
      snapNote = '• 🌉 Brücke: Grip-Daten von nächster Brücke\n';
    } else if (reason === 'track' || reason === 'path') {
      snapNote = '• 🌲 Gripposition auf Waldweg – verschoben auf nächste Straße\n';
    } else if (reason === 'no_road') {
      snapNote = '• 📍 Kein Weg gefunden – Grip-Daten von nächster befahrbarer Straße\n';
    } else {
      snapNote = '• 📍 Gripposition automatisch auf nächste befahrbare Straße verschoben\n';
    }

    const surface    = getSurfaceText(tags.surface);
    const smoothness = getSmoothnessText(tags.smoothness);
    const highway    = isFerry ? '⛴️ Fähre' : isBridge ? '🌉 Brücke' : getHighwayClass(tags.highway);
    const notes      = snapNote + generateSurfaceNotes(tags.surface, tags.smoothness, tags.highway);

    return { surface, smoothness, highway, notes };
  } catch (e) {
    console.warn('Snap-to-Road Fehler:', e);
    return getDefaultStreetInfo();
  }
}

/**
 * Konvertiert OSM Surface-Tag zu lesbarem Text
 */
function getSurfaceText(surface) {
  if (!surface) return 'Unbekannt';
  
  const map = {
    'asphalt': '🟫 Asphalt',
    'concrete': '⬜ Beton',
    'paving_stones': '🔲 Pflastersteine',
    'paved': '🟫 Gepflastert',
    'gravel': '🟤 Schotter',
    'dirt': '🟫 Erdreich',
    'unpaved': '🟫 Unbefestigt',
    'compacted': '🟫 Verdichtet',
    'sand': '🟨 Sand',
    'ground': '🟫 Boden'
  };
  return map[surface] || `🟫 ${surface}`;
}

/**
 * Konvertiert OSM Smoothness-Tag zu lesbarem Text
 */
function getSmoothnessText(smoothness) {
  if (!smoothness) return 'Nicht ermittelt';
  
  const map = {
    'excellent': '✅ Ausgezeichnet',
    'good': '✅ Gut',
    'intermediate': '⚠️ Mittelmäßig',
    'bad': '⚠️ Schlecht',
    'very_bad': '❌ Sehr schlecht',
    'horrible': '❌ Furchtbar',
    'impassable': '❌ Unpassierbar'
  };
  return map[smoothness] || `⚠️ ${smoothness}`;
}

/**
 * Klassifiziert Straßentyp nach OSM Highway-Tag
 */
function getHighwayClass(highway) {
  if (!highway) return 'Unbekannt';
  
  const map = {
    'motorway': '🛣️ Autobahn',
    'trunk': '🛣️ Bundesstraße',
    'primary': '🟨 Hauptstraße',
    'secondary': '🟩 Nebenstraße',
    'tertiary': '🟩 Straße',
    'residential': '🏘️ Wohngebiet',
    'unclassified': '🟽 Ungeclassifiziert',
    'service': '🔧 Service',
    'track': '⛰️ Waldweg',
    'path': '🥾 Pfad'
  };
  return map[highway] || `🛣️ ${highway}`;
}

/**
 * Generiert spezifische Fahrhinweise basierend auf Straßenoberfläche
 */
function generateSurfaceNotes(surface, smoothness, highway) {
  const notes = [];

  if (surface === 'gravel' || surface === 'unpaved') {
    notes.push('• Unbefestigte Straße: Reduzierte Bodenhaftung bei Nässe');
    notes.push('• Vorsicht bei Brems- und Kurvenfahrten');
  }

  if (smoothness === 'bad' || smoothness === 'very_bad' || smoothness === 'horrible') {
    notes.push('• Straße mit Schäden/Rillen: Rutschgefahr');
    notes.push('• Langsamer fahren und Bodenkontakt beobachten');
  }

  if (highway === 'track' || highway === 'path') {
    notes.push('• Unbefestigter Waldweg/Pfad');
    notes.push('• Gering für Motorräder geeignet');
  }

  if (surface === 'sand' || surface === 'dirt') {
    notes.push('• Lockerer Untergrund: Minimale Bodenhaftung');
    notes.push('• Fahrzeug kann durchrutschen');
  }

  if (notes.length === 0) {
    notes.push('• Straße in gutem Zustand');
    notes.push('• Normal Grip-Verhältnisse');
  }

  return notes.join('\n');
}

/**
 * Fallback bei OSM-Daten nicht verfügbar
 */
function getDefaultStreetInfo() {
  return {
    surface: 'Nicht ermittelt',
    smoothness: 'Nicht ermittelt',
    highway: 'Unbekannt',
    notes: '• Straßenverhältnisse können nicht ermittelt werden\n• Nutze allgemeine Vorsichtsmaßnahmen'
  };
}

// ── PERFORMANCE MONITORING ──────────────────────────────

/**
 * Gibt Performance-Statistiken der Grip-Heatmap aus
 * Hilfreich zur Performance-Überwachung und Debugging
 */
function getGripHeatmapStats() {
  return {
    ...gripHeatmapPerformance,
    dataSize: Object.keys(gripHeatmapData).length,
    lastUpdate: new Date().toLocaleTimeString('de')
  };
}

/**
 * Zeigt Grip-Heatmap Performance-Infos in der Browser-Konsole an
 */
function logGripHeatmapPerformance() {
  const stats = getGripHeatmapStats();
  console.table({
    'Modus': stats.mode,
    'Punkte': stats.pointCount,
    'Zoom-Level': stats.zoomLevel,
    'Render-Zeit (ms)': stats.renderTime,
    'Memory (KB)': stats.memoryUsage,
    'Daten-Einträge': stats.dataSize
  });
}