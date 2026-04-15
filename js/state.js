// ── Globaler App-State ────────────────────────────────────
'use strict';
console.log('📦 state.js loaded successfully');

let currentLat              = null;
let currentLng              = null;
let departureTime           = null;
let lastGripScore           = null;
let lastGngStatus           = null;
let lastRouteCoords         = [];
let lastRouteDistKm         = 0;
let lastRouteDurMin         = 0;
let waypoints               = [];
let currentWeather          = null;

// ── 3 Fahrerprofil-Presets (Global verfügbar) ────────────────
const PROFILE_PRESETS = {
  sport: {
    label:             'Sport',
    speedKmh:          110,
    tankVolumeLiters:  17,
    consumptionL100km: 7.0,
    reserveLiters:     2.5,
    thresholds: {
      tempDanger: 2,  tempCaution: 8,
      windDanger: 60, windCaution: 40,
      rainDanger: 2.0, rainCaution: 0.5,
      gustDanger: 90, gustCaution: 65,
      gripDanger: 20, gripCaution: 40
    }
  },
  touring: {
    label:             'Touring',
    speedKmh:          80,
    tankVolumeLiters:  18,
    consumptionL100km: 5.5,
    reserveLiters:     3.0,
    thresholds: {
      tempDanger: 5,  tempCaution: 12,
      windDanger: 50, windCaution: 30,
      rainDanger: 2.0, rainCaution: 0.5,
      gustDanger: 80, gustCaution: 60,
      gripDanger: 25, gripCaution: 45
    }
  },
  adventure: {
    label:             'Adventure',
    speedKmh:          70,
    tankVolumeLiters:  22,
    consumptionL100km: 6.5,
    reserveLiters:     4.0,
    thresholds: {
      tempDanger: 0,  tempCaution: 5,
      windDanger: 70, windCaution: 45,
      rainDanger: 5.0, rainCaution: 1.0,
      gustDanger: 100, gustCaution: 70,
      gripDanger: 15, gripCaution: 35
    }
  }
};

// Rider-Profil – wird von app.js mit loadProfile() befüllt
// Hier nur die Struktur als Fallback-Default
let profile = {
  speedKmh: 80,
  radius: 150,
  tankVolumeLiters: 18,
  consumptionL100km: 5.5,
  reserveLiters: 3.0,
  theme: 'light',
  routingPreference: 'standard',
  preset: 'touring',
  thresholds: {
    tempDanger: 5,   tempCaution: 12,
    windDanger: 50,  windCaution: 30,
    rainDanger: 2.0, rainCaution: 0.5,
    gustDanger: 80,  gustCaution: 60,
    gripDanger: 25,  gripCaution: 45
  }
};
