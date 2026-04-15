'use strict';
// ── TourCast config.js – App-Konstanten & Cloud-Keys ──
const APP = {
  version:        'v2.0.0',
  defaultCenter:  [48.37, 10.9],
  defaultZoom:    11,

  tileUrl:        'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
  tileAttrib:     '© <a href="https://openstreetmap.org">OpenStreetMap</a> DE',

  orsApi:         'https://api.openrouteservice.org/v2/directions/driving-car',
  orsKey:         null, // Wird von index.html/Electron initialisiert!
  nominatim:      'https://nominatim.openstreetmap.org/search',
  openmeteo:      'https://api.open-meteo.com/v1/forecast',
  elevationApi:   'https://api.opentopodata.org/v1/srtm30m',
  overpass:       'https://overpass-api.de/api/interpreter',

  dropboxKey:     'TODO_DROPBOX_APP_KEY',
  oneDriveId:     'TODO_ONEDRIVE_CLIENT_ID',
  googleApiKey:   'TODO_GOOGLE_API_KEY',
  googleClientId: 'TODO_GOOGLE_CLIENT_ID',

  graphhopperEnabled: false
};