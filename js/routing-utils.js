'use strict';
/**
 * ── TourCast routing-utils.js ──
 * Polyline-Dekoder, Koordinaten-Validierung, Utility-Funktionen
 * für robuste Routenberechnung mit ORS API
 */

// ── Polyline-Dekodierung (Google Encoded Polyline Algorithm) ──
/**
 * Dekodiert Google Encoded Polyline zu Array von [lat, lng] Koordinaten
 * Kompatibel mit ORS API Standard-JSON Response
 * @param {string} encoded - Base64-encoded Polyline
 * @returns {Array<[number, number]>} - Array von [lat, lng]
 */
function decodePolyline(encoded) {
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

// ── Koordinaten-Validierung ──
/**
 * Prüft, ob Koordinaten gültig sind
 * @param {number} lat - Latitude (-90 bis 90)
 * @param {number} lng - Longitude (-180 bis 180)
 * @returns {boolean}
 */
function isValidCoordinate(lat, lng) {
  return (
    typeof lat === 'number' && !isNaN(lat) &&
    typeof lng === 'number' && !isNaN(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
}

/**
 * Extrahiert & validiert Koordinaten aus verschiedenen Quellen
 * @param {HTMLElement} el - Input-Element
 * @param {HTMLElement} [cityEl] - Alternativ City-Element
 * @returns {Object|null} - {lat, lng} oder null wenn ungültig
 */
function extractCoordinates(el, cityEl = null) {
  let lat, lng;

  // Versuche vom Primary-Element zu parsen
  if (el) {
    lat = parseFloat(el.dataset.lat || el._selectedLatLng?.lat);
    lng = parseFloat(el.dataset.lng || el._selectedLatLng?.lng);
  }

  // Fallback auf City-Element
  if ((isNaN(lat) || isNaN(lng)) && cityEl) {
    lat = parseFloat(cityEl.dataset.lat);
    lng = parseFloat(cityEl.dataset.lng);
  }

  // Validierung
  if (!isValidCoordinate(lat, lng)) {
    return null;
  }

  return { lat, lng };
}

/**
 * Haversine-Distanz zwischen zwei Koordinaten
 * @param {number} lat1, lng1, lat2, lng2 - Koordinaten in Grad
 * @returns {number} - Distanz in Kilometern
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Waypoint-Optimierung ──
/**
 * Entfernt doppelte/dicht beieinander liegende Waypoints
 * @param {Array<{lat, lng}>} coords - Koordinaten-Array
 * @param {number} minDistKm - Minimale Distanz zwischen Punkten (default: 0.1)
 * @returns {Array<{lat, lng}>} - Dedupliziertes Array
 */
function deduplicateCoordinates(coords, minDistKm = 0.1) {
  if (!coords || coords.length < 2) return coords;

  const result = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const last = result[result.length - 1];
    const dist = haversineKm(last.lat, last.lng, coords[i].lat, coords[i].lng);
    if (dist >= minDistKm) {
      result.push(coords[i]);
    }
  }
  return result;
}

/**
 * Entfernt collineare Punkte (3 Punkte auf gerader Linie)
 * Verbessert Performance bei ORS-Routing
 * @param {Array<{lat, lng}>} coords
 * @param {number} tolerance - Toleranz in Grad (default: 0.0001)
 * @returns {Array<{lat, lng}>}
 */
function removeCollinearPoints(coords, tolerance = 0.0001) {
  if (coords.length < 3) return coords;

  const result = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) {
    const p0 = coords[i - 1];
    const p1 = coords[i];
    const p2 = coords[i + 1];

    // Cross product um Collinearität zu prüfen
    const cross = (p1.lat - p0.lat) * (p2.lng - p0.lng) -
                  (p1.lng - p0.lng) * (p2.lat - p0.lat);

    if (Math.abs(cross) > tolerance) {
      result.push(p1);
    }
  }
  result.push(coords[coords.length - 1]);
  return result;
}

/**
 * Reduziert Koordinaten per Douglas-Peucker wenn zu viele vorhanden
 * TomTom Rider max ~10.000 Trackpoints
 * @param {Array<{lat, lng}>} coords
 * @param {number} maxPoints - Maximum Punkte (default: 9500)
 * @returns {Array<{lat, lng}>}
 */
function reduceCoordinates(coords, maxPoints = 9500) {
  if (coords.length <= maxPoints) return coords;

  const ratio = coords.length / maxPoints;
  const result = [];
  for (let i = 0; i < coords.length; i += ratio) {
    result.push(coords[Math.floor(i)]);
  }
  return result;
}

// ── ORS API URL-Konstruktion ──
/**
 * Konstruiert robuste ORS-URL für Motorrad-Routing
 * @param {string} baseApi - Basis-URL (z.B. APP.orsApi)
 * @param {string} profile - Routing-Profil (default: 'driving-motorcycle')
 * @returns {string} - Vollständige API-URL
 */
function buildOrsUrl(baseApi, profile = 'driving-motorcycle') {
  // Normalisiere URL: entferne Query-Parameter und /geojson Suffix
  let url = baseApi
    .replace(/\?.*$/, '')  // Entferne Query-String
    .replace(/\/geojson\/?$/, '')  // Entferne /geojson
    .replace(/\/driving-motorcycle\/?$/, '')  // Entferne altes Motorrad-Profil
    .replace(/\/driving-car\/?$/, ''); // Entferne altes Auto-Profil

  // Hänge korrektes Profil an
  if (!url.endsWith('/')) url += '/';
  url += profile;

  return url;
}

// ── HTML Escape für GPX/XML ──
/**
 * Escaped HTML/XML Sonderzeichen
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
