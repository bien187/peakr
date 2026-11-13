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
(MeteoSchweiz) und Prognoseraster nur bei Bedarf. Regeln, Quellen und Grenzen:
[VERFUEGBARKEIT_UND_WETTER.md](VERFUEGBARKEIT_UND_WETTER.md).

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
