'use strict';
// ── TourCast profile.js – Presets, Tank, Verbrauch, Go/No-Go Schwellenwerte ──
// Must-Have:
//   ✅ 3 Presets + alle Schwellenwerte individuell
//   ✅ Tankinhalt, Verbrauch, Reserve einstellbar
//   ✅ Auto-Reichweite + Tankwarnung
//
// Ladereihenfolge: nach ui.js und app.js → überschreibt renderProfileTab(),
// calcGoNoGo(), applyProfileToUI() und loadProfile()

let _thresholdsExpanded = false; // State für die einklappbare Sektion
let _tankExpanded = false;       // State für Tank & Reichweite
let _uiExpanded = false;         // State für Darstellung

// ── profile-Objekt erweitern ──────────────────────────────
// (profile ist const in app.js – mutation via Object.assign ist erlaubt)
if (typeof profile === 'undefined') { window.profile = {}; }
Object.assign(profile, {
  tankVolumeLiters:  18,
  consumptionL100km: 5.5,
  reserveLiters:     3.0,
  routingPreference: 'standard',    // 'direct' | 'standard' | 'winding'
  lowDataMode:       false,
  preset:            'touring',
  thresholds: {
    tempDanger:   5,
    tempCaution:  12,
    windDanger:   50,
    windCaution:  30,
    rainDanger:   2.0,
    rainCaution:  0.5,
    gustDanger:   80,
    gustCaution:  60,
    gripDanger:   25,
    gripCaution:  45
  }
});

// ── Auto-Reichweite berechnen ─────────────────────────────
function calcAutoRange() {
  const usable = Math.max(
    0,
    (profile.tankVolumeLiters  || 18) -
    (profile.reserveLiters     || 3)
  );
  const range = Math.round(
    (usable / (profile.consumptionL100km || 5.5)) * 100
  );
  profile.tankRange = range;   // routing.js + poi.js lesen diesen Wert
  return range;
}

// ── Preset anwenden ───────────────────────────────────────
function applyPreset(presetKey) {
  const p = PROFILE_PRESETS[presetKey];
  if (!p) return;

  profile.preset            = presetKey;
  profile.speedKmh          = p.speedKmh;
  
  // TANK UND VERBRAUCH BLEIBEN UNVERÄNDERT (Entkoppelt von Presets)
  // Nur wetterabhängige Schwellenwerte werden übernommen
  Object.assign(profile.thresholds, p.thresholds);

  calcAutoRange();
  saveProfile();
  renderProfileTab();
  applyProfileToUI();

  showToast(`Profil „${p.label}" geladen`, 2000);
}

// ── Tankwarnung ───────────────────────────────────────────
function checkTankWarning(distKm) {
  const range = calcAutoRange();
  const warn  = document.getElementById('route-tank-warn');
  if (!warn) return;

  if (distKm > range) {
    warn.innerHTML     = `⛽ Tankwarnung – Route ${distKm.toFixed(0)} km · Reichweite ${range} km · Nachtanken erforderlich!`;
    warn.style.display = '';
    warn.style.color   = '#FF3355';
  } else if (distKm > range * 0.75) {
    warn.innerHTML     = `⛽ Hinweis – Route ${distKm.toFixed(0)} km · Reichweite ${range} km · Reserve beachten`;
    warn.style.display = '';
    warn.style.color   = '#FFD700';
  } else {
    warn.style.display = 'none';
  }
}

// ── Routen-Präferenz setzen ──────────────────────────────
function setRoutingPreference(pref) {
  profile.routingPreference = pref;
  document.querySelectorAll('[data-route-pref]').forEach(b => {
    b.classList.toggle('active', b.dataset.routePref === pref);
  });
  saveProfile();
  showToast(`Routen-Charakter: ${pref.toUpperCase()}`, 'info');
}

/** Toggelt die Sichtbarkeit der Schwellenwerte */
window.toggleThresholds = function() {
  _thresholdsExpanded = !_thresholdsExpanded;
  renderProfileTab();
};

/** Toggelt die Sichtbarkeit der Tank-Sektion */
window.toggleTankSection = function() {
  _tankExpanded = !_tankExpanded;
  renderProfileTab();
};

/** Toggelt die Sichtbarkeit der Darstellung-Sektion */
window.toggleUiSection = function() {
  _uiExpanded = !_uiExpanded;
  renderProfileTab();
};

// ── calcGoNoGo überschreiben ──────────────────────────────
// Nutzt profile.thresholds statt hartcodierter Werte (grip.js)
function calcGoNoGo(wx) {
  if (!wx) return {
    color: 'var(--caution)', label: 'CAUTION',
    reasons: [], status: 'caution', grip: 70
  };

  const thr  = profile.thresholds || PROFILE_PRESETS.touring.thresholds;
  const temp = wx.temperature_2m  ?? 15;
  const wind = wx.wind_speed_10m  ?? 0;
  const gust = wx.wind_gusts_10m  ?? 0;
  const rain = wx.precipitation   ?? 0;
  const code = wx.weathercode     ?? 0;
  const grip = calcGripScore(wx);
  const reasons = [];
  let   level   = 'go';

  // ── STOP ─────────────────────────────────────────────
  if (temp < thr.tempDanger) {
    level = 'danger';
    reasons.push({ type: 'temp',
      text: `Temperatur ${temp.toFixed(1)} °C – Grenzwert: ${thr.tempDanger} °C` });
  }
  if (wind > thr.windDanger) {
    level = 'danger';
    reasons.push({ type: 'wind',
      text: `Starkwind ${Math.round(wind)} km/h – Grenzwert: ${thr.windDanger} km/h` });
  }
  if (rain > thr.rainDanger) {
    level = 'danger';
    reasons.push({ type: 'rain',
      text: `Starkregen ${rain.toFixed(1)} mm/h – Grenzwert: ${thr.rainDanger} mm/h` });
  }
  if (gust > thr.gustDanger) {
    level = 'danger';
    reasons.push({ type: 'wind',
      text: `Böen ${Math.round(gust)} km/h – Grenzwert: ${thr.gustDanger} km/h` });
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    level = 'danger';
    reasons.push({ type: 'snow', text: 'Schneefall – Fahrbahn rutschig' });
  }
  if (code >= 95) {
    level = 'danger';
    reasons.push({ type: 'thunder', text: 'Gewitter' });
  }
  if (grip < thr.gripDanger) {
    level = 'danger';
    reasons.push({ type: 'grip',
      text: `Grip ${grip}% – Grenzwert: ${thr.gripDanger}%` });
  }

  // ── CAUTION ───────────────────────────────────────────
  if (level !== 'danger') {
    if (temp >= thr.tempDanger && temp < thr.tempCaution) {
      level = 'caution';
      reasons.push({ type: 'temp',
        text: `Kühle ${temp.toFixed(1)} °C – Grenzwert: ${thr.tempCaution} °C` });
    }
    if (wind >= thr.windCaution && wind <= thr.windDanger) {
      level = 'caution';
      reasons.push({ type: 'wind',
        text: `Wind ${Math.round(wind)} km/h – Grenzwert: ${thr.windCaution} km/h` });
    }
    if (rain >= thr.rainCaution && rain <= thr.rainDanger) {
      level = 'caution';
      reasons.push({ type: 'rain',
        text: `Regen ${rain.toFixed(1)} mm/h – Grenzwert: ${thr.rainCaution} mm/h` });
    }
    if (gust >= thr.gustCaution && gust <= thr.gustDanger) {
      level = 'caution';
      reasons.push({ type: 'wind',
        text: `Böen ${Math.round(gust)} km/h – Grenzwert: ${thr.gustCaution} km/h` });
    }
    if (grip >= thr.gripDanger && grip < thr.gripCaution) {
      level = 'caution';
      reasons.push({ type: 'grip',
        text: `Schmierfilm-Risiko Grip ${grip}% – Grenzwert: ${thr.gripCaution}%` });
    }
  }

  if (level === 'go' && !reasons.length)
    reasons.push({ type: 'go', text: 'Ideale Bedingungen – gute Fahrt!' });

  if (level === 'danger')
    return { color: 'var(--danger)', label: 'NO-GO',   reasons, status: 'danger',  grip };
  if (level === 'caution')
    return { color: 'var(--caution)', label: 'CAUTION', reasons, status: 'caution', grip };
  return     { color: 'var(--go)', label: 'GO',    reasons, status: 'go',      grip };
}

// ── renderProfileTab überschreiben ───────────────────────
/**
 * Rendert das detaillierte Fahrerprofil-Menü.
 */
window.renderProfileTab = function() {
  const container = document.getElementById('profile-settings-content');
  if (!container) return;

  const range = calcAutoRange();
  const t     = profile.thresholds || PROFILE_PRESETS.touring.thresholds;

  container.innerHTML = `

    <!-- Presets -->
    <div class="route-section-title">Fahrerprofil</div>
    <div class="rt-curve-seg" style="margin:4px 14px 14px">
      ${Object.entries(PROFILE_PRESETS).map(([key, p]) => `
        <button class="seg-btn${profile.preset === key ? ' active' : ''}"
                data-preset="${key}" onclick="applyPreset('${key}')">
          ${p.label} 
        </button>`).join('')}
    </div>

    <!-- Routen-Charakter -->
    <div class="route-section-title">Routen-Charakter</div>
    <div class="rt-curve-seg" style="margin:4px 14px 14px">
      <button class="seg-btn${(profile.routingPreference||'standard') === 'direct' ? ' active' : ''}"
              data-route-pref="direct" onclick="setRoutingPreference('direct')">
        DIREKT
      </button>
      <button class="seg-btn${(profile.routingPreference||'standard') === 'standard' ? ' active' : ''}"
              data-route-pref="standard" onclick="setRoutingPreference('standard')">
        STANDARD
      </button>
      <button class="seg-btn${(profile.routingPreference||'standard') === 'winding' ? ' active' : ''}"
              data-route-pref="winding" onclick="setRoutingPreference('winding')">
        KURVIG
      </button>
    </div>

    <!-- Reisegeschwindigkeit -->
    <div class="sett-row" style="padding:4px 14px 0">
      <span class="sett-label">Reisegeschwindigkeit</span>
      <span class="sett-val mono" id="speed-val">${profile.speedKmh} km/h</span>
    </div>
    <div class="range-wrap" style="padding:4px 14px 10px">
      <span class="range-a">60</span>
      <input type="range" id="speed-range" class="tc-range"
             min="60" max="180" step="5" value="${profile.speedKmh}"
             oninput="onSpeedChange(this.value)">
      <span class="range-a">180</span>
    </div>

    <div class="sheet-sep"></div>

    <!-- Tank & Reichweite -->
    <div class="collapsible-trigger ${_tankExpanded ? '' : 'collapsed'}" 
         onclick="toggleTankSection()" 
         style="padding-right: 14px">
      <div class="route-section-title" style="margin-top:8px">Tank &amp; Reichweite</div>
      <span class="chevron-icon">▼</span>
    </div>

    <div class="collapsible-content">
      <div class="sett-row" style="padding:4px 14px 0">
        <span class="sett-label">Tankinhalt</span>
        <span class="sett-val mono" id="tank-vol-val">${profile.tankVolumeLiters} L</span>
      </div>
      <div class="range-wrap" style="padding:4px 14px 8px">
        <span class="range-a">5</span>
        <input type="range" id="tank-vol-range" class="tc-range"
               min="5" max="40" step="0.5" value="${profile.tankVolumeLiters}"
               oninput="onTankVolChange(this.value)">
        <span class="range-a">40</span>
      </div>

      <div class="sett-row" style="padding:4px 14px 0">
        <span class="sett-label">Verbrauch</span>
        <span class="sett-val mono" id="consumption-val">${profile.consumptionL100km} L/100km</span>
      </div>
      <div class="range-wrap" style="padding:4px 14px 8px">
        <span class="range-a">2</span>
        <input type="range" id="consumption-range" class="tc-range"
               min="2" max="15" step="0.1" value="${profile.consumptionL100km}"
               oninput="onConsumptionChange(this.value)">
        <span class="range-a">15</span>
      </div>

      <div class="sett-row" style="padding:4px 14px 0">
        <span class="sett-label">Reserve</span>
        <span class="sett-val mono" id="reserve-val">${profile.reserveLiters} L</span>
      </div>
      <div class="range-wrap" style="padding:4px 14px 8px">
        <span class="range-a">1</span>
        <input type="range" id="reserve-range" class="tc-range"
               min="1" max="10" step="0.5" value="${profile.reserveLiters}"
               oninput="onReserveChange(this.value)">
        <span class="range-a">10</span>
      </div>

      <div class="sett-row" style="padding:4px 14px 14px">
        <span class="sett-label" style="color:var(--text-mid)">
          Auto-Reichweite
        </span>
        <span class="sett-val mono" id="auto-range-val"
              style="color:var(--accent)">${range} km</span>
      </div>
    </div>

    <div class="sheet-sep"></div>

    <!-- Aktionsradius -->
    <div class="route-section-title" style="margin-top:8px">Karte</div>
    <div class="sett-row" style="padding:4px 14px 0">
      <span class="sett-label">Aktionsradius</span>
      <span class="sett-val mono" id="radius-val">${profile.radius} km</span>
    </div>
    <div class="range-wrap" style="padding:4px 14px 14px">
      <span class="range-a">50</span>
      <input type="range" id="radius-range" class="tc-range"
             min="50" max="300" step="25" value="${profile.radius}"
             oninput="onRadiusChange(this.value)">
      <span class="range-a">300</span>
    </div>

    <div class="sheet-sep"></div>

    <!-- Go/No-Go Schwellenwerte -->
    <div class="collapsible-trigger ${_thresholdsExpanded ? '' : 'collapsed'}" 
         onclick="toggleThresholds()" 
         style="padding-right: 14px">
      <div class="route-section-title" style="margin-top:8px">
        Go/No-Go Schwellenwerte
      </div>
      <span class="chevron-icon">▼</span>
    </div>

    <div class="collapsible-content">
      ${renderThresholdRow('Temp. STOP',     'tempDanger',  t.tempDanger,  -10, 15,  1,   '°C'  )}
      ${renderThresholdRow('Temp. Vorsicht', 'tempCaution', t.tempCaution,   0, 25,  1,   '°C'  )}
      ${renderThresholdRow('Wind STOP',      'windDanger',  t.windDanger,   20, 120, 5,   'km/h')}
      ${renderThresholdRow('Wind Vorsicht',  'windCaution', t.windCaution,  10, 80,  5,   'km/h')}
      ${renderThresholdRow('Regen STOP',     'rainDanger',  t.rainDanger,  0.5, 10,  0.5, 'mm/h')}
      ${renderThresholdRow('Regen Vorsicht', 'rainCaution', t.rainCaution,   0, 5,   0.5, 'mm/h')}
      ${renderThresholdRow('Böen STOP',      'gustDanger',  t.gustDanger,   30, 150, 5,   'km/h')}
      ${renderThresholdRow('Grip STOP',      'gripDanger',  t.gripDanger,    0, 50,  5,   '%'   )}
      ${renderThresholdRow('Grip Vorsicht',  'gripCaution', t.gripCaution,  10, 70,  5,   '%'   )}

      <div style="padding:6px 14px 12px">
        <button class="route-btn" style="width:100%"
                onclick="applyPreset(profile.preset || 'touring')">
          ↺ Schwellenwerte zurücksetzen
        </button>
      </div>
    </div>

    <div class="sheet-sep"></div>

    <!-- Darstellung -->
    <div class="collapsible-trigger ${_uiExpanded ? '' : 'collapsed'}" 
         onclick="toggleUiSection()" 
         style="padding-right: 14px">
      <div class="route-section-title" style="margin-top:8px">Darstellung</div>
      <span class="chevron-icon">▼</span>
    </div>

    <div class="collapsible-content">
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
        <span class="sett-val mono" id="ui-scale-val">
          ${Math.round((profile.uiScale||1)*100)}%
        </span>
      </div>
      <div class="range-wrap" style="padding:4px 14px 20px">
        <span class="range-a">80</span>
        <input type="range" id="ui-scale-range" class="tc-range"
               min="80" max="130" step="5"
               value="${Math.round((profile.uiScale||1)*100)}"
               oninput="onUiScaleChange(this.value)">
        <span class="range-a">130</span>
      </div>
    </div>
  `;
}

// ── Threshold-Row HTML-Helper ─────────────────────────────
function renderThresholdRow(label, key, value, min, max, step, unit) {
  return `
    <div class="sett-row" style="padding:4px 14px 0">
      <span class="sett-label" style="font-size:12px">${label}</span>
      <span class="sett-val mono" id="thr-${key}-val">${value} ${unit}</span>
    </div>
    <div class="range-wrap" style="padding:2px 14px 8px">
      <span class="range-a">${min}</span>
      <input type="range" id="thr-${key}" class="tc-range"
             min="${min}" max="${max}" step="${step}" value="${value}"
             oninput="onThresholdChange('${key}',this.value,'${unit}')">
      <span class="range-a">${max}</span>
    </div>`;
}

// ── Slider-Handler ────────────────────────────────────────
function onTankVolChange(val) {
  profile.tankVolumeLiters = parseFloat(val);
  const el = document.getElementById('tank-vol-val');
  if (el) el.textContent = `${parseFloat(val).toFixed(1)} L`;
  _updateRangeDisplay();
  saveProfile();
}

function onConsumptionChange(val) {
  profile.consumptionL100km = parseFloat(val);
  const el = document.getElementById('consumption-val');
  if (el) el.textContent = `${parseFloat(val).toFixed(1)} L/100km`;
  _updateRangeDisplay();
  saveProfile();
}

function onReserveChange(val) {
  profile.reserveLiters = parseFloat(val);
  const el = document.getElementById('reserve-val');
  if (el) el.textContent = `${parseFloat(val).toFixed(1)} L`;
  _updateRangeDisplay();
  saveProfile();
}

function onThresholdChange(key, val, unit) {
  if (!profile.thresholds) profile.thresholds = {};
  profile.thresholds[key] = parseFloat(val);
  const el = document.getElementById(`thr-${key}-val`);
  if (el) el.textContent = `${parseFloat(val)} ${unit}`;
  saveProfile();
  if (currentWeather) updateStatusBubble(currentWeather);
}

function _updateRangeDisplay() {
  const range = calcAutoRange();
  const el    = document.getElementById('auto-range-val');
  if (el) el.textContent = `${range} km`;
}

// ── applyProfileToUI erweitern ────────────────────────────
// ✅ NEU
const _origApplyProfileToUI = typeof applyProfileToUI === 'function' ? applyProfileToUI : function(){};
window.applyProfileToUI = function() {
  _origApplyProfileToUI();
  const el = id => document.getElementById(id);
  if (el('tank-vol-val'))    el('tank-vol-val').textContent    = profile.tankVolumeLiters + ' L';
  if (el('consumption-val')) el('consumption-val').textContent = profile.consumptionL100km + ' L/100km';
  if (el('reserve-val'))     el('reserve-val').textContent     = profile.reserveLiters + ' L';
  if (el('auto-range-val'))  el('auto-range-val').textContent  = calcAutoRange() + ' km';
  document.querySelectorAll('[data-preset]').forEach(b =>
    b.classList.toggle('active', b.dataset.preset === profile.preset)
  );
  document.querySelectorAll('[data-route-pref]').forEach(b =>
    b.classList.toggle('active', b.dataset.routePref === (profile.routingPreference || 'standard'))
  );
};


// ✅ NEU – function expression, kein Hoisting
const _origLoadProfile = typeof loadProfile === 'function' ? loadProfile : function(){};
window.loadProfile = function() {
  _origLoadProfile();
  if (!profile.thresholds || typeof profile.thresholds !== 'object')
    profile.thresholds = { ...PROFILE_PRESETS.touring.thresholds };
  if (profile.tankVolumeLiters && profile.consumptionL100km) calcAutoRange();
};
