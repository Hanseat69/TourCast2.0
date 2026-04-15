'use strict';
/**
 * ── TourCast gpx-tomtom.js ──
 * GPX 1.1 Export für TomTom Rider 500
 * 
 * Anforderungen TomTom Rider 500:
 * - GPX 1.1 Format (Standard)
 * - Elevation-Daten für alle Trackpoints
 * - ISO 8601 Zeitstempel
 * - Max ~10.000 Trackpoints
 * - Waypoints mit POI-Informationen
 * - Route-Metadaten (Länge, Fahrtzeit)
 */

/**
 * Erzeugt TomTom Rider 500-kompatible GPX-Datei mit vollständigen Daten
 * @param {Array<{lat, lng, elev?, time?}>} coords - Routenkoordinaten
 * @param {Object} options - Konfiguration
 * @returns {string} - GPX XML-Inhalt
 */
function buildGPXContentTomTom(coords, options = {}) {
  const {
    name = 'TourCast Route',
    description = 'Tour exportiert aus TourCast',
    asTrack = true,
    includeElevation = true,
    includeTime = true,
    distKm = lastRouteDistKm || 0,
    durMin = lastRouteDurMin || 0
  } = options;

  if (!coords || coords.length === 0) {
    console.error('buildGPXContentTomTom: Keine Koordinaten');
    return '';
  }

  // Optimize Koordinaten für TomTom Limits
  const optimizedCoords = reduceCoordinates(coords, 9500);

  let gpxBody = '';

  if (asTrack) {
    gpxBody = buildGPXTrack(optimizedCoords, name, { includeElevation, includeTime, distKm, durMin });
  } else {
    gpxBody = buildGPXRoute(optimizedCoords, name, { includeElevation, distKm, durMin });
  }

  // Metadaten
  const now = new Date().toISOString();
  const metadata = `  <metadata>
    <name>${escapeHtml(name)}</name>
    <desc>${escapeHtml(description)}</desc>
    <author><name>TourCast W11 v2.0</name></author>
    <copyright author="TourCast"><year>${new Date().getFullYear()}</year></copyright>
    <time>${now}</time>
    <keywords>tour, motorcycle, tracking</keywords>
    <bounds minlat="${optimizedCoords.reduce((a, c) => Math.min(a, c.lat), 90).toFixed(6)}" 
            minlon="${optimizedCoords.reduce((a, c) => Math.min(a, c.lng), 180).toFixed(6)}" 
            maxlat="${optimizedCoords.reduce((a, c) => Math.max(a, c.lat), -90).toFixed(6)}" 
            maxlon="${optimizedCoords.reduce((a, c) => Math.max(a, c.lng), -180).toFixed(6)}" />
    <extensions>
      <distance>${distKm.toFixed(1)}</distance>
      <duration>${durMin}</duration>
      <format>TourCast Motor Touring</format>
    </extensions>
  </metadata>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TourCast W11 v2.0" 
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 
     http://www.topografix.com/GPX/1/1/gpx.xsd">
${metadata}
${gpxBody}
</gpx>`;
}

/**
 * Erzeugt GPX Track-Segment (für kontinuierliche Aufzeichnung)
 * @private
 */
function buildGPXTrack(coords, name, options = {}) {
  const { includeElevation, includeTime, distKm, durMin } = options;

  let trkpts = '';
  const startTime = new Date(departureTime || new Date());
  let cumulativeDist = 0;

  for (let i = 0; i < coords.length; i++) {
    const c = coords[i];

    // Zeitstempel berechnen (linear verteilt über Fahrzeit)
    let timeStr = '';
    if (includeTime) {
      let segmentDist = 0;
      if (i > 0) {
        segmentDist = haversineKm(coords[i - 1].lat, coords[i - 1].lng, c.lat, c.lng);
      }
      cumulativeDist += segmentDist;

      // Durchschnittliche Geschwindigkeit: Gesamtstrecke / Gesamtzeit
      const avgSpeedKmH = durMin > 0 ? (distKm / (durMin / 60)) : 60;
      const timeToThisPointMin = (cumulativeDist / distKm) * durMin;
      const pointTime = new Date(startTime.getTime() + timeToThisPointMin * 60000);

      timeStr = `\n      <time>${pointTime.toISOString()}</time>`;
    }

    // Elevation
    let elevStr = '';
    if (includeElevation && c.elev) {
      elevStr = `\n      <ele>${Math.round(c.elev)}</ele>`;
    }

    trkpts += `    <trkpt lat="${c.lat.toFixed(6)}" lon="${c.lng.toFixed(6)}">`;
    if (elevStr) trkpts += elevStr;
    if (timeStr) trkpts += timeStr;
    trkpts += `\n    </trkpt>\n`;
  }

  return `  <trk>
    <name>${escapeHtml(name)}</name>
    <desc>Motorrad-Tour mit Grip-Heatmap und Wetterdaten</desc>
    <extensions>
      <distance>${distKm.toFixed(1)}</distance>
      <duration>${durMin}</duration>
      <trackPoints>${coords.length}</trackPoints>
      <avgSpeed>${(distKm / (durMin / 60)).toFixed(1)}</avgSpeed>
    </extensions>
    <trkseg>
${trkpts}    </trkseg>
  </trk>`;
}

/**
 * Erzeugt GPX Route mit Waypoints (für Navigation)
 * @private
 */
function buildGPXRoute(coords, name, options = {}) {
  const { includeElevation, distKm, durMin } = options;

  const fromEl = document.getElementById('input-from');
  const toEl = document.getElementById('input-to');
  const fromName = fromEl?.value?.split(',')[0]?.trim() || 'Start';
  const toName = toEl?.value?.split(',')[0]?.trim() || 'Ziel';

  let rtepts = `    <rtept lat="${coords[0].lat.toFixed(6)}" lon="${coords[0].lng.toFixed(6)}">
      <name>START: ${escapeHtml(fromName)}</name>
      <desc>Startpunkt der Route</desc>
      <type>startPoint</type>
    </rtept>\n`;

  // Mittleere Waypoints
  waypoints.forEach((wp, idx) => {
    const lat = (wp.lat || wp.latlng?.lat || 0).toFixed(6);
    const lng = (wp.lng || wp.latlng?.lng || 0).toFixed(6);
    const wpName = escapeHtml(wp.label || wp.name || `Punkt ${idx + 1}`);
    const wpDesc = wp.desc ? escapeHtml(wp.desc) : '';

    let elevStr = '';
    if (includeElevation && wp.elev) {
      elevStr = `\n      <ele>${Math.round(wp.elev)}</ele>`;
    }

    rtepts += `    <rtept lat="${lat}" lon="${lng}">
      <name>${wpName}</name>${elevStr}
      <desc>${wpDesc}</desc>
      <type>intermediatePoint</type>
    </rtept>\n`;
  });

  // Ziel-Waypoint
  rtepts += `    <rtept lat="${coords[coords.length - 1].lat.toFixed(6)}" lon="${coords[coords.length - 1].lng.toFixed(6)}">
      <name>ZIEL: ${escapeHtml(toName)}</name>
      <desc>Ziel der Route</desc>
      <type>endPoint</type>
    </rtept>`;

  return `  <rte>
    <name>${escapeHtml(name)}</name>
    <desc>Navigationsroute mit Zwischenzielen</desc>
    <extensions>
      <distance>${distKm.toFixed(1)}</distance>
      <duration>${durMin}</duration>
      <waypoints>${waypoints.length + 2}</waypoints>
      <avgSpeed>${(distKm / (durMin / 60)).toFixed(1)}</avgSpeed>
    </extensions>
${rtepts}
  </rte>`;
}

/**
 * Erweitert vorhandene Koordinaten mit Elevation-Daten
 * Benutzt bereits berechnete Höhenprofildaten falls vorhanden
 * @param {Array<{lat, lng}>} coords
 * @returns {Array<{lat, lng, elev}>}
 */
function enrichCoordinatesWithElevation(coords) {
  if (!elevationData || elevationData.length === 0) {
    return coords; // Keine Elevation verfügbar
  }

  // Interpoliere Elevation zu allen Koordinaten
  return coords.map(c => {
    // Finde nächsten Elevation-Datenpunkt
    let minDist = Infinity;
    let closestElev = null;

    elevationData.forEach(ed => {
      const dist = haversineKm(c.lat, c.lng, ed.lat, ed.lng);
      if (dist < minDist) {
        minDist = dist;
        closestElev = ed.elev;
      }
    });

    return {
      lat: c.lat,
      lng: c.lng,
      elev: closestElev || 0
    };
  });
}

/**
 * Exportiert Route als GPX Datei mit TomTom-Optimierungen
 * Wird von exportLocal() aufgerufen
 */
async function exportGPXToTomTom() {
  if (!lastRouteCoords || lastRouteCoords.length === 0) {
    showToast('⚠️ Keine Route zum Exportieren vorhanden', 'warning');
    return;
  }

  try {
    // Optimiere Koordinaten
    let coords = deduplicateCoordinates(lastRouteCoords, 0.05); // Min. 50m Abstand
    coords = removeCollinearPoints(coords, 0.00005);

    // Füge Elevation-Daten ein falls vorhanden
    if (elevationData && elevationData.length > 0) {
      coords = enrichCoordinatesWithElevation(coords);
    }

    // Erstelle GPX-Inhalt
    const asTrack = document.getElementById('gpx-export-as-track')?.checked !== false;
    const name = document.getElementById('gpx-route-name')?.value || buildGPXName();

    const gpxContent = buildGPXContentTomTom(coords, {
      name,
      description: `${lastRouteDistKm.toFixed(1)}km Motorrad-Tour, ~${lastRouteDurMin}min Fahrzeit`,
      asTrack,
      includeElevation: true,
      includeTime: true,
      distKm: lastRouteDistKm,
      durMin: lastRouteDurMin
    });

    const filename = `${sanitizeFilename(name)}.gpx`;

    if (window.electronAPI) {
      // Windows 11 App
      const result = await window.electronAPI.saveGPX(gpxContent, filename);
      if (result.success) {
        showToast(`✅ GPX für TomTom Rider gespeichert: ${filename}`, 'success');
      } else if (result.error) {
        showToast(`⚠️ Fehler: ${result.error}`, 'error');
      }
    } else {
      // Browser Fallback
      const blob = new Blob([gpxContent], { type: 'application/gpx+xml; charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      showToast(`✅ GPX heruntergeladen: ${filename}`, 'success');
    }
  } catch (e) {
    console.error('GPX-Export Fehler:', e);
    showToast(`⚠️ Export fehlgeschlagen: ${e.message}`, 'error');
  }
}

/**
 * Generiert Test-GPX für Validierung
 * @returns {string} - GPX-Inhalt
 */
function generateTestGPX() {
  const testCoords = [
    { lat: 48.1374, lng: 11.5755, elev: 520 },
    { lat: 48.1400, lng: 11.5800, elev: 530 },
    { lat: 48.1420, lng: 11.5850, elev: 540 },
    { lat: 48.1440, lng: 11.5900, elev: 550 }
  ];

  return buildGPXContentTomTom(testCoords, {
    name: 'Test-Route München',
    description: 'Test-Route für Validierung',
    asTrack: true,
    distKm: 5.2,
    durMin: 15
  });
}
