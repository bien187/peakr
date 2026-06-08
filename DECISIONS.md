# Designentscheidungen & Annahmen

Dieses Dokument hält bewusste Entscheidungen fest, die beim Bauen getroffen wurden.

## Phase 0 — Gerüst

- **Paketmanager:** pnpm 9 (via npm global installiert, da Homebrew-Node kein corepack mitliefert).
- **Modulsystem:** durchgängig ESM (`"type": "module"`). TypeScript mit
  `moduleResolution: "Bundler"` → extensionslose Imports, kein `.js`-Suffix nötig.
- **Shared-Paket ohne Build-Schritt:** `@ch-alpineroute/shared` exportiert direkt die
  TS-Quelle (`exports` → `./src/index.ts`). Backend lädt sie über `tsx`, das Frontend über
  Next.js `transpilePackages`. Das spart einen separaten Build und hält die Typen synchron.
- **Eine einzige `.env` im Root:** Das Backend lädt sie über einen absoluten Pfad
  (`import.meta.url`), das Frontend über `dotenv` in `next.config.mjs`. So gibt es nur eine
  Quelle für Secrets statt je eine pro App.
- **TypeScript strict:** `strict: true` aktiv. `noUncheckedIndexedAccess` und
  `verbatimModuleSyntax` bewusst **aus** gelassen, um Reibung in einem so großen Codebestand
  zu vermeiden, ohne die Kern-Typsicherheit zu verlieren.
- **ESLint:** eine flache Root-Config (`eslint.config.mjs`) mit typescript-eslint
  (syntaktisch, nicht typ-bewusst → schnell, weniger False Positives) + Prettier-Kompat.
  Next.js führt sein eigenes Lint nicht beim Build aus (`ignoreDuringBuilds`), da separat gelintet wird.
- **Redis optional:** in `docker-compose.yml` hinter dem Profil `with-redis`, startet also
  nicht standardmäßig. Aktuell nicht zwingend gebraucht.
- **Frontend-Style:** Tailwind 3.4 (stabile Config-Datei) statt Tailwind 4 (CSS-first),
  da der Prompt eine `tailwind.config.ts` mit Breakpoints vorsieht.

## Phase 1 — DB & Shared

- **PostGIS-Geo-Spalten via Drizzle-`customType`:** `geography(Point,4326)`,
  `geography(LineString,4326)`, `geography(MultiPolygon,4326)` und `bytea`. Die Typen dienen
  primär der DDL-Erzeugung; gelesen/geschrieben werden Geometrien fast immer über rohe
  `ST_*`-SQL-Ausdrücke (ST_MakePoint, ST_AsGeoJSON, ST_DWithin), da die WKB-Rückgaben des
  Treibers nicht direkt nutzbar sind.
- **Manueller Fix im generierten Migrations-SQL:** `drizzle-kit generate` setzt customType-
  Typnamen in Anführungszeichen (`"geography(Point,4326)"`). PostgreSQL würde das als
  wörtlichen Typnamen lesen und scheitern — der Typmodifier muss außerhalb der Quotes stehen.
  Daher sind im File `drizzle/0000_*.sql` die Quotes um die `geography(...)`- und `bytea`-Typen
  entfernt. Bei künftigem `generate` ggf. erneut anpassen.
- **PostGIS-Extension:** wird vom Migrations-Runner (`src/db/migrate.ts`) per
  `CREATE EXTENSION IF NOT EXISTS postgis;` **vor** den Migrationen sichergestellt.
- **`geography` statt `geometry`:** geography rechnet sphärisch in Metern → `ST_DWithin(..., meter)`
  und Distanzen sind ohne Reprojektion korrekt für die ganze Schweiz.
- **Append-only `live_status`** mit Index `(destination_id, captured_at DESC)` für schnelle
  `DISTINCT ON`-Abfragen des neuesten Snapshots.
- **Shared-Schemas** spiegeln die DB, sind aber API-orientiert (camelCase, `LatLng` statt
  Geo-Spalte). Eine Quelle der Wahrheit für Backend-Validierung und Frontend-Typen.

## Phase 2 — Externe Services

Alle Endpunkte wurden live gegen die echten APIs verifiziert (Formate geprüft).

- **HTTP-Helper (`lib/http.ts`):** zentraler `fetchJson` mit 8s-Timeout (`AbortSignal.timeout`),
  1 Retry (5xx/429/Netzfehler; 4xx endgültig), plus `settle()` für „nie den ganzen Request
  killen". Workers/Suche kapseln jede Quelle einzeln.
- **SLF-Warnregionen:** Der dokumentierte Pfad `/api/warningregion/` ist die Swagger-UI. Der echte
  GeoJSON-Endpunkt ist `/api/warningregion/warnregionDefinition/current/geojson` (149 Polygone,
  Props `sector_id`/`sector_name`). Region-ID = `sector_id`.
- **SLF-Bulletin im Sommer leer:** `{"bulletins":[]}` → Parser gibt leere Map zurück (kein Fehler).
  Bulletin-Region-IDs (z.B. `CH-1111`) werden via `normalizeRegionId` auf `sector_id` (`1111`) gemappt.
- **Open-Meteo:** `snow_depth` in m → ×100 = cm; `snowfall`/`snowfall_sum` bereits in cm;
  `wind_speed_10m` in km/h; `visibility` in m. Aktuelle Stunde via `currentHourIndex`.
- **swisstopo:** Geocode-Label enthält HTML (`<b>…</b>`) und Kanton in Klammern (`Zermatt (VS)`)
  → `stripHtml` + `extractCanton`. Zusätzlich Höhen-API als Fallback für fehlende Höhenmeter.
- **Overpass:** `out center;` liefert Way/Relation-Mittelpunkte (`center.lat/lon`); großzügiger
  Timeout (60s) + Retry, da rate-limited/langsam → Ergebnisse beim Import cachen.
- **ORS:** Matrix-Endpoint, Fahrzeit in Sekunden → Minuten; `Authorization`-Header = roher Key
  (kein „Bearer"). Ein Request pro Suche. Isochrone optional, ≤60 Min.
- **Wikipedia:** Pageviews-Summe letzte 30 Tage, log-Skalierung auf 1–100 (`pageviewsToScore`,
  `is_estimate=true`). 404 → Score 1. Aussagekräftiger User-Agent (Wikimedia-Pflicht).
- **OpenAI:** abschaltbares Modul (`ENABLE_OPENAI_TREND`, Default aus), Responses API + web_search,
  strukturiertes JSON-Schema. User-Key wird verschlüsselt gespeichert, nie geloggt/an Browser gesendet.
- **crypto.service:** AES-256-GCM, IV pro Aufruf zufällig, Auth-Tag an Ciphertext angehängt.

## Phase 3 — Auth & User

- **JWT via jose** (HS256, `JWT_SECRET`), Token zusätzlich als httpOnly-Cookie gesetzt; das
  Frontend nutzt primär den `Authorization: Bearer`-Header (Token kommt auch im Body zurück).
- **Passwort-Hashing:** argon2id. `verifyPassword` fängt Fehler ab und gibt `false` statt zu werfen.
- **Auth-Middleware:** `installAuth` dekoriert `app.authenticate` (PreHandler) + `request.user`.
  Geschützte Routen nutzen `{ preHandler: app.authenticate }` und `requireUser()`.
- **PostGIS-Home-Location:** Da der Treiber Geographie als WKB liefert, werden User über rohe
  `ST_X/ST_Y`-SQL gelesen und mit `ST_MakePoint(...)::geography` geschrieben (user.repo.ts).
- **OpenAI-Key:** verschlüsselt (AES-GCM) in `openai_key_enc`/`openai_key_iv`, wird nie an den
  Client zurückgegeben — nur das Flag `hasOpenAiKey`.
- **Einheitlicher Error-Handler:** AppError → Status+Code, ZodError → 400, Rest → 500.

## Phase 4 — Suche

- **Ein Query, kein N+1:** `findCandidates` holt Ziel + neuesten Live-Snapshot
  (`LEFT JOIN LATERAL ... ORDER BY captured_at DESC LIMIT 1`) + Trend in einem Statement,
  gefiltert per `ST_DWithin` (Radius ≈ (maxMinutes+Toleranz)×1500 m), sortiert nach Luftlinie,
  LIMIT 60.
- **Trennung IO / Logik:** `search()` macht IO (DB + ORS), die reine `assembleResponse()` macht
  Aufteilung/Gate/Scoring/Sortierung → vollständig ohne Mocks testbar.
- **ORS-Fallback:** Ohne `ORS_API_KEY` (oder bei ORS-Fehler) Luftlinien-Schätzung
  (×1,4 bei ~50 km/h); `meta.matrixUsed=false` macht das transparent.
- **Sicherheits-Gate:** Ski-Ziele mit Lawinenstufe ≥4 werden `blocked` markiert, ans Listenende
  sortiert und mit Begründung versehen (statt still zu verschwinden → mehr Transparenz).
- **Vorschläge ("+X Min"):** Ziele mit maxMinutes < Fahrzeit ≤ maxMinutes+Toleranz landen in
  `suggestions` mit `overBudgetMinutes`.
- **Score-Formel transparent** (`score.service`): jeder Beitrag (Basis/Schnee/Neuschnee/Lifte/
  Bedingungen/Trend/Lawinen-Abzug) ist im `scoreBreakdown` nachvollziehbar.
- **`hikeKind`-Mapping:** `route`→hike_route, peak/lake/hut/viewpoint→hike_destination,
  `any`→beide. SAC-Filter nutzt die natürliche Enum-Ordnung (`<= 'T3'::sac_difficulty`).
- **`validate()`** typt auf `z.infer` (Output), damit Zod-`.default()`-Felder als required gelten.

## Phase 5 — Worker & Seed

- **Worker mit `runOnce`-Funktion + Cron-Guard:** `runLiveStatusOnce`/`runTrendOnce` sind reine
  Funktionen; Cron wird nur per `isMainModule()` beim direkten Start geplant. So kann die
  Admin-Route die Funktionen importieren/aufrufen, ohne dass der API-Server Crons startet.
- **`/api/admin/refresh`** (admin-only) startet beide Worker im Hintergrund (HTTP 202), damit der
  Request nicht blockiert.
- **Liftstatus-Adapter:** Interface + 3 Beispiel-Adapter (Zermatt/Laax/Davos). Da es keine freie,
  offizielle CH-weite Quelle gibt, liefern sie ehrlich `unknown` statt zu crashen oder zu faken.
  Registry `getLiftStatus` kapselt Fehler via `settle`.
- **Schneehöhe:** Open-Meteo liefert einen Punktwert am Ziel → gespeichert als `snow_depth_top_cm`
  (kein separater Tal-/Berg-Wert ohne zweite Koordinate).
- **OpenAI im trend-Worker:** nutzt — falls `ENABLE_OPENAI_TREND` und `OPENAI_API_KEY` gesetzt —
  den globalen Env-Key (ein Worker hat keinen User-Kontext). Der per-User-Key bleibt für
  künftige per-User-Features reserviert. Score bleibt immer `is_estimate=true`.
- **Idempotente Imports:** kuratierte Ziele werden per (Name+Typ) entdoppelt, Overpass-Ziele per
  `source_ref->>'osmId'`. Overpass-Abfragen sind auf die Schweiz begrenzt, gecappt (`out center N`)
  und filtern Gipfel auf ≥2500 m, um Rauschen/Rate-Limits zu begrenzen.
- **SLF-Import:** GeoJSON → `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(...),4326))::geography`,
  danach `ST_Contains` zum Verknüpfen der Ziele mit ihrer Warnregion.

## Datenlage (ehrlich)

- **Live-Liftstatus** hat keine offizielle, schweizweite Gratis-Quelle. Die Skigebiet-Adapter
  geben bei fehlender Quelle sauber `unknown` zurück statt zu crashen. Echte Live-Liftdaten gibt
  es nur für Gebiete, für die ein konkreter Adapter existiert (siehe Phase 5).
