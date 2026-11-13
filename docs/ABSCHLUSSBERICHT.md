# Peakr – Abschlussbericht der Überarbeitung (12./13.11.2026)

> **Nachtrag 13.11.2026, Datenbank:** Supabase steht nicht mehr zur Verfügung (kein Gratisprojekt
> mehr frei). Peakr läuft jetzt mit **Neon** (Gratisstufe, über die Vercel-Integration). Zusätzlich
> liest die Suche ihre Stammdaten aus einem **Suchindex** statt aus der Datenbank – das hält den
> Datenverkehr im Gratis-Kontingent und die Suche lauffähig, wenn die Datenbank fehlt. Details:
> [Abschnitt 13](#13-nachtrag-neon-und-suchindex).

Ausgangslage, Belege und Ursachenanalyse: [AUDIT.md](AUDIT.md). Dieser Bericht hält fest, was
umgesetzt wurde, was **nachweislich funktioniert** und was nur **vorbereitet** ist, weil Zugänge fehlen.

**Kurzfassung:** Datenbasis, Fahrzeitberechnung, Wanderrouten, Suche, Worker und Oberfläche sind neu
aufgebaut und lokal vollständig getestet (Typecheck, Lint, 71 Unit-Tests, 35 Datenbank-Tests über
8 Regionen, Produktions-Build, Docker-Images, Browser-Tests). Öffentlich läuft Peakr noch **nicht**:
Die Produktionsdatenbank (Neon) muss erst angelegt werden. Für die Inbetriebnahme sind die Schritte im Abschnitt
[10](#10-noch-benötigte-zugangsdaten-und-manuelle-schritte) nötig – alle kostenlos.

---

## 1. Ursprüngliche Probleme und ihre Ursachen

Belege im Detail: [AUDIT.md § 1–3](AUDIT.md).

**Warum der Betrieb stand (nachgewiesen):**
1. GitHub hat den Worker-Workflow nach 60 Tagen ohne Repository-Aktivität abgeschaltet (`disabled_inactivity`, letzter Lauf 20.08.2026).
2. Ohne Worker-Zugriffe wurde die Supabase-Gratisdatenbank pausiert und ist inzwischen nicht mehr vorhanden (`tenant/user not found`). Seither liefert `/api/search` in Produktion HTTP 500.
3. Der Live-Worker überschritt das Open-Meteo-Kontingent um das Fünffache (57'000 statt 10'000 Abrufe/Tag) und aktualisierte nur 17 % der Ziele – meldete aber «Erfolg».

**Warum Peakr fachlich nicht zuverlässig war (nachgewiesen):**
4. Produktion rechnete **nur Luftlinie × 1,4 bei 50 km/h** – nie echte Fahrzeiten. Lokal bekamen nur die ersten 60 Kandidaten eine echte ORS-Fahrzeit, der Rest eine Schätzung, die trotzdem als «in Reichweite» galt.
5. Fahrzeit wurde zum Gipfel gerechnet statt zu einem Parkplatz.
6. Gipfelauswahl durch sechs hintereinandergeschaltete Ausschlüsse: Mindesthöhe 1'200 m, Pflicht-`ele`-Tag, Weg innerhalb 800 m (sonst Schätzwerte), Löschen bei Qualitätswert < 30, `out 8000`, Sortierung nach Luftlinie mit `LIMIT 8000`. Jura, Voralpen und Mittelland fehlten fast vollständig.
7. SAC-Filter wirkungslos (`sac IS NULL OR sac <= max`; 5 von 4'446 Zielen hatten eine Schwierigkeit).
8. Wanderwege-Integration und SLF-Regionen waren Stubs; die Lawinenstufe wurde nie ausgewertet (`Number("moderate") = NaN`).
9. Die Karte zeichnete eine **erfundene** Zickzack-Route von einem erfundenen Parkplatz.
10. Zwei voneinander abweichende API-Implementierungen (Fastify lokal, Next.js in Produktion).

**Plausibel, nicht mehr belegbar:** 59 fehlgeschlagene Worker-Läufe im Juni (Logs abgelaufen; zeitlich passend zu Schemakorrekturen); Wachstum der Datenbank über 500 MB durch `live_status` mit vollständigen Rohantworten.

**Durch die Pause entstanden:** gelöschte Datenbank, abgeschaltete Workflows, überholte Vercel-Domain im Repo (`peakr-frontend.vercel.app` → `peakr-ch.vercel.app`). Zusätzlich lokal: von iCloud ausgelagerte Repository-Dateien (wieder hergestellt) und eine lokale `.env`, die auf die Produktionsdatenbank zeigte.

## 2. Behobene Fehler

| # | Fehler | Behebung | Nachweis |
|---|---|---|---|
| K1/K3/K4 | Keine bzw. geschätzte Fahrzeiten, 60er-Grenze, Ziel statt Parkplatz | Eigener Strassengraph, Fahrzeit zu jedem Ausgangspunkt, keine Schätzung, kein Limit | DB-Tests: Fahrzeiten bekannter Gipfel in 8 Regionen im erwarteten Bereich; Vergleich mit ORS: Median 2,6 % |
| K2 | Zwei API-Implementierungen | Eine framework-freie Server-API, Next.js-Routen als Hüllen; Fastify entfernt | Smoke-Test aller Endpunkte im Produktionsmodus |
| K5 | Schema widerspricht Migrationen | Drizzle-Schema-Datei entfernt, SQL-Migrationen sind die einzige Wahrheit; additive Migration 0002 | Migration auf leerer DB und auf Kopie mit Altdaten getestet |
| K6 | Wanderwege-Stubs | Echte Routenberechnung, 22'403 Routen | DB-Test Detailansicht; Screenshots |
| K7 | Lawinenstufe nie ausgewertet | CAAML-Parser korrigiert, Regionen importiert und zugeordnet | Unit-Test; 140 Skigebiete mit aktueller Stufe |
| K8 | swissNAMES3D über nicht existierenden Dienst | Download über STAC-API, vollständiger Import | 9'845 Gipfel aus swissNAMES3D |
| K9 | Erfundene Route im Frontend | Entfernt; echte Linie aus der Datenbank | Screenshot Route Rautispitz |
| K10 | Root-`package.json` überschrieben | Wiederhergestellt aus der Git-Historie | `pnpm typecheck/lint/test/build` vom Root |
| K11 | Favoriten-POST ohne Body abgelehnt | Content-Type nur mit Body | Smoke-Test Favoriten |
| – | Datenqualität (Abschnitt 3 Audit) | Neuer Import ohne willkürliche Filter, Duplikaterkennung, Herkunft | [DATENQUALITAET.md](DATENQUALITAET.md) |
| – | Open-Meteo-Kontingent gesprengt | Wetterraster 0,1° + gebündelte Abfragen: ~7'400 statt 57'000/Tag | Worker-Läufe `success`, 0 Fehler |
| – | Worker meldet Erfolg bei 83 % Fehlern | Erfolgsquote ≥ 70 % Pflicht, sonst `partial`/`failed`; Sperre, Zeitlimit, SIGTERM | Läufe in `import_runs` |
| – | Trend-Werte zu 93 % «1» | Nur Ziele mit eigenem Wikipedia-Artikel; Wikimedia-konformer User-Agent (der alte wurde mit HTTP 429 abgewiesen) | 724 Werte, 4 davon «1» |
| – | Sicherheit: Standard-JWT-Geheimnis in Produktion, keine Rate-Limits | Geheimnis in Produktion Pflicht (zur Laufzeit), Rate-Limits in der DB für Login, Registrierung, Suche, Detail | Unit-/Smoke-Tests |
| – | Objekte ausserhalb der Schweiz (Liechtenstein, Grenzgebiete) | Ohne Kanton → stillgelegt | DB-Test «26 Kantone, 0 ausserhalb» |
| – | `NEXT_PUBLIC_API_BASE_URL` zeigte auf nicht mehr existierenden Server | Variable entfernt, API immer gleiche Herkunft | Browser-Test |
| – | Abhängigkeiten: kritische XSS-Lücke in `maplibre-gl` 4.7, SQL-Injection-Meldung in `drizzle-orm` 0.38 | `maplibre-gl` 6.18 (Worker-Datei wird nach `public/` kopiert), `drizzle-orm` 0.45.4 | Browser-Test ohne Konsolenfehler; Migration auf leerer und bestehender DB |
| – | Docker-Build scheiterte ohne Geheimnis | Prüfung nur zur Laufzeit, nicht während `next build` | Docker-Images gebaut und gestartet |

## 3. Geänderte Dateien

Vollständige Liste im [Anhang](#anhang-geänderte-dateien). Schwerpunkte:

- **Neu:** `apps/backend/src/pipeline/**` (Datenaufbau), `routing/**` (Fahrzeit), `server/**` (API),
  `workers/{cli,jobs,runner}.ts`, `repositories/search.repo.ts`, `services/{destination,geocode,health}.service.ts`,
  `drizzle/0002_postgis_rebuild.sql`, Tests (`*.test.ts`, `src/test/search.db.test.ts`),
  `scripts/quality-report.ts`, `.github/workflows/{ci,data}.yml`, `docs/*`.
- **Neu geschrieben:** Such-Service, Shared-Schemas, Frontend-Komponenten (Suche, Liste, Karte, Detail),
  Worker-Workflow, Docker-Konfiguration, README, SETUP_EXTERNAL, `.env.example`.
- **Entfernt:** Fastify-Server und -Routen, alte Import-Skripte und Worker, ORS-/Overpass-/geoAdmin-Services,
  Drizzle-Schema, Krypto-Service (eigene OpenAI-Schlüssel je Konto), `railway.toml`, veraltete Screenshots.
- **Unverändert gelassen:** Design-System (`peakr.css`, Themes), Auth-Seiten, Root-Prototypen
  (`app/`, `components/`, `peakr/` …, als Altkopien dokumentiert).

## 4. Neu implementierte Funktionen

- Vollständige Datenpipeline (`pnpm pipeline`): swissNAMES3D + OSM + amtliche Wanderwege, Duplikaterkennung, Herkunft, Kantone, SLF-Regionen, Wetterzellen, Stilllegen statt Löschen, idempotent, protokolliert.
- Skigebiete aus OSM gruppiert (Lifte + Pisten → Gebiet, Talstation, Anlagen nach Typ, Pistenkilometer nach Schwierigkeit).
- Strassengraph der Schweiz mit Autoprofil (Saisonsperren, Autoverlad) und Fahrzeit in 0,1–0,7 s je Suche.
- Ausgangspunkte (8'200 Parkplätze, 800 Strassenzugänge, 317 Talstationen) mit Qualitätsstufe.
- Wanderrouten mit bis zu 3 Varianten je Ziel: Distanz, Auf-/Abstieg, Gehzeit hin und zurück, höchster Punkt, SAC (OSM bzw. amtliche Kategorie), Anteil signalisierter Wege, Linie.
- Suche: mehrere Zielarten, SAC je Route, Toleranzbereich, Abschnitt «Schwierigkeit unbekannt», optional Ziele ohne Route, Gehzeit- und Höhenfilter, Mindestschneehöhe, serverseitige Sortierung, Seiten + alle Kartenpunkte, Cache.
- Detailansicht mit Fahrzeit je Routenvariante, Navigation zum Parkplatz, Anlagen/Pisten, Datenquellen.
- Karte: Gruppierung (Zähler), Route und Parkplatz der Auswahl, Legende, Kurzinfo, Feuerstellen je Kachel zwischengespeichert.
- Statusseite `/api/health` mit Aktualität aller Jobs; Datenqualitätsbericht; wöchentlicher Datenaufbau mit Release des Graphen und Selbst-Reaktivierung der Zeitpläne; CI.

## 5. Neue Datenquellen

swissNAMES3D (STAC-Download), swissTLM3D-Wanderwege (GeoPackage), Geofabrik-OSM-Auszug (lokal mit
osmium), Terrain Tiles (Höhen), Wikimedia-Pageviews (korrekt angebunden). Geprüft und verworfen bzw.
nur für Tests: OpenRouteService, Valhalla/OSRM, Overpass als Importquelle, Wikidata direkt,
swissALTI3D/DHM25, SchweizMobil, Liftstatus-Portale, MeteoSchweiz direkt. Begründungen und Lizenzen:
[DATENQUELLEN.md](DATENQUELLEN.md).

## 6. Datenbankänderungen

Migration `0002_postgis_rebuild.sql` (additiv, nichts wird gelöscht):
PostGIS-Spalten `geom` (generiert) mit GiST-Index; neue Tabellen `data_sources`, `import_runs`,
`app_meta`, `job_locks`, `rate_limits`, `avalanche_regions`, `cantons`, `destination_sources`,
`trailheads`, `hike_routes`, `ski_resort_details`, `ski_lifts`, `weather_cells`; neue Spalten an
`destinations` (`object_class`, `names`, `wikidata_id`, `importance`, `extent_m`, `weather_cell`,
`route_status`, `retired_at`, `updated_at`) und `live_status` (`lift_source`, `avalanche_valid_until`).
Alte OSM-Referenzen werden übernommen, damit bestehende Ziel-IDs und Favoriten erhalten bleiben.
Die Spalten `users.openai_key_*` bleiben bestehen (keine Löschung von Kontodaten), werden aber nicht
mehr verwendet. Platzbedarf lokal 109 MB.

## 7. Worker-Status

| Job | Lokal ausgeführt | Ergebnis |
|---|---|---|
| `ski` | ja | 317/317 Gebiete, 0 Fehler; Lawinenstufe für 140 (Bulletin deckt im November nur einen Teil der Regionen ab) |
| `weather` | ja | 584/584 Rasterzellen |
| `trend` | ja | Status `partial`: 724 von 725 Zielen mit Wert, 1 Abruf nach Wikimedia-Drosselung (HTTP 429) offen – holt der nächste Lauf nach; der alte User-Agent wurde komplett abgewiesen |
| `maintenance` | ja, auch im Docker-Container | erfolgreich |

**Produktion:** nicht aktiv – es gibt keine Datenbank. Der Workflow «Peakr Worker» ist neu geschrieben
und muss auf GitHub wieder aktiviert werden (Abschnitt 10). Er wurde **nicht** auf GitHub ausgeführt.

## 8. Deployment-Status

| Teil | Status |
|---|---|
| Code | fertig, nicht committet/gepusht (Entscheidung des Besitzers) |
| Vercel `peakr-ch.vercel.app` | läuft mit dem **alten** Stand; Suche liefert HTTP 500 (keine DB) |
| Produktions-Build | lokal erfolgreich; Strassengraph wird in die Funktionen gepackt |
| Docker (`app`, `worker`) | Images gebaut, Container gegen lokale DB getestet |
| Datenbank | Neon über die Vercel-Integration anzulegen (Supabase entfällt) |
| GitHub Actions | Workflows geschrieben, nicht auf GitHub gelaufen |
| Release `data-latest` | entsteht beim ersten Lauf von «Peakr Daten» (Strassengraph + Suchindex) |

## 9. Testergebnisse (13.11.2026, lokal)

| Prüfung | Ergebnis |
|---|---|
| `pnpm typecheck` (shared, backend, frontend) | fehlerfrei |
| `pnpm lint` | 0 Fehler, 0 Warnungen |
| `pnpm test` | 71 Tests bestanden (Backend 64: Suche, Toleranz, SAC je Route, Seiten/Kartenpunkte, Cache-Schlüssel, Strassengraph, LV95, SLF, Namensabgleich, Duplikate, Auto-/Wanderprofil, Score, Suchindex, URL-Bereinigung, Suche ohne Datenbank; Frontend 7: Anzeige und Adapter) |
| `pnpm test:db` | 35 Tests bestanden – Testmatrix Zürich, Luzern, Interlaken, Sion, Chur, St. Gallen, Lugano, Delémont: bekannte Gipfel mit Fahrzeit im erwarteten Bereich, exakte Zeitbereiche, keine Abschneidung, SAC-Filter, Skigebiete mit Talstation, Detailrouten, Kantonsabdeckung, Ziele unter 1'200 m |
| `pnpm build` | erfolgreich |
| Fahrzeit vs. OpenRouteService | 478 Strecken, Median 2,6 %, 90,6 % innerhalb ±10 % |
| Produktionsserver (Smoke-Test) | Suche 0,2–0,4 s kalt / 0,02 s Cache; Validierung, Registrierung, Favoriten, 401 ohne Token, Ortssuche, Sicherheits-Header. Ohne erreichbare Datenbank: `/api/health` 503, Suche liefert weiter Treffer mit Fahrzeit (`liveData: unavailable`) |
| Browser (Playwright, Desktop + Mobil) | Suche, Auswahl mit Route, Filter, Nachladen, Detail (3D/Karte), Ski; keine Konsolenfehler |
| Docker | `app` beantwortet Suche in 0,14 s; `worker maintenance` erfolgreich; osmium im Image |
| `pnpm audit --prod` | vorher 14 Meldungen (1 kritisch), jetzt 12 (0 kritisch) – Rest siehe Abschnitt 11 |

Beispiele aus der Testmatrix (90 min ab Zentrum): Zürich → Rigi Kulm 44 min, Säntis 79 min;
Interlaken → Schilthorn 17 min; Chur → Pizol 34 min; Lugano → Monte Generoso 33 min;
Delémont → Chasseral 61 min.

## 10. Noch benötigte Zugangsdaten und manuelle Schritte

Ausführlich mit Klickpfaden: [SETUP_EXTERNAL.md](../SETUP_EXTERNAL.md). Alles kostenlos.

1. **Alte Vercel-Variablen entfernen:** `DATABASE_URL` (zeigt auf die gelöschte Supabase-DB) und `ENCRYPTION_KEY` – sonst kollidiert die Neon-Integration.
2. **Neon anlegen:** Vercel → *Storage* → *Create Database* → *Neon*, Plan Free, Region Frankfurt, Präfix leer, mit dem Projekt verbinden (setzt `DATABASE_URL` und `DATABASE_URL_UNPOOLED`).
3. **`JWT_SECRET` in Vercel prüfen bzw. neu setzen** (≥ 32 Zeichen, sonst startet die API nicht).
4. **GitHub-Secret `DATABASE_URL`** = direkte Neon-Verbindung (`DATABASE_URL_UNPOOLED`).
5. **Änderungen prüfen, committen und pushen** (bewusst nicht automatisch erfolgt).
6. **GitHub-Workflows aktivieren:** «Peakr Worker», «Peakr Daten», «CI».
7. **«Peakr Daten» einmal manuell starten** (~20 min) → Schema, Daten, Release `data-latest` mit Strassengraph und Suchindex.
8. **«Peakr Worker» je einmal mit `ski`, `weather`, `trend` starten.**
9. **Vercel neu deployen** (ohne Build-Cache). Root Directory `apps/frontend`, Node 22; Region `fra1` kommt aus `vercel.json`.
10. **Vercel-Deploy-Hook** anlegen und als GitHub-Secret `VERCEL_DEPLOY_HOOK_URL` speichern (empfohlen).
11. **Abnahme:** `/api/health` → `status: ok`; Suche Zürich/Wandern/90 min; Detail; Favorit.
12. **Lokale `.env`:** `DATABASE_URL` auf die lokale DB umstellen; veraltete Variablen entfernen.
13. **Repository aus iCloud nehmen** (z. B. nach `~/Developer/peakr`): iCloud hat Dateien ausgelagert und Konfliktkopien angelegt.
14. Optional: Uptime-Überwachung auf `/api/health` (z. B. UptimeRobot, gratis); alte GitHub-Secrets `ORS_API_KEY`, `ENCRYPTION_KEY`, `JWT_SECRET` löschen.

Alle Befehle dazu (ohne Kopieren von Geheimnissen): [SETUP_EXTERNAL.md](../SETUP_EXTERNAL.md).

## 11. Verbleibende Einschränkungen

- **Liftstatus:** keine freie, rechtlich saubere Quelle → nicht angezeigt (Anlagenzahl aus OSM ja). Adapter-Schnittstelle vorbereitet.
- **Fahrzeiten** ohne Verkehr, Baustellen und tageszeitliche Sperren; Saisonsperren mit Stand des wöchentlichen Graph-Builds; Startort muss höchstens 3 km von einer Strasse liegen.
- **Routen** werden berechnet, nicht begangen. 34 % der Ziele (vor allem hochalpine Gipfel über Gletscher, z. B. Titlis, Wildhorn, Mont Fort) haben keinen durchgehenden Weg im Netz und erscheinen nur unter «ohne Route». 16,8 % der Routen haben keine bekannte SAC-Schwierigkeit.
- **Parkplätze** stammen aus OSM; 92 % sind ohne Namen (Anzeige «Parkplatz auf … m»), 802 Ausgangspunkte sind nur Strassenzugänge ohne bestätigten Parkplatz (gekennzeichnet).
- **Schneehöhen** sind Modellwerte (Open-Meteo) an Tal- und Bergstation, keine Messungen der Bergbahnen.
- **Pistenkilometer** summieren die OSM-Pistenlinien inkl. Freeride/Skirouten und können von Angaben der Bergbahnen abweichen.
- **Gruppierung der Skigebiete** ist automatisch; zusammenhängende Grossgebiete können anders geschnitten sein als im Marketing (z. B. «4 Vallées – Verbier/La Tzoumaz/Nendaz/Veysonnaz/Thyon» als ein Gebiet, im Oberengadin dagegen «Corviglia» und «St. Moritz – Zuoz» getrennt).
- **Wanderwege-Overlay, Grundkarte, Feuerstellen** kommen live von swisstopo bzw. Overpass; bei deren Ausfall fehlen sie in der Karte (die Suche funktioniert weiter).
- **GitHub schaltet Zeitpläne** nach 60 Tagen Inaktivität ab. Der Daten-Workflow reaktiviert sie wöchentlich; ob das auf Dauer genügt, ist erst nach einigen Monaten Betrieb belegt. `/api/health` zeigt veraltete Jobs an.
- **Abhängigkeiten mit offenen Meldungen (12):** 10 betreffen Build-Werkzeuge in Next.js 15.5.29 (postcss, nanoid, source-map-js) bzw. `sharp` für die Bildoptimierung, die Peakr nicht nutzt; behoben erst mit Next.js 16 (Major-Update, bewusst nicht durchgeführt). `zod` 3: Speicherverbrauch bei übergrossen Sammlungen – alle Arrays der API sind begrenzt (`max(5)`, `max(50)`), Next.js begrenzt die Anfragegrösse; behoben erst mit zod 4 (Major). `uuid` in `node-cron`: betrifft v3/v5/v6 mit Puffer, `node-cron` nutzt v4. Empfehlung: Next.js 16 und zod 4 in einem eigenen, getesteten Schritt.
- **Neon Free:** 1 GB Speicher, 100 CU-Stunden und 5 GB ausgehender Verkehr je Monat (Neon-FAQ, Stand 03.11.2026); nur kurzer Wiederherstellungszeitraum – Konten/Favoriten bei Bedarf selbst sichern (Befehl in [BETRIEB.md](BETRIEB.md)). Nach 5 min ohne Zugriff pausiert die Datenbank; der erste Zugriff danach dauert 1–2 s länger.
- **Stammdaten der Suche** stammen aus dem Suchindex des letzten Deploys. Ohne Deploy-Hook erreichen neue Ziele, Parkplätze und Routen die Suche erst mit dem nächsten Push (die Detailseite ist immer aktuell).

## 12. Einschätzung der Datenqualität und Abdeckung

Gemessen, nicht geschätzt ([DATENQUALITAET.md](DATENQUALITAET.md), `pnpm report:quality`):

- **19'225 Wanderziele in allen 26 Kantonen** (vorher 4'446): 11'010 Gipfel, 2'903 Hütten/Berggasthäuser, 2'611 Pässe, 1'727 Seen, 974 Aussichtspunkte. 3'722 Gipfel liegen unter 1'200 m (vorher 0).
- **Vollständigkeit gegenüber der amtlichen Quelle:** Alle swissNAMES3D-Objekte der Wanderziel-Objektarten innerhalb der Schweiz sind übernommen (9'845 Gipfel-Einträge → 9'798 nach Zusammenführung amtlicher Doppelungen). OSM ergänzt 1'212 Gipfel und 914 Aussichtspunkte, die swissNAMES3D nicht führt. Das ist die Abdeckung der Quellen – eine Prüfung «jedes Wanderziel der Schweiz» gegen eine dritte, unabhängige Liste gibt es nicht.
- **Routen:** 12'754 Ziele (66 %) mit mindestens einer Route, 22'403 Routen insgesamt. Hütten 93 %, Aussichtspunkte 94 %, Seen 86 %, Gipfel 57 %, Pässe 53 % (viele Pässe/Gipfel sind weglos).
- **Schwierigkeit:** beste Route je Ziel T1 6'214 · T2 1'288 · T3 2'589 · T4 476 · T5 129 · T6 148 · unbekannt 1'910.
- **Fahrzeit:** für jeden Ausgangspunkt mit Strassenanschluss exakt berechnet (alle 9'320); Abweichung zu ORS im Median 2,6 %.
- **Duplikate:** 10'997 beim Import zusammengeführt; verbleibend 10 gleichnamige Paare unter 300 m, bewusst getrennt (unterschiedliche Höhe bzw. allgemeine Namen wie «Plateforme»).
- **Fehlerhafte Datensätze:** 0 Koordinaten ausserhalb der Schweiz, 0 unplausible Höhen, 0 Ziele ohne Namen, 0 ungültige Routengeometrien.
- **Skigebiete:** 317 mit 1'760 Anlagen; alle mit Talstation und Strassenzufahrt (13 autofrei gekennzeichnet); kleine Dorflifte sind erfasst, soweit in OSM vorhanden.

## 13. Nachtrag: Neon und Suchindex

**Anlass:** Für ein neues Supabase-Gratisprojekt gibt es kein Kontingent mehr.

**Entscheidung:** Neon (Gratisstufe) über die Vercel-Integration. Kriterien: kostenlos ohne
Kreditkarte, PostGIS verfügbar (laut Neon-Dokumentation), keine Sperre nach Inaktivität, gleiche
Region wie die Vercel-Funktionen, Umgebungsvariablen werden von Vercel gesetzt. Peakr nutzte keine
Supabase-spezifischen Funktionen; geändert hat sich nur die Verbindung.

**Umgesetzt und getestet:**

| Änderung | Warum | Nachweis |
|---|---|---|
| URL-Bereinigung (`sanitizeDatabaseUrl`) | Neon-URLs enthalten `channel_binding`; postgres.js reicht das als Startparameter durch, Postgres bricht ab | Lokal reproduziert («unrecognized configuration parameter»), mit Bereinigung verbunden; Unit-Test |
| Gepoolte/direkte Verbindung automatisch | Pooler (Transaktionsmodus) für Serverless, direkte Verbindung für lange Importe | Code `db/index.ts`; Workflows nutzen die direkte URL |
| Suchindex `search-index.json.gz` (2 MB) | Eine grosse Suche hätte ~10 MB aus der DB gelesen – bei 5 GB/Monat nur ~500 Suchen | Suche liest nur noch Live-Daten; DB-Testmatrix (35 Tests, 8 Regionen) besteht unverändert |
| Suche ohne Datenbank lauffähig | Neon pausiert/Kontingent/Störung darf die Kernfunktion nicht abschalten | Unit-Test und Produktionsserver ohne DB: Treffer mit Fahrzeit, `liveData: unavailable`, Hinweis in der Oberfläche |
| Rate-Limit der Suche lässt bei DB-Ausfall durch | sonst hätte der Rate-Limit-Schreibzugriff die Suche blockiert | Unit-Test über `apiSearch` |
| `/api/health` meldet den Suchindex | Betrieb erkennt fehlende Artefakte | Smoke-Test |
| Daten-Workflow veröffentlicht beide Artefakte; `prebuild` lädt beide | Index und Graph gehören zum selben Datenstand | Build lokal: beide Dateien im Funktions-Bundle (`route.js.nft.json`) |
| `apps/frontend/vercel.json`: Region `fra1` | Datenbank in Frankfurt; Standardregion wäre Washington | – (greift beim Deploy) |
| Ungeeignetes `JWT_SECRET` schaltet nur die Anmeldung ab (503) statt die ganze API | Vercel gibt die Werte nicht heraus, die Länge des alten Geheimnisses ist unbekannt; vorher hätte ein zu kurzes Geheimnis auch Suche und Statusseite lahmgelegt. Die Workflows lesen das GitHub-Secret nicht mehr | Unit-Test; `/api/health` meldet `auth.configured` |
| iCloud-Konfliktkopien entfernt | leere `app/api/* 2/`-Ordner, doppelte Screenshots und `.next/* 2.ts` brachen den Typecheck | Typecheck grün |

**Nicht ausgeführt (Freigabe nötig):** Variablen in Vercel ändern, GitHub-Secrets setzen, pushen,
deployen. Das Ändern von Vercel-Variablen hat die Sitzungsrichtlinie blockiert (Schreibzugriff auf
Geheimnis-Speicher); alle Schritte stehen mit fertigen Befehlen in [SETUP_EXTERNAL.md](../SETUP_EXTERNAL.md).

**Neue Dateien:** `apps/backend/src/search/indexFormat.ts`, `apps/backend/src/search/searchIndex.ts`,
`apps/backend/src/search/searchIndex.test.ts`, `apps/backend/src/pipeline/steps/searchIndex.ts`,
`apps/frontend/vercel.json`. **Geändert:** `db/index.ts`, `db/migrate.ts`, `config/env.ts`,
`repositories/search.repo.ts`, `services/search.service.ts`, `services/health.service.ts`,
`server/index.ts`, `pipeline/cli.ts`, `packages/shared/src/{search,api}.ts`,
`apps/frontend/components/PeakrUI.tsx`, `apps/frontend/app/peakr.css`,
`apps/frontend/scripts/fetch-road-graph.mjs`, `apps/frontend/next.config.mjs`,
`.github/workflows/{data,workers}.yml`, `.env.example`, `SETUP_EXTERNAL.md`, `README.md`,
`docs/{ARCHITEKTUR,BETRIEB,ABSCHLUSSBERICHT}.md`.

---

## Anhang: Geänderte Dateien

Stand `git status` am Ende der Arbeiten (ohne `node_modules`, `.data/`, Build-Artefakte).

**Neu (60)**

- `.github/workflows/ci.yml`
- `.github/workflows/data.yml`
- `apps/backend/drizzle/0002_postgis_rebuild.sql`
- `apps/backend/src/geo/lv95.test.ts`
- `apps/backend/src/geo/lv95.ts`
- `apps/backend/src/lib/heap.ts`
- `apps/backend/src/lifts/index.ts`
- `apps/backend/src/pipeline/cli.ts`
- `apps/backend/src/pipeline/dem.ts`
- `apps/backend/src/pipeline/hikeGraph.ts`
- `apps/backend/src/pipeline/io/files.ts`
- `apps/backend/src/pipeline/io/gpkg.ts`
- `apps/backend/src/pipeline/io/opl.ts`
- `apps/backend/src/pipeline/names.test.ts`
- `apps/backend/src/pipeline/names.ts`
- `apps/backend/src/pipeline/network.ts`
- `apps/backend/src/pipeline/nodeGrid.ts`
- `apps/backend/src/pipeline/officialTrails.ts`
- `apps/backend/src/pipeline/paths.ts`
- `apps/backend/src/pipeline/profiles/car.ts`
- `apps/backend/src/pipeline/profiles/hike.ts`
- `apps/backend/src/pipeline/profiles/profiles.test.ts`
- `apps/backend/src/pipeline/runs.ts`
- `apps/backend/src/pipeline/steps/destinations.test.ts`
- `apps/backend/src/pipeline/steps/destinations.ts`
- `apps/backend/src/pipeline/steps/networkStep.ts`
- `apps/backend/src/pipeline/steps/prepare.ts`
- `apps/backend/src/pipeline/steps/roadGraphBuilder.ts`
- `apps/backend/src/pipeline/steps/ski.ts`
- `apps/backend/src/pipeline/steps/slfRegions.ts`
- `apps/backend/src/repositories/search.repo.ts`
- `apps/backend/src/routing/driveTime.ts`
- `apps/backend/src/routing/roadGraph.test.ts`
- `apps/backend/src/routing/roadGraph.ts`
- `apps/backend/src/scripts/calibrate-drive.ts`
- `apps/backend/src/scripts/quality-report.ts`
- `apps/backend/src/scripts/try-search.ts`
- `apps/backend/src/server/index.ts`
- `apps/backend/src/services/destination.service.ts`
- `apps/backend/src/services/geocode.service.ts`
- `apps/backend/src/services/health.service.ts`
- `apps/backend/src/services/slf.service.test.ts`
- `apps/backend/src/test/fixtures.ts`
- `apps/backend/src/test/search.db.test.ts`
- `apps/backend/src/workers/cli.ts`
- `apps/backend/src/workers/jobs.ts`
- `apps/backend/src/workers/runner.ts`
- `apps/backend/vitest.db.config.ts`
- `apps/frontend/lib/map.ts`
- `apps/frontend/lib/peakr.test.ts`
- `apps/frontend/lib/server/handle.ts`
- `apps/frontend/scripts/copy-map-worker.mjs`
- `apps/frontend/scripts/fetch-road-graph.mjs`
- `apps/frontend/vitest.config.ts`
- `docs/ABSCHLUSSBERICHT.md`
- `docs/ARCHITEKTUR.md`
- `docs/AUDIT.md`
- `docs/BETRIEB.md`
- `docs/DATENQUALITAET.md`
- `docs/DATENQUELLEN.md`

**Geändert (64)**

- `.dockerignore`
- `.env.example`
- `.github/workflows/workers.yml`
- `.gitignore`
- `DECISIONS.md`
- `MIGRATION.md`
- `README.md`
- `SETUP_EXTERNAL.md`
- `apps/backend/Dockerfile`
- `apps/backend/drizzle/0001_hiking_pipeline.sql`
- `apps/backend/drizzle/meta/_journal.json`
- `apps/backend/package.json`
- `apps/backend/src/config/env.ts`
- `apps/backend/src/db/index.ts`
- `apps/backend/src/db/migrate.ts`
- `apps/backend/src/lib/logger.ts`
- `apps/backend/src/repositories/destination.repo.ts`
- `apps/backend/src/repositories/favorites.repo.ts`
- `apps/backend/src/repositories/user.repo.ts`
- `apps/backend/src/services/auth.service.ts`
- `apps/backend/src/services/openMeteo.service.ts`
- `apps/backend/src/services/score.service.ts`
- `apps/backend/src/services/search.service.test.ts`
- `apps/backend/src/services/search.service.ts`
- `apps/backend/src/services/slf.service.ts`
- `apps/backend/src/services/wikipedia.service.ts`
- `apps/backend/vitest.config.ts`
- `apps/frontend/Dockerfile`
- `apps/frontend/app/api/auth/login/route.ts`
- `apps/frontend/app/api/auth/logout/route.ts`
- `apps/frontend/app/api/auth/register/route.ts`
- `apps/frontend/app/api/destinations/[id]/route.ts`
- `apps/frontend/app/api/favorites/[destinationId]/route.ts`
- `apps/frontend/app/api/favorites/route.ts`
- `apps/frontend/app/api/geocode/route.ts`
- `apps/frontend/app/api/health/route.ts`
- `apps/frontend/app/api/me/route.ts`
- `apps/frontend/app/api/search/route.ts`
- `apps/frontend/app/dashboard/page.tsx`
- `apps/frontend/app/destinations/[id]/page.tsx`
- `apps/frontend/app/page.tsx`
- `apps/frontend/app/peakr.css`
- `apps/frontend/components/Icon.tsx`
- `apps/frontend/components/PeakrDetail.tsx`
- `apps/frontend/components/PeakrMap.tsx`
- `apps/frontend/components/PeakrUI.tsx`
- `apps/frontend/components/SearchControls.tsx`
- `apps/frontend/lib/api.ts`
- `apps/frontend/lib/peakr.ts`
- `apps/frontend/next.config.mjs`
- `apps/frontend/package.json`
- `docker-compose.yml`
- `docs/screenshots/desktop-detail.jpg`
- `docs/screenshots/desktop-hero.jpg`
- `docs/screenshots/desktop-search-ski.jpg`
- `docs/screenshots/mobile-search.jpg`
- `eslint.config.mjs`
- `package.json`
- `packages/shared/src/api.ts`
- `packages/shared/src/destination.ts`
- `packages/shared/src/enums.ts`
- `packages/shared/src/search.ts`
- `packages/shared/src/user.ts`
- `pnpm-lock.yaml`

**Entfernt (46)**

- `apps/backend/drizzle.config.ts`
- `apps/backend/drizzle/meta/0000_snapshot.json`
- `apps/backend/src/app.ts`
- `apps/backend/src/data/curated-destinations.ts`
- `apps/backend/src/db/schema.ts`
- `apps/backend/src/db/types.ts`
- `apps/backend/src/index.ts`
- `apps/backend/src/lib/isMain.ts`
- `apps/backend/src/lib/jwt.ts`
- `apps/backend/src/plugins/auth.ts`
- `apps/backend/src/repositories/hikingRoutes.repo.ts`
- `apps/backend/src/repositories/import.repo.ts`
- `apps/backend/src/repositories/status.repo.ts`
- `apps/backend/src/routes/admin.ts`
- `apps/backend/src/routes/auth.ts`
- `apps/backend/src/routes/destinations.ts`
- `apps/backend/src/routes/favorites.ts`
- `apps/backend/src/routes/geocode.ts`
- `apps/backend/src/routes/health.ts`
- `apps/backend/src/routes/me.ts`
- `apps/backend/src/routes/search.ts`
- `apps/backend/src/scrapers/adapters/examples.ts`
- `apps/backend/src/scrapers/adapters/index.ts`
- `apps/backend/src/scrapers/adapters/types.ts`
- `apps/backend/src/scripts/import-destinations-legacy.ts`
- `apps/backend/src/scripts/import-destinations.ts`
- `apps/backend/src/scripts/import-hiking-routes.ts`
- `apps/backend/src/scripts/import-slf-regions.ts`
- `apps/backend/src/services/crypto.service.test.ts`
- `apps/backend/src/services/crypto.service.ts`
- `apps/backend/src/services/geoAdmin.service.ts`
- `apps/backend/src/services/openMeteo.service.test.ts`
- `apps/backend/src/services/ors.service.ts`
- `apps/backend/src/services/overpass.service.ts`
- `apps/backend/src/services/swisstopo.service.ts`
- `apps/backend/src/workers/liveStatus.worker.ts`
- `apps/backend/src/workers/run-once.ts`
- `apps/backend/src/workers/trend.worker.ts`
- `apps/frontend/lib/server/db.ts`
- `apps/frontend/lib/server/jwt.ts`
- `apps/frontend/lib/server/response.ts`
- `docs/screenshots/desktop-dark.jpg`
- `docs/screenshots/desktop-favorites.jpg`
- `docs/screenshots/desktop-search-hike.jpg`
- `docs/screenshots/mobile-detail.jpg`
- `railway.toml`

Nicht Teil der Überarbeitung und unverändert gelassen: `.agents/`, `skills-lock.json`, `schema.sql` (lagen bereits vorher unversioniert im Arbeitsverzeichnis).
