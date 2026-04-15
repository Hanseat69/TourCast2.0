# TourCast Pro 2.0 — Windows 11 Desktop Edition

> **Hilfe gesucht!** Dieses Projekt hat drei aktive Bugs im Touren-Erstellungs-Workflow, die ich bisher nicht lösen konnte. Wer Erfahrung mit Leaflet.js, OpenRouteService oder der Overpass API hat: jeder Beitrag ist willkommen. Details im Abschnitt [Bekannte Fehler](#bekannte-fehler--hilfe-gesucht).

Ein Desktop-Tourenbegleiter für Motorradfahrer, gebaut mit **Electron** und **Windows 11 Fluent UI**. Die App ermöglicht die Planung von A-nach-B-Routen und Rundtouren, zeigt das Wetter entlang der Strecke, sucht POIs (Tankstellen, Parkplätze, Restaurants, Aussichtspunkte …), exportiert GPX-Tracks und visualisiert die Straßenqualität über eine Grip-Heatmap.

---

## Inhaltsverzeichnis

- [Funktionen](#funktionen)
- [Tech-Stack](#tech-stack)
- [Installation](#installation)
- [Konfiguration — API-Keys](#konfiguration--api-keys)
- [Projektstruktur](#projektstruktur)
- [Bekannte Fehler / Hilfe gesucht](#bekannte-fehler--hilfe-gesucht)
- [Beitragen](#beitragen)
- [Autor](#autor)

---

## Funktionen

- A-nach-B-Routing und Rundtouren-Generierung über **OpenRouteService**
- Routenvisualisierung auf einer **MapLibre GL / Leaflet**-Karte mit farbcodierten Straßentypen
- Wettervorhersage entlang der Route (Open-Meteo)
- POI-Suche entlang der Route über die **Overpass API** (Tankstellen, Parkplätze, Restaurants, Cafés, Aussichtspunkte, Ladestationen)
- Höhenprofil
- GPX-Import & -Export
- Grip-Heatmap (Straßenzustand-Risikoindikator)
- Windows-11-Fluent-UI-Design mit nativen Fenstersteuerungen über Electron IPC

---

## Tech-Stack

| Schicht | Technologie |
|---|---|
| Desktop-Shell | Electron 28, electron-store |
| Karten-Rendering | Leaflet.js + MapLibre GL JS |
| Routing | OpenRouteService API v2 (ORS) |
| Geocoding | Nominatim (OpenStreetMap) |
| POI-Daten | Overpass API |
| Wetter | Open-Meteo |
| Höhendaten | OpenTopoData (SRTM 30m) |
| UI | Windows 11 Fluent UI (eigene CSS-Tokens) |

---

## Installation

```bash
# Repository klonen
git clone https://github.com/<dein-username>/TourCast2.0.git
cd TourCast2.0

# Abhängigkeiten installieren
npm install

# App starten
npm start
```

Voraussetzung: **Node.js 18+** und **npm**.

---

## Konfiguration — API-Keys

Die Dateien `.env` und `.env.example` sind über `.gitignore` vom Repository ausgeschlossen.  
Lege eine neue `.env`-Datei an und trage deinen ORS-Key ein:

```
ORS_API_KEY=dein_ors_api_key_hier
```

Einen kostenlosen ORS-Key erstellst du unter <https://openrouteservice.org/sign-up/>.

Der Key wird in `js/config.js` unter `APP.orsKey` verwendet und im Electron-Build über das Preload-Script aus der `.env`-Datei injiziert.

---

## Projektstruktur

```
W11-TourCast 2.0/
├── index.html           # Einstiegspunkt der Anwendung
├── main.js              # Electron Main Process
├── preload.js           # Electron Preload / IPC-Bridge
├── package.json
├── js/
│   ├── config.js        # App-Konstanten & API-Endpunkte
│   ├── navigation.js    # A-nach-B-Routing, Rundtouren, Fahrtrichtungspfeile
│   ├── poi.js           # POI-Suche über Overpass API
│   ├── routing.js       # Karten-Pick-Modus, Reverse Geocoding
│   ├── map-maplibre.js  # MapLibre-GL-Style & Layer-Definitionen
│   ├── map.js           # Leaflet-Karten-Initialisierung
│   ├── weather-engine.js
│   ├── elevation.js
│   ├── roundtrip.js
│   └── ...
├── css/                 # Windows-11-Fluent-UI-Stylesheets
├── fonts/
└── icons/
```

---

## Bekannte Fehler / Hilfe gesucht

Die folgenden drei Bugs betreffen den **zentralen Touren-Erstellungs-Workflow**. Eine Route kann berechnet werden, das Ergebnis wird aber fehlerhaft dargestellt. Beiträge, Hinweise oder auch nur ein Code-Review, der die Ursache einkreist, sind ausdrücklich erwünscht.

---

### Bug 1 — POIs werden nicht angezeigt

**Symptom:** Nach der Routenberechnung werden beim Klick auf einen POI-Button (Tankstellen, Parkplätze, Restaurants …) keine Ergebnisse angezeigt. Die Karte bleibt leer, es werden keine Marker gesetzt.

**Erwartetes Verhalten:** POIs innerhalb von ~5 km um die Route sollen über die Overpass API abgerufen und als Marker auf der Karte angezeigt werden.

**Betroffene Dateien:**
- [`js/poi.js`](js/poi.js) — `togglePOI()`, `loadPOIsAlongRoute()`, `isWithinRoutePuffer()`
- [`js/navigation.js`](js/navigation.js) — befüllt das globale Array `lastRouteCoords` nach einer erfolgreichen ORS-Antwort

**Vermutete Ursache / offene Fragen:**
- Ist `lastRouteCoords` zum Zeitpunkt des `togglePOI()`-Aufrufs tatsächlich befüllt und verfügbar?  
  Die Variable wird in `navigation.js` geschrieben, aber in `poi.js` gelesen — könnte die Lade-Reihenfolge der Skripte ein Problem sein?
- Schlägt die Overpass-API-Anfrage fehl? Gibt es einen CORS- oder Rate-Limit-Fehler in der Konsole?
- Der Entfernungsfilter `isWithinRoutePuffer()` könnte alle Ergebnisse verwerfen, wenn `lastRouteCoords` `{lat, lng}`-Objekte enthält, die Funktion aber `[lat, lng]`-Arrays erwartet — oder umgekehrt.

---

### Bug 2 — Start- und Zielpunkt erscheinen neben der dargestellten Strecke

**Symptom:** Nach der Routenberechnung werden die grüne Startfahne und die karierte Zielfahne deutlich versetzt neben der Routenlinie platziert — immer, unabhängig davon, ob die Adresse eingetippt, aus der Autocomplete-Liste ausgewählt oder direkt auf der Karte angeklickt wurde.

**Erwartetes Verhalten:** Der Startmarker soll genau auf dem ersten Punkt der Routen-Polylinie sitzen, der Zielmarker auf dem letzten Punkt.

**Betroffene Dateien:**
- [`js/navigation.js`](js/navigation.js) — ca. Zeile 541 und 554: `L.marker([startLat, startLng], ...)` / `L.marker([endLat, endLng], ...)`

**Vermutete Ursache:**  
Die Marker werden an den Nominatim-gecodierten Koordinaten platziert (`startLat`/`startLng` aus den `data-lat`/`data-lng`-Attributen des Eingabefelds). ORS rastet die Route jedoch am nächstgelegenen Straßennetzknoten ein, sodass `coords2D[0]` (der tatsächliche erste Routenpunkt) von der gecodierten Adresse abweichen kann. Der wahrscheinliche Fix wäre, die Marker stattdessen bei `coords2D[0]` und `coords2D[coords2D.length - 1]` zu setzen.

---

### Bug 3 — Fahrtrichtungspfeile auf der Route zeigen in die falsche Richtung

**Symptom:** Die kleinen Richtungspfeil-Icons auf der Routenlinie zeigen nicht in die korrekte Fahrtrichtung. Sie sind falsch rotiert (möglicherweise um 90° oder 180° verdreht). Die Pfeile erscheinen nicht auf der Strecke sondern irgendwo daneben. Je weiter man herausscrollt desto senkrechter erscheinen sie, wie an einem Faden aufgehängt.

**Erwartetes Verhalten:** Die Pfeile sollen gleichmäßig verteilt entlang der Route in Fahrtrichtung — vom Start zum Ziel — zeigen.

**Betroffene Dateien:**
- [`js/navigation.js`](js/navigation.js) — Funktion `addDirectionArrows()` (ab ca. Zeile 749)

**Vermutete Ursache / offene Fragen:**
- Der Bearing wird mit der Standard-Vorwärts-Azimut-Formel (Haversine) berechnet. Liefert sie korrekte Werte (0° = Nord, 90° = Ost)?
- Das SVG-Pfad-Element `M10 3L17 15L10 12L3 15Z` zeigt **nach oben** (Spitze bei y=3). Bei `bearing=0°` sollte `rotate(0deg)` den Pfeil nach Norden zeigen lassen — ist das tatsächlich der Fall?
- Könnte das Problem sein, dass `coords2D` intern als `[lng, lat]` statt als `[lat, lng]` gespeichert ist? Das würde Längen- und Breitengrad bei der Berechnung vertauschen und den Azimut umkehren.
- Ist `transform-origin: 50% 50%` im `<div>` korrekt relativ zum Leaflet-`iconAnchor: [10, 10]`?

---

## Beitragen

1. Repository forken und einen Feature-Branch anlegen.
2. Pull Request mit einer Beschreibung der Änderung öffnen — bei Bedarf mit Vorher/Nachher-Screenshots.
3. Für Fehlermeldungen bitte die Electron-/Browser-Konsolenausgabe und die genauen Reproduktionsschritte angeben.

Ein automatisiertes Test-Setup existiert noch nicht. Die Baseline ist aktuell manuelles Testen in der Electron-App.

---

## Autor

**Burkhard Wolff** — Entwicklung  
TourCast Pro 2.0 · April 2026
