# Peakr – Technischer Audit (Stand 12.11.2026)

Dieser Bericht hält den Zustand **vor** der Überarbeitung fest. Jede Aussage ist als
**nachgewiesen** (Beleg im Repo, in GitHub oder durch einen Live-Test), **plausibel** (technisch
schlüssig, Beleg fehlt) oder **Vermutung** markiert. Was daraus umgesetzt wurde, steht in
[ABSCHLUSSBERICHT.md](ABSCHLUSSBERICHT.md).

## 1. Warum Peakr nicht mehr lief

| # | Ursache | Status | Beleg |
|---|---------|--------|-------|
| 1 | **Worker von GitHub automatisch abgeschaltet.** Geplante Workflows werden nach 60 Tagen ohne Repo-Aktivität deaktiviert. Letzter Commit 21.06., letzter Lauf 20.08.2026 18:34 UTC. | nachgewiesen | `gh workflow list` → `Peakr Worker  disabled_inactivity`; 563 Läufe zwischen 13.06. und 20.08. |
| 2 | **Produktions-Datenbank nicht mehr erreichbar.** Der Supabase-Pooler kennt das Projekt nicht mehr (`tenant/user … not found`). Typisch für ein pausiertes oder gelöschtes Free-Projekt; nach Abschaltung der Worker gab es keine Aktivität mehr. | nachgewiesen (Symptom), Pausierung als Grund plausibel | Lesender Verbindungstest mit der `DATABASE_URL` aus `.env` |
| 3 | **Suche in Produktion liefert HTTP 500.** `https://peakr-ch.vercel.app` antwortet, `/api/health` ist ok, `/api/search` scheitert, weil die DB fehlt. Die im Repo hinterlegte URL `peakr-frontend.vercel.app` existiert nicht mehr. | nachgewiesen | `curl` gegen beide URLs |
| 4 | **Live-Worker aktualisierte nur 17 % der Ziele.** Letzter Lauf: `fetched 1200, total 7165, failed 5965`, danach Open-Meteo HTTP 429. Der Lauf galt trotzdem als «success». 7'165 Ziele × 8 Läufe/Tag = 57'000 Abrufe pro Tag gegenüber 10'000 im Gratis-Kontingent. | nachgewiesen | Log des Laufs 32403958282 |
| 5 | **59 fehlgeschlagene Worker-Läufe vom 16.–21.06.** Abbruch nach rund 10 Sekunden mit Exit-Code 1; ab dem Merge vom 21.06. wieder grün. Passt zeitlich zu den Schema-Korrekturen in diesem Merge. | plausibel | Job-Metadaten; die Logs selbst sind abgelaufen (HTTP 410) |
| 6 | **Datenbank-Wachstum über das Supabase-Gratislimit (500 MB).** `live_status` ist append-only und speichert pro Zeile die komplette Open-Meteo-Antwort (~1 KB). Bei 9'600 Zeilen/Tag über 68 Tage ergibt das rund 650'000 Zeilen. | plausibel | Messung in der lokalen DB: 3'099 Zeilen = 3,2 MB `raw_payload`; Produktion nicht prüfbar |
| 7 | Netlify-Credits aufgebraucht, danach Umzug Railway → Netlify → Vercel innert vier Tagen. | nachgewiesen | `MIGRATION.md`, Commits 09.–13.06. |

Der eigentliche fachliche Grund («nicht zuverlässig genug») ist in den Abschnitten 2 und 3 belegt.

## 2. Kritische Fehler

| # | Fehler | Status | Fundstelle |
|---|--------|--------|------------|
| K1 | **Produktive Suche kennt keine echten Fahrzeiten.** Die Vercel-Route rechnet ausschliesslich Luftlinie × 1,4 bei 50 km/h und setzt `matrixUsed: false`. OpenRouteService wird dort nie aufgerufen. | nachgewiesen | `apps/frontend/app/api/search/route.ts:123` |
| K2 | **Zwei getrennte API-Implementierungen.** Fastify (`apps/backend`, lokal) und Next.js-Routen (Produktion) enthalten dieselbe Logik doppelt und weichen ab: Fahrzeiten, Passwort-Hashing (argon2 gegen bcrypt, Konten nicht austauschbar), OpenAI-Key- und Admin-Route fehlen in Produktion. | nachgewiesen | Vergleich der Routen |
| K3 | **Fastify-Suche: nur 60 Ziele mit echter Fahrzeit.** Alle weiteren bekommen die Luftlinien-Schätzung und zählen trotzdem als «in Reichweite». | nachgewiesen | `search.service.ts` `ORS_MATRIX_LIMIT = 60` |
| K4 | **Fahrzeit wird zum Gipfel statt zu einem Ausgangspunkt gerechnet.** ORS liefert für strassenlose Punkte `null`, worauf die Schätzung greift. | nachgewiesen | `search.service.ts:143` |
| K5 | **Schema und Migrationen widersprechen sich.** `schema.ts` beschreibt PostGIS-Spalten (`location`, `route_geom`) und die Tabellen `avalanche_regions`, `hiking_routes`; die Migrationen legen `lat`/`lng` an und diese Tabellen gar nicht. `drizzle-kit generate` würde die Datenbank zerstören. | nachgewiesen | `db/schema.ts` gegen `drizzle/0000_*.sql` |
| K6 | **Wanderwege sind Stubs.** Alle fünf Funktionen in `hikingRoutes.repo.ts` sind leer; `import:hiking-routes` lädt Daten und verwirft sie. | nachgewiesen | `repositories/hikingRoutes.repo.ts` |
| K7 | **Lawinenstufen funktionieren nie.** (a) `upsertAvalancheRegion` und `linkDestinationsToRegions` sind Stubs, `slf_region_id` bleibt leer. (b) Das SLF liefert `mainValue` als Text (`"moderate"`), der Code rechnet `Number("moderate")` = `NaN` und verwirft jede Stufe. | nachgewiesen | `import.repo.ts:4`, `slf.service.ts:64`, Live-Abruf des Bulletins |
| K8 | **swissNAMES3D-Anbindung zeigt auf einen Dienst, den es nicht gibt.** `wfs.geo.admin.ch` löst nicht auf. Die Funktionen werden zudem nirgends aufgerufen. | nachgewiesen | `geoAdmin.service.ts:10`, `curl` → keine Verbindung |
| K9 | **Erfundene Wanderroute im Frontend.** `routeGeo()` erzeugt eine «plausible» Zickzack-Linie von einem synthetischen Parkplatz zum Ziel. | nachgewiesen | `apps/frontend/lib/peakr.ts:355` |
| K10 | **Root-`package.json` überschrieben.** Sie ist eine Kopie von `packages/shared/package.json`; Root-Skripte, ESLint und Prettier fehlen. | nachgewiesen | `package.json` |
| K11 | **Favoriten mit Fastify:** `POST` mit JSON-Header ohne Body wird abgelehnt. | nachgewiesen | README, `lib/api.ts` |

## 3. Datenqualität

Gemessen in der lokalen Datenbank (Stand des alten Imports):

| Befund | Wert | Status |
|--------|------|--------|
| Gipfel | 3'864, alle aus einer einzigen Overpass-Abfrage mit `out 8000` | nachgewiesen |
| Gipfel unter 1'200 m | 0 – hart ausgeschlossen (Jura, Voralpen, Mittelland, Tessiner Vorberge fehlen) | nachgewiesen |
| Gipfel ohne `ele`-Tag oder ohne Namen | ausgeschlossen | nachgewiesen |
| Gipfel weiter als 800 m vom nächsten Wanderweg | ausgeschlossen; ohne lokale Wege wird ein Schätzwert «400 m» oder «1'200 m» eingetragen | nachgewiesen |
| Ziele mit `quality_score < 30` | werden **gelöscht** | nachgewiesen |
| SAC-Schwierigkeit bekannt | 5 von 4'446 Wanderzielen (nur die kuratierten) | nachgewiesen |
| SAC-Filter | `sac IS NULL OR sac <= max` – unbekannt gilt als passend, der Filter ist wirkungslos | nachgewiesen |
| Skigebiete | 303, davon 10 mit Höhenangabe; `landuse=winter_sports` gedeckelt auf 300 | nachgewiesen |
| Seen | nur mit `ele`-Tag ≥ 1'000 m, gedeckelt auf 3'000 | nachgewiesen |
| Aussichtspunkte | nur mit Wikidata, Wikipedia, Beschreibung oder Website; gedeckelt auf 1'000 | nachgewiesen |
| Duplikat-Erkennung | gleicher Name im Umkreis von rund 50 m, sonst keine | nachgewiesen |
| Trend-Score | 332 von 355 Einträgen haben den Wert 1, weil der Zielname als Wikipedia-Titel geraten wird | nachgewiesen |
| Liftstatus | durchgehend unbekannt; die drei «Adapter» geben konstant `unknown` zurück | nachgewiesen |
| Wetter | eine Punktabfrage pro Ziel, siehe Ursache 4 | nachgewiesen |
| Herkunft, Importläufe, Aktualisierungsdatum | werden nicht gespeichert | nachgewiesen |

Die Auswahl der Gipfel war damit nicht «unerklärlich», sondern das Ergebnis von sechs
hintereinandergeschalteten Ausschlussregeln plus einer Obergrenze der Abfrage.

## 4. Architektur

- **Kein Routennetz, keine Ausgangspunkte, keine Parkplätze.** Das Datenmodell kennt nur Zielpunkte.
- **Suchradius als Luftlinie:** `(Fahrzeit + Toleranz) × 1,5 km`. Auf der Autobahn sind 2 km pro
  Minute möglich; solche Ziele fallen heraus, bevor eine Fahrzeit berechnet wird.
- **`LIMIT 8000`** in der Kandidatenabfrage, sortiert nach Luftlinie.
- **Fahrzeit-Abhängigkeit von einem externen Dienst mit Tageskontingent** (ORS: 500 Matrix-Anfragen
  pro Tag) ohne Cache.
- **PostGIS wurde entfernt**, weil die Railway-Datenbank es nicht anbot (Commits `8b12f13`,
  `2d56b58`). Supabase bietet PostGIS; der Rückbau wurde nie rückgängig gemacht.
- **Worker ohne Schutz:** keine Sperre gegen Parallelläufe, kein Abbruchsignal, kein Aufräumen
  alter Daten, Erfolgsmeldung trotz 83 % Fehlschlägen.

## 5. Performance

- Kandidatenabfrage macht pro Ziel einen `LATERAL`-Zugriff auf `live_status`; bei tausenden
  Treffern entsprechend viele Index-Zugriffe.
- Antwort der Suche enthält bis zu 8'000 vollständige Ergebnisse mit Live- und Trenddaten.
- Karte ohne Clustering; die Feuerstellen-Ebene fragt bei jeder Kartenbewegung den öffentlichen
  Overpass-Server direkt aus dem Browser ab.
- Kein Cache für identische Suchen.

## 6. Sicherheit

| Befund | Status |
|--------|--------|
| Kein Rate-Limit auf Login, Registrierung und Suche | nachgewiesen |
| `JWT_SECRET` hat einen fest eingebauten Standardwert (`dev-secret-min-16chars`), der auch in Produktion greift, wenn die Variable fehlt | nachgewiesen |
| `ENCRYPTION_KEY` fällt auf 64 Nullen zurück | nachgewiesen |
| Token liegt im `localStorage` (anfällig bei XSS) | nachgewiesen, bewusst belassen – siehe Abschlussbericht |
| SQL: durchgehend parametrisiert, keine Injection gefunden | nachgewiesen |
| Secrets im Repository: keine; `.env` ist ignoriert und war nie eingecheckt | nachgewiesen (`git log --all -- .env`) |
| Lokale `.env` zeigt auf die Produktions-Datenbank | nachgewiesen – jeder lokale Import hätte Produktion verändert |
| Abhängigkeiten | siehe Abschlussbericht |

## 7. Infrastruktur

| Teil | Zustand |
|------|---------|
| Vercel-Projekt `peakr-frontend` | vorhanden, Domain `peakr-ch.vercel.app`, baut bei jedem Push |
| Supabase | Projekt nicht erreichbar |
| GitHub Actions | Workflow deaktiviert; Repo ist öffentlich, Laufzeit daher kostenlos |
| Railway (`railway.toml`) | ungenutzt, seit 09.06. kein Bestandteil des Betriebs; kein dauerhaftes Gratisangebot |
| Docker Compose | funktioniert lokal, baut aber das alte Schema |
| Lokale Werkzeuge | Docker über Colima vorhanden; `osmium`, `psql`, `ogr2ogr` fehlten |

## 8. Datenquellen – Erreichbarkeit am 12.11.2026

| Quelle | Ergebnis |
|--------|----------|
| swissNAMES3D 2026 (CSV, 29 MB) über die STAC-API von `data.geo.admin.ch` | erreichbar |
| swissTLM3D Wanderwege (GeoPackage, 198 MB, Stand 28.07.2026) | erreichbar |
| Geofabrik Schweiz (`.osm.pbf`, 551 MB, täglich) | erreichbar |
| SLF Warnregionen und Bulletin | erreichbar, Bulletin aktiv (3 Bulletins) |
| Open-Meteo | erreichbar, Kontingent 10'000 Abrufe/Tag |
| swisstopo SearchServer (Ortssuche) | erreichbar |
| `wfs.geo.admin.ch` | existiert nicht |

## 9. Was funktionierte

Ortssuche, Registrierung und Anmeldung, Favoriten (Next.js-Variante), Kartenanzeige mit
swisstopo-Grundkarte und Wanderweg-Overlay, Detailseite mit 3D-Gelände und 7-Tage-Prognose,
Hell-/Dunkelmodus, das Design insgesamt. Diese Teile bleiben erhalten.
