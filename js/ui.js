'use strict';
// ── TourCast ui.js – Tabs, Modals, Toast, Sheet, Layer-Switcher, Settings ──
console.log('📦 ui.js loaded successfully');

let activeTab   = 'route';
let sheetOpen   = false; // Keep sheetOpen for bottom sheet

// ── Planner Panel Toggle ──────────────────────────────────
function toggleRoutePanel() {
  const panel = document.getElementById('route-panel');
  const btn   = document.getElementById('btn-nav-toggle');
  if (!panel) return;

  const isHidden = panel.classList.toggle('panel-hidden');
  
  if (btn) {
    // Button ist aktiv, wenn das Panel NICHT versteckt ist
    btn.classList.toggle('active', !isHidden);
  }
}

function showRoutePanel() {
  document.getElementById('route-panel')?.classList.remove('panel-hidden');
  const btn = document.getElementById('btn-nav-toggle');
  if (btn) btn.classList.add('active');
  // Ensure the correct tab is rendered when showing the panel
  switchTab(activeTab);
}

function hideRoutePanel() {
  document.getElementById('route-panel')?.classList.add('panel-hidden');
  const btn = document.getElementById('btn-nav-toggle');
  if (btn) btn.classList.remove('active');
}

// ── Tab-Navigation ────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  // Mapping: Sowohl 'route' als auch 'roundtrip' nutzen den Container 'tab-route'
  const targetPanelId = (tab === 'route' || tab === 'roundtrip') ? 'tab-route' : `tab-${tab}`;

  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === targetPanelId);
  });

  // Planner Modus synchronisieren
  if (tab === 'route' && typeof setPlannerMode === 'function') {
    setPlannerMode('ab');
  } else if (tab === 'roundtrip' && typeof setPlannerMode === 'function') {
    setPlannerMode('roundtrip');
  }

  // Tab-spezifische Aktionen
  if (tab === 'saved' && typeof renderSavedRoutesList === 'function') renderSavedRoutesList();
  if ((tab === 'route' || tab === 'roundtrip') && lastRouteCoords.length) {
    renderElevationSVG();
  }

  // Update "Planer" button active state
  const planerBtn = document.getElementById('btn-nav-toggle');
  const isHidden  = document.getElementById('route-panel')?.classList.contains('panel-hidden');
  if (planerBtn) planerBtn.classList.toggle('active', !isHidden && (activeTab === 'route' || activeTab === 'roundtrip'));
}

function renderTabs() {
  const bar = document.getElementById('tab-bar');
  if (!bar) return;
  const tabs = [
    { id: 'route',   label: 'ROUTE' },
    { id: 'roundtrip', label: 'RUNDTOUR' },
    { id: 'saved',   label: 'ARCHIV' }
  ];
  bar.innerHTML = tabs.map(t => `
    <button class="tab-btn${t.id === activeTab ? ' active' : ''}"
            data-tab="${t.id}" onclick="switchTab('${t.id}')">
      <span class="tab-lbl">${t.label}</span>
    </button>`).join('');
}

// ── Bottom Sheet ──────────────────────────────────────────
function toggleSheet() {
  sheetOpen = !sheetOpen;
  document.getElementById('bottom-sheet')?.classList.toggle('open', sheetOpen);
  if (sheetOpen) hideRoutePanel(); else showRoutePanel();
}

function openSheet() {
  sheetOpen = true;
  document.getElementById('bottom-sheet')?.classList.add('open');
  hideRoutePanel();
}

function closeSheet() {
  sheetOpen = false;
  document.getElementById('bottom-sheet')?.classList.remove('open');
  showRoutePanel();
}

// ── Layer-Switcher ─────────────────────────────────────────
let activeLayer = null;

function switchLayer(layer, btn) {
  if (!map) return;

  const isToggleOff = (activeLayer === layer);
  activeLayer = isToggleOff ? null : layer;

  // Nav-Buttons
  document.querySelectorAll('[data-layer]').forEach(b => {
    b.classList.toggle('active', !isToggleOff && b.dataset.layer === layer);
  });

  // Panel-Sichtbarkeit
  const panels = {
    radar:     'radar-badge',
    grip:      null,
    sun:       'env-panel'
  };

  // Alle schließen
  Object.values(panels).filter(Boolean).forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });
  document.getElementById('grip-legend')   ?.classList.add('hidden');
  document.getElementById('grip-time-bar') ?.classList.add('hidden');

  // Radius-Kreis immer ausblenden – wird nur im Grip-Modus gezeigt
  if (typeof hideRadiusCircle === 'function') hideRadiusCircle();

  if (isToggleOff) {
    stopRadarAnimation();
    if (map && map.hasLayer(S.gripGroup)) map.removeLayer(S.gripGroup);
    return;
  }

  // Aktiven öffnen
  if (layer === 'radar') {
    if (profile.lowDataMode) {
      showToast('ℹ️ Low-Data-Mode: Radar deaktiviert');
      return;
    }
    // Safety check: Map muss bereit sein
    if (!map || !map._container || !S.radarGroup) {
      showToast('⚠️ Karte wird noch geladen... Bitte warten', 'info');
      return;
    }
    loadRadar();
    document.getElementById('radar-badge')?.classList.remove('hidden');
    loadSatFallback(); // Load satellite layer for radar panel
    startRadarAnimation();
  }
  if (layer === 'grip') {
    document.getElementById('grip-legend')   ?.classList.remove('hidden');
    document.getElementById('grip-time-bar') ?.classList.remove('hidden');
    S.gripGroup?.addTo(map);
    // Radius-Kreis nur in Grip-Ansicht anzeigen
    if (typeof updateRadiusCircle === 'function') updateRadiusCircle();
    
    // Heatmap sofort aufbauen, falls Wetterdaten da sind
    if (typeof currentWeather !== 'undefined' && currentWeather?.hourly) {
      const ci = currentHourIndex(currentWeather);
      buildGripHeatmap(currentLat, currentLng, currentWeather.hourly, ci);
    }
  } else {
    if (map &&map.hasLayer?.(S.gripGroup)) map.removeLayer(S.gripGroup);
  }
  if (layer === 'sun') {
    document.getElementById('env-panel')?.classList.remove('hidden');
    loadSatFallback(); // Load satellite layer for sun panel
    updateSunPanel();
  }
}

// ── Go/No-Go Modal (Status-Bubble Tap) ───────────────────
function openGoModal() {
  const wx  = currentWeather;
  const box = document.getElementById('go-modal-box');
  if (!box || !wx) return;

  const gng    = calcGoNoGo(wx);
  const grip   = gripLabel(gng.grip);
  const dotClr = gng.color;
  const info   = wmoInfo(wx.weathercode, wx.is_day);

  box.innerHTML = `
    <button class="go-modal-close" onclick="closeGoModal()">✕</button>
    <div class="gng-popup">
      <div class="gng-header">
        <div class="gng-dot" style="background:${dotClr};box-shadow:0 0 14px ${dotClr}"></div>
        <span class="gng-status-text" style="color:${dotClr}">
          STATUS: ${gng.label}
        </span>
      </div>
      <div class="gng-reasons">
        ${gng.reasons.map(r =>
          `<div class="gng-reason">
             <span class="status-indicator"></span>
             <span>${r.text}</span>
           </div>`).join('')}
      </div>
      <div class="gng-divider"></div>
      <div class="gng-meta">
        <div class="gng-meta-row">Wetter
          <span style="display:flex;align-items:center;gap:4px">${info.icon} ${info.text}</span>
        </div>
        <div class="gng-meta-row">Temperatur
          <span>${wx.temperature_2m !== null ? Math.round(wx.temperature_2m) + ' °C' : '–'}</span>
        </div>
        <div class="gng-meta-row">Gefühlt
          <span>${wx.apparent_temperature !== null
            ? Math.round(wx.apparent_temperature) + ' °C' : '–'}</span>
        </div>
        <div class="gng-meta-row">Wind
          <span>${Math.round(wx.wind_speed_10m)} km/h ${windDirArrow(wx.wind_direction_10m)}</span>
        </div>
        ${wx.wind_gusts_10m > wx.wind_speed_10m + 15 ? `
        <div class="gng-meta-row">Böen
          <span style="color:#FFD700">${Math.round(wx.wind_gusts_10m)} km/h</span>
        </div>` : ''}
        <div class="gng-meta-row">Grip
          <span style="color:${grip.color}">${grip.label} ${gng.grip}%</span>
        </div>
        <div class="gng-meta-row">Niederschlag
          <span>${wx.precipitation} mm/h</span>
        </div>
      </div>
    </div>`;

  document.getElementById('go-modal-overlay')?.classList.add('open');
}

function closeGoModal() {
  document.getElementById('go-modal-overlay')?.classList.remove('open');
}

// Klick außerhalb → schließen
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('go-modal-overlay')?.addEventListener('click', e => {
    if (e.target.id === 'go-modal-overlay') closeGoModal();
  });
});

// ── Status-Bubble updaten ─────────────────────────────────
function updateStatusBubble(wx) {
  if (!wx) return;
  const gng   = calcGoNoGo(wx);
  
  // Zentrales CSS-Variablen Update
  document.documentElement.style.setProperty('--status-clr', gng.color);
  
  const container = document.querySelector('.status-bubble-container');
  const dot       = document.getElementById('go-dot');
  const lbl       = document.getElementById('go-lbl');
  const pill      = document.getElementById('temp-pill');

  if (container) {
    // Klassen für Animationen/Styles umschalten
    container.classList.remove('status-go', 'status-caution', 'status-danger');
    container.classList.add(`status-${gng.status}`);

    // Unwetter-Check: Spezifische WMO-Codes (Starkregen, Gewitter, Hagel) 
    // oder extrem hohe Böen triggern die Formänderung
    const severeWmoCodes = [65, 75, 82, 95, 96, 99];
    const isSevereWeather = severeWmoCodes.includes(wx.weathercode) || 
                            (wx.wind_gusts_10m > 85);

    container.classList.toggle('has-warning', isSevereWeather);
  }

  if (lbl) {
    lbl.textContent = gng.label;
    lbl.style.color = gng.color;
  }
  
  if (pill && wx.temperature_2m !== null) {
    pill.textContent = `${Math.round(wx.temperature_2m)}°C`;
  }

  // Ringe auf der Karte (falls vorhanden) ebenfalls updaten
  document.querySelectorAll('.go-ring').forEach(r => {
    r.style.borderColor = gng.color;
  });

  lastGripScore = gng.grip;
  lastGngStatus = gng.status;

  // Wind-Warnung am Wetter-Button (Global)
  const thr = profile.thresholds || (typeof PROFILE_PRESETS !== 'undefined' ? PROFILE_PRESETS.touring.thresholds : {});
  const hasWindDanger = (wx.wind_speed_10m >= (thr.windDanger || 50)) || 
                        (wx.wind_gusts_10m >= (thr.gustDanger || 80));
  
  const weatherBtn = document.getElementById('nav-btn-weather');
  if (weatherBtn) {
    weatherBtn.classList.toggle('nav-btn-danger', hasWindDanger);
  }
}

// ── Sonne-Panel updaten ───────────────────────────────────
function updateSunPanel() {
  const wx = currentWeather;
  if (!wx || !S.sunData) return;

  const sd = S.sunData;
  const fmt = iso => iso
    ? new Date(iso).toLocaleTimeString('de', { hour:'2-digit', minute:'2-digit' })
    : '–';

  const el = id => {
    const element = document.getElementById(id);
    return element;
  };

  const setTxt = (id, val) => { const e = el(id); if(e) e.textContent = val; };

  setTxt('sp-rise', fmt(sd.sunrise));
  setTxt('sp-set',  fmt(sd.sunset));
  setTxt('sp-gold', fmt(sd.goldenHour));

  // Tages-Extrema
  const tempMax = wx.daily?.temperature_2m_max?.[0];
  const lo = wx.daily?.temperature_2m_min?.[0];
  if (tempMax !== undefined) setTxt('sp-temp-hi', Math.round(tempMax) + '°');
  if (lo !== undefined)      setTxt('sp-temp-lo', Math.round(lo) + '°');

  // Wind & Böen Detail-Warnung
  const wind = wx.wind_speed_10m || 0;
  const gust = wx.wind_gusts_10m || 0;
  const thr  = profile.thresholds || (typeof PROFILE_PRESETS !== 'undefined' ? PROFILE_PRESETS.touring.thresholds : {});
  
  setTxt('sp-wind-combined', `${Math.round(wind)} / ${Math.round(gust)} km/h`);
  
  let windStatus = 'sp-ok';
  let windLabel  = 'NORMAL';
  let isDanger   = false;

  if (wind >= thr.windDanger || gust >= thr.gustDanger) {
    windStatus = 'sp-danger';
    windLabel  = 'GEFAHR!';
    isDanger   = true;
  } else if (wind >= thr.windCaution || gust >= thr.gustCaution) {
    windStatus = 'sp-warn';
    windLabel  = 'VORSICHT';
  }

  const wb = el('sp-wind-badge');
  if (wb) { wb.textContent = windLabel; wb.className = `sp-badge ${windStatus}`; }
  el('sp-wind-warn-icon').style.display = isDanger ? 'inline' : 'none';

  // UV
  const uv = S.uvIndex ?? wx.uv_index ?? 0;
  const ui = uvInfo(uv);
  el('sp-uv')       && (el('sp-uv').textContent        = uv.toFixed(1));
  el('sp-uv-badge') && (el('sp-uv-badge').textContent  = ui.label);
  el('sp-uv-badge') && (el('sp-uv-badge').className    = `sp-badge ${ui.cls}`);

  // Sichtweite
  const visKm = Math.round((wx.visibility ?? 10000) / 1000);
  el('sp-vis')       && (el('sp-vis').textContent        = `${visKm} km`);
  el('sp-vis-badge') && (el('sp-vis-badge').textContent  = visKm < 2 ? 'Nebel!' : visKm < 5 ? 'Eingeschränkt' : 'Gut');
  el('sp-vis-badge') && (el('sp-vis-badge').className    = `sp-badge ${visKm < 5 ? 'sp-warn' : 'sp-ok'}`);

  // Hitzbelastung
  const cloud = S.cloudCover ?? 50;
  const hInfo = heatInfo(wx.temperature_2m ?? 20, cloud);
  el('sp-heat')       && (el('sp-heat').textContent        = `${Math.round(wx.temperature_2m ?? 0)} °C`);
  el('sp-heat-badge') && (el('sp-heat-badge').textContent  = hInfo.label);
  el('sp-heat-badge') && (el('sp-heat-badge').className    = `sp-badge ${hInfo.cls}`);

  // Bekleidungsempfehlung (Windchill-basiert)
  const wcGear = (typeof calcWindchill === 'function') 
    ? calcWindchill(wx.temperature_2m ?? 15, profile.speedKmh || 80)
    : (wx.temperature_2m ?? 15);

  // Windchill Anzeige im Sun-Panel
  el('sp-wc') && (el('sp-wc').textContent = `${Math.round(wcGear)} °C`);
  const wcB = el('sp-wc-badge');
  if (wcB) {
    const diff = (wx.temperature_2m ?? 15) - wcGear;
    if (diff > 8) { wcB.textContent = 'STARK KÜHLEND'; wcB.className = 'sp-badge sp-danger'; }
    else if (diff > 3) { wcB.textContent = 'KÜHLEND'; wcB.className = 'sp-badge sp-warn'; }
    else { wcB.textContent = 'NEUTRAL'; wcB.className = 'sp-badge sp-ok'; }
  }

  let recGear = 'Standard-Kombi';
  if (wcGear < 7)       recGear = 'Winter / Thermo';
  else if (wcGear < 15) recGear = 'Inlay empfohlen';
  else if (wcGear > 24) recGear = 'Sommer / Mesh';
  el('sp-gear') && (el('sp-gear').textContent = recGear);

  // Blendwarnung
  const glare    = glareWarning(sd.sunrise, sd.sunset, cloud);
  const glareRow = document.getElementById('sp-glare-row');
  if (glareRow) glareRow.style.display = glare ? '' : 'none';

  // Sonnenschutz-Tipp
  const tipDiv = document.getElementById('sp-tip');
  const tipDvd = document.getElementById('sp-tip-div');
  if (tipDiv && ui.tip) {
    tipDiv.textContent   = ui.tip;
    tipDiv.style.display = 'block';
    if (tipDvd) tipDvd.style.display = '';
  } else if (tipDiv) {
    tipDiv.style.display = 'none';
    if (tipDvd) tipDvd.style.display = 'none';
  }
}

// ── Export Modal Handling ────────────────────────────────
function openExportModal() {
  if (!lastRouteCoords || lastRouteCoords.length === 0) {
    showToast('⚠️ Zuerst eine Route berechnen!', 'error');
    return;
  }

  // Vorschlag für Tourennamen im Export-Feld setzen
  const nameInput = document.getElementById('gpx-route-name');
  if (nameInput) {
    nameInput.value = typeof buildGPXName === 'function' ? buildGPXName() : 'Meine Tour';
  }

  // TomTom Hilfe Text injizieren (falls Container vorhanden)
  const helpContainer = document.getElementById('export-help-tt');
  if (helpContainer) {
    helpContainer.innerHTML = `
      <div class="tt-help-box">
        <div class="tt-help-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <span>TomTom Rider Sync Hilfe</span>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-mid); line-height: 1.4;">
          Lade die Datei in <strong>TomTom MyDrive</strong> hoch für WLAN-Sync oder kopiere sie per USB in den Ordner <code>GPX2ITN</code>.
        </p>
      </div>
    `;
  }

  openModal('modal-export');
}

// ── Toast ─────────────────────────────────────────────────
let toastTimer = null;

function showToast(msg, type = 'error') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className   = `toast show${type === 'success' ? ' success' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 6000);
}

// ── Hilfe-Modal ───────────────────────────────────────────
function openHelp() {
  document.getElementById('help-overlay')?.classList.add('open');
}

function closeHelp() {
  document.getElementById('help-overlay')?.classList.remove('open');
}

function closeHelpOnBg(e) {
  if (e.target.id === 'help-overlay') closeHelp();
}

function toggleDsgvo() {
  const btn  = document.getElementById('dsgvo-toggle');
  const cont = document.getElementById('dsgvo-content');
  btn ?.classList.toggle('open');
  cont?.classList.toggle('open');
}

// ── Einstellungen-Modal ───────────────────────────────────
function openSettings() {
  closeProfileSettings(); // Reset auf Hauptmenü
  applyProfileToUI();
  document.getElementById('settings-overlay')?.classList.add('open');
}

function openProfileSettings() {
  document.getElementById('settings-menu-main').classList.add('hidden');
  document.getElementById('settings-profile-view').classList.remove('hidden');
  document.getElementById('settings-title').textContent = 'Fahrerprofil';
  if (typeof renderProfileTab === 'function') renderProfileTab();
}

function closeProfileSettings() {
  document.getElementById('settings-menu-main').classList.remove('hidden');
  document.getElementById('settings-profile-view').classList.add('hidden');
  document.getElementById('settings-title').textContent = 'Einstellungen';
}

function openLogsView() {
  document.getElementById('settings-menu-main').classList.add('hidden');
  document.getElementById('settings-logs-view').classList.remove('hidden');
  document.getElementById('settings-title').textContent = 'System Logs';
}

function closeLogsView() {
  document.getElementById('settings-menu-main').classList.remove('hidden');
  document.getElementById('settings-logs-view').classList.add('hidden');
  document.getElementById('settings-title').textContent = 'Einstellungen';
}

function closeSettings() {
  document.getElementById('settings-overlay')?.classList.remove('open');
}

function closeSettingsOnBg(e) {
  if (e.target.id === 'settings-overlay') closeSettings();
}

// ── Profil-Werte → UI synchronisieren ────────────────────
function applyProfileToUI() {
  const el = id => document.getElementById(id);

  // Geschwindigkeit
  const sRange = el('speed-range');
  const sVal   = el('speed-val');
  if (sRange) sRange.value = profile.speedKmh;
  if (sVal)   sVal.textContent = `${profile.speedKmh} km/h`;

  // Radius
  const rRange = el('radius-range');
  const rVal   = el('radius-val');
  if (rRange) rRange.value = profile.radius;
  if (rVal)   rVal.textContent = `${profile.radius} km`;

  // Tank-Reichweite
  const tRange = el('tank-range');
  const tVal   = el('tank-val');
  if (tRange) tRange.value = profile.tankRange;
  if (tVal)   tVal.textContent = `${profile.tankRange} km`;

  // Schriftgröße
  const uiRange = el('ui-scale-range');
  const uiVal   = el('ui-scale-val');
  if (uiRange) uiRange.value = Math.round((profile.uiScale || 1) * 100);
  if (uiVal)   uiVal.textContent = `${Math.round((profile.uiScale || 1) * 100)}%`;

  // Radar-Frames
  const rfRange = el('radar-frames-range');
  const rfVal   = el('radar-frames-val');
  if (rfRange) rfRange.value = profile.radarFrames ?? 6;
  if (rfVal)   rfVal.textContent = `${profile.radarFrames ?? 6}`;
}

// ── Profil-Slider-Handler ─────────────────────────────────
function onSpeedChange(val) {
  profile.speedKmh = parseInt(val);
  const el = document.getElementById('speed-val');
  if (el) el.textContent = `${profile.speedKmh} km/h`;
  saveProfile();
}

function onRadiusChange(val) {
  profile.radius = parseInt(val);
  const el = document.getElementById('radius-val');
  if (el) el.textContent = `${profile.radius} km`;
  APP.RADIUSKM = profile.radius;
  // Nur im Grip-Modus den Radius-Kreis aktualisieren
  if (activeLayer === 'grip') updateRadiusCircle();
  saveProfile();
}

function onTankChange(val) {
  profile.tankRange = parseInt(val);
  const el = document.getElementById('tank-val');
  if (el) el.textContent = `${profile.tankRange} km`;
  saveProfile();
}

function onUiScaleChange(val) {
  const scale = parseInt(val) / 100;
  profile.uiScale = scale;
  document.documentElement.style.setProperty('--ui-scale', scale);
  const el = document.getElementById('ui-scale-val');
  if (el) el.textContent = `${val}%`;
  saveProfile();
}

function onRadarFramesChange(val) {
  profile.radarFrames = parseInt(val);
  const el = document.getElementById('radar-frames-val');
  if (el) el.textContent = `${val}`;
  saveProfile();
}

function onLowDataModeChange(val) {
  profile.lowDataMode = val;
  if (val) {
    // Radar stoppen
    stopRadarAnimation();
    if (activeLayer === 'radar') switchLayer('radar'); 

    // Alle aktiven POIs außer Tankstellen entfernen
    if (typeof POI_TYPES !== 'undefined' && typeof activePOITypes !== 'undefined') {
      Object.keys(POI_TYPES).forEach(type => {
        if (type !== 'fuel' && activePOITypes.has(type)) {
        togglePOI(type);
      }
      });
    }
  }
  saveProfile();
  renderProfileTab();
}

function setTheme(theme) {
  profile.theme = 'light';
  applyTheme('light');
  saveProfile();
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = 'light';
  
  // Force Light-Mode CSS
  root.style.setProperty('color-scheme', 'light', 'important');
  root.style.setProperty('--bg', '#EEF2F7', 'important');
  root.style.setProperty('--surface', '#FFFFFF', 'important');
  root.style.setProperty('--text', '#2D3E50', 'important');
  root.style.setProperty('--text-secondary', '#6B788A', 'important');
  root.style.setProperty('--accent', '#D35400', 'important');
  root.style.setProperty('--border', '#D0D8E0', 'important');
  root.style.setProperty('--shadow-light', 'rgba(0,0,0,0.04)', 'important');
  root.style.setProperty('--shadow-medium', 'rgba(0,0,0,0.08)', 'important');
  root.style.setProperty('--shadow-dark', 'rgba(0,0,0,0.16)', 'important');
  
  // Force Light-Mode on body
  document.body.style.setProperty('background-color', '#EEF2F7', 'important');
  document.body.style.setProperty('color', '#2D3E50', 'important');
}

// ── Route-Profil-Panel (Tab: Profil) ─────────────────────
function renderProfileTab() {
  const panel = document.getElementById('profile-settings-content');
  if (!panel) return;

  panel.innerHTML = `
    <div class="route-section-title">Fahrzeug & Tour</div>

    <!-- Reisegeschwindigkeit -->
    <div class="sett-row" style="padding:10px 14px 0">
      <span class="sett-label">Reisegeschwindigkeit</span>
      <span class="sett-val" id="speed-val">${profile.speedKmh} km/h</span>
    </div>
    <div class="range-wrap" style="padding:6px 14px 12px">
      <span class="range-a">60</span>
      <input type="range" id="speed-range" class="tc-range"
             min="60" max="180" step="5" value="${profile.speedKmh}"
             oninput="onSpeedChange(this.value)">
      <span class="range-a">180</span>
    </div>

    <!-- Aktionsradius -->
    <div class="sett-row" style="padding:4px 14px 0">
      <span class="sett-label">Aktionsradius</span>
      <span class="sett-val" id="radius-val">${profile.radius} km</span>
    </div>
    <div class="range-wrap" style="padding:6px 14px 12px">
      <span class="range-a">50</span>
      <input type="range" id="radius-range" class="tc-range"
             min="50" max="300" step="25" value="${profile.radius}"
             oninput="onRadiusChange(this.value)">
      <span class="range-a">300</span>
    </div>

    <!-- Tank-Reichweite -->
    <div class="sett-row" style="padding:4px 14px 0">
      <span class="sett-label">Tank-Reichweite</span>
      <span class="sett-val" id="tank-val">${profile.tankRange} km</span>
    </div>
    <div class="range-wrap" style="padding:6px 14px 20px">
      <span class="range-a">100</span>
      <input type="range" id="tank-range" class="tc-range"
             min="100" max="600" step="25" value="${profile.tankRange}"
             oninput="onTankChange(this.value)">
      <span class="range-a">600</span>
    </div>

    <div class="sheet-sep"></div>

    <!-- Darstellung -->
    <div class="route-section-title" style="margin-top:10px">Darstellung</div>

    <div class="sett-row" style="padding:10px 14px 4px">
      <span class="sett-label">Low-Data-Mode</span>
    </div>
    <div style="padding:0 14px 10px">
      <div class="theme-seg">
        <button class="seg-btn${profile.lowDataMode ? ' active' : ''}"
                onclick="onLowDataModeChange(true)">An</button>
        <button class="seg-btn${!profile.lowDataMode ? ' active' : ''}"
                onclick="onLowDataModeChange(false)">Aus</button>
      </div>
    </div>

    <div class="sett-row" style="padding:4px 14px 0">
      <span class="sett-label">Schriftgröße</span>
      <span class="sett-val" id="ui-scale-val">${Math.round((profile.uiScale||1)*100)}%</span>
    </div>
    <div class="range-wrap" style="padding:6px 14px 20px">
      <span class="range-a">80</span>
      <input type="range" id="ui-scale-range" class="tc-range"
             min="80" max="130" step="5"
             value="${Math.round((profile.uiScale||1)*100)}"
             oninput="onUiScaleChange(this.value)">
      <span class="range-a">130</span>
    </div>
  `;
}

// ── Generic Modal Helper ──────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open');    }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

// ── Log-Fenster öffnen ────────────────────────────────────
async function openLogWindow() {
  try {
    await window.electronAPI?.openLogWindow();
  } catch (err) {
    console.error('Fehler beim Öffnen des Log-Fensters:', err);
    showToast('❌ Log-Fenster konnte nicht geöffnet werden', 'error');
  }
}

// ── Manuelles Refresh ─────────────────────────────────────
function manualRefresh() {
  const btn = document.getElementById('refresh-btn');
  btn?.classList.add('spinning');
  weatherCache = {};
  initApp().finally(() => {
    setTimeout(() => btn?.classList.remove('spinning'), 800);
  });
}

// ── Version in UI eintragen ───────────────────────────────
function setVersionLabels() {
  const v = APP.VERSION || 'v1.0.0';
  ['ld-ver', 'help-ver'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  });
}

// ── Radius-Kreis auf Karte ────────────────────────────────
// radiusCircle → map.js

function updateRadiusCircle() {
  if (!map) return;  // Guard: Karte nicht initialisiert
  if (radiusCircle) map.removeLayer(radiusCircle);
  if (!currentLat || !currentLng) return;
  radiusCircle = L.circle([currentLat, currentLng], {
    radius:      (profile.radius || 150) * 1000,
    color:       '#FF6200',
    weight:      1,
    dashArray:   '6 4',
    fillOpacity: 0,
    interactive: false
  }).addTo(map);
}

// ══════════════════════════════════════════════════════════
// ERGÄNZUNGEN SPRINT 2 – fehlende Hilfsfunktionen
// ══════════════════════════════════════════════════════════

// ── Modal Background-Click ────────────────────────────────
function closeModalOnBg(event, id) {
  if (event.target === event.currentTarget) closeModal(id);
}

// ── Route speichern – Prompt / Confirm ───────────────────
function promptSaveRoute() {
  const input = document.getElementById('save-route-name');
  if (input) input.value = '';
  openModal('modal-save-route');
}

function confirmSaveRoute() {
  const name = document.getElementById('save-route-name')?.value.trim();
  saveRoute(name || null);
  closeModal('modal-save-route');
}

// ── HTML escapen ──────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g, '&#39;');
}

/** Hilfsfunktion: Windrichtung als Pfeil */
function windDirArrow(deg) {
  if (deg === undefined || deg === null) return '';
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  return arrows[Math.round(deg / 45) % 8];
}
