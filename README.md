# Peakr

**Peakr** ist ein persönlicher Ski- und Wander-Navigator für die Schweiz. Die App findet das beste Ziel für heute — basierend auf echter Fahrzeit, Schnee- und Wetterlage, Lawinengefahr und einem Bekanntheits-Score. Kein Werbe-Ranking, keine Paywalls.

Der Kern: Du gibst an, wie lange du bereit bist zu fahren. Peakr berechnet daraus erreichbare Gebiete, sortiert sie nach einer Gesamtbewertung (Schnee × Score × Wetter × Saison) und zeigt dir die besten Optionen auf einer Karte — alles mit 100 % kostenlosen Datenquellen.

> Privates Werkzeug, kein kommerzielles Produkt.

---

## Was die App kann

- **Ziele finden** nach Fahrzeit vom eigenen Standort (Geocode oder GPS) — Ski oder Wandern wählbar
- **Detailansicht** pro Ziel: 3D-Terrain, Satellitenluftbild, topografische Karte, 7-Tage-Wetter, Höhen- und Schneeverlauf, Lawinenwarnstufe
- **Live-Daten**: Schneehöhe auf Bergstation und Tal, offene Lifte, Wettercode, Avalanche-Level (SLF)
- **Filterung** nach Wanderart (Gipfel, Bergsee, Hütte, Aussichtspunkt) und SAC-Schwierigkeitsgrad
- **Favoriten** mit Stern markieren und im Dashboard verwalten — auch ohne Login via localStorage
- **Standard-Startort** im Konto speichern → wird bei jedem Öffnen automatisch vorausgewählt
- **3 Design-Direktionen** (Paper / Glacier / Pine), hell/dunkel, Dichte-Einstellung — alles live umschaltbar, im Browser gespeichert
- **Vollständige Authentifizierung** (Register / Login / Logout, JWT, argon2-Hashing)
- Optional: OpenAI-Key hinterlegen für KI-gestützte Textzusammenfassungen

---

## Tech-Stack

| Schicht      | Technologie                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------- |
| Monorepo     | pnpm-Workspaces (`apps/backend`, `apps/frontend`, `packages/shared`)                         |
| Frontend     | Next.js 15 (App Router), TypeScript, Tailwind CSS, MapLibre GL JS, Zustand, lucide-react     |
| Karten       | swisstopo Lightbasemap Vektortiles, swisstopo swissimage WMTS (Luftbild), MapLibre demotiles DEM (3D-Terrain) |
| Design       | Eigenes oklch-Token-System — 3 Design-Direktionen × hell/dunkel × 3 Dichte-Stufen           |
| Schriften    | Spectral (Serif), Hanken Grotesk (Sans), JetBrains Mono — alle via `next/font/google`       |
| Backend      | Node.js + TypeScript, Hapi.js, Drizzle ORM, Zod, jose (JWT), argon2, node-cron              |
| Datenbank    | PostgreSQL 16 + PostGIS (via Docker)                                                         |
| Infrastruktur | Docker Compose (DB + Backend + Frontend + 2 Worker in einem `docker compose up -d`)        |

### Externe Datenquellen (alle kostenlos)

| Quelle               | Verwendung                                        |
| -------------------- | ------------------------------------------------- |
| Open-Meteo           | 7-Tage-Wettervorhersage (kein API-Key nötig)      |
| SLF CAAML            | Tägliches Lawinenbulletin                         |
| swisstopo GeoAdmin   | Geocoding, Kartenvektor-Style, swissimage-Luftbild |
| Overpass / OSM       | POIs, SAC-Schwierigkeiten, Hütteninformationen    |
| OpenRouteService     | Fahrzeitmatrix (einziger Pflicht-API-Key)         |
| Wikipedia Pageviews  | Bekanntheits-Score (pageviews pro Monat)          |
| MapLibre demotiles   | DEM-Terrain-Tiles für 3D-Ansicht                  |

---

## Schnellstart (lokal)

> Vollständige Anleitung inkl. Key-Beschaffung: `SETUP_EXTERNAL.md`

```bash
# 1. Voraussetzungen: Node ≥ 20, pnpm 9, Docker Desktop oder Colima
cp .env.example .env          # .env ausfüllen (mind. ORS_API_KEY)

# 2. Datenbank starten
docker compose up -d

# 3. Abhängigkeiten + Migrationen
pnpm install && pnpm db:migrate

# 4. Daten laden
pnpm import:destinations && pnpm import:slf-regions

# 5. Entwicklung (Backend :4000 + Frontend :3000)
pnpm dev
```

## Produktivbetrieb (komplett via Docker)

```bash
brew install colima docker docker-compose && colima start   # einmalig, falls kein Docker Desktop

cp .env.example .env                      # Secrets eintragen
docker compose up -d --build              # baut & startet alles; Migration läuft automatisch

# Daten einmalig laden:
docker compose run --rm migrate pnpm import:destinations
docker compose run --rm migrate pnpm import:slf-regions
```

- Frontend: <http://localhost:3000> · Backend: <http://localhost:4000/api/health>
- Logs: `docker compose logs -f backend`
- Stoppen: `docker compose down` (Daten bleiben im Volume `pgdata`)

---

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
│   ├── backend/     Hapi-API, Worker, Import-Skripte
│   └── frontend/    Next.js-UI (Karte + Ergebnisliste + Detail)
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
| `PATCH /api/me`                      | ✓     | Startort / Anzeigename ändern          |
| `PUT/DELETE /api/me/openai-key`      | ✓     | optionalen OpenAI-Key setzen/entfernen |
| `GET /api/geocode?q=`                | –     | Ortssuche (swisstopo-Proxy)            |
| `POST /api/search`                   | –     | Kern-Suche (Ziele nach Fahrzeit/Score) |
| `GET /api/destinations/:id`          | –     | Detail inkl. Live-Status & Verlauf     |
| `GET/POST/DELETE /api/favorites[..]` | ✓     | Favoriten verwalten                    |
| `POST /api/admin/refresh`            | admin | Worker manuell anstoßen                |

## Smoke-Test

1. <http://localhost:3000> öffnen → Suchseite mit Karte erscheint
2. **Registrieren** (oben rechts) mit E-Mail + Passwort (≥ 8 Zeichen)
3. Im **Dashboard** einen Standard-Startort setzen → wird beim nächsten Laden automatisch übernommen
4. Startort eingeben (Geocode oder GPS), Modus (Ski/Wandern), Fahrzeitrahmen wählen
5. Ergebnisse als Karte + Liste → Klick auf Marker oder Karte wechselt zu Detailseite
6. Detailseite: zwischen 3D-Terrain, Topokarte und Luftbild wechseln, Wetter + Lawinenstufe prüfen
7. Ziel mit ★ markieren → erscheint im **Dashboard**

> Ohne `ORS_API_KEY` funktioniert die Suche — Fahrzeiten sind dann Luftlinien-Schätzungen.

## Fehlerbehebung

- **`pnpm` fehlt:** `npm install -g pnpm@9`
- **DB-Verbindungsfehler:** läuft `docker compose up -d`? Stimmt `DATABASE_URL` in `.env`?
- **`relation "destinations" does not exist`:** `pnpm db:migrate` ausführen
- **Suche liefert nichts:** `pnpm import:destinations` ausführen
- **Karte bleibt grau:** swisstopo-Style nicht erreichbar → automatischer OSM-Raster-Fallback greift

## Sicherheitshinweis Lawinen

Die Lawinenstufe stammt aus dem offiziellen SLF-Bulletin, ersetzt aber **nicht** die eigene Beurteilung vor Ort. Immer das offizielle Bulletin auf [whiterisk.ch](https://whiterisk.ch) prüfen.
