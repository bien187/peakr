# Peakr – Architektur und Entscheidungen (Stand 13.11.2026)

## Überblick

```
                ┌──────────────────────── Vercel (Hobby, fra1) ──────────────────┐
 Browser ──────►│ Next.js: Oberfläche + app/api/* (dünne Hüllen)                 │
                │        └─► apps/backend/src/server  ◄── road-graph.bin (40 MB) │
                │                                     ◄── search-index.json.gz   │
                └───────────────────────────────┬────────────────────────────────┘
                                                │ SQL (postgres.js, TLS, Pooler)
                                     ┌──────────▼──────────┐
                                     │  Neon PostgreSQL    │  PostGIS, Frankfurt
                                     └──────────▲──────────┘
                ┌───────────────────────────────┴────────────────────────────────┐
                │ GitHub Actions                                                  │
                │  «Peakr Worker»  ski 3 h · weather 6 h · trend wöchentlich ·    │
                │                  maintenance täglich                            │
                │  «Peakr Daten»   wöchentlich: Pipeline → Release data-latest →  │
                │                  Vercel-Deploy-Hook → Zeitpläne aktiv halten    │
                └─────────────────────────────────────────────────────────────────┘
```

Es gibt **eine** Implementierung der API (`apps/backend/src/server/index.ts`). Die Next.js-Routen
rufen sie nur auf; Validierung, Fehlerformat und Rate-Limits sind damit überall gleich. Die frühere
zweite Implementierung (Fastify) ist entfernt.

## Datenmodell

| Tabelle | Inhalt |
|---|---|
| `destinations` | Ziele (Wandern und Ski). Getrennt gehalten: Existenz (Zeile), Metadaten-Qualität (`quality_score`), Wanderbarkeit (`route_status`), Herkunft (`source_layer`, `destination_sources`). Stillgelegt statt gelöscht (`retired_at`). |
| `destination_sources` | Eindeutige Quellenreferenz → Ziel (swissNAMES3D-UUID, OSM-ID). Damit bleiben IDs und Favoriten über Importe stabil. |
| `trailheads` | Parkplätze, Strassenzugänge, Talstationen; `drive_lat/lng` = Punkt auf dem Strassengraphen, `road_snap_m` = Abstand dorthin, `quality` 1–3. |
| `hike_routes` | Bis zu 3 Routen je Ziel: Linie (LineString 4326), Höhe je Stützpunkt (`elevations`), Distanz, Auf-/Abstieg, Gehzeit hin/zurück, SAC min/max, Anteil amtlich signalisiert, Abstand Wegende–Ziel. |
| `trail_closures`, `route_closures` | Gemeldete Sperrungen/Umleitungen auf Wanderwegen und ihre Zuordnung zu den Routen (Überlappung, Umleitung vorhanden). |
| `snow_observations` | Letzte Schneehöhe je Messstation (SLF IMIS, MeteoSchweiz). |
| `weather_cells.forecast` | Stündliche Prognose je 0,1°-Zelle für heute bis übermorgen (Tourplanung, Wetterkarte). |
| `ski_resort_details`, `ski_lifts` | Gruppierte Skigebiete, Anlagen nach Typ, Pistenkilometer nach Schwierigkeit, Talstation. |
| `live_status` | Verlauf der Bedingungen je Skigebiet (120 Tage). |
| `weather_cells` | Wetterraster 0,1° für Wanderziele, überschrieben statt angehängt. |
| `avalanche_regions`, `cantons` | Polygone für die Zuordnung per `ST_Contains`. |
| `data_sources`, `import_runs`, `app_meta`, `job_locks`, `rate_limits` | Herkunft und Stand, Protokoll aller Läufe, Datenversion, Sperren gegen Parallelläufe, Rate-Limits über Serverless-Instanzen hinweg. |

Alle Geometrien sind WGS84 (EPSG:4326) mit GiST-Index. LV95-Daten (swisstopo) werden beim Import
umgerechnet (`apps/backend/src/geo/lv95.ts`, Näherungsformeln von swisstopo, < 2 m).

Migrationen: `apps/backend/drizzle/*.sql`, angewendet mit `pnpm db:migrate`. `0002_postgis_rebuild`
ist additiv: bestehende Ziele, Konten und Favoriten bleiben erhalten; alte OSM-Referenzen werden
übernommen. Getestet gegen eine leere und gegen eine Kopie einer Datenbank mit Altdaten.

## Datenpipeline (`pnpm pipeline`)

| Schritt | Was passiert |
|---|---|
| `prepare` | Lädt swissNAMES3D (CSV), swissTLM3D-Wanderwege (GeoPackage) und den Geofabrik-Auszug (`.osm.pbf`). `osmium` filtert daraus Strassen-/Wegnetz, Ziele/Parkplätze/Skiobjekte und Kantonsgrenzen. Downloads werden 20 h wiederverwendet (`--refresh` erzwingt neu). |
| `slf` | SLF-Warnregionen als Polygone. |
| `destinations` | swissNAMES3D-Objektarten (Gipfel, Hügel, Pässe, Aussichtspunkte, Seen, Schutzhütten, abgelegene Gasthöfe) + OSM (`natural=peak/saddle/water`, `mountain_pass`, `tourism=alpine_hut/wilderness_hut/viewpoint`). Zusammenführung mit Duplikaterkennung (Name, Abstand, Höhe, Objektart); amtlich ist führend. Kanton, SLF-Region und Wetterzelle per PostGIS. Objekte ausserhalb der Schweiz werden stillgelegt. |
| `ski` | Lifte und Pisten aus OSM, räumlich gruppiert (< 150 m), benannt über `landuse=winter_sports`, gleichnamige Gruppen zusammengelegt; Talstation = tiefste Anlage. |
| `network` | Strassengraph (Autoprofil) → `road-graph.bin`. Wegnetz aus OSM + amtlichen Wanderwegen, Höhen aus dem Geländemodell. Für jedes Ziel: Suche rückwärts vom Ziel bis 9 h Gehkosten zu Parkplätzen bzw. Strassenzugängen, bis zu 3 Varianten mit ≥ 1,2 km Abstand der Startpunkte. |
| `index` | Suchindex `search-index.json.gz` (~2 MB): alle aktiven Ziele, Ausgangspunkte, Routen-Kennzahlen und Skigebiete als kompakte Tupel – siehe «Suchindex». |

Jeder Schritt ist idempotent, läuft in einer Transaktion je Tabelle und schreibt Statistiken in
`import_runs`. Der Datenstand (`app_meta.data_version`) ist Teil des Such-Cache-Schlüssels.

### Was bewusst NICHT mehr gefiltert wird

Die alte Importlogik hatte sechs hintereinandergeschaltete Ausschlüsse (siehe [AUDIT.md](AUDIT.md)).
Entfernt: Mindesthöhe 1'200 m, Pflicht-`ele`-Tag, Pflicht-Weg innerhalb 800 m, Löschen bei
Qualitätswert < 30, `out 8000`/`LIMIT 300`-Obergrenzen. Ein Ziel ohne Route bleibt in der Datenbank
(`route_status = 'no_route'`) und ist in der Suche über «Ziele ohne bekannte Route» sichtbar.

## Fahrzeit

### Entscheidung: eigener Strassengraph statt ORS, Valhalla oder OSRM

| Option | Genauigkeit | Kosten | Betrieb | Ergebnis |
|---|---|---|---|---|
| OpenRouteService (Gratis-API) | gut | 0, aber 500 Matrix-Anfragen/Tag und max. 3'500 Zellen je Anfrage | externer Dienst, Ausfälle, Limits | Ursache der alten 60-Kandidaten-Grenze – verworfen |
| Valhalla / OSRM selbst betrieben | sehr gut | Server mit 2–4 GB RAM dauerhaft: bei Railway/Fly/Hetzner 5–20 CHF/Monat | Server pflegen, Daten aktualisieren | widerspricht «möglichst kostenlos» |
| **Eigener Graph in der Serverfunktion** | im Median 2,6 % Abweichung zu ORS | 0 | wöchentlich neu gebaut per GitHub Actions | **gewählt** |

Peakr braucht nur eine Frage: *Fahrzeit von einem Startpunkt zu allen Ausgangspunkten*. Das ist ein
einzelner Dijkstra mit Zeitgrenze («1:n»), kein Routing zwischen beliebigen Paaren. Ein kompakter
Graph der Schweiz (1,39 Mio. Knoten, 2,9 Mio. Kanten, 40 MB) passt in eine Serverless-Funktion;
eine Suche dauert 0,1–0,7 s. Ergebnisse werden je Startknoten und Zeitgrenze im Speicher gehalten.

**Autoprofil** (`pipeline/profiles/car.ts`): Geschwindigkeit aus `maxspeed` bzw. Strassenklasse,
Abschlag für Kurvigkeit, Zugangsbeschränkungen, Autoverlad/Fähren mit Wartezeit, saisonale Sperren
(`motor_vehicle:conditional = no @ (Nov-May)` u. ä.) zum Zeitpunkt des Graph-Builds.

**Kalibrierung** (`pnpm --filter @ch-alpineroute/backend calibrate:drive`, eine einzige ORS-Anfrage):
478 Strecken von 8 Städten zu Ausgangspunkten: Median-Verhältnis 0,98, P10–P90 0,93–1,02,
Median-Abweichung 2,7 min, 90,6 % innerhalb ±10 %. Grössere Abweichungen fast nur, wo ORS bzw.
OSM eine andere Strecke wählen (z. B. Wintersperre, Autoverlad).

### Zwei Stufen ohne stille Abschneidung

1. Dijkstra ab dem Startort bis `maxMinutes + Toleranz` → Rechteck aller erreichten Strassenknoten.
2. Der Suchindex liefert **alle** Ausgangspunkte im Rechteck (kein LIMIT); für jeden wird die
   Fahrzeit aus dem Dijkstra-Feld gelesen (O(1)).

Ein Ausgangspunkt ohne Strassenanschluss bekommt keine Fahrzeit. Jedes Ergebnis trägt
`driveMinutes`, `driveEstimated` (immer `false`), `routingProvider`, `routingStatus`
(`ok` · `partial` = Strasse endet > 600 m vor der Talstation, z. B. Zermatt · `no_route` ·
`unavailable`), `routeDistanceKm`, `routingUpdatedAt`.

## Suchindex und Datenbankverkehr

Die Suche liest Stammdaten (Ziele, Ausgangspunkte, Routen-Kennzahlen, Skigebiete) nicht aus der
Datenbank, sondern aus `search-index.json.gz`, den der Pipeline-Schritt `index` schreibt und der
zusammen mit dem Strassengraphen ins Funktions-Bundle kommt (Release `data-latest` → `prebuild`).

**Grund:** Eine Suche «Zürich, alle Zielarten, 90 min» prüft rund 16'000 Routen. Aus der Datenbank
gelesen wären das ~10 MB je Suche – die Gratisstufe von Neon erlaubt 5 GB ausgehenden Verkehr im
Monat, also nur wenige hundert Suchen. Aus dem Index gelesen fragt eine Suche die Datenbank nur noch
nach den Live-Daten (Wetterraster ~600 Zeilen, Lawinenstufen, Messwerte der ~320 Skigebiete,
Bekanntheit), je Instanz 5–30 min zwischengespeichert, plus eine Zeile Rate-Limit.

**Folgen:**
- Die Suche funktioniert auch, wenn die Datenbank nicht erreichbar ist: Treffer und Fahrzeiten
  bleiben korrekt, die Antwort meldet `meta.liveData: "unavailable"` und die Oberfläche zeigt einen
  Hinweis. Konto, Favoriten und Detailseite brauchen weiterhin die Datenbank.
- Neue Stammdaten erreichen die Suche erst mit dem nächsten Deploy (Deploy-Hook des Daten-Workflows).
  Die Detailseite liest immer die Datenbank und ist damit gleich aktuell oder neuer.
- `/api/health` meldet `searchIndex.available` und `builtAt`.

## Datenbank: Neon statt Supabase

Die frühere Supabase-Gratisdatenbank wurde pausiert und gelöscht; für ein neues Gratisprojekt gab
es kein Kontingent mehr. Peakr verwendet keine Supabase-spezifischen Funktionen (nur PostgreSQL +
PostGIS über postgres.js), der Wechsel betrifft nur die Verbindung:

- **Neon** (Gratisstufe, über die Vercel-Integration): PostgreSQL mit PostGIS, pausiert nach 5 min
  ohne Zugriff und wacht beim nächsten Zugriff selbst auf – keine Sperre wie bei Supabase.
- **Zwei Verbindungen:** `DATABASE_URL` (Pooler, Transaktionsmodus) für die Website auf Vercel,
  `DATABASE_URL_UNPOOLED` (direkt) für Migration, Pipeline und Worker. `db/index.ts` wählt
  automatisch: auf Vercel (`VERCEL` gesetzt) die gepoolte, sonst die direkte, falls vorhanden.
- **URL-Bereinigung:** Neon-URLs enthalten `sslmode` und `channel_binding`. postgres.js schickt
  unbekannte URL-Parameter als Startparameter an den Server, der die Verbindung dann abbricht
  («unrecognized configuration parameter "channel_binding"», lokal nachgewiesen). Diese Parameter
  werden vor dem Verbinden entfernt; TLS wird für nicht-lokale Hosts immer verlangt.
- **Region:** Neon in Frankfurt, Vercel-Funktionen über `apps/frontend/vercel.json` ebenfalls `fra1`.
- **Alternativen:** Jede PostgreSQL ≥ 14 mit PostGIS funktioniert (eigener Server: `docker-compose.yml`).

## Suche

- **Abschnitte:** `result` (≤ Limit), `suggestion` (Limit < t ≤ Limit + Toleranz), `sac_unknown`
  (in Reichweite, aber nur über Routen ohne SAC-Angabe, wenn ein SAC-Filter aktiv ist), `unrouted`
  (optional; reale Ziele ohne Route, ohne Fahrzeit).
- **SAC je Route:** Für jedes Ziel werden alle Varianten geprüft; gewählt wird die beste Variante,
  die alle Filter erfüllt. Unbekannte Schwierigkeit erfüllt einen Filter nie stillschweigend.
  Die amtliche Signalisation kennt nur drei Klassen (gelb T1, weiss-rot-weiss T2–T3,
  weiss-blau-weiss T4–T6); daher kann eine Route einen Bereich «T2–T3» haben. Massgebend für den
  Filter ist die obere Grenze.
- **Antwort:** Detailkarten seitenweise (60), **alle** Treffer als kompakte Kartenpunkte
  (`[id, Name, lat, lng, Art, Abschnitt, Score, Fahrzeit]`) – auch bei mehreren tausend Treffern
  unter 1 MB.
- **Cache:** gesamtes Ergebnis 10 min im Speicher; Schlüssel aus Start (auf ~11 m gerundet), allen
  Filtern, Modus und Datenversion (Stand der Stammdaten **und** der Live-Daten – jeder Worker-Lauf
  entwertet den Cache). Sortierung und Seite werden aus dem Cache bedient.
- **Bewertung** (`services/score.service.ts`): Bedingungen, Bedeutung des Ziels, Datenlage; Ski
  zusätzlich Schnee, Neuschnee, Lawinen-Abzug. Aufschlüsselung in `scoreBreakdown`.

## Wanderrouten

- **Wegnetz:** alle begehbaren OSM-Wege (276'000 km), ergänzt um die amtlichen swissTLM3D-Wanderwege
  (67'000 km) als Raster; ein OSM-Abschnitt auf einem amtlichen Weg übernimmt dessen Kategorie.
- **Schwierigkeit:** OSM `sac_scale` ist führend (T1–T6); sonst amtliche Kategorie als Bereich;
  sonst unbekannt.
- **Höhen:** 3D-Koordinaten der amtlichen Wege, sonst Terrain Tiles (EU-DEM/SRTM, ~30 m, über ±50 m
  Weg geglättet). Auf- und Abstieg werden mit 6 m Hysterese summiert, damit das Rauschen des Modells
  keine Höhenmeter erfindet; am Routenende gilt die amtliche Gipfelhöhe. Gespeichert wird die Höhe je
  Stützpunkt (`hike_routes.elevations`); die Vereinfachung der Linie behält Punkte, die mehr als 5 m
  vom Höhenprofil abweichen.
- **Export:** GPX 1.1 und Übergabe an den swisstopo-Kartenviewer, siehe
  [GPX_UND_SWISSTOPO.md](GPX_UND_SWISSTOPO.md).
- **Gehzeit:** DIN 33466 (4 km/h horizontal, 300 Hm/h auf, 500 Hm/h ab).
- **Kein Erfinden:** Es gibt nur Routen, die im Wegnetz durchgehend existieren. Liegt kein Weg näher als
  150 m am Gipfel bzw. Pass (Hütten 120 m, Seen 150 m vom Ufer), erhält das Ziel keine Route
  (`no_route`). Der verbleibende Abstand Wegende–Ziel wird je Route gespeichert und angezeigt.

Warum nicht pgRouting? Die Routen werden einmal pro Woche vorberechnet, nicht pro Anfrage. Ein
Graph im Speicher der Pipeline (2,8 Mio. Knoten) rechnet alle 19'000 Ziele in unter einer Minute;
pgRouting bräuchte für dieselbe Arbeit ein Vielfaches an Zeit und Platz in der Gratis-Datenbank.

## Verfügbarkeit und Wetterkarte

Suche und Detailseite bewerten jede Route bzw. jedes Skigebiet für die geplante Tour (Sperrungen,
Schnee, Wetter, Lawinen, Tageslicht bzw. Betrieb) – beim Lesen, aus zwischengespeicherten
Grundlagen. Standardmässig erscheinen nur verfügbare Ziele. Die Wetterkarte lädt Radar
(MeteoSchweiz, als Datenbild) und Prognoseraster nur bei Bedarf; gefärbt, weichgezeichnet und
animiert wird im Browser (`apps/frontend/lib/weatherEngine.ts`, `weatherField.ts`,
`weatherParticles.ts`). Regeln, Quellen und Grenzen:
[VERFUEGBARKEIT_UND_WETTER.md](VERFUEGBARKEIT_UND_WETTER.md).

## Karte: Dichte der Ziele (Heatmap) und Hotspots

Die Karte zeigt, wo sich die Ziele der aktuellen Suche häufen. Das geschieht als Dichtekarte statt mit
Kreisen. Sie zeigt nur die Dichte, keine Beliebtheit und keine erfundenen Aktivitätsdaten. Drei
Zustände gehen stufenlos ineinander über:

| Zoom | Zustand | Was zu sehen ist |
|---|---|---|
| unter 7,4 (ganze Schweiz) | A | nur die Heatmap mit vielen regionalen Zentren: keine Kreise, keine Punkte, keine Zahlen |
| 7,4–10,3 (Mittelland, Alpentäler) | B | lokale Zentren werden enger; über grossen Hotspots schwebt dezent die echte Anzahl («530 Ziele») |
| ab 9,8 (nah) | C | Die Heatmap blendet von 10 bis 11,2 aus, die Einzelziele blenden bis 10,6 ein. Es sind kleine Punkte mit Mint-Schein, ab 11,6 mit Symbol und Namen. |

### Datenbasis

Liste und Karte nutzen dieselbe Antwort von `/api/search`:
- `points` enthält auf Seite 0 alle Treffer aller Abschnitte, ohne Seitenbegrenzung;
- die Karte filtert nichts heraus;
- GPU-Heatmap und Engine bekommen dieselbe bereinigte Liste (`uniquePoints`).

Unsichere Ziele sind nur enthalten, wenn «unsichere zeigen» aktiv ist; nicht verfügbare nie.

Audit vom 21.11.2026 (Produktion; ab Zürich, Bern und Luzern; ≤ 4 h + 50 min):

- **Vollständigkeit:** Liste = API = Kartenquelle = Heatmap-Quelle, ab Zürich 5534 = 5534 = 5534 =
  5534. Alle Koordinaten sind identisch mit dem Suchindex und liegen in der Schweiz.
- **Fahrzeit:** Die längste Fahrzeit lag ab Zürich bei 219 min; die Fahrzeitgrenze schnitt nichts ab.
- **Fehlende Regionen:** Leere Regionen lagen an der Verfügbarkeit, nicht an der Karte.
  - Wallis: 0 verfügbar, Lawinengefahr Stufe 3.
  - Tessin: 251 von 929 verfügbar, die tiefer gelegenen (Median 660 m). Die fehlenden liegen im
    Median auf 2271 m (gemessener Schnee, zu wenig Tageslicht).
- **Darstellung bis 2.0:** Die verfügbaren Tessiner Ziele kamen auf der Karte an, waren aber
  unsichtbar. Grund war die zu starke Glättung (15 km) und die Normalisierung auf das dichte
  Mittelland. In der Übersicht erreichten 0 % der Tessiner Ziele die Stufe «niedrig».

### Dichte

Code: `apps/frontend/lib/density/densityEngine.ts`, getestet.

- **Kern:** derselbe Gauss-Kern wie die MapLibre-Heatmap auf der GPU (σ = Radius/3), gerechnet in
  Bildschirmpixeln der jeweiligen Zoomstufe. Die Hotspots der Engine liegen dort, wo die Karte
  leuchtet.
- **Radius (2.1: wenig Glättung):**
  - geografisch festgelegt: 5,6 km bei Zoom 6, 3 km bei 8, 1,6 km bei 10; bis 2.0 waren es 15 km bei
    Zoom 6;
  - je Zoomstufe nur gut 25 % enger, während die Karte doppelt so gross wird. Die Flecken wachsen
    also fast mit der Karte mit, statt beim Zoomen zu «fliessen».
- **Normalisierung:** Je Zoomstufe erreicht das 98. Perzentil der Dichte an den Zielen die oberste
  Farbe; Spitzen werden abgeschnitten.
- **Farbstufen (2.1: aus den Daten):**
  - Die Stufen sitzen auf Quantilen der Dichte an den Zielen, gemittelt über Zoom 6–8:
    - 97 % der Ziele erreichen mindestens «sehr niedrig»;
    - 75 % «niedrig»;
    - 40 % «mittel»;
    - das oberste Siebtel «hoch»;
    - 3 % «sehr hoch».
  - Ein einzelnes Ziel bleibt als feiner Punkt sichtbar, erreicht aber nie «mittel». Es gibt also
    keine künstlichen Hotspots.
  - Ergebnis in der Übersicht: Alle Ziele jeder Region sind sichtbar; im Tessin erreichen zwei
    Drittel mindestens «niedrig» (vorher 0 %).
- **Doppelte:** gleiche ID nur einmal; gleicher Ort mit gleichem Namen nur einmal.
- **Gewicht:** Treffer 1; «knapp ausserhalb» und Ziele ohne Angabe 0,5, wie ihre Punkte.

### Hotspot-Zahlen

- **Einzugsgebiete:** Die Rasterzellen schliessen sich dem Nachbarn mit dem höchsten Maximum an.
  Nebenmaxima, die weniger als 0,1 über dem Sattel liegen, werden zusammengelegt.
- **Zählung:** Gezählt werden die Ziele im wahrnehmbar leuchtenden Teil (ab der halben Stufe «sehr
  niedrig»). Jedes Ziel zählt höchstens einmal. Die Zahl ist genau die Anzahl Ziele, deren Ort im
  Bereich des Hotspots liegt; ein Test prüft das.
- **Wann eine Zahl erscheint:**
  - das Maximum erreicht mindestens «hoch»;
  - der Hotspot enthält einen Mindestanteil aller Ziele: 2 %, 0,8 % bzw. 0,4 % je Band, mindestens
    8 Ziele; auf dem Handy das 1,5-Fache.
- **Bänder:** drei Bänder bei Zoom 7,5, 8,5 und 9,5, mit kurzer Überblendung dazwischen. Grosse
  Hotspots werden zuerst platziert; überlappende kleine fallen weg.

### Darstellung

Alles sind MapLibre-Ebenen auf der GPU, es gibt keine DOM-Marker.

- **`density-heat`** (`heatmapLayer.ts`): liegt über Relief, Wald und Wasser der Grundkarte und
  unter Strassen, Wegen, Grenzen, Höhenlinien und Namen. Das Licht liegt unter der Topografie, die
  violetten Grenzen und die Ortsnamen bleiben lesbar.
- **`hotspot-0` bis `hotspot-2`** (`hotspotLayer.ts`): Symbole mit kleiner dunkler Fläche und feiner
  Mint-Kontur.
- **`points-halo`, `points`, `point-icons`, `point-name`** (`destinationLayer.ts`): die Einzelziele.

### Farben (2.1: kräftig)

Nur Mint und Grün, fünf klar unterscheidbare Stufen; dazu kommt ein kurzer weicher Rand, damit
zwischen den Zielen dunkle Karte bleibt statt Nebel.

| Stufe | dunkle Karte | helle Karte |
|---|---|---|
| sehr niedrig | `rgba(46,116,80,0.33)` dunkles Mint | `rgba(98,182,134,0.28)` |
| niedrig | `rgba(58,142,98,0.47)` | `rgba(74,162,112,0.42)` |
| mittel | `rgba(84,184,128,0.63)` | `rgba(50,140,94,0.57)` |
| hoch | `rgba(130,226,168,0.83)` helles Mint | `rgba(28,116,72,0.72)` |
| sehr hoch | `rgba(198,252,220,0.95)` Mint mit Lichtwirkung | `rgba(14,92,56,0.84)` |

Auf der hellen Karte gilt dichter = dunkler, weil helleres Mint auf Weiss schwächer wirken würde. Im
Wetterbild hat die Heatmap 55 % Deckkraft.

### Bewegung

- **Ohne Nutzeraktion bewegt sich nichts:** keine Pulse, kein Fliessen.
- **Zoomabhängige Übergänge:** Deckkraft und Grösse sind direkte Zoom-Ausdrücke. Sie folgen der
  Karte also ohne Verzögerung.
- **Dauern:**
  - Kamerafahrten (Suche, Auswahl, Hineinzoomen) 300 ms;
  - Themenwechsel 220 ms;
  - Überblenden von Zahlen und Namen 200 ms.
- **«Bewegung reduzieren»:** alles sofort.

### Bedienung

- **Antippen oder Klicken:** Eine Zahl, oder bis Zoom 10,3 auch eine leuchtende Fläche mit Maximum
  ab «niedrig» und mindestens 3 Zielen, zoomt auf die Ziele dieses Hotspots, mindestens eine
  Zoomstufe tiefer.
- **Überfahren:** zeigt die Arten, z. B. «180 Gipfel · 140 Aussicht · 90 Seen».
- **Einzelziele:** wie bisher. Ein Klick wählt aus; Liste und Detailansicht sind unverändert.

### Leistung

- **Web Worker:** Das Dichtemodell rechnet ein Web Worker (`density.worker.ts`).
  - 8004 echte Ziele: 60 ms auf einem aktuellen Mac.
  - 20'000 Ziele: rund 100 ms.
  - Die Felder für Intensität und Stufen rechnen auf einem groben Raster, die Hotspots auf einem
    feineren; sortiert wird nativ über gepackte Schlüssel.
- **Handy-Test** (Chrome, CPU vierfach gedrosselt, 6312 Ziele): Die Heatmap ist 0,7 s nach dem
  Suchergebnis fertig. Eine Zoomfahrt von 6 auf 10 läuft mit 60 Bildern pro Sekunde (95 % der
  Bilder ≤ 17 ms).
- **Schwache Geräte** (höchstens 4 Kerne, höchstens 2 GB Speicher oder Datensparmodus): ein
  Hotspot-Band statt drei, kein Mint-Schein.

## Worker

`apps/backend/src/workers/runner.ts` gibt jedem Job:
Sperre in der Datenbank (`job_locks`, läuft nach Absturz von selbst ab) · Zeitlimit · sauberes
Beenden bei SIGTERM/SIGINT · Protokoll in `import_runs` mit Erfolgsquote (Lauf gilt nur bei ≥ 70 %
Erfolg als `success`, sonst `partial`/`failed`) · Fehler je Datensatz brechen den Lauf nicht ab ·
Batches statt Einzelabfragen.

| Job | Quelle | Abrufe je Lauf | Takt |
|---|---|---|---|
| `ski` | Open-Meteo (Tal- und Bergstation, gebündelt), SLF-Bulletin | ~640 Orte | 3 h |
| `weather` | Open-Meteo-Raster 0,1° für alle Wanderziele | ~580 Orte | 6 h |
| `trend` | Wikipedia-Seitenaufrufe (nur Ziele mit Artikel) | ~720 | wöchentlich |
| `maintenance` | – (Aufräumen, hängende Läufe schliessen) | 0 | täglich |

Open-Meteo: ~7'400 Orte pro Tag bei 10'000 im Gratiskontingent. Früher: 57'000 (eine Abfrage je Ziel).

Der Trend-Wert ist optional und schwach gewichtet. Er ist nur für Ziele mit eigenem Wikipedia-Artikel
gesetzt; geratene Artikeltitel (früher 93 % «1») gibt es nicht mehr.

## Sicherheit

- Passwörter mit bcrypt; Anmelde-Token (JWT, HS256) mit Pflicht-Geheimnis (≥ 32 Zeichen) in Produktion.
  Fehlt es oder ist es zu kurz, lehnt nur die Anmeldung mit 503 ab; Suche und Karte laufen weiter,
  `/api/health` meldet `auth.configured: false`. Pipeline und Worker brauchen kein Geheimnis.
- Rate-Limits in der Datenbank: Anmeldung/Registrierung je IP, Suche 120/min, Detail mit Fahrzeit 120/min.
- Alle SQL-Abfragen sind parametrisierte Tagged Templates.
- Eingaben werden mit Zod geprüft; Startorte ausserhalb der Schweiz werden abgelehnt.
- Interne Fehlermeldungen gehen nur ins Log; der Client erhält `{ error: { code, message } }`.
- Sicherheits-Header (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`).
- Keine Secrets im Browser-Bundle: `NEXT_PUBLIC_*` enthält nur die Kartenstil-URL.
- Bewusst belassen: Token im `localStorage` (keine Cookies → kein CSRF; XSS-Fläche gering, da kein
  fremdes HTML gerendert wird; Popups escapen Namen).
