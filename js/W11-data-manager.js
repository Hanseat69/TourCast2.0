'use strict';
/**
 * ── TourCast W11-data-manager.js ──
 * Refaktoriertes Modul für nativen Windows-Export.
 */

async function exportLocal() {
  if (!lastRouteCoords || lastRouteCoords.length === 0) {
    console.warn('Export abgebrochen: Keine Route vorhanden.');
    showToast('⚠️ Keine Route zum Exportieren vorhanden');
    return;
  }

  // Nutze TomTom-optimierten Export wenn verfügbar (Höhendaten, Koordinatenbereinigung,
  // max. 9500 Punkte, GPX 1.1 mit Extensions) – andernfalls einfacher Fallback
  if (typeof exportGPXToTomTom === 'function') {
    return exportGPXToTomTom();
  }
  
  const name = buildGPXName();
  const gpxContent = buildGPXContent(null, name); // Pass customName to buildGPXContent
  const filename = `${sanitizeFilename(name)}.gpx`;

  if (window.electronAPI) {
    const result = await window.electronAPI.saveGPX(gpxContent, filename);
    if (result.success) {
      console.log(`GPX erfolgreich gespeichert: ${result.path}`);
      showToast('💾 GPX erfolgreich gespeichert', 'success');
    } else if (result.error) {
      console.error(`Export-Fehler: ${result.error}`);
      showToast(`⚠️ Export-Fehler: ${result.error}`, 'error');
    } else if (result.cancelled) {
      showToast('Export abgebrochen');
    }
  } else {
    // Fallback für Browser-Tests
    const blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    showToast('💾 GPX heruntergeladen', 'success');
  }
}

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
    const fromName = document.getElementById('input-from')?.value?.split(',')[0] || 'Start';
    const toName   = document.getElementById('input-to')?.value?.split(',')[0]   || 'Ziel';

    let rtepts = `    <rtept lat="${start.lat.toFixed(6)}" lon="${start.lng.toFixed(6)}"><name>${escapeHtml(fromName)}</name></rtept>\n`;
    rtepts += waypoints.map(wp => {
      const name = escapeHtml(wp.label || wp.name);
      const desc = wp.desc ? `<desc>${escapeHtml(wp.desc)}</desc>` : '';
      return `    <rtept lat="${(wp.lat || wp.latlng.lat).toFixed(6)}" lon="${(wp.lng || wp.latlng.lng).toFixed(6)}"><name>${name}</name>${desc}</rtept>`;
    }
    ).join('\n');
    rtepts += `\n    <rtept lat="${end.lat.toFixed(6)}" lon="${end.lng.toFixed(6)}"><name>${escapeHtml(toName)}</name></rtept>`;
    gpxBody = `  <rte>\n    <name>${escapeHtml(name)}</name>\n${rtepts}\n  </rte>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TourCast W11" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeHtml(name)}</name><time>${new Date().toISOString()}</time></metadata>
${gpxBody}
</gpx>`;
}

function buildGPXName() {
  // Prüfen, ob ein manueller Name im Export-Modal eingegeben wurde
  const manualName = document.getElementById('gpx-route-name')?.value?.trim();
  if (manualName) return manualName;

  const from = document.getElementById('input-from')?.value?.split(',')[0]?.trim();
  const to = document.getElementById('input-to')?.value?.split(',')[0]?.trim();
  
  if (from && to) return `${from} -> ${to}`;
  if (typeof roundtrip !== 'undefined' && roundtrip.radiusKm) {
    return `Rundtour ${roundtrip.radiusKm}km`;
  }
  return `Tour_${new Date().toLocaleDateString('de-DE')}`;
}

function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_');
}