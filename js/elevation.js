'use strict';
// ── TourCast elevation.js – Höhenprofil SVG + Pässe + Cross-Highlighting ──
// Must-Have:
//   ✅ Höhenprofil als stilisierte SVG-Silhouette mit Grip-Farbband
//   ✅ Pässe und Hochpunkte automatisch markiert
//   ✅ Cross-Highlighting: Tap auf Profil → Marker auf Karte

const ELEV_SAMPLES   = 100;
const GRIP_BAND_H    = 10;
const PASS_MIN_ELEV  = 600;   // Mindesthöhe für Pass-Erkennung (m)
const PASS_MIN_PROM  = 80;    // Mindest-Prominenz (m)
const PASS_MIN_SEP   = 0.05;  // Mindestabstand zwischen Pässen (5 % der Route)

let elevationData     = [];   // [{ dist, elev, grip, lat, lng }]
let elevPassMarkers   = [];   // Leaflet-Marker für Pässe
let elevCrossMarker   = null; // Cross-Highlight Marker auf Karte
let elevSampledCoords = [];   // Sampled-Koordinaten für Cross-Highlighting

// ── Höhenprofil berechnen ─────────────────────────────────
async function buildElevationProfile(coords) {
  const container = document.getElementById('elevation-container');
  if (!container || !coords?.length) return;

  container.style.display = 'block';
  const svg = document.getElementById('elevation-svg');
  if (!svg) return;

  svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle"'
    + ' fill="var(--text-mid)" font-size="11">Höhenprofil wird geladen…</text>';

  clearPassMarkers();

  try {
    // Präzises Sampling auf exakt 100 Punkte (Open-Meteo Limit)
    const sampled = [];
    for (let i = 0; i < ELEV_SAMPLES; i++) {
      const idx = Math.floor(i * (coords.length - 1) / (ELEV_SAMPLES - 1));
      sampled.push(coords[idx]);
    }
    elevSampledCoords = sampled;

    // Open-Meteo Format: latitude=lat1,lat2&longitude=lng1,lng2
    const lats = sampled.map(c => c.lat.toFixed(5)).join(',');
    const lngs = sampled.map(c => c.lng.toFixed(5)).join(',');
    
    const url = `${APP.elevationApi}?latitude=${lats}&longitude=${lngs}`;
    const resp = await fetch(url);

    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (!data.elevation || !data.elevation.length) throw new Error('Keine Höhendaten');

    let cumDist = 0;
    elevationData = data.elevation.map((elev, i) => {
      if (i > 0) {
        cumDist += haversineKm(
          sampled[i - 1].lat, sampled[i - 1].lng,
          sampled[i].lat,     sampled[i].lng
        );
      }
      const grip = resolveGrip(sampled[i]);
      return {
        dist: cumDist,
        elev: elev ?? 0,
        grip,
        lat:  sampled[i].lat,
        lng:  sampled[i].lng
      };
    });

    renderElevationSVG();
    detectAndMarkPasses();

  } catch (e) {
    svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle"'
      + ' fill="var(--text-mid)" font-size="11">Höhendaten nicht verfügbar</text>';
  }
}

// ── Grip-Score sicher ermitteln ───────────────────────────
function resolveGrip(coord) {
  try {
    if (typeof interpolateWeather === 'function') {
      const wx = interpolateWeather(coord.lat, coord.lng);
      if (wx && typeof calcGripScore === 'function') return calcGripScore(wx);
    }
    if (typeof currentWeather !== 'undefined' && currentWeather
        && typeof calcGripScore === 'function') {
      return calcGripScore(currentWeather);
    }
  } catch (_) { /* silent */ }
  return 70; // Default: trocken
}

// ── SVG rendern ───────────────────────────────────────────
function renderElevationSVG() {
  const svg = document.getElementById('elevation-svg');
  if (!svg || !elevationData.length) return;

  // clientWidth kann 0 sein wenn Container gerade sichtbar wurde
  const W = Math.max(svg.clientWidth  || svg.parentElement?.clientWidth || 300, 200);
  const H = Math.max(svg.clientHeight || 80, 60);
  const PAD = { t: 10, r: 8, b: GRIP_BAND_H + 8, l: 8 };
  const w  = W - PAD.l - PAD.r;
  const h  = H - PAD.t - PAD.b;

  const elevs  = elevationData.map(d => d.elev);
  const minE   = Math.min(...elevs);
  const maxE   = Math.max(...elevs);
  const rangeE = Math.max(maxE - minE, 10);
  const maxD   = elevationData[elevationData.length - 1].dist || 1;

  const xOf = d => PAD.l + (d.dist / maxD) * w;
  const yOf = d => PAD.t + h - ((d.elev - minE) / rangeE) * h;

  // Silhouette – Stroke-Pfad
  const strokePath = elevationData
    .map((d, i) => (i === 0 ? 'M' : 'L') + xOf(d).toFixed(1) + ',' + yOf(d).toFixed(1))
    .join(' ');

  // Füllfläche
  const lastD  = elevationData[elevationData.length - 1];
  const fillPath = strokePath
    + ' L' + xOf(lastD).toFixed(1) + ',' + (PAD.t + h).toFixed(1)
    + ' L' + PAD.l + ',' + (PAD.t + h).toFixed(1) + ' Z';

  // Grip-Band Segmente
  const gripBand = elevationData.slice(0, -1).map((d, i) => {
    const next  = elevationData[i + 1];
    const color = (typeof gripLabel === 'function')
      ? (gripLabel(d.grip)?.color || '#00FF87')
      : '#00FF87';
    const x1 = xOf(d).toFixed(1);
    const x2 = xOf(next).toFixed(1);
    const bw  = (parseFloat(x2) - parseFloat(x1)).toFixed(1);
    const by  = (H - GRIP_BAND_H).toFixed(1);
    return '<rect x="' + x1 + '" y="' + by + '" width="' + bw
      + '" height="' + GRIP_BAND_H + '" fill="' + color + '" opacity="0.9"/>';
  }).join('');

  // Min/Max Labels
  const minIdx = elevs.indexOf(minE);
  const maxIdx = elevs.indexOf(maxE);
  const minPt  = elevationData[minIdx];
  const maxPt  = elevationData[maxIdx];
  const minLX  = Math.max(PAD.l + 6, Math.min(W - PAD.r - 6, xOf(minPt)));
  const maxLX  = Math.max(PAD.l + 6, Math.min(W - PAD.r - 6, xOf(maxPt)));

  // Cross-Highlight-Linie (initial unsichtbar)
  const crossLine = '<line id="elev-cross-line"'
    + ' x1="0" y1="' + PAD.t + '" x2="0" y2="' + (PAD.t + h).toFixed(1) + '"'
    + ' stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="3,2"'
    + ' opacity="0" pointer-events="none"/>';

  // Transparentes Tap-Target über dem gesamten Diagramm
  const tapTarget = '<rect'
    + ' x="' + PAD.l + '" y="' + PAD.t + '"'
    + ' width="' + w + '" height="' + h + '"'
    + ' fill="transparent" style="cursor:crosshair"'
    + ' onclick="onElevSvgTap(event)"/>';

  svg.innerHTML = ''
    + '<defs>'
    +   '<linearGradient id="elev-grad" x1="0" y1="0" x2="0" y2="1">'
    +     '<stop offset="0%"   stop-color="var(--accent)" stop-opacity="0.30"/>'
    +     '<stop offset="100%" stop-color="var(--accent)" stop-opacity="0.04"/>'
    +   '</linearGradient>'
    + '</defs>'
    + '<path d="' + fillPath   + '" fill="url(#elev-grad)" stroke="none"/>'
    + '<path d="' + strokePath + '" fill="none" stroke="var(--accent)"'
    +   ' stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>'
    + gripBand
    + '<text x="' + minLX.toFixed(1) + '" y="' + (yOf(minPt) + 10).toFixed(1)
    +   '" text-anchor="middle" fill="var(--text-mid)" font-size="9">'
    +   Math.round(minE) + 'm</text>'
    + '<text x="' + maxLX.toFixed(1) + '" y="' + (yOf(maxPt) - 3).toFixed(1)
    +   '" text-anchor="middle" fill="var(--text-bright)" font-size="9">'
    +   Math.round(maxE) + 'm</text>'
    + crossLine
    + tapTarget;

  // Außenbeschriftung
  const startEl = document.querySelector('.elev-label-start');
  const endEl   = document.querySelector('.elev-label-end');
  if (startEl) startEl.textContent = Math.round(elevationData[0].elev) + 'm';
  if (endEl)   endEl.textContent   = Math.round(lastD.elev) + 'm';
}

// ── Cross-Highlighting: Tap auf SVG → Marker auf Karte ────
function onElevSvgTap(event) {
  const svg = document.getElementById('elevation-svg');
  if (!svg || !elevationData.length) return;

  const PAD_L = 8;
  const PAD_R = 8;
  const rect  = svg.getBoundingClientRect();
  const w     = rect.width - PAD_L - PAD_R;
  if (w <= 0) return;

  const xClick = event.clientX - rect.left - PAD_L;
  const frac   = Math.max(0, Math.min(1, xClick / w));
  const maxD   = elevationData[elevationData.length - 1].dist || 1;
  const distAt = frac * maxD;

  // Nächsten Datenpunkt ermitteln
  let nearest = 0;
  let minDiff = Infinity;
  elevationData.forEach((d, i) => {
    const diff = Math.abs(d.dist - distAt);
    if (diff < minDiff) { minDiff = diff; nearest = i; }
  });

  const pt = elevationData[nearest];
  if (!pt) return;

  // Cross-Linie im SVG verschieben
  const crossLine = document.getElementById('elev-cross-line');
  if (crossLine) {
    const W      = svg.clientWidth || 300;
    const PAD    = { t: 10, r: 8, b: GRIP_BAND_H + 8, l: 8 };
    const wInner = W - PAD.l - PAD.r;
    const xPos   = (PAD.l + (pt.dist / maxD) * wInner).toFixed(1);
    crossLine.setAttribute('x1', xPos);
    crossLine.setAttribute('x2', xPos);
    crossLine.setAttribute('opacity', '1');
  }

  // Marker auf Karte setzen/verschieben
  if (typeof map === 'undefined') return;

  if (!elevCrossMarker) {
    elevCrossMarker = L.marker([pt.lat, pt.lng], {
      zIndexOffset: 1000,
      icon: L.divIcon({
        className: '',
        html: '<div style="'
          + 'width:14px;height:14px;border-radius:50%;'
          + 'background:#FF6200;border:2px solid #fff;'
          + 'box-shadow:0 0 10px rgba(255,98,0,0.85)"></div>',
        iconSize:   [14, 14],
        iconAnchor: [7, 7]
      })
    }).addTo(map);
  } else {
    elevCrossMarker.setLatLng([pt.lat, pt.lng]);
  }

  const gripInfo = (typeof gripLabel === 'function')
    ? gripLabel(pt.grip)
    : { label: 'Trocken' };

  elevCrossMarker
    .bindPopup(
      '<b>' + pt.dist.toFixed(1) + ' km</b><br>'
      + Math.round(pt.elev) + ' m ü.NN<br>'
      + 'Grip: ' + gripInfo.label + ' (' + Math.round(pt.grip) + '%)'
    )
    .openPopup();
}

// ── Pässe & Hochpunkte erkennen & markieren ───────────────
function detectAndMarkPasses() {
  if (!elevationData.length || typeof map === 'undefined') return;
  clearPassMarkers();

  const passes = findPasses(elevationData);
  passes.forEach(idx => {
    const pt = elevationData[idx];
    if (!pt) return;

    const m = L.marker([pt.lat, pt.lng], {
      icon: L.divIcon({
        className: '',
        html: '<div style="'
          + 'background:rgba(6,10,15,0.88);'
          + 'border:1px solid #FF6200;'
          + 'border-radius:6px;'
          + 'padding:2px 7px;'
          + 'font-size:10px;font-weight:700;color:#fff;'
          + 'white-space:nowrap;'
          + 'box-shadow:0 2px 8px rgba(0,0,0,0.5)">'
          + 'PASS ' + Math.round(pt.elev) + ' m'
          + '</div>',
        iconSize:   [72, 22],
        iconAnchor: [36, 22]
      })
    }).addTo(map);

    m.bindPopup(
      '<b>Hochpunkt</b><br>'
      + Math.round(pt.elev) + ' m ü.NN<br>'
      + pt.dist.toFixed(1) + ' km ab Start'
    );

    elevPassMarkers.push(m);
  });
}

// ── Lokale Maxima (Pässe) finden ──────────────────────────
function findPasses(data) {
  if (data.length < 3) return [];

  const totalDist  = data[data.length - 1].dist || 1;
  const minSepDist = totalDist * PASS_MIN_SEP;
  const passes     = [];

  for (let i = 1; i < data.length - 1; i++) {
    const pt = data[i];
    if (pt.elev < PASS_MIN_ELEV) continue;

    // Lokales Maximum im Fenster ±5 Punkte
    const lo = Math.max(0, i - 5);
    const hi = Math.min(data.length - 1, i + 5);
    let isMax = true;
    for (let j = lo; j <= hi; j++) {
      if (j !== i && data[j].elev > pt.elev) { isMax = false; break; }
    }
    if (!isMax) continue;

    // Prominenz berechnen
    let leftMin  = pt.elev;
    let rightMin = pt.elev;
    for (let j = i - 1; j >= 0;          j--) leftMin  = Math.min(leftMin,  data[j].elev);
    for (let j = i + 1; j < data.length; j++) rightMin = Math.min(rightMin, data[j].elev);
    const prominence = pt.elev - Math.max(leftMin, rightMin);
    if (prominence < PASS_MIN_PROM) continue;

    // Mindestabstand zu bereits gefundenen Pässen
    const tooClose = passes.some(pidx =>
      Math.abs(data[pidx].dist - pt.dist) < minSepDist
    );
    if (tooClose) continue;

    passes.push(i);
  }
  return passes;
}

// ── Marker aufräumen ──────────────────────────────────────
function clearPassMarkers() {
  if (typeof map !== 'undefined') {
    elevPassMarkers.forEach(m => map.removeLayer(m));
    if (elevCrossMarker) { map.removeLayer(elevCrossMarker); elevCrossMarker = null; }
  }
  elevPassMarkers = [];
}

// ── Haversine – Guard gegen Doppeldeklaration ─────────────
// routing.js definiert haversineKm zuerst; diese Definition
// greift nur wenn routing.js fehlt (z. B. Testumgebung).
var haversineKm = haversineKm || function(lat1, lng1, lat2, lng2) {
  const R  = 6371;
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dG = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(dL / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180)
    * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ── Höhenprofil löschen ───────────────────────────────────
function clearElevationProfile() {
  elevationData = [];
  elevSampledCoords = [];
  clearPassMarkers();
  const container = document.getElementById('elevation-container');
  if (container) container.style.display = 'none';
  const svg = document.getElementById('elevation-svg');
  if (svg) svg.innerHTML = ''; // Clear SVG content
}
