# TourCast Pro 2.0 — Windows 11 Desktop Edition

> **Help wanted!** This project has three active bugs in the tour-creation workflow that I am struggling to resolve. If you have experience with Leaflet.js, OpenRouteService, or Overpass API, any contribution is greatly appreciated. See the [Known Issues](#known-issues--help-wanted) section below.

A desktop touring-companion app built with **Electron** and **Windows 11 Fluent UI**. It lets riders plan A-to-B routes and round trips, displays weather conditions along the route, shows POIs (fuel, parking, restaurants, viewpoints, …), exports GPX tracks, and visualises road-surface quality via a grip heatmap.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Installation](#installation)
- [Configuration — API Keys](#configuration--api-keys)
- [Project Structure](#project-structure)
- [Known Issues / Help Wanted](#known-issues--help-wanted)
- [Contributing](#contributing)
- [Author](#author)

---

## Features

- A-to-B routing and round-trip generation via **OpenRouteService**
- Route visualisation on a **MapLibre GL / Leaflet** map with colour-coded road types
- Weather forecast along the route (Open-Meteo)
- POI search along the route via **Overpass API** (fuel, parking, restaurants, cafés, viewpoints, charging stations)
- Elevation profile
- GPX import & export
- Grip heatmap (road-surface risk indicator)
- Windows 11 Fluent UI design with native window controls via Electron IPC

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 28, electron-store |
| Map rendering | Leaflet.js + MapLibre GL JS |
| Routing | OpenRouteService API v2 (ORS) |
| Geocoding | Nominatim (OpenStreetMap) |
| POI data | Overpass API |
| Weather | Open-Meteo |
| Elevation | OpenTopoData (SRTM 30m) |
| UI | Windows 11 Fluent UI (custom CSS tokens) |

---

## Installation

```bash
# Clone the repository
git clone https://github.com/<your-username>/TourCast2.0.git
cd TourCast2.0

# Install dependencies
npm install

# Start the app
npm start
```

Requires **Node.js 18+** and **npm**.

---

## Configuration — API Keys

Copy the example environment file and fill in your keys:

```bash
cp .env.example.template .env
```

> `.env` and `.env.example` are excluded from this repository via `.gitignore`.  
> Create a free ORS key at <https://openrouteservice.org/sign-up/>.

The app reads `APP.orsKey` from `js/config.js`. In the Electron build it is injected via the preload script from the `.env` file.

---

## Project Structure

```
W11-TourCast 2.0/
├── index.html           # Application entry point
├── main.js              # Electron main process
├── preload.js           # Electron preload / IPC bridge
├── package.json
├── js/
│   ├── config.js        # App constants & API endpoints
│   ├── navigation.js    # A-to-B routing, round trips, direction arrows
│   ├── poi.js           # POI search via Overpass API
│   ├── routing.js       # Map-pick mode, reverse geocoding
│   ├── map-maplibre.js  # MapLibre GL style & layer definitions
│   ├── map.js           # Leaflet map initialisation
│   ├── weather-engine.js
│   ├── elevation.js
│   ├── roundtrip.js
│   └── ...
├── css/                 # Windows 11 Fluent UI stylesheets
├── fonts/
└── icons/
```

---

## Known Issues / Help Wanted

The following three bugs affect the **core tour-creation workflow**. A route can be calculated, but the result is displayed incorrectly. Contributions, hints, or even just a code review pointing to the root cause are very welcome.

---

### Bug 1 — POIs are not displayed

**Symptom:** Clicking any POI button (Fuel, Parking, Restaurants, …) after a route has been calculated produces no result. The map stays empty; no markers are added.

**Expected behaviour:** POIs within ~5 km of the route should be fetched from Overpass API and shown as map markers.

**Relevant files:**
- [`js/poi.js`](js/poi.js) — `togglePOI()`, `loadPOIsAlongRoute()`, `isWithinRoutePuffer()`
- [`js/navigation.js`](js/navigation.js) — sets the global `lastRouteCoords` array after a successful ORS response

**Suspected cause / questions:**
- Is `lastRouteCoords` actually populated and in scope when `togglePOI()` is called?  
  The global is defined and written in `navigation.js` but read in `poi.js` — could there be a module-load-order issue?
- Does the Overpass API query itself succeed? Is there a CORS or rate-limit error in the browser console?
- The `isWithinRoutePuffer()` distance filter might reject all results if `lastRouteCoords` contains `{lat, lng}` objects but the filter expects `[lat, lng]` arrays (or vice versa) — check coordinate format consistency.

---

### Bug 2 — Start and end markers appear offset from the route

**Symptom:** After a route is calculated, the green start flag and the checkered end flag are placed noticeably off the drawn route line — always, regardless of whether the address was typed, selected from autocomplete, or picked directly on the map.

**Expected behaviour:** The start marker should sit exactly on the first point of the route polyline; the end marker on the last point.

**Relevant files:**
- [`js/navigation.js`](js/navigation.js) — lines ~541 and ~554: `L.marker([startLat, startLng], ...)` / `L.marker([endLat, endLng], ...)`

**Suspected cause:**  
The markers are placed at the Nominatim-geocoded coordinates (`startLat`/`startLng` from the input field's `data-lat`/`data-lng` attributes). ORS, however, snaps the route to the nearest road-network node, so `coords2D[0]` (the actual first route point) can differ from the geocoded address point. The likely fix is to place the markers at `coords2D[0]` and `coords2D[coords2D.length - 1]` instead.

---

### Bug 3 — Direction arrows on the route point the wrong way

**Symptom:** The small directional arrow icons overlaid on the route polyline do not indicate the correct travel direction. They appear rotated incorrectly (possibly 90° or 180° off). The arrows do not appear on the route line itself but are offset to the side. The further you zoom out, the more they drift vertically — as if hanging from a thread above the map.

**Expected behaviour:** Arrows should point in the direction of travel — from start toward destination — at evenly distributed positions along the route.

**Relevant files:**
- [`js/navigation.js`](js/navigation.js) — `addDirectionArrows()` (around line 749)

**Suspected cause / questions:**
- The bearing is calculated with a standard forward-azimuth formula (haversine). Does it produce correct values (0° = North, 90° = East)?
- The SVG arrow path `M10 3L17 15L10 12L3 15Z` points **upward** (tip at y=3). At `bearing=0°` the CSS `rotate(0deg)` leaves it pointing north — is that actually what is rendered?
- Could the issue be that `coords2D` is stored in a different format (e.g. `[lng, lat]` instead of `[lat, lng]`) which causes `lat1`/`lat2`/`dLng` to swap, reversing the computed azimuth?
- Is the `transform-origin: 50% 50%` placement correct relative to Leaflet's `iconAnchor: [10, 10]`?

---

## Contributing

1. Fork the repository and create a feature branch.
2. Open a pull request with a description of the change and, if applicable, a before/after screenshot.
3. For bug reports, please include the browser/Electron console output and the exact steps to reproduce.

There is no test suite yet — manual testing in the Electron app is currently the baseline.

---

## Author

**Burkhard Wolff** — initial development  
TourCast Pro 2.0 · April 2026
