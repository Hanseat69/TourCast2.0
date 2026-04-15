'use strict';
// ── TourCast map.js – Maplibre GL Engine mit Straßen-Farbcodierung ──
// Visualisiert Straßentypen mit Farben: Autobahn (blau), Bundesstraße (orange), 
// Landstraße (gelb), etc. – Standard-Navigationsprogramm-Stil

let map          = null;
let userMarker   = null;
let currentStyle = 'street'; // 'street', 'satellite', or 'topo'

// Marker Collection
let routeMarkers = [];
let poiMarkers = [];

// ── MAPLIBRE GL STYLE MIT DEUTSCHEN STRAßEN-FARBEN ──────────────────
// Diesen Style verwenden wir für alle Ansichten, mit Variationen bei Hintergrund/Layer-Farben

const MAP_STYLES = {
  street: {
    // OpenStreetMap Vector Tiles via Protomaps (kostenlos, keine API-Key nötig)
    version: 8,
    sources: {
      osm_vector: {
        type: 'vector',
        tiles: ['https://tile.openstreetmap.us/data/v3/{z}/{x}/{y}.pbf'],
        minzoom: 0,
        maxzoom: 14
      }
    },
    layers: [
      // ────────── BACKGROUND ──────────────────────────
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#EEF2F7' }  // Hell-Grau (Light Mode)
      },

      // ────────── WATER ──────────────────────────
      {
        id: 'water',
        type: 'fill',
        source: 'osm_vector',
        'source-layer': 'water',
        paint: { 'fill-color': '#B3D9FF', 'fill-opacity': 0.5 }
      },

      // ────────── STRAßEN MIT FARBCODIERUNG ──────────────────────────
      // MOTORWAY (Autobahn) - BLAU
      {
        id: 'road_motorway',
        type: 'line',
        source: 'osm_vector',
        'source-layer': 'roads',
        filter: ['==', ['get', 'class'], 'motorway'],
        paint: {
          'line-color': '#1E90FF',     // Leuchtendes Blau
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 12, 4, 14, 8],
          'line-opacity': 0.9
        }
      },

      // TRUNK (Bundesstraße) - ORANGE
      {
        id: 'road_trunk',
        type: 'line',
        source: 'osm_vector',
        'source-layer': 'roads',
        filter: ['==', ['get', 'class'], 'trunk'],
        paint: {
          'line-color': '#FF6B35',     // Orange
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 12, 3, 14, 6],
          'line-opacity': 0.9
        }
      },

      // PRIMARY (Landesstraße) - GELB
      {
        id: 'road_primary',
        type: 'line',
        source: 'osm_vector',
        'source-layer': 'roads',
        filter: ['==', ['get', 'class'], 'primary'],
        paint: {
          'line-color': '#FFD700',     // Gold-Gelb
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.3, 12, 2.5, 14, 5],
          'line-opacity': 0.9
        }
      },

      // SECONDARY (Kreisstraße) - DUNKELROT
      {
        id: 'road_secondary',
        type: 'line',
        source: 'osm_vector',
        'source-layer': 'roads',
        filter: ['==', ['get', 'class'], 'secondary'],
        paint: {
          'line-color': '#DC143C',     // Crimson
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.3, 12, 2, 14, 4],
          'line-opacity': 0.85
        }
      },

      // TERTIARY (Landstraße) - GRÜN
      {
        id: 'road_tertiary',
        type: 'line',
        source: 'osm_vector',
        'source-layer': 'roads',
        filter: ['==', ['get', 'class'], 'tertiary'],
        paint: {
          'line-color': '#50C878',     // Jagd-Grün
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.2, 12, 1.5, 14, 3],
          'line-opacity': 0.85
        }
      },

      // RESIDENTIAL (Wohnstraße) - GRAU
      {
        id: 'road_residential',
        type: 'line',
        source: 'osm_vector',
        'source-layer': 'roads',
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'unclassified']]],
        paint: {
          'line-color': '#B0B0B0',     // Grau
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.2, 12, 1, 14, 2],
          'line-opacity': 0.8
        }
      },

      // SERVICE & ALLEYS (Nebenstraßen) - HELL-GRAU
      {
        id: 'road_service',
        type: 'line',
        source: 'osm_vector',
        'source-layer': 'roads',
        filter: ['in', ['get', 'class'], ['literal', ['service', 'footway', 'path']]],
        paint: {
          'line-color': '#D3D3D3',     // Hell-Grau
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.2, 14, 1],
          'line-opacity': 0.6
        }
      },

      // ────────── GEBÄUDE ──────────────────────────
      {
        id: 'building',
        type: 'fill',
        source: 'osm_vector',
        'source-layer': 'building',
        paint: {
          'fill-color': '#E8E8E8',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.3, 14, 0.6]
        }
      },

      // ────────── GRENZEN & LABELS ──────────────────────────
      {
        id: 'boundary',
        type: 'line',
        source: 'osm_vector',
        'source-layer': 'boundary',
        paint: {
          'line-color': '#CCCCCC',
          'line-dasharray': [4, 4],
          'line-width': 1,
          'line-opacity': 0.5
        }
      }
    ]
  },

  // ────────── SATELLIT ANSICHT ──────────────────────────
  satellite: {
    version: 8,
    sources: {
      satellite: {
        type: 'raster',
        url: 'https://a.tile.openstreetmap.org/satellite/{z}/{x}/{y}.jpg',
        tileSize: 256
      }
    },
    layers: [
      {
        id: 'satellite',
        type: 'raster',
        source: 'satellite'
      }
    ]
  },

  // ────────── TOPOGRAFIE ──────────────────────────
  topo: {
    version: 8,
    sources: {
      topo: {
        type: 'raster',
        url: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
        tileSize: 256
      }
    },
    layers: [
      {
        id: 'topo',
        type: 'raster',
        source: 'topo'
      }
    ]
  }
};

// ── KARTE INITIALISIEREN ──────────────────────────────────────────
function initMap() {
  try {
    maplibregl.accessToken = false; // Protomaps benötigt keinen Token
    
    map = new maplibregl.Map({
      container: 'map',
      style: MAP_STYLES.street,
      center: APP.defaultCenter || [10.0, 51.5],
      zoom: APP.defaultZoom || 6,
      pitch: 0,
      bearing: 0,
      attributionControl: true,
      boxZoom: false,
      doubleClickZoom: true,
      dragPan: true,
      dragRotate: false,
      keyboard: false,
      scrollZoom: true,
      touchPitch: false,
      touchZoomRotate: true
    });

    // ────────── NAVIGATION CONTROLS ──────────────────────────
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 200, unit: 'metric' }), 'bottom-left');

    // ────────── CUSTOM PANES FÜR LAYERUNG ──────────────────────────
    // In Maplibre GL werden Ebenen über die Reihenfolge im Style-Array gesteuert
    // Wir fügen diese als Gruppen hinzu für spätere Referenzierung

    // ────────── LOAD EVENT ──────────────────────────────
    map.on('load', function() {
      console.log('✓ Maplibre GL Map geladen mit Straßen-Farbcodierung');
      
      // GeoJSON Quellen für Routen und Marker
      if (!map.getSource('route-source')) {
        map.addSource('route-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
      }

      if (!map.getSource('poi-source')) {
        map.addSource('poi-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
      }

      // ────────── ROUTEN-LAYER (GeoJSON Linien) ──────────────────────────
      if (!map.getLayer('route-line')) {
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route-source',
          paint: {
            'line-color': '#FF5722',      // Knall-Orange für Routing
            'line-width': 4,
            'line-opacity': 0.8,
            'line-dasharray': [2, 2]
          }
        });
      }
      // ────────── ROUTE PULSE OVERLAY ─────────────────────
      if (!map.getLayer('route-pulse')) {
        map.addLayer({
          id: 'route-pulse',
          type: 'line',
          source: 'route-source',
          paint: {
            'line-color': '#FFFFFF',
            'line-width': 3,
            'line-opacity': 0,
            'line-blur': 2
          }
        });
      }
      // ────────── POI MARKER ──────────────────────────────
      if (!map.getLayer('poi-points')) {
        map.addLayer({
          id: 'poi-points',
          type: 'circle',
          source: 'poi-source',
          paint: {
            'circle-radius': 6,
            'circle-color': '#D97E24',     // Bernstein
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF'
          }
        });
      }

      console.log('✓ GeoJSON Quellen und Layer initialisiert');
    });

    // ────────── ERROR HANDLER ──────────────────────────────
    map.on('error', (e) => {
      console.error('Map Error:', e.error?.message || e);
    });

    console.log('✓ Maplibre GL Map erstellt');
  } catch (err) {
    console.error('FEHLER bei Map Init:', err);
  }
}

// ────────── LAYER WECHSELN (STREET / SATELLITE / TOPO) ──────────────────────────
function switchLayer(layerName) {
  if (!map || map.isStyleLoaded() === false) {
    console.warn('Map nicht bereit für Layer-Wechsel');
    return;
  }

  try {
    const style = MAP_STYLES[layerName];
    if (!style) {
      console.warn(`Layer '${layerName}' nicht verfügbar`);
      return;
    }

    currentStyle = layerName;

    // Style wechseln (merkt sich Zoom, Position, etc.)
    map.setStyle(style, { diff: true });

    // Nach Style-Wechsel müssen die GeoJSON Quellen neu hinzugefügt werden
    map.once('styledata', function() {
      if (!map.getSource('route-source')) {
        map.addSource('route-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
      }
      if (!map.getSource('poi-source')) {
        map.addSource('poi-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
      }

      // Layer neu hinzufügen
      if (!map.getLayer('route-line')) {
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route-source',
          paint: {
            'line-color': '#FF5722',
            'line-width': 4,
            'line-opacity': 0.8,
            'line-dasharray': [2, 2]
          }
        });
      }

      if (!map.getLayer('route-pulse')) {
        map.addLayer({
          id: 'route-pulse',
          type: 'line',
          source: 'route-source',
          paint: {
            'line-color': '#FFFFFF',
            'line-width': 3,
            'line-opacity': 0,
            'line-blur': 2
          }
        });
      }

      if (!map.getLayer('poi-points')) {
        map.addLayer({
          id: 'poi-points',
          type: 'circle',
          source: 'poi-source',
          paint: {
            'circle-radius': 6,
            'circle-color': '#D97E24',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#FFFFFF'
          }
        });
      }

      console.log(`✓ Layer zu '${layerName}' gewechselt`);
    });
  } catch (err) {
    console.error(`Fehler beim Wechsel zu Layer '${layerName}':`, err);
  }
}

// ────────── MARKER MANAGEMENT ──────────────────────────────────────
// Füge einen neuen Marker hinzu (für Start/End/POI)
function addMarker(lngLat, options = {}) {
  try {
    const { className = 'default-marker', title = '', id = null } = options;
    
    // Erstelle HTML Element für Marker
    const el = document.createElement('div');
    el.className = `maplibre-marker ${className}`;
    el.style.width = '32px';
    el.style.height = '32px';
    el.style.backgroundSize = '100%';
    el.style.backgroundImage = options.imgSrc || 'url(data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCAzMiA0OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTYgMEMxMi4xMyAwIDIgNi4xMyAyIDE2YzAgOC4xNiAxNCAxNiAxNCAxNnMxNC03Ljg0IDE0LTE2YzAtOS44Ny0xMC4xMy0xNi0xNC0xNnoiIGZpbGw9IiMwMDAwMDAiLz48L3N2Zz4=)';
    el.title = title;

    const marker = new maplibregl.Marker({ element: el, draggable: false })
      .setLngLat(lngLat)
      .addTo(map);

    if (id) marker.id = id;
    return marker;
  } catch (err) {
    console.error('Fehler beim Hinzufügen von Marker:', err);
    return null;
  }
}

// Entferne alle Route Marker
function clearRouteMarkers() {
  routeMarkers.forEach(m => m.remove());
  routeMarkers = [];
}

// Entferne alle POI Marker
function clearPOIMarkers() {
  poiMarkers.forEach(m => m.remove());
  poiMarkers = [];
}

// Entferne User Position Marker
function removeUserMarker() {
  if (userMarker) {
    userMarker.remove();
    userMarker = null;
  }
}

// ────────── ROUTE PULSE ANIMATION ────────────────────────────────────────────
let _routePulseRAF = null;
let _pulsePhase    = 0;

function startRoutePulse() {
  if (!map || !map.getLayer('route-pulse')) return;
  stopRoutePulse();
  function tick() {
    _pulsePhase = (_pulsePhase + 0.025) % (2 * Math.PI);
    const opacity = 0.2 + 0.45 * (0.5 + 0.5 * Math.sin(_pulsePhase));
    if (map.getLayer('route-pulse')) {
      map.setPaintProperty('route-pulse', 'line-opacity', opacity);
    }
    _routePulseRAF = requestAnimationFrame(tick);
  }
  _routePulseRAF = requestAnimationFrame(tick);
}

function stopRoutePulse() {
  if (_routePulseRAF) {
    cancelAnimationFrame(_routePulseRAF);
    _routePulseRAF = null;
  }
  if (map && map.getLayer('route-pulse')) {
    map.setPaintProperty('route-pulse', 'line-opacity', 0);
  }
}

// ────────── ROUTE ZEICHNEN (GEOJSON LINIENZUG) ──────────────────────────────
function drawRoute(coordinates, routeType = 'primary') {
  try {
    if (!map || !map.getSource('route-source')) {
      console.error('Route Source nicht verfügbar');
      return;
    }

    stopRoutePulse();
    const total    = coordinates.length;
    const duration = Math.min(1400, 700 + total * 0.3); // max 1,4 s
    const start    = performance.now();

    function frame(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased    = 1 - Math.pow(1 - progress, 2); // ease-out quadratic
      const count    = Math.max(2, Math.floor(eased * total));

      map.getSource('route-source').setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coordinates.slice(0, count) },
          properties: { type: routeType }
        }]
      });

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        startRoutePulse();
      }
    }
    requestAnimationFrame(frame);

    // Zoom to Route (sofort, unabhängig von Animation)
    fitBoundsToRoute(coordinates);
    console.log(`✓ Route gezeichnet (${routeType}) mit ${total} Punkten`);
  } catch (err) {
    console.error('Fehler bei drawRoute:', err);
  }
}

// Fit bounds zur Route
function fitBoundsToRoute(coordinates) {
  try {
    if (!coordinates || coordinates.length === 0) return;

    const bounds = coordinates.reduce((b, coord) => {
      return [
        [Math.min(b[0][0], coord[0]), Math.min(b[0][1], coord[1])],
        [Math.max(b[1][0], coord[0]), Math.max(b[1][1], coord[1])]
      ];
    }, [[coordinates[0][0], coordinates[0][1]], [coordinates[0][0], coordinates[0][1]]]);

    map.fitBounds(bounds, { padding: 50, duration: 1000 });
  } catch (err) {
    console.error('Fehler bei fitBoundsToRoute:', err);
  }
}

// Entferne Route
function clearRoute() {
  try {
    stopRoutePulse();
    if (!map || !map.getSource('route-source')) return;
    map.getSource('route-source').setData({
      type: 'FeatureCollection',
      features: []
    });
    console.log('✓ Route gelöscht');
  } catch (err) {
    console.error('Fehler bei clearRoute:', err);
  }
}

// ────────── POI ANZEIGEN ──────────────────────────────────────────
function showPOIs(pois) {
  try {
    if (!map || !map.getSource('poi-source')) return;

    const features = pois.map((poi, idx) => ({
      type: 'Feature',
      id: idx,
      geometry: {
        type: 'Point',
        coordinates: [poi.lng || poi.lon, poi.lat]
      },
      properties: {
        name: poi.name,
        type: poi.type,
        icon: poi.icon
      }
    }));

    map.getSource('poi-source').setData({
      type: 'FeatureCollection',
      features: features
    });

    console.log(`✓ ${features.length} POIs angezeigt`);
  } catch (err) {
    console.error('Fehler bei showPOIs:', err);
  }
}

// ────────── VIEWPORT MANAGEMENT ──────────────────────────────────────
function flyTo(lngLat, zoom = 12, duration = 1500) {
  if (!map) return;
  map.flyTo({
    center: lngLat,
    zoom: zoom,
    duration: duration
  });
}

function panTo(lngLat) {
  if (!map) return;
  map.easeTo({
    center: lngLat,
    duration: 1000
  });
}

function setZoom(z) {
  if (!map) return;
  map.setZoom(z);
}

function getZoom() {
  return map ? map.getZoom() : 0;
}

function getCenter() {
  return map ? map.getCenter() : null;
}

// ────────── EXPORT FÜR EXTERNE MODULE ──────────────────────────────────────
// Navigation, Routing, POI etc. nutzen diese Funktionen

window.MapAPI = {
  initMap,
  switchLayer,
  addMarker,
  clearRouteMarkers,
  clearPOIMarkers,
  removeUserMarker,
  drawRoute,
  fitBoundsToRoute,
  clearRoute,
  startRoutePulse,
  stopRoutePulse,
  showPOIs,
  flyTo,
  panTo,
  setZoom,
  getZoom,
  getCenter,
  getMap: () => map
};

console.log('✓ map.js (Maplibre GL) geladen');
