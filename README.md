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

> Vollständige, schrittweise Anleitung inkl. Key-Beschaffung: siehe **`SETUP_EXTERNAL.md`**
> (wird in Phase 8 erzeugt).

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

## Sicherheitshinweis Lawinen

Die angezeigte Lawinen-Gefahrenstufe stammt aus dem offiziellen SLF-Bulletin, ersetzt aber
**nicht** die eigene Beurteilung vor Ort. Immer das offizielle Bulletin auf
[whiterisk.ch](https://whiterisk.ch) prüfen.
