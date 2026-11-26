# Lift- und Pistenstatus (LiftRadar)

Stand 26.11.2026. Peakr zeigt für Schweizer Skigebiete, wie viele Lifte und Pisten **laut
Statusbericht** offen sind – samt Zeitpunkt, Quelle und Aktualität. Die Daten stammen von
[LiftRadar](https://liftradar.eu), einem freien Sammeldienst, der die Berichte der Skigebiete
(in der Schweiz meist über [infosnow.ch](https://infosnow.ch)) etwa zweimal täglich liest.

> LiftRadar ist **keine offizielle Quelle**. Berichte können verzögert, unvollständig oder falsch
> sein. Peakr nennt deshalb nie «live» oder «jetzt offen», sondern immer «laut Statusbericht»
> mit Zeitpunkt, und verlinkt die Website des Skigebiets.

## Quelle (geprüft am 25.11.2026)

| Datei | Inhalt |
|---|---|
| `https://liftradar.eu/json/index.json` | alle ~920 Gebiete (89 in der Schweiz): Status, `checked_at`, Zähler offen/gesamt, Schnee, Quellen |
| `https://liftradar.eu/json/ch/<id>.json` | ein Gebiet: Zähler, nach Lifttyp und Pistenschwierigkeit, Schneehöhen, `lifts_updated_at` (Bericht des Gebiets), `fetched_at`, `status_from`, Website, Originalquellen mit `attribution_required`, Verweis `details` |
| `https://liftradar.eu/json/ch/<id>.details.json` | **experimentell:** jede Anlage und Piste mit stabiler `id`, Name, Typ bzw. Schwierigkeit/Farbe, Länge und Status |

- Schemas: `https://liftradar.eu/schema/index.schema.json`, `resort.schema.json`, `resort-details.schema.json`.
- Gebietsstatus: `open`, `closed`, `no_report` (seit 14 Tagen kein Bericht oder seit 2 Tagen nicht lesbar).
  Bei `no_report` ist `lifts.open` 0 und bedeutungslos – Peakr übernimmt diese 0 nicht.
- Status je Anlage/Piste: `open`, `closed`, `preparation`, `unknown`. Einträge mit `unknown`
  zählt LiftRadar in seinen eigenen Zählern nicht mit.
- Alle Dateien tragen ein `ETag`; eine fehlende Datei antwortet mit HTTP 404 (HTML).
- Aktualisierung laut Dokumentation: «at about 08:40 and 13:40 CET, so there's no point reading
  it more often than hourly». Es gibt keine eigene Webseite je Gebiet.
- 76 der 89 Schweizer Gebiete verweisen auf eine Einzelliste; die übrigen 13 hatten am Stichtag
  keinen aktuellen Bericht.

### Lizenz und Nennung

LiftRadar nennt für die JSON-Daten **keine ausdrückliche Lizenz**; die Dateien sind «free to read»,
ohne Schlüssel und Anmeldung. Je Originalquelle gibt `attribution_required` an, ob eine Nennung
verlangt wird – `null` heisst «noch nicht geprüft» und ist laut LiftRadar wie `true` zu behandeln.

Peakr nennt deshalb immer **LiftRadar** (mit Link) und alle Originalquellen mit
`attribution_required` `true` oder `null` (z. B. infosnow.ch, slf.ch) – in der Detailansicht und in
der Quellenzeile. Eine Aussage über uneingeschränkte (kommerzielle) Nutzungsrechte lässt sich daraus
**nicht** ableiten. Für eine kommerzielle Nutzung vorher bei LiftRadar nachfragen
(Kontakt auf https://liftradar.eu).

## Datenfluss

```
GitHub Actions «Peakr Worker» (eigene Termine + nach jedem anderen Worker-Job)
  └─ pnpm worker lifts
       1. Zuordnung prüfen, OSM-Referenzen → Peakr-Ziel-IDs (destination_sources)
       2. index.json mit If-None-Match  ── 304 → nur «zuletzt abgeglichen» setzen, fertig
       3. je zugeordnetem Gebiet: checked_at unverändert? → nichts abrufen
       4. <id>.json (If-None-Match) und, falls verwiesen, <id>.details.json; Zod-Prüfung
       5. normalisieren (lifts/status.ts) → Stand (lifts/snapshot.ts)
       6. je Gebiet eine Transaktion: Stand + Einzelliste ersetzen (gleiche Prüfsumme → nur Zeitpunkte)
  └─ PostgreSQL: ski_resort_status, ski_resort_status_items
Website (Vercel): Suche und Detail lesen nur die Datenbank – nie LiftRadar direkt.
```

Code: `apps/backend/src/lifts/` (`liftradar.ts` Abruf und Schemas, `status.ts` Normalisierung,
`freshness.ts` Aktualität und Saison, `mapping.ts` Zuordnung, `snapshot.ts`, `summary.ts`,
`sync.ts`), Datenbank `apps/backend/src/repositories/liftStatus.repo.ts`, Migration
`apps/backend/drizzle/0006_lift_status.sql`.

## Tabellen (Migration 0006)

**`ski_resort_status`** – eine Zeile je LiftRadar-Gebiet (`source`, `source_resort_id`), mit
`destination_id` des Peakr-Skigebiets. Mehrere Zeilen können zu einem Skigebiet gehören (Verbünde).

- Zähler `lifts_open|closed|preparation|unknown|total`, `slopes_…`, `slopes_open_km|total_km` –
  alle `NULL`, wenn die Quelle sie nicht liefert. Ohne Einzelliste kennt Peakr nur «offen» und
  «gesamt»; «geschlossen» wird **nicht** als «gesamt − offen» berechnet.
- `lifts_by_type`, `slopes_by_difficulty` (Zusammenfassung der Quelle), Schneehöhen laut Bericht.
- Zeitpunkte, getrennt gespeichert: `report_at` (Bericht des Gebiets, `lifts_updated_at`, sonst NULL),
  `checked_at` (wann LiftRadar gelesen hat, aus dem Index), `values_from` (Werte aus einem älteren
  Lauf der Quelle), `fetched_at` (letzter Abgleich durch Peakr), `changed_at` (Inhalt zuletzt geändert).
- `match_method`, `match_verified`, `website_url`, `source_url`, `source_links` (Originalquellen mit
  Nennungspflicht), `etag`, `content_hash`.

**`ski_resort_status_items`** – Lifte (`kind = 'lift'`) und Pisten (`'slope'`) mit `item_id` der
Quelle, Position, Name, Typ bzw. Schwierigkeit, Farbe, Länge, `status` und `status_raw`. Wird nur
zusammen mit einem vollständig gelesenen Bericht ersetzt (Fremdschlüssel mit `ON DELETE CASCADE`).

Grösse: ~85 Zeilen Status, ~3'000 Einträge – vernachlässigbar für das Neon-Kontingent.

## Zuordnung LiftRadar ↔ Peakr

Versioniert in `apps/backend/src/lifts/mapping.ts`. Schlüssel auf der Peakr-Seite ist die stabile
OSM-Referenz des Skigebiets (`ski:way/…`), nicht die UUID – sie bleibt bei jedem Neuaufbau und in
jeder Datenbank gleich. Zur Laufzeit wird **nichts** über Namen geraten.

Erstellt am 25.11.2026 aus Peakrs eigenem Ski-Schritt (OSM-Stand 11.11.2026) und dem LiftRadar-Index:

| Methode | Vorgehen | Anzahl |
|---|---|---|
| `lift_names` | Anlagennamen der LiftRadar-Einzelliste mit den OSM-Anlagen des Peakr-Gebiets verglichen | 73 |
| `name_location` | gleicher Name, wenige Kilometer, ähnliche Anlagenzahl (Gebiete ohne Einzelliste) | 10 |
| `manual` | Ortskenntnis (Val Müstair → Minschuns, Zuoz → «St. Moritz – Zuoz») | 2 |

**85 von 89** Schweizer LiftRadar-Gebieten sind **73 Peakr-Skigebieten** zugeordnet. Verbünde fassen
mehrere LiftRadar-Gebiete zusammen, z. B. 4 Vallées (Verbier, Nendaz, Thyon, Veysonnaz, La Tzoumaz),
Villars–Gryon–Les Diablerets, Arosa Lenzerheide, Corviglia + Corvatsch, Zinal/Grimentz + Vercorin,
Unterbäch + Eischoll, Chäserrugg + Wildhaus, Portes du Soleil (Champéry, Morgins – nur Schweizer Teil).

Bewusst **nicht zugeordnet** (`LIFTRADAR_UNMAPPED`), weil sich der Bericht nicht ehrlich aufteilen lässt:

- `gstaad` – umfasst drei Peakr-Gebiete (Schönried–Saanenmöser–Zweisimmen–St. Stephan,
  Gstaad–Saanen–Rougemont, Wispile) und weitere Anlagen
- `andermatt-sedrun-disentis` – umfasst Skiarena Andermatt-Sedrun und Gemsstock sowie Disentis
- `lenk` – Anlagen in Betelberg und in Adelboden–Lenk
- `tschiertschen` – kein entsprechendes Peakr-Gebiet

Teilabdeckung wird angezeigt (`COVERAGE_NOTES`): Portes du Soleil (nur Schweizer Teil),
Adelboden–Lenk (nur Adelboden, nicht die Lenker Seite).

### Neue Gebiete zuordnen

```bash
pnpm liftradar:mapping                  # Stand aller Schweizer LiftRadar-Gebiete
pnpm liftradar:mapping --open --details # nur offene, mit Kandidaten und Anlagennamen-Vergleich
```

Der Bericht des Jobs nennt neue Schweizer Gebiete ohne Zuordnung (`unmappedCandidates`) und
Zuordnungen, deren Peakr-Gebiet fehlt (`unresolvedRefs`). Vorschläge des Skripts sind mit
`verified: false` markiert; erst nach Prüfung (Anlagennamen, Lage, Umfang) in `mapping.ts` übernehmen.
Ein LiftRadar-Gebiet darf höchstens einem Peakr-Gebiet zugeordnet sein (Test `mappingProblems`).

## Normalisierung

Zentral in `apps/backend/src/lifts/status.ts` – das Frontend zeigt nur noch Beschriftungen an.

| Quelle | intern | Anzeige |
|---|---|---|
| `open`, `operating` | `open` | offen |
| `closed` | `closed` | geschlossen |
| `preparation` | `preparation` | in Vorbereitung |
| `unknown`, fehlend, leer | `unknown` | unbekannt |
| jeder andere Text | `unknown` (+ Protokoll `unknownStatusValues`) | unbekannt |

Ein fehlender oder unbekannter Status ist **nie** «geschlossen». `status_raw` bleibt gespeichert.

## Aktualität und Datenzeitpunkt

Datenzeitpunkt je Gebiet (`summary.ts`, `areaDataTime`):

- Werte aus einem älteren Lauf der Quelle (`status_from`): dieser Zeitpunkt.
- **offen:** der Bericht des Gebiets (`report_at`), sonst `checked_at`. Ein alter Bericht «offen» ist verdächtig.
- **geschlossen:** die letzte Prüfung durch LiftRadar (`checked_at`). Geschlossene Gebiete
  veröffentlichen oft tagelang keinen neuen Bericht; LiftRadar bestätigt bei jedem Lauf, dass der
  neueste Bericht weiterhin «geschlossen» lautet.

Bei Verbünden zählt der älteste Zeitpunkt der berichtenden Gebiete. Einstufung (`freshness.ts`):

| Aktualität | Alter | Wirkung |
|---|---|---|
| `fresh` («aktuell») | ≤ 12 h | Verfügbarkeit und Bewertung nutzen den Bericht |
| `stale` («älter») | ≤ 36 h | Anzeige mit Hinweis; Verfügbarkeit «unsicher», kein Bonus |
| `outdated` («veraltet») | > 36 h | Anzeige als «letzter verfügbarer Status» |
| `unknown` | kein Zeitpunkt | wie veraltet |

Die Grenzen folgen dem Takt der Quelle (08:40/13:40): Ein Bericht vom Morgen ist am Abend noch der
neueste; über Nacht entsteht eine Lücke von rund 19 Stunden.

## Verwendung in Peakr

- **Verfügbarkeit** (`availability/checks.ts`, `assessOperation`): «verfügbar» nur mit frischem Bericht
  und offenen Anlagen für den heutigen Skitag; «alle geschlossen» heute → «nicht verfügbar»; für spätere
  Tage, ohne Bericht oder mit altem Bericht → «unsicher». Belegart `report` («Statusbericht, nicht amtlich»).
- **Bewertung:** wie bisher bis 10 Punkte für den Anteil offener Anlagen – nur aus einem frischen
  Bericht. Fehlender Bericht ergibt keinen Abzug; Sortierung nach Fahrzeit bleibt unverändert.
- **API:** `liftStatus` in jedem Suchergebnis (Kurzfassung) und in der Detailansicht (mit
  `areaDetails`, `liftItems`, `slopeItems`); Schema in `packages/shared/src/liftStatus.ts`. Die
  bisherigen Felder `live.liftsOpen/liftsTotal/liftSource` werden nur aus frischen Berichten gefüllt.
- **Oberfläche:** Ergebniskarte «Lifte offen 18/24 · Pisten offen 42/61 · Bericht 08:40 · LiftRadar»;
  Detailansicht «Betriebsstatus» mit Zählern, aufklappbaren Einzellisten (offene zuerst), Zeitpunkten,
  Quellen, Website-Links und Hinweis auf Verzögerung (`apps/frontend/components/LiftStatus.tsx`).

## Job, Zeitplan und Saison

`pnpm worker lifts` – eigener Job (`worker:lifts`) im bestehenden Worker-Rahmen (Sperre, Zeitlimit
10 min, Protokoll in `import_runs`, `/api/health`).

- **GitHub Actions** (`.github/workflows/workers.yml`): November–April stündlich um :50 von 05:50
  bis 17:50 UTC, Mai–Oktober täglich 06:50 UTC. Weil GitHub geplante Läufe oft auslässt oder
  stundenlang verzögert (am ersten Tag startete kein einziger Lift-Termin), läuft der Job zusätzlich
  als Schritt «Liftstatus» nach jedem anderen Worker-Job (`ski`, `weather`, `maintenance`, `trend`)
  mit – ohne `force`, die Saisonlogik entscheidet. Manuell: «Run workflow» → Job `lifts` (mit `force`).
- **Saisonlogik im Job** (`freshness.ts`, `shouldSync`): in der Saison frühestens 40 min nach dem
  letzten erfolgreichen Abgleich, sonst höchstens alle 20 h; `--force` übergeht beides.
  Anpassbar über `LIFTS_SEASON_MONTHS` (Standard `11,12,1,2,3,4`), `LIFTS_SEASON_MIN_INTERVAL_MIN`,
  `LIFTS_OFFSEASON_INTERVAL_H`, `LIFTS_CONCURRENCY` (Standard 4 gleichzeitige Abrufe).
- **Selbst betrieben:** `pnpm worker schedule` startet `lifts` stündlich 07:50–18:50 (Europe/Zurich).

Abfragen je Lauf: 1 (Index unverändert, 304) bis rund 160 (alle Gebiete neu, nach jedem Lauf der
Quelle). Dauer 2–15 s.

### Bericht eines Laufs

```
LiftRadar-Abgleich
Index: geladen, 89 Schweizer Gebiete
Zugeordnet: 85 (aktiv 85)
Neu gespeichert: 85 · unverändert: 0 (davon 304: 0) · Fehler: 0
Nicht im Index: –
Ohne Zuordnung (neu): –
Gebiete mit aktuellem Bericht: 75, ohne: 10
Lifte: offen 29, geschlossen 836, in Vorbereitung 0, unbekannt 1
Pisten: offen 17, geschlossen 1907, in Vorbereitung 0, unbekannt 0
Dauer: 10.7 s
```

(Echter Lauf vom 26.11.2026.) Dieselben Kennzahlen stehen als `stats` in `import_runs`.

## Fehler und Rückfälle

- **Abruf:** nur `https://liftradar.eu/json/…` (Allowlist, keine Weiterleitungen), Zeitlimit 15 s,
  2 Wiederholungen mit Wartezeit (1,5 s, 5 s) nur bei Netzwerkfehlern, 429 und 5xx; 404 ist endgültig.
  Antworten über 5 MB (Index 10 MB) oder ohne JSON-Inhaltstyp werden verworfen.
- **Prüfung:** Zod-Schemas für Index, Gebiet und Einzelliste; ungültige Index-Einträge werden gezählt
  und übersprungen, ein ungültiges Gebiet bleibt beim alten Stand. Ein Index ohne Schweizer Gebiete
  bricht den Lauf ab, ohne etwas zu ändern.
- **Je Gebiet unabhängig:** Fehler eines Gebiets stoppen die anderen nicht; sein alter Stand bleibt
  und wird über die Zeitpunkte als älter erkennbar. Der Lauf gilt erst ab 70 % erfolgreicher Gebiete
  als erfolgreich (sonst `failed`, GitHub meldet den fehlgeschlagenen Workflow).
- **Quelle ausgefallen:** die Website zeigt den letzten Stand mit «älter»/«veraltet» und dem Zeitpunkt.
- **Kein Bericht** (`no_report`) oder kein zugeordnetes Gebiet: «Lift- und Pistenstatus derzeit nicht
  verfügbar», kein erfundener Wert; Verfügbarkeit «unsicher».
- Website-Links und Quellenlinks nur mit `http(s)`.
- Kein Scraping von Betreiber-Websites – deren Adressen werden nur verlinkt.

## Lokal testen

```bash
pnpm db:migrate                          # legt die Tabellen an (Migration 0006)
pnpm worker lifts --force                # Abgleich mit LiftRadar (echte Daten)
pnpm liftradar:mapping                   # Zuordnung prüfen
pnpm --filter @ch-alpineroute/backend exec vitest run src/lifts   # Unit-Tests (ohne Netz)
DATABASE_URL=… pnpm --filter @ch-alpineroute/backend exec vitest run --config vitest.db.config.ts src/test/liftStatus.db.test.ts
```

Danach in der App ein Skigebiet öffnen (z. B. Zermatt): Abschnitt «Betriebsstatus».

## Bekannte Grenzen

- Statusberichte sind keine Echtzeitdaten (zweimal täglich), und LiftRadar ist ein Sammeldienst ohne
  Gewähr. Die Einzellisten sind bei LiftRadar als experimentell markiert.
- Vier Schweizer Gebiete sind nicht zugeordnet (siehe oben); Gstaad und Andermatt bräuchten eine
  Aufteilung je Anlage auf die Peakr-Gebiete.
- Für Skigebiete, die LiftRadar nicht führt (rund 240 kleinere Peakr-Gebiete), gibt es keinen Status.
- Die Zuordnung beruht auf dem OSM-Stand vom 11.11.2026; ändert sich eine OSM-Fläche, meldet der Job
  die Referenz als nicht auflösbar.
- Schneehöhen laut Bericht werden gespeichert und im Detail gezeigt, ersetzen aber nicht die Modell- und
  Messwerte der bestehenden Schneeprüfung.
