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

_(folgt)_

## Datenlage (ehrlich)

- **Live-Liftstatus** hat keine offizielle, schweizweite Gratis-Quelle. Die Skigebiet-Adapter
  geben bei fehlender Quelle sauber `unknown` zurück statt zu crashen. Echte Live-Liftdaten gibt
  es nur für Gebiete, für die ein konkreter Adapter existiert (siehe Phase 5).
