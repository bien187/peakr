# Wanderroute in swisstopo öffnen und als GPX herunterladen

Stand 13.11.2026. Beide Funktionen stehen in der Detailansicht eines Wanderziels unter der gewählten
Routenvariante. Sie erscheinen nur, wenn die Variante eine Linie mit mindestens zwei Punkten hat.
Ohne berechnete Route (Ziel «ohne Route») gibt es keine Buttons.

| Button | Wirkung |
|---|---|
| **In Swisstopo öffnen** (Kartensymbol) | Öffnet [map.geo.admin.ch](https://map.geo.admin.ch) in einem neuen Tab bzw. in der swisstopo-App. Zu sehen sind die Landeskarte, das amtliche Wanderwegnetz und die Route als eigene Ebene, auf den Routenausschnitt gezoomt. |
| **GPX herunterladen** (Downloadsymbol) | Lädt `peakr_wanderroute_<name>.gpx` direkt im Browser herunter. Die Datei wird lokal aus den bereits geladenen Routendaten erzeugt, ohne weiteren Serveraufruf. |

## Wie die Übergabe an swisstopo funktioniert

Der Link verwendet ausschliesslich Parameter des offiziellen Viewers:

```
https://map.geo.admin.ch/#/map?lang=de&center=<E>,<N>&z=<0–10>
  &bgLayer=ch.swisstopo.pixelkarte-farbe
  &layers=ch.swisstopo.swisstlm3d-wanderwege;GPX|https://peakr-ch.vercel.app/api/destinations/<id>/routes/<variante>/gpx
```

- `lang`, `center` (LV95), `z`, `bgLayer` und `layers` sind in der
  [Parameterdokumentation](https://docs.geo.admin.ch/map-viewer/url-parameters.html) und der
  [Parameterliste von swisstopo](https://www.geo.admin.ch/en/changes-of-the-url-parameters-2024)
  beschrieben.
- **Externe Ebenen** stehen im `layers`-Parameter als `TYP|URL`. Die öffentliche Seite zeigt das nur
  am Beispiel `WMS|…`. Die Schreibweise `GPX|<URL>` ist im Architekturentscheid des offiziellen Viewers
  festgelegt ([geoadmin/web-mapviewer, `adr/2021_03_16_url_param_structure.md`](https://github.com/geoadmin/web-mapviewer/blob/develop/adr/2021_03_16_url_param_structure.md)).
  Der Viewer setzt sie in `LayerParamConfig.class.js` um und prüft sie in seinen eigenen
  End-to-End-Tests (`importToolFile.cy.js`). Es ist dieselbe Funktion wie *Erweiterte Werkzeuge →
  Import* mit einer Online-Datei.
- **Ausschnitt:** Zentrum ist die Mitte der Route, umgerechnet nach LV95 mit den Näherungsformeln von
  swisstopo (~1 m). Die Zoomstufe richtet sich nach den Auflösungen des Viewers (650 … 0,1 m/px,
  `LV95_RESOLUTIONS`) und der Fenstergrösse. Die ganze Route soll mit Rand sichtbar sein, gezoomt wird
  höchstens bis 1 m/px.
- **Laden der Datei:** Den Inhalt holt der Viewer selbst. Er fragt zuerst per `HEAD` den Inhaltstyp ab
  (`application/gpx+xml`; der Wert wird wörtlich verglichen, deshalb ohne `charset`) und lädt dann
  per `GET`. Dafür braucht es HTTPS und CORS. Der Endpunkt
  `GET|HEAD|OPTIONS /api/destinations/<id>/routes/<variante>/gpx` sendet
  `Access-Control-Allow-Origin: *`. Fehlt CORS, weicht der Viewer auf seinen eigenen Proxy aus.
- Die Datei des Endpunkts entsteht mit **derselben Funktion** wie der Download im Browser
  (`routeGpx()` in `packages/shared/src/gpx.ts`). Browser-Datei und swisstopo-Ebene sind deshalb bis
  auf den Erstellungszeitpunkt identisch (im Browsertest geprüft).

**Lokale Entwicklung:** swisstopo kann `http://localhost` nicht erreichen. Ausserhalb einer
öffentlichen HTTPS-Adresse öffnet der Link deshalb nur den Kartenausschnitt mit dem Wanderwegnetz. Der
Hinweis unter den Buttons erklärt, wie die heruntergeladene GPX-Datei im Viewer über «Import»
ergänzt wird.

## Wie die GPX-Datei aufgebaut ist

GPX 1.1 (`http://www.topografix.com/GPX/1/1`), Elementreihenfolge laut offiziellem Schema.

| Teil | Inhalt |
|---|---|
| `metadata` | Name «<Ziel> ab <Ausgangspunkt>», Beschreibung (Distanz, Auf-/Abstieg, Gehzeit nach DIN 33466, SAC, Anteil signalisierter Wege, Herkunft der Höhen, Hinweis «berechnet, nicht begangen», Berechnungsdatum), Quellen (© swisstopo, © OpenStreetMap-Mitwirkende/ODbL), Link zur Detailseite in Peakr, Erstellungszeit, Grenzen (`bounds`) |
| `wpt` Start | Parkplatz bzw. Strassenzugang mit Name (oder «Parkplatz auf … m») und Höhe |
| `wpt` am Weg | Benannte Ziele aus swissNAMES3D/OSM (Hütten, Berggasthäuser, Pässe, Seen, Aussichtspunkte, Gipfel), die höchstens 50 m neben dem Weg liegen, in Gehrichtung, mit amtlicher Objektart und Wegstrecke ab Start, höchstens 30 |
| `wpt` Ziel | Zielpunkt mit amtlicher Höhe |
| `trk` | Ein Segment mit allen gespeicherten Stützpunkten, Typ `hiking` |

- **Koordinaten:** WGS84, `lat`/`lon` mit 6 Nachkommastellen (~0,1 m). Ungültige Werte (NaN,
  ausserhalb −90…90 / −180…<180) werden verworfen, direkt aufeinanderfolgende identische Punkte
  entfernt. Rundwege bleiben erhalten.
- **Höhen:** Nur gespeicherte Werte, nie geschätzt. Fehlt eine Höhe, fehlt das `<ele>` dieses Punkts.
  Quelle sind die 3D-Koordinaten der amtlichen Wanderwege (swissTLM3D), sonst das Geländemodell
  (Terrain Tiles, über ±50 m geglättet), am Ziel die amtliche Gipfelhöhe.
- **Text:** XML-Sonderzeichen werden maskiert, in XML verbotene Steuerzeichen entfernt.
- **Dateiname:** `peakr_wanderroute_<name>.gpx`. Umlaute werden umgeschrieben (ä→ae …), Akzente
  entfernt, alles andere wird zu `_`, höchstens 60 Zeichen, Ersatzname `route`. Hat ein Ziel mehrere
  Varianten, folgt `_variante_<n>`.

### Höhen je Stützpunkt (Migration 0003)

Bis zu dieser Version speicherte die Pipeline nur die 2D-Linie. Neu hält `hike_routes.elevations`
(`smallint[]`) die Höhe je Stützpunkt, in derselben Reihenfolge wie `geom`. Die Linienvereinfachung
(Douglas-Peucker, 10 m seitlich) behält zusätzlich jeden Punkt, der mehr als 5 m vom interpolierten
Höhenprofil abweicht. Sonst würden Kuppen und Senken zwischen zwei Stützpunkten verschwinden.
Durchschnittlich hat eine Route 39 Stützpunkte, höchstens 223.

Der aus den gespeicherten Punkten berechnete Aufstieg weicht vom Peakr-Wert (voller Verlauf) im Median
um 0,3 % ab; bei 90 % der Routen beträgt die Abweichung höchstens 6 %. Grundlage ist die Auswertung
aller 22'403 Routen vom 13.11.2026.

**Übergang:** Die Spalte entsteht mit der Migration im nächsten Lauf von «Peakr Daten». Erst dieser
Lauf füllt sie. Bis dahin enthalten GPX-Dateien keine Höhen je Punkt, und der Hinweis unter den Buttons
sagt das. Die Detailseite prüft, ob die Spalte existiert, und bricht deshalb vorher nicht ab.

## Einschränkungen

- Die Route ist **aus dem Wegnetz berechnet**, nicht begangen. Die Linie ist um höchstens 10 m seitlich
  vereinfacht. Sperrungen, Verhältnisse und Ausrüstung müssen vor der Tour selbst geprüft werden. Das
  steht auch in der Datei.
- Endet der erfasste Weg vor dem Zielpunkt, liegt der Ziel-Wegpunkt neben dem Track. Die Beschreibung
  nennt den Abstand.
- Der swisstopo-Link lädt die Route **live** von Peakr. Ist Peakr nicht erreichbar, zeigt swisstopo nur
  Karte und Wanderwegnetz mit einer Fehlermeldung zur Ebene.
- Der Link verweist auf «Variante n» eines Ziels. Nach dem wöchentlichen Neuaufbau kann diese
  Variante anders verlaufen, etwa ab einem anderen Parkplatz. Ein alter Link zeigt dann die aktuelle
  Variante n.
- Wegpunkte entlang der Route kommen nur aus den Peakr-Zielen (swissNAMES3D und OSM). Wegweiser,
  Haltestellen und andere Punkte sind nicht enthalten.

## Kosten und Limits

Es entstehen keine Kosten. Der Download braucht keinen Serveraufruf, weil die Daten mit der
Detailseite bereits geladen sind. Ein Öffnen in swisstopo erzeugt eine `HEAD`- und eine `GET`-Anfrage
an Peakr; Vercel hält die Antwort eine Stunde im Edge-Cache (`s-maxage=3600`). Das ist eine
Datenbankabfrage pro Route und Stunde. Der swisstopo-Viewer ist ein frei nutzbarer Dienst des Bundes.
Es wird kein Schlüssel und kein Konto gebraucht.

## Tests

- `packages/shared/test/gpx.test.ts`:
  - Gültigkeit gegen das offizielle GPX-1.1-Schema mit `xmllint`;
  - vollständiger Track, Reihenfolge, lat/lon nicht vertauscht;
  - Doppelpunkte und ungültige Koordinaten;
  - Höhen nur wenn vorhanden;
  - Maskierung und Dateinamen;
  - echte Route (Rigi Kulm) gegen eine Referenzdatei;
  - Einlesen mit togeojson;
  - swisstopo-Link: dokumentierte Parameter, Zerlegung wie im Viewer, Zentrum und Zoom, keine Übergabe nicht ladbarer Adressen.
- `packages/shared/test/gpx.openlayers.test.ts`: Einlesen mit OpenLayers `ol/format/GPX` in der Version des swisstopo-Viewers. Geprüft werden Track, Höhen, Wegpunkte und Metadaten.
- `apps/backend/src/pipeline/hikeGraph.test.ts`: höhenbewusste Linienvereinfachung.
- Browsertest (Chrome, Desktop 1280×900 und Mobil 390×844):
  - Buttons sichtbar, mindestens 42 px hoch, auf dem Handy volle Breite;
  - Download mit korrektem Dateinamen, schemagültig und identisch zur Serverdatei;
  - swisstopo öffnet in einem neuen Tab;
  - keine Skriptfehler.
- Endpunkt: `GET` 200 mit `application/gpx+xml`, CORS und Dateiname; `HEAD`; Preflight `OPTIONS` 204;
  unbekannte Variante 404; ungültige ID bzw. Variante 400.
