# Peakr – Betrieb, Worker und Fehlerbehebung

Erstmalige Einrichtung: [SETUP_EXTERNAL.md](../SETUP_EXTERNAL.md).

## Zeitplan

| Was | Workflow | Takt (UTC) | Dauer |
|---|---|---|---|
| Skigebiete: Wetter, Schnee, Lawine; Schneemessungen (SLF IMIS, MeteoSchweiz) | Peakr Worker → `ski` | `5 */3 * * *` | 2–10 min (je nach Wiederholungen) |
| Wetterraster mit stündlicher Prognose bis übermorgen; Wegsperrungen (geo.admin.ch) samt Zuordnung zu den Routen; Schneemessungen | Peakr Worker → `weather` | `35 */6 * * *` | 3–10 min (je nach Wiederholungen) |
| Bekanntheit (Wikipedia) | Peakr Worker → `trend` | montags 04:20 | ~3–4 min |
| Aufräumen | Peakr Worker → `maintenance` | täglich 03:50 | Sekunden |
| Datenaufbau + Strassengraph | Peakr Daten | montags 02:15 | ~15–25 min |
| Typecheck, Tests, Build | CI | jeder Push/PR | ~5 min |

Jeder Worker-Lauf wendet vorher die Datenbank-Migrationen an (`pnpm db:migrate`, idempotent). Neue
Tabellen stehen damit nach dem nächsten Worker-Lauf bereit, nicht erst nach dem wöchentlichen
Datenaufbau. Fällt eine Quelle der Verfügbarkeitsprüfung aus, bleiben die bisherigen Daten stehen;
Suche und Detailseite melden zu alte Daten als «unsicher» (siehe
[VERFUEGBARKEIT_UND_WETTER.md](VERFUEGBARKEIT_UND_WETTER.md)).

Selbst betrieben (Docker, eigener Server) übernimmt `pnpm worker schedule` denselben Zeitplan
(Europe/Zurich) in einem Dauerprozess; siehe [docker-compose.yml](../docker-compose.yml).

## Überwachung

**`GET /api/health`** – ohne Anmeldung, für Uptime-Dienste geeignet (z. B. UptimeRobot, gratis):

```json
{
  "status": "ok | degraded | down",
  "database": true,
  "routing": { "available": true, "graphBuiltAt": "…", "osmTimestamp": "…" },
  "data": { "destinations": 19225, "skiResorts": 317, "hikeRoutes": 22403, "dataVersion": "…" },
  "jobs": [{ "job": "worker:ski", "status": "success", "ageHours": 1.2, "stale": false }, …]
}
```

`degraded`, sobald ein Job älter ist als erlaubt (ski 8 h, weather 14 h, trend 9 Tage, maintenance
3 Tage, Pipeline-Schritte 16–45 Tage), der Strassengraph fehlt oder keine Daten da sind. Empfehlung:
Uptime-Dienst mit Schlüsselwort-Prüfung auf `"status":"ok"`.

**GitHub** benachrichtigt bei fehlgeschlagenen Workflow-Läufen per E-Mail (Standard für den Besitzer).
Der Datenaufbau schreibt den Datenqualitätsbericht in die Zusammenfassung jedes Laufs.

**Datenbank:** jeder Lauf steht in `import_runs` (Status, Dauer, Statistik, Fehler):

```sql
SELECT job, status, started_at, finished_at, stats, error
FROM import_runs ORDER BY started_at DESC LIMIT 20;
```

## Robustheit der Worker

- **Keine Doppelläufe:** Sperre in `job_locks` (läuft nach Absturz von selbst ab) plus
  `concurrency`-Gruppe im Workflow.
- **Zeitlimit** je Job (20 min, Trend 90 min) und sauberes Beenden bei SIGTERM.
- **Fehler je Datenquelle und Datensatz** werden gezählt, nicht weitergeworfen. Ein Lauf gilt erst
  ab 70 % Erfolg als `success`, darunter `partial` oder `failed` – früher meldete ein Lauf mit 83 %
  Fehlern «Erfolg».
- **Wiederholungen** mit Wartezeit bei Netzwerkfehlern und HTTP 429/5xx; bei anhaltender Drosselung
  (Wikimedia) bricht der Trend-Job ab und der nächste Lauf holt den Rest.
- **Speicher:** Batches von 50–500 Datensätzen; Verlauf wird nach 120 Tagen gelöscht, Rohantworten
  werden nicht mehr gespeichert.

## Häufige Aufgaben

```bash
# einzelnen Job lokal ausführen
pnpm worker ski
# Daten komplett neu aufbauen (lokal)
pnpm pipeline all --refresh
# nur Routen und Strassengraph neu
pnpm pipeline network
# Datenqualität prüfen
pnpm report:quality
# Tests gegen die befüllte DB
pnpm test:db
# Fahrzeiten mit OpenRouteService vergleichen (braucht ORS_API_KEY, 1 Anfrage)
pnpm --filter @ch-alpineroute/backend calibrate:drive
```

Gegen Produktion: `DATABASE_URL=<direkte Neon-URL> pnpm …` voranstellen (Wert von `DATABASE_URL_UNPOOLED`). Die Pipeline lädt
~800 MB und braucht ~8 GB RAM; bequemer ist *Actions → Peakr Daten → Run workflow*.

## Fehlerbehebung

| Symptom | Ursache / Lösung |
|---|---|
| Suche zeigt «Fahrzeiten nicht verfügbar» | Strassengraph oder Suchindex fehlt in der Serverfunktion (`/api/health` → `routing.available`, `searchIndex.available`). Release `data-latest` mit beiden Dateien vorhanden? Dann Vercel ohne Cache neu deployen. Lokal: `pnpm pipeline network index`. |
| `/api/health` → `down` | Datenbank nicht erreichbar: `DATABASE_URL` in Vercel prüfen (Neon-Integration verbunden?). Die Suche selbst läuft trotzdem – nur ohne Live-Daten, Konto und Favoriten. |
| Anmeldung meldet «Die Anmeldung ist auf dem Server nicht eingerichtet» (HTTP 503), `/api/health` → `auth.configured: false` | `JWT_SECRET` in Vercel fehlt oder ist kürzer als 32 Zeichen. Neu setzen (siehe SETUP_EXTERNAL.md 4.2) und neu deployen. Suche und Karte sind davon nicht betroffen. |
| Suche zeigt «Live-Daten gerade nicht abrufbar» | Datenbank kurz nicht erreichbar oder Neon-Kontingent erschöpft (Neon-Konsole → *Usage*). Treffer und Fahrzeiten bleiben korrekt. |
| `degraded`, Job `worker:*` `stale` | *Actions → Peakr Worker*: Workflow deaktiviert? (*Enable workflow*). Letzten Lauf ansehen; Secret `DATABASE_URL` gesetzt? |
| Job-Status `partial` | Ein Teil der Abrufe scheiterte (Open-Meteo-Kontingent, Netzwerk). Wird beim nächsten Lauf nachgeholt; dauerhaft? Log des Laufs prüfen. |
| Log zeigt `fetch failed (UND_ERR_CONNECT_TIMEOUT)` bei Open-Meteo | Von GitHub-Runnern aus kommt der Verbindungsaufbau zu `api.open-meteo.com` zeitweise nicht zustande (beobachtet am 13.11.2026: in einem Lauf jeder Versuch, in anderen 10–60 % der Versuche). Der Worker wiederholt je Block bis zu viermal mit wachsender Pause und macht am Ende einen zweiten Durchgang; der Lauf dauert dann bis ~10 min. Scheitern dauerhaft alle Versuche, ist Open-Meteo von GitHub aus nicht erreichbar – der Worker kann dann nur noch lokal bzw. auf einem eigenen Server (`pnpm worker schedule`) laufen. |
| Worker-Lauf meldet «Lauf übersprungen: derselbe Job läuft bereits» | Ein anderer Lauf desselben Jobs läuft noch oder ist abgestürzt; die Sperre läuft nach 30 min (Trend 120 min) ab. |
| «Vom Startort aus ist im Umkreis von 3 km keine Strasse erreichbar» | Startpunkt mitten im Gelände bzw. See. Anderen Startort wählen. |
| Bekanntes Ziel fehlt | Amtliche Schreibweise prüfen (z. B. «Gross Mythen», «Harderkulm»). Hat es keine Route, erscheint es nur mit «Ziele ohne bekannte Route zeigen». `SELECT name, route_status FROM destinations WHERE name ILIKE '%…%'`. |
| Pipeline: «Programm osmium fehlt» | `brew install osmium-tool` bzw. `apt-get install osmium-tool unzip`. |
| Pipeline bricht mit «heap out of memory» ab | Mehr RAM bzw. `--max-old-space-size` (Standard 8192) – der Schritt `network` braucht ~6–7 GB. |
| Karte zeigt nur OSM-Raster statt swisstopo, Konsole «Worker failed to load» | `public/maplibre-gl-worker.mjs` fehlt. Wird von `prebuild`/`predev` kopiert; bei eigenem Build-Befehl `node scripts/copy-map-worker.mjs` vorher ausführen. |
| Vercel-Build bricht in `next/font` ab («Cannot read properties of null (reading '1')») | Betraf frühere Versionen, die Schriften beim Build von Google Fonts luden. Seit 13.11.2026 kommen sie aus npm (Fontsource) – kein Abruf mehr beim Build. |
| Trend-Werte fehlen | Wikimedia drosselt bei unpassendem User-Agent (HTTP 429). Der Worker sendet `Peakr/1.0 (+https://github.com/bien187/peakr)`; bei Fork die URL anpassen (`services/wikipedia.service.ts`). |

## Datenschutz und Backups

- Konten: E-Mail, bcrypt-Hash, Anzeigename, Standard-Startort. Keine weiteren Personendaten.
- Neon Free hält nur einen kurzen Wiederherstellungszeitraum vor. Vor grösseren Änderungen selbst sichern:
  `pg_dump "$DATABASE_URL" -Fc -f peakr-$(date +%F).dump` (Konten und Favoriten genügen:
  `-t users -t favorites`; alles andere baut die Pipeline neu auf).
