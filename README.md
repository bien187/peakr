# 🏔️ CH-AlpineRoute

Intelligenter **Ski- und Wander-Navigator für die Schweiz**. Findet das beste Ziel nach
**echter Fahrzeit**, **Schnee- & Wetterlage**, **Lawinengefahr (SLF)** und einem ehrlichen
**Bekanntheits-Score** — alles mit **100 % kostenlosen Datenquellen**.

> Privates Tool, kein kommerzielles Produkt. Kein Mapbox-Token, kein .NET, keine bezahlten
> Dienste (Ausnahme: optionale, standardmäßig deaktivierte OpenAI-Anreicherung).

---

## Tech-Stack

| Bereich   | Technologie                                                              |
| --------- | ------------------------------------------------------------------------ |
| Monorepo  | pnpm-Workspaces (`apps/backend`, `apps/frontend`, `packages/shared`)     |
| Backend   | Node.js + TypeScript, Fastify, Drizzle ORM, Zod, jose, argon2, node-cron |
| Datenbank | PostgreSQL 16 + PostGIS (via Docker)                                     |
| Frontend  | Next.js (App Router), Tailwind CSS, MapLibre GL JS                       |
| Routing   | OpenRouteService Public API (Matrix für Fahrzeiten)                      |
| Karte     | swisstopo Vektor-Style (kostenlos, kein Token)                           |

## Externe Datenquellen (alle kostenlos)

Open-Meteo (Wetter/Schnee), SLF CAAML (Lawinen), swisstopo GeoAdmin (Geocoding, Wanderwege),
Overpass/OSM (POIs, SAC-Schwierigkeit), OpenRouteService (Fahrzeit – einziger Pflicht-Key),
Wikipedia Pageviews (Bekanntheits-Score). Optional & kostenpflichtig: OpenAI (deaktiviert).

---

## Schnellstart (lokal)

> Vollständige, schrittweise Anleitung inkl. Key-Beschaffung: siehe **`SETUP_EXTERNAL.md`**.

```bash
# 1. Voraussetzungen: Node ≥ 20, pnpm 9, Docker Desktop
# 2. Secrets anlegen
cp .env.example .env          # danach .env ausfüllen (mind. ORS_API_KEY)

# 3. Datenbank starten
docker compose up -d

# 4. Abhängigkeiten + Migrationen
pnpm install
pnpm db:migrate

# 5. Daten laden
pnpm import:slf-regions
pnpm import:destinations

# 6. Entwicklung starten (Backend :4000 + Frontend :3000)
pnpm dev
```

## Produktivbetrieb (komplett in Docker)

Die ganze App (DB + Backend + Frontend + beide Worker) läuft mit **einem Befehl**. Voraussetzung
ist eine Docker-Laufzeit — entweder **Docker Desktop** oder das passwortfreie **Colima**:

```bash
brew install colima docker docker-compose && colima start   # einmalig (falls kein Docker Desktop)
```

```bash
cp .env.example .env             # ausfüllen (Secrets generieren, optional ORS_API_KEY)
docker compose up -d --build     # baut & startet alles; Migration läuft automatisch

# Daten einmalig laden (danach halten die Worker sie aktuell):
docker compose run --rm migrate pnpm import:destinations
docker compose run --rm migrate pnpm import:slf-regions
```

- Frontend: <http://localhost:3000> · Backend: <http://localhost:4000/api/health>
- Status/Logs: `docker compose ps` · `docker compose logs -f backend`
- Stoppen: `docker compose down` (Daten bleiben im Volume `pgdata` erhalten)
- `restart: unless-stopped` → Container starten nach einem Reboot automatisch wieder
  (Colima vorher hochfahren: `brew services start colima`, oder in Docker Desktop „Start on login").

## Nützliche Befehle

| Befehl                      | Wirkung                                          |
| --------------------------- | ------------------------------------------------ |
| `pnpm dev`                  | Backend + Frontend parallel                      |
| `pnpm typecheck`            | `tsc --noEmit` in allen Paketen                  |
| `pnpm lint` / `pnpm format` | ESLint / Prettier                                |
| `pnpm test`                 | Vitest (Backend)                                 |
| `pnpm db:migrate`           | Drizzle-Migrationen anwenden                     |
| `pnpm import:destinations`  | Ziele via Overpass + kuratierte JSON importieren |
| `pnpm import:slf-regions`   | SLF-Warnregionen importieren & Zielen zuordnen   |

## Projektstruktur

```
.
├── apps/
│   ├── backend/     Fastify-API, Worker, Import-Skripte
│   └── frontend/    Next.js-UI (Map + Liste)
├── packages/
│   └── shared/      Zod-Schemas & TypeScript-Typen (Backend + Frontend)
├── docker-compose.yml
├── .env.example
└── DECISIONS.md     getroffene Annahmen & Designentscheidungen
```

## API-Endpunkte (Backend, `:4000`)

| Methode + Pfad                       | Auth  | Zweck                                  |
| ------------------------------------ | ----- | -------------------------------------- |
| `GET /api/health`                    | –     | Health-Check                           |
| `POST /api/auth/register`            | –     | Registrieren → JWT                     |
| `POST /api/auth/login`               | –     | Login → JWT                            |
| `POST /api/auth/logout`              | –     | Cookie löschen                         |
| `GET /api/me`                        | ✓     | eigenes Profil                         |
| `PATCH /api/me`                      | ✓     | Startort/Anzeigename ändern            |
| `PUT/DELETE /api/me/openai-key`      | ✓     | optionalen OpenAI-Key setzen/entfernen |
| `GET /api/geocode?q=`                | –     | Ortssuche (swisstopo-Proxy)            |
| `POST /api/search`                   | –     | Kern-Suche (Ziele nach Fahrzeit/Score) |
| `GET /api/destinations/:id`          | –     | Detail inkl. Live-Historie             |
| `GET/POST/DELETE /api/favorites[..]` | ✓     | Favoriten verwalten                    |
| `POST /api/admin/refresh`            | admin | Worker manuell anstoßen (Hintergrund)  |

## Worker & Daten

```bash
pnpm import:destinations   # Ziele laden (kuratiert + Overpass) — einmalig / bei Bedarf
pnpm import:slf-regions    # SLF-Warnregionen laden & Zielen zuordnen

pnpm worker:live           # Live-Status-Worker (sofort + Cron alle 3 h)
pnpm worker:trend          # Trend-Worker (sofort + Cron täglich 04:30)
```

Die Worker laufen als eigene, dauerhafte Prozesse. Alternativ als Admin `POST /api/admin/refresh`
für einen einmaligen Lauf. Ohne gelaufenen Live-Worker zeigen Ziele noch keine Wetter-/Schneedaten.

> **Live-Liftstatus:** Es gibt keine offizielle, schweizweite Gratis-Quelle. Die Adapter geben
> dafür sauber „unbekannt" zurück (siehe `DECISIONS.md`).

## Smoke-Test (nach `pnpm dev`)

1. <http://localhost:3000> öffnen → Landing/Suche erscheint.
2. **Registrieren** (oben rechts) mit E-Mail + Passwort (≥8 Zeichen).
3. **Startort** eingeben (z.B. „Bern") und aus der Autocomplete wählen.
4. Modus **Ski/Wandern**, Fahrzeit-Slider setzen → **Ziele finden**.
5. Ergebnisse erscheinen als Karten + farbige Marker auf der Karte; Klick synchronisiert beide.
6. Ein Ziel mit ★ als Favorit markieren → erscheint im **Dashboard**.
7. **Details →** öffnet die Detailseite mit Verlaufs-Chart.

> Ohne `ORS_API_KEY` funktioniert die Suche trotzdem — Fahrzeiten sind dann Luftlinien-Schätzungen
> (im Ergebnis-Header vermerkt). Mit Key kommen echte Fahrzeiten aus der ORS-Matrix.

## Fehlerbehebung

- **`pnpm` fehlt:** `npm install -g pnpm@9` (Homebrew-Node bringt kein corepack mit).
- **DB-Verbindungsfehler:** läuft `docker compose up -d`? Stimmt `DATABASE_URL` in `.env`?
- **`relation \"destinations\" does not exist`:** `pnpm db:migrate` ausführen.
- **Suche liefert nichts:** zuerst `pnpm import:destinations` ausführen.
- **Karte bleibt grau:** der swisstopo-Vektor-Style war nicht erreichbar → automatischer
  OSM-Raster-Fallback; Marker funktionieren unabhängig davon.

## Sicherheitshinweis Lawinen

Die angezeigte Lawinen-Gefahrenstufe stammt aus dem offiziellen SLF-Bulletin, ersetzt aber
**nicht** die eigene Beurteilung vor Ort. Immer das offizielle Bulletin auf
[whiterisk.ch](https://whiterisk.ch) prüfen.
