# Verfügbarkeit und Live-Wetterkarte

Stand 13.11.2026. Die Seite beschreibt:
- wie Peakr entscheidet, ob ein Wanderziel oder Skigebiet zur geplanten Zeit **verfügbar**, **unsicher** oder **nicht verfügbar** ist;
- wie die Wetterkarte funktioniert;
- welche Quellen dahinterstehen, was sie leisten und wo ihre Grenzen liegen.

## Grundsätze

- **Standardmässig erscheinen nur verfügbare Ziele.** Unsichere lassen sich unter *Ziele & Anspruch
  → «Auch unsichere Ziele zeigen»* einblenden. Nicht verfügbare bleiben immer ausgeblendet. Ihre Zahl
  und die Gründe stehen am Ende der Trefferliste.
- **Ein fehlender Bericht ist kein Nachweis für «offen».** Fehlen Daten für eine Prüfung oder sind sie
  veraltet, lautet das Ergebnis höchstens «unsicher».
- **Prognosen und Modellwerte sind als solche gekennzeichnet.** Jede Prüfung trägt ihre Belegart:
  amtliche Meldung, gemessen, Prognose (Modell), Modellwert, berechnet oder keine Daten. Dazu kommen
  Quelle und Zeitstempel.
- **Ein Skigebiet wird nie als geöffnet gezeigt, wenn kein verlässlicher Live-Betriebsstatus vorliegt.**
  Heute gibt es dafür keine freie, rechtlich saubere Quelle. Alle Skigebiete gelten deshalb als
  «unsicher», bis für ein Gebiet ein zugelassener Adapter existiert (`apps/backend/src/lifts`).
- Gesamtstatus = schlechteste Einzelprüfung. Der angezeigte Grund ist der Text dieser Prüfung. Bei
  Gleichstand gilt beim Wandern die Reihenfolge Sperrung, Lawine, Schnee, Wetter, Tageslicht, bei
  Skigebieten zuerst der Betrieb.
- Vertrauen:
  - **hoch:** nur amtliche Meldungen, Messungen und Berechnungen;
  - **mittel:** Prognose oder Modell beteiligt;
  - **gering:** für eine Prüfung fehlen Daten.

## Tourplanung

Die Suche bewertet für eine Planung: einen Tag (heute bis übermorgen, so weit reicht die gespeicherte
Prognose) und eine Startstunde.
- **Automatisch:** heute ab der nächsten vollen Stunde, frühestens 7 Uhr. Ab 14 Uhr morgen ab 8 Uhr.
- Ein Start in der Vergangenheit wird auf die nächste Stunde gesetzt.
- Tourende = Start + Gehzeit hin und zurück nach DIN 33466, ohne Pausen.
- Skigebiete werden für den Skitag 9–16 Uhr bewertet.
- Die Detailseite übernimmt die Planung der Suche.

## Prüfungen beim Wandern (Sommerrouten)

| Prüfung | Verfügbar | Unsicher | Nicht verfügbar |
|---|---|---|---|
| **Sperrungen** | keine gemeldete Sperrung; mindestens 50 % der Route auf amtlichen Wanderwegen | gesperrter Abschnitt mit signalisierter Umleitung · weniger als 50 % auf amtlichen Wegen (für den Rest gibt es keine Meldungen) · Daten älter als 48 h | gesperrter Abschnitt ohne Umleitung auf der Route |
| **Schnee entlang der Route** | eine Station auf ähnlicher oder grösserer Höhe misst schneefrei (< 2 cm) · nur Modell: Modellhöhe nahe der Route und schneefrei | Station knapp unter dem höchsten Punkt misst 5–20 cm · Modell meldet Schnee nahe Routenhöhe · keine Messung in Routenhöhe | ≥ 20 cm an einer Station bis 100 m über dem höchsten Punkt · ≥ 5 cm an einer Station 300 m oder mehr darunter · Modell meldet Schnee unterhalb der Route |
| **Wetter zur Tourzeit** (Prognose) | trocken bzw. leichter Regen, Böen < 60 km/h | Gewitter (WMO 95–99) · Böen 60–90 km/h · Schneefall möglich (≥ 1 cm oder Niederschlag bei ≤ 0,5 °C auf dem höchsten Punkt) · ≥ 15 mm bzw. ≥ 5 mm/h · Prognose älter als 18 h oder zu kurz | Böen ≥ 90 km/h · ≥ 10 cm Neuschnee |
| **Lawinenbulletin** (räumlich) | Stufe 1 · kein Bulletin in Kraft · Route unterhalb 1500 m | Stufe 2 · Bulletin älter als 30 h (Routen ≥ 1500 m) | Stufe ≥ 3 im Höhenband der Route |
| **Tageslicht** (berechnet) | Rückkehr vor Sonnenuntergang | Rückkehr in der bürgerlichen Dämmerung | Rückkehr nach der Dämmerung · Tour länger als das Tageslicht |

**Schnee:** Massgebend sind Stationen bis 25 km um das Ziel mit Messungen der letzten 36 Stunden:
SLF-IMIS (1300–2950 m) sowie MeteoSchweiz (manuell und automatisch). Ohne passende Messung zählt die
modellierte Schneehöhe der Wetterzelle, gekennzeichnet als Modellwert. Die Exposition (Nordhänge)
kann Peakr nicht beurteilen. Der Hinweis steht im Text.

**Lawinen:** Im Schweizer Bulletin tragen die Lawinenprobleme die Kernzone, z. B. «Stufe 3 oberhalb
2000 m, N–O». Ausserhalb der Kernzone ist die Gefahr laut SLF in der Regel eine Stufe tiefer. Peakr
nimmt die höchste Stufe, deren Höhenband die Route berührt (tiefster bis höchster Punkt). Expositionen
werden genannt, aber nicht ausgewertet. «Waldgrenze» zählt als 1800 m (Untergrenze) bzw. 2200 m
(Obergrenze).

**Sperrungen:** Peakr ordnet einen gesperrten Abschnitt einer Route zu, wenn mindestens die Hälfte des
Abschnitts (höchstens 150 m, mindestens 15 m) innerhalb von 25 m der Route liegt. Eine Route, die
einen gesperrten Weg nur kreuzt, gilt damit nicht als gesperrt. Eine Umleitung zählt, wenn eine
«detour»-Meldung mit gleichem Titel in 3 km Umkreis existiert. Die Zuordnung läuft nach jedem Abruf
und nach jedem Neuaufbau der Routen.

Hat ein Ziel mehrere Routen, wählt die Suche zuerst eine verfügbare Variante. Ist die kürzeste Route
gesperrt, erscheint das Ziel mit der nächsten verfügbaren.

## Prüfungen bei Skigebieten

| Prüfung | Verfügbar | Unsicher | Nicht verfügbar |
|---|---|---|---|
| **Betrieb** | Live-Quelle meldet heute offene Anlagen (Stand < 12 h) | keine Live-Quelle (heute: alle Gebiete) · Stand älter als 12 h · Planung für einen anderen Tag | Live-Quelle meldet alle Anlagen geschlossen |
| **Schnee** | ≥ 10 cm am Berg (Messung bevorzugt, sonst Modell) | < 10 cm (technische Beschneiung ist nicht erfasst) · keine aktuelle Schneehöhe | – |
| **Wetter am Skitag** | wie Wandern | wie Wandern | Böen ≥ 90 km/h · ≥ 10 cm Neuschnee |
| **Lawinen** | Stufe 1–3 (Pisten sind gesichert) | Stufe ≥ 4: Anlagen und Pisten können gesperrt sein | – |

Die Schneeangaben unterscheiden:
- **gemessen:** die nächste Station innert 15 km, höchstens 400 m über bzw. unter der Bergstation, mit Name, Höhe und Zeitpunkt;
- **Modellwert:** Open-Meteo, für Tal und Berg.

Die technische Beschneiung kennt Peakr nicht und sagt das auch.

## Live-Wetterkarte

Der Schalter **Wetter** sitzt oben rechts im Kartenbereich. Er ist nicht Teil der Navigation, ein
dunkler Hintergrund zeigt den aktiven Zustand. Das Panel bietet Ebenenwahl, Zeitleiste mit
Abspielen/Pause, Legende mit Einheit, Kennzeichnung «Radar · gemessen» bzw. «Prognose · Modell»,
Quellen und Stand. Für die Prognoseraster zeigt der Zeiger den Wert der Zelle.

| Ebene | Quelle | Zeitachse |
|---|---|---|
| Niederschlag | Radar MeteoSchweiz (PRECIP, gemessen), danach Prognose | letzte Stunde in 5-Minuten-Bildern, dann stündlich bis 48 h |
| Bewölkung | Prognose Open-Meteo | stündlich bis 48 h |
| Neuschnee | Prognose Open-Meteo (cm/h) | stündlich bis 48 h |
| Temperatur | Prognose Open-Meteo, Höhe des Modellgeländes | stündlich bis 48 h |
| Windböen | Prognose Open-Meteo (km/h) | stündlich bis 48 h |

**Farben:**
- Grössen sind einfarbige Rampen von hell nach dunkel: Niederschlag blau, Neuschnee violett, Böen orange, Bewölkung grau.
- Die Temperatur ist divergierend: blau, neutral um 0 °C, rot.
- Die Rampen sind auf den Helligkeitsstufen der Referenzrampe abgeleitet und geprüft:
  - Helligkeit monoton;
  - Stufenabstand ≥ 0,06 OKLCH-L;
  - ein Farbton je Rampe.
- Die hellste Stufe («wenig») tritt bewusst zurück.
- Radarbild, Raster und Legende nutzen dieselben Klassen (`packages/shared/src/weatherScales.ts`).

**Ressourcen und Störungen:**
- Daten werden erst beim Einschalten geladen, und je Ebene nur einmal.
- Verschieben und Zoomen lösen keine Abrufe aus. Das Radarbild ist ein einziges Bild für die
  Schweiz, das Prognoseraster ein GeoJSON mit allen Stunden.
- Ausgeschaltet werden Quellen und Ebenen entfernt.
- Fehler bleiben in der Wetterkomponente. Das Panel meldet sie, Karte und Suche laufen weiter.
- Ist das letzte Radarbild älter als 30 Minuten, steht «Keine aktuellen Radardaten – letzte Messung …».

**Radarbild:**
- `GET /api/weather/radar` listet die jüngsten 12 Bilder aus dem STAC-Katalog (Cache 2 min).
- `GET /api/weather/radar/<JJJJMMTTHHMM>` liefert ein Bild:
  1. HDF5-Datei laden (~30 KB);
  2. mit **jsfive** lesen (reiner JavaScript-Leser von NIST, ohne WebAssembly);
  3. auf Web-Mercator umrechnen;
  4. nach den Legendenklassen einfärben und als PNG ausliefern (650 × 468 px).
- Ein Bild ändert sich nach der Veröffentlichung nicht mehr. Das CDN hält es deshalb dauerhaft
  (`s-maxage=1 Jahr`); gerechnet wird es einmal.
- Die Ausrichtung ist an SwissMetNet-Regenmessern geprüft. Nasse Messer zeigten im Mittel 0,63 mm/h
  Radar, trockene 0,35 mm/h; im gespiegelten Raster wäre es umgekehrt (0,29 bzw. 0,40).

**Prognoseraster:** `GET /api/weather/forecast?var=precip|cloud|snowfall|temp|gust` liest die
Datenbank (Cache 15 min). Es entstehen keine Abrufe bei Open-Meteo.

## Quellen

| Quelle | Herkunft / Abruf | Aktualisierung | Lizenz | Verfügbarkeit | Zuverlässigkeit und Grenzen |
|---|---|---|---|---|---|
| **Sperrungen Wanderwege** | geo.admin.ch, Ebene `ch.astra.wanderland-sperrungen_umleitungen`, offizielle Identify-Schnittstelle, ~1100 Meldungen in 6 Seiten | Worker «weather» alle 6 h | Bundesgeodaten (OGD), Quellenangabe «ASTRA, Schweizer Wanderwege, kantonale Fachstellen» | öffentlich, ohne Schlüssel | gemeldet von Fachstellen; nur amtliches Wanderwegnetz; Dauer als Freitext (nicht ausgewertet); kurzfristige Sperrungen können fehlen |
| **SLF IMIS** | `measurement-api.slf.ch`, Tageswerte Schneehöhe/Neuschnee (132 Stationen, 1300–2950 m) | Worker «ski» alle 3 h, «weather» alle 6 h | CC BY 4.0, Quellenangabe SLF mit Link; Schnittstelle nicht für Abfragen je Nutzeranfrage | öffentlich | Messfelder sind flach; Tageswert ohne Uhrzeit |
| **MeteoSchweiz Schneemessnetz** | geo.admin.ch GeoJSON (manuell 1×/Tag, automatisch 10 min; ~240 Stationen) | wie IMIS | OGD, CC BY 4.0, «Quelle: MeteoSchweiz» | öffentlich | überwiegend tiefe Lagen |
| **MeteoSchweiz Radar** | STAC `ch.meteoschweiz.ogd-radar-precip`, Produkt RZC, 5 min, 14 Tage | beim Öffnen der Karte | OGD, CC BY 4.0 | öffentlich, ~1 min nach Messzeit | Radar unterschätzt bzw. verpasst Niederschlag hinter Bergen; sehr leichter Niederschlag erscheint, bevor ihn ein Regenmesser registriert |
| **Open-Meteo** | stündliche Prognose je 0,1°-Zelle (Niederschlag, Neuschnee, Wettercode, Böen, Temperatur, Bewölkung) für heute bis übermorgen | Worker «weather» alle 6 h | CC BY 4.0, gratis nur nicht-kommerziell | ohne Garantie | Modell, kein Messwert; Zelle ≈ 11 × 8 km, Werte auf Höhe des Modellgeländes (Temperatur für die Route mit 0,65 °C/100 m umgerechnet) |
| **SLF Lawinenbulletin** | `aws.slf.ch` CAAML v6 (Gefahrenstufen, Kernzonen aus den Lawinenproblemen) | Worker «ski» alle 3 h | CC BY 4.0 | saisonal; ausserhalb der Saison leer | Peakr wertet Höhe aus, nicht Exposition; massgebend bleibt whiterisk.ch |
| **Sonnenstand** | berechnet (Sonnenstandsgleichung, ±1 min) | – | – | immer | Gelände, das früher Schatten wirft, ist nicht berücksichtigt |

Geprüft, nicht eingesetzt:
- **RainViewer:** die Bedingungen erlauben nur persönliche bzw. Ausbildungsnutzung; die
  MeteoSchweiz-Daten sind offen und genauer.
- **Liftstatus-Portale und Websites der Bergbahnen:** ohne offene Lizenz; automatisierter Abruf untersagt.
- **Wetterwarnungen von MeteoSchweiz:** keine offene, maschinenlesbare Quelle gefunden. Die Ebene ist
  deshalb nicht umgesetzt.

## Datenmodell

| Tabelle / Feld | Inhalt |
|---|---|
| `trail_closures` | Meldungen (Art `closed_way`/`detour`, Titel, Grund, Dauer, Text, Link, Herausgeber, Linie) |
| `route_closures` | Route ↔ Sperrung mit Überlappung in m und «Umleitung vorhanden» |
| `snow_observations` | letzte Messung je Station (Quelle, Lage, Höhe, Schneehöhe, Neuschnee, Zeitpunkt) |
| `weather_cells.forecast`, `forecast_at` | stündliche Prognose je Zelle (JSON-Arrays ab `start`) |
| `app_meta.avalanche_levels` | Stufe je Warnregion samt Höhenbändern und Expositionen, Abrufzeit |
| API `availability` | `status`, `reason`, `confidence`, `checkedAt`, `plan` (inkl. Tourende), `checks[]` mit `kind`, `status`, `text`, `evidence`, `source`, `observedAt`, `url` |

Die Verfügbarkeit wird **beim Lesen berechnet** (Suche und Detailseite), nicht gespeichert. Sie hängt
von der Planung ab und muss stets den neuesten Stand der Grundlagen nutzen. Die Grundlagen werden
je Server-Instanz 5 Minuten zwischengespeichert. Eine ungecachte Suche ab Zürich (90 min, ~6000
Ziele) braucht lokal rund 150 ms.

## Kosten und Limits

Es entstehen keine Kosten.
- **Open-Meteo** (gratis bis 10'000 Abrufe/Tag): Der Wetterlauf fragt dieselben ~560 Zellen wie
  bisher ab, mit 12 statt 6 Variablen, also 1,2 Abrufe je Zelle. Das sind rund 2'700 Abrufe/Tag.
  Zusammen mit dem Ski-Lauf (~5'100/Tag) liegt Peakr bei etwa 7'800/Tag. Die Wetterkarte löst keine
  Abrufe aus.
- **Radar:** ein Funktionsaufruf je neuem 5-Minuten-Bild, das jemand ansieht, sonst CDN.
- **geo.admin.ch, SLF, MeteoSchweiz:** wenige Abrufe je Worker-Lauf.
- **GitHub Actions:** unverändert (öffentliches Repository). Jeder Worker-Lauf wendet zusätzlich die
  Migrationen an, das dauert wenige Sekunden.

## Grenzen

- Peakr kann Sperrungen ausserhalb des amtlichen Wanderwegnetzes nicht kennen. Routen grösstenteils
  abseits davon gelten deshalb als unsicher. Das betrifft rund ein Drittel der Routen. Die Schwelle
  ist `MIN_OFFICIAL_SHARE` in `apps/backend/src/availability/checks.ts`.
- Die Wetterprüfung nutzt die Zelle des Ziels. Auf Graten können Böen deutlich stärker sein.
- Exposition (Schnee, Lawinen) und Steinschlag werden nicht beurteilt.
- Ohne Live-Betriebsstatus sind alle Skigebiete «unsicher». Die Ski-Suche zeigt dann einen
  erklärenden Hinweis mit Schalter.
- Das Radar deckt die Schweiz und die Ränder der Nachbarländer ab (Bildausschnitt 5,0–11,5° E,
  45,2–48,4° N).

## Tests

- `apps/backend/src/availability/engine.test.ts` (39): alle Regeln oben, Sommer und Winter. Dazu
  gehören Sperrung mit und ohne Umleitung, Messung vs. Modell, Gewitter vor und nach der Tour,
  Höhenbänder, Dämmerung, Betrieb ohne Quelle sowie Vertrauen und Grund.
- `apps/backend/src/availability/time.test.ts`: Sommerzeit, Planung, Sonnenwenden (±3 min gegen Almanach).
- `apps/backend/src/services/search.service.test.ts`: Wahl der verfügbaren Variante, Zählung der
  Ausblendungen, «unsichere zeigen», Ski ohne Betriebsstatus, Cache-Schlüssel.
- `apps/backend/src/services/slf.service.test.ts`: Kernzone, «Waldgrenze», eine Stufe tiefer ausserhalb.
- `apps/backend/src/services/radar.service.test.ts`: Dateinamen, echte Radardatei dekodieren,
  Nord-Süd-Lage, Farbklassen, PNG-Aufbau.
- `apps/frontend/lib/peakr.test.ts`: Planungsdatum in Schweizer Zeit, Beschriftungen, Gründe.
- Browsertest Desktop 1360 × 900 und Mobil 390 × 844:
  - keine Wetterabrufe vor dem Einschalten;
  - Schalter oben rechts mit aktivem Zustand;
  - Radar als Messung, spätere Stunden als Prognose gekennzeichnet;
  - Legende, Abspielen, Ebenenwechsel;
  - keine neuen Abrufe beim Verschieben und Zoomen;
  - Ausschalten entfernt alles;
  - Ski-Leerzustand, Detailkarte «Verfügbarkeit»;
  - keine Skriptfehler.
