'use strict';
/**
 * ── TourCast routing.js ──
 * Routing utility functions: map picking mode, address clearing, reverse geocoding.
 * Dependencies: Leaflet map, Nominatim API
 */

// ── Global State for Map Picking ──────────────────────────
let mapPickMode = null;
let mapPickMarker = null;
let mapPickHighlight = null;

/**
 * Activates map picking mode for the specified field ('from' or 'to')
 * User clicks on map to select coordinates, then reverse-geocodes the address.
 * Works with both simplified (input-from) and structured (street-from/nr-from/etc) input formats.
 * @param {string} field - 'from' or 'to'
 */
function startMapPick(field) {
  if (!map) {
    showToast('⚠️ Karte nicht verfügbar', 'error');
    return;
  }

  // Clean up any previous map picking session
  if (mapPickMode) {
    endMapPick();
  }

  mapPickMode = field;

  // Visual feedback: highlight the button and change cursor
  document.body.style.cursor = 'crosshair';
  const pickBtn = document.querySelector(`button[onclick="startMapPick('${field}')"]`);
  if (pickBtn) {
    pickBtn.classList.add('map-pick-active');
    pickBtn.title = '❌ Abbrechen';
  }

  // Show instruction toast
  showToast(`📍 Klicke auf der Karte um ${field === 'from' ? 'Startpunkt' : 'Ziel'} zu wählen (ESC zum Abbrechen)`, 'info');

  // One-time click handler on map
  const clickHandler = async (e) => {
    if (mapPickMode !== field) return; // Guard against concurrent picks

    const { lat, lng } = e.latlng;

    // Clean up event listeners
    map.off('click', clickHandler);
    document.removeEventListener('keydown', escapeHandler);

    // Place visual marker on map
    if (mapPickMarker) map.removeLayer(mapPickMarker);
    mapPickMarker = L.marker([lat, lng], {
      icon: L.icon({
        iconUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22%23FF6200%22%3E%3Ccircle cx=%2212%22 cy=%2212%22 r=%228%22/%3E%3C/svg%3E',
        iconSize: [32, 32],
        iconAnchor: [16, 32]
      })
    }).addTo(map);

    // Try reverse geocoding
    showToast('🔄 Adresse wird ermittelt...', 'info');
    try {
      const url = `${APP.nominatim}/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
      const resp = await fetch(url);
      const data = await resp.json();

      // Fill input fields based on format
      const simpleInput = document.getElementById(`input-${field}`);
      const streetInput = document.getElementById(`street-${field}`);

      if (simpleInput) {
        // Simplified format (current index.html)
        const addr = formatNominatimAddr(data);
        simpleInput.value = addr;
        simpleInput.dataset.lat = lat;
        simpleInput.dataset.lng = lng;
      } else if (streetInput) {
        // Structured format (W11-index.html compatibility)
        const a = data.address || {};
        const street = a.road || a.pedestrian || data.display_name.split(',')[0];
        const nr = a.house_number || '';
        const zip = a.postcode || '';
        const city = a.city || a.town || a.village || '';

        streetInput.value = street;
        const nrField = document.getElementById(`nr-${field}`);
        const zipField = document.getElementById(`zip-${field}`);
        const cityField = document.getElementById(`city-${field}`);
        
        if (nrField) nrField.value = nr;
        if (zipField) zipField.value = zip;
        if (cityField) cityField.value = city;

        // Store coordinates on the street input element
        streetInput.dataset.lat = lat;
        streetInput.dataset.lng = lng;
      }

      showToast('✅ Punkt ausgewählt! Adresse eingetragen.', 'success');

      // Trigger route recalculation if both fields set
      if (typeof calculateRoute === 'function' && areRouteInputsReady()) {
        setTimeout(() => calculateRoute(), 100);
      }

    } catch (e) {
      console.warn('Nominatim reverse geocoding failed:', e);
      // Fallback: use coordinates directly
      const coords = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      const simpleInput = document.getElementById(`input-${field}`);
      if (simpleInput) {
        simpleInput.value = coords;
        simpleInput.dataset.lat = lat;
        simpleInput.dataset.lng = lng;
      }
      showToast('✅ Koordinaten: ' + coords, 'info');
    }

    endMapPick();

    // Save session state
    if (typeof saveActiveSession === 'function') saveActiveSession();
  };

  // ESC key handler to cancel
  const escapeHandler = (e) => {
    if (e.key === 'Escape') {
      map.off('click', clickHandler);
      document.removeEventListener('keydown', escapeHandler);
      endMapPick();
      showToast('❌ Kartenwahl abgebrochen', 'info');
    }
  };

  map.on('click', clickHandler);
  document.addEventListener('keydown', escapeHandler);
}

/**
 * Ends map picking mode and resets visual state
 */
function endMapPick() {
  mapPickMode = null;
  document.body.style.cursor = 'auto';

  // Reset button styling
  document.querySelectorAll('button.map-pick-btn').forEach(btn => {
    btn.classList.remove('map-pick-active');
    btn.title = 'Punkt auf Karte wählen';
  });

  // Remove temporary marker (if exists and user didn't select)
  if (mapPickMarker && map.hasLayer(mapPickMarker)) {
    map.removeLayer(mapPickMarker);
    mapPickMarker = null;
  }
}

/**
 * Clears all input fields and coordinates for the specified field
 * @param {string} field - 'from' or 'to'
 */
function clearInput(field) {
  // Simple format (current index.html)
  const simpleInput = document.getElementById(`input-${field}`);
  if (simpleInput) {
    simpleInput.value = '';
    delete simpleInput.dataset.lat;
    delete simpleInput.dataset.lng;
    simpleInput._selectedLatLng = null;
  }

  // Structured format (W11-index.html compatibility)
  const streetInput = document.getElementById(`street-${field}`);
  if (streetInput) {
    streetInput.value = '';
    delete streetInput.dataset.lat;
    delete streetInput.dataset.lng;
    document.getElementById(`nr-${field}`).value = '';
    document.getElementById(`zip-${field}`).value = '';
    document.getElementById(`city-${field}`).value = '';
  }

  // Clear autocomplete dropdown
  const acList = document.getElementById(`ac-${field}`);
  if (acList) acList.innerHTML = '';

  showToast(`Feld ${field === 'from' ? 'Startpunkt' : 'Ziel'} geleert`, 'info');

  // Save session
  if (typeof saveActiveSession === 'function') saveActiveSession();
}

/**
 * Checks if route inputs are ready (both from and to have value)
 * @returns {boolean}
 */
function areRouteInputsReady() {
  const fromSimple = document.getElementById('input-from');
  const toSimple = document.getElementById('input-to');
  const fromStreet = document.getElementById('street-from');
  const toStreet = document.getElementById('street-to');

  // Check simplified format
  if (fromSimple && toSimple) {
    return (fromSimple.value.trim() && toSimple.value.trim());
  }

  // Check structured format
  if (fromStreet && toStreet) {
    return (fromStreet.value.trim() && toStreet.value.trim());
  }

  return false;
}

/**
 * Formats Nominatim reverse geocoding data into a readable short address
 * @param {object} r - Nominatim response object
 * @returns {string} - Formatted address (Street Nr, PLZ City)
 */
function formatNominatimAddr(r) {
  const a = r.address;
  if (!a) return r.display_name;
  const street = a.road || a.pedestrian || r.display_name.split(',')[0];
  const nr = a.house_number ? ' ' + a.house_number : '';
  const city = a.city || a.town || a.village || '';
  const plz = a.postcode ? a.postcode + ' ' : '';
  return `${street}${nr}, ${plz}${city}`;
}

/**
 * Utility: Calculate haversine distance between two points (as backup to haversineKm from routing.js)
 * Used by elevation.js for distance calculations
 * @param {number} lat1, lng1, lat2, lng2 - Coordinates in degrees
 * @returns {number} - Distance in kilometers
 */
var haversineKm = haversineKm || function(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dG = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dL / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180)
    * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ── Favorite Handling (for potential future use) ────────
/**
 * Handles favorite click - stores or removes a route from favorites
 * Called from favorites UI elements
 * @param {string} routeId - Unique route identifier
 */
function handleFavClick(routeId) {
  if (!routeId) return;
  
  try {
    const favKey = 'route_favs';
    const favs = JSON.parse(localStorage.getItem(favKey) || '[]');
    const index = favs.indexOf(routeId);

    if (index > -1) {
      // Remove from favorites
      favs.splice(index, 1);
      showToast('⭐ Aus Favoriten entfernt', 'info');
    } else {
      // Add to favorites
      favs.push(routeId);
      showToast('⭐ Zu Favoriten hinzugefügt', 'success');
    }

    localStorage.setItem(favKey, JSON.stringify(favs));

    // Update UI state
    const favBtn = document.querySelector(`[data-route-id="${routeId}"] .fav-btn`);
    if (favBtn) {
      favBtn.classList.toggle('is-favorite', index === -1);
    }
  } catch (e) {
    console.error('Favorite handling error:', e);
  }
}

// ── Initialize Event Listeners on DOM Ready ────────────
document.addEventListener('DOMContentLoaded', () => {
  // Allow ESC to cancel map picking even if map event listener didn't catch it
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mapPickMode) {
      endMapPick();
      showToast('❌ Kartenwahl abgebrochen', 'info');
    }
  });
});
