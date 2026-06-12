# Migration: Netlify → Vercel + Supabase

Ziel: weg von den aufgebrauchten Netlify-Credits, komplett auf **kostenlosen Tiers**.

## Zielarchitektur

| Teil | Vorher | Nachher |
|------|--------|---------|
| UI **+ Backend** (Next.js `apps/frontend`, inkl. `app/api/*`) | Netlify | **Vercel** |
| Datenbank (Postgres **+ PostGIS**) | extern | **Supabase** (Free) |
| Worker `liveStatus` (alle 3 h) / `trend` (täglich) | — | **GitHub Actions** (Free) |
| Fastify `apps/backend` | nur lokal/Original | bleibt **Dev-only** (nicht deployt) |

**Wichtig:** Das produktive „Backend" sind die **Next.js-API-Routes** in `apps/frontend/app/api/*`
(sie sprechen die DB direkt über `lib/server/db.ts` an). Es gibt in Produktion **keinen separaten
Server** — Frontend und API laufen zusammen auf Vercel. PostGIS wird nur beim **Daten-Import** und in
den **Workern** (`apps/backend`) gebraucht (z.B. Ziele den SLF-Regionen via `ST_Contains` zuordnen),
nicht zur Laufzeit der Suche.

---

## Schritt 1 — Supabase (Datenbank)

1. **Projekt anlegen:** [supabase.com](https://supabase.com) → *New project*. Region **EU (Frankfurt)**,
   starkes DB-Passwort vergeben (notieren).
2. **PostGIS aktivieren:** Dashboard → *Database* → *Extensions* → `postgis` einschalten.
   (Die Migration ruft zusätzlich `CREATE EXTENSION IF NOT EXISTS postgis` auf — doppelt hält besser.)
3. **Connection-Strings holen:** *Project Settings* → *Database* → *Connection string*. Es gibt zwei,
   die wir je nach Zweck verwenden:
   - **Session-Pooler / Direct (Port 5432)** → für **Migration, Import, GitHub Actions** (lange Batch-Läufe).
   - **Transaction-Pooler (Port 6543)** → für **Vercel** (Serverless, viele kurze Verbindungen).

   > Der Code setzt überall `prepare: false`, daher funktionieren beide Strings problemlos.

4. **Schema + Daten laden (lokal, einmalig).** `.env` im Repo-Root anlegen mit dem **Session-Pooler**-String:
   ```bash
   DATABASE_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```
   Dann:
   ```bash
   pnpm install
   pnpm --filter @ch-alpineroute/backend db:migrate          # Schema + PostGIS
   pnpm --filter @ch-alpineroute/backend import:slf-regions   # Lawinenregionen (Polygone)
   pnpm --filter @ch-alpineroute/backend import:destinations  # Ziele (nutzt ST_Contains)
   # optional:
   pnpm --filter @ch-alpineroute/backend import:hiking-routes
   ```
5. **Erstbefüllung Live/Trend**, damit sofort Daten da sind:
   ```bash
   pnpm --filter @ch-alpineroute/backend worker:live:once
   pnpm --filter @ch-alpineroute/backend worker:trend:once
   ```

---

## Schritt 2 — Vercel (App = Frontend + API)

1. [vercel.com](https://vercel.com) → *Add New… → Project* → Repo **bien187/peakr** importieren.
2. **Root Directory:** `apps/frontend` (Vercel erkennt Next.js; der pnpm-Workspace wird automatisch
   mitinstalliert, inkl. `@ch-alpineroute/shared`).
3. **Environment Variables** (Production):

   | Variable | Wert |
   |----------|------|
   | `DATABASE_URL` | Supabase **Transaction-Pooler** (Port 6543) |
   | `JWT_SECRET` | `openssl rand -base64 48` (zwingend für Login!) |
   | `NEXT_PUBLIC_SWISSTOPO_STYLE_URL` | `https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json` |
   | `NEXT_PUBLIC_API_BASE_URL` | **leer lassen / nicht setzen** → same-domain `/api/*` |

   `NODE_ENV=production` setzt Vercel selbst (aktiviert auch DB-SSL).
4. **Deploy.** Ergebnis-Domain z.B. `https://peakr.vercel.app`.

> Falls der pnpm-Workspace-Install zickt: Install Command auf `pnpm install` setzen und sicherstellen,
> dass Vercel Dateien außerhalb des Root-Directory einbezieht (Monorepo-Default ist ok).

---

## Schritt 3 — GitHub Actions (Worker, gratis)

Der Workflow liegt bereits unter `.github/workflows/workers.yml` (liveStatus alle 3 h, trend täglich
04:30 UTC, plus manuell per *Run workflow*). Er führt die Job-Skripte einmalig aus und schreibt nach
Supabase.

**Repository-Secrets setzen** (*Settings → Secrets and variables → Actions → New repository secret*):

| Secret | Pflicht | Hinweis |
|--------|---------|---------|
| `DATABASE_URL` | ✅ | Supabase **Session-Pooler** (Port 5432) |
| `ORS_API_KEY` | – | nur falls Importe Fahrzeiten brauchen |
| `ENCRYPTION_KEY` | – | `openssl rand -hex 32` (sonst Default) |
| `JWT_SECRET` | – | beliebig ≥16 Zeichen (sonst Default) |
| `OPENAI_API_KEY` | – | nur bei `ENABLE_OPENAI_TREND=true` |

Test: *Actions* → *Peakr Worker* → *Run workflow* → `live` ausführen und Log prüfen.

---

## Schritt 4 — Aufräumen

- Netlify-Deployment des Projekts deaktivieren/löschen (Credits werden nicht mehr verbraucht).
- Custom-Domain (falls vorhanden) auf Vercel umhängen.
- `apps/backend` bleibt im Repo für lokale Entwicklung (`docker compose up`) und als Quelle der
  Import-/Worker-Skripte — es wird **nicht** separat gehostet.

## Was am Code geändert wurde

- `apps/frontend/lib/server/db.ts` — `prepare: false` (Vercel + Supabase-Pooler).
- `apps/backend/src/db/index.ts` & `db/migrate.ts` — automatisches SSL für nicht-lokale DBs + `prepare: false`.
- `apps/backend/src/workers/run-once.ts` + Scripts `worker:live:once` / `worker:trend:once` — Einmal-Lauf für CI.
- `.github/workflows/workers.yml` — geplante Worker statt Always-on-Service.
