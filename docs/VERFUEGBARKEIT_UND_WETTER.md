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

Der Schalter **Wetter** sitzt oben rechts im Kartenbereich. Eingeschaltet wird die Karte dunkel
(Schleier unter den Beschriftungen, Beschriftungen hell), die Wetterebene liegt als weicher Verlauf
darüber und **läuft von selbst ab** – ausser bei «Bewegung reduzieren» im System.

- **Einstellungen (Panel):** Ebenenwahl, Zeitleiste mit Abspielen/Pause und «Jetzt»-Marke
  (Messung voll, Prognose gestrichelt), Legende als Verlauf mit Zahlen und Worten, Kennzeichnung
  «Radar · gemessen» bzw. «Prognose · Modell», Quellen und Stand.
- **Zugeklappt** (Pfeil oben im Panel; auf dem Handy auch beim Verschieben der Karte) läuft das
  Wetter weiter. Ein dunkler Chip zeigt Ebene, Zeit und «gemessen»/«Prognose», daneben eine
  senkrechte Mini-Legende. Antippen öffnet die Einstellungen wieder (dort Pause), das × schaltet aus.
- **Pause** hält Zeit, Bild und Partikel an und rastet auf einem echten Daten-Zeitpunkt ein.
  Zwischenbilder entstehen nur beim Abspielen (Überblendung zweier Stunden bzw. Radarbilder).
  Zwischen Messung und Prognose wird nur über die Deckkraft gewechselt – ein Mischbild aus
  Messung und Prognose gibt es nicht.
- **Wert unter dem Zeiger** (Maus): z. B. «2,4 mm/h · leicht – Radar gemessen · 14:35» für den
  angezeigten Zeitpunkt.
- **Windböen:** kleine, auslaufende Striche ziehen mit Windrichtung und Böenstärke (Open-Meteo
  `wind_direction_10m` und `wind_gusts_10m`); ohne Windrichtung im Datenstand gibt es keine Striche
  und einen Hinweis. **Neuschnee:** Flocken fallen dort, wo Neuschnee erwartet wird.

| Ebene | Quelle | Zeitachse |
|---|---|---|
| Niederschlag | Radar MeteoSchweiz (PRECIP, gemessen), danach Prognose | letzte Stunde in 5-Minuten-Bildern, dann stündlich bis 48 h |
| Bewölkung | Prognose Open-Meteo | stündlich bis 48 h |
| Neuschnee | Prognose Open-Meteo (cm/h) | stündlich bis 48 h |
| Temperatur | Prognose Open-Meteo, Höhe des Modellgeländes | stündlich bis 48 h |
| Windböen | Prognose Open-Meteo (km/h, mit Windrichtung) | stündlich bis 48 h |

**Farben** (`packages/shared/src/weatherScales.ts`, eine Quelle für Karte und Legende):
- Fliessende Verläufe statt Klassen. Werte werden auf 0–255 abgebildet (Niederschlag und Neuschnee
  logarithmisch), eine Farbtabelle mit 256 Einträgen färbt jedes Pixel; schwache Werte laufen über
  die Deckkraft weich aus.
- Niederschlag: hellblau → blau → violett → rot → orange → gelb (wie bekannte Wetter-Apps), Worte
  leicht < 2,5 · mässig < 10 · stark < 50 · extrem (mm/h, Stufen wie beim Deutschen Wetterdienst).
- Temperatur divergierend: blau, neutral hell um 0 °C, orange bis rot.
- Bewölkung als weisser Schleier, Böen als zarte Tönung (die Striche tragen die Richtung).
- Die Legende zeigt die Farben so, wie sie auf dem dunklen Schleier erscheinen.

**Darstellung (Browser):**
- `apps/frontend/lib/weatherEngine.ts` steuert die Ebenen ausserhalb von React (rund 30 Bilder pro
  Sekunde, nur solange etwas läuft; angehalten zeichnet die Karte nur bei Bedarf).
- `apps/frontend/lib/weatherField.ts` rechnet die Flächen: Radar zweimal weichgezeichnet (Kastenfilter,
  ≈ Gauss), Prognoseraster bilinear zwischen Zellmitten und weichgezeichnet; Ränder der
  Datenabdeckung laufen aus. Die Bilder liegen als MapLibre-Canvas-Quellen in Web-Mercator.
- `apps/frontend/lib/weatherParticles.ts` zeichnet Striche und Flocken als eigene WebGL-Ebene unter
  den Beschriftungen und Zielpunkten.
- `apps/frontend/lib/mapShade.ts` liefert den dunklen Schleier und die hellen Beschriftungen – für
  die Wetterkarte und für den dunklen Modus der App. Es gilt der stärkere Wunsch, die Karte wird nie
  doppelt abgedunkelt; schaltet man eines aus, bleibt das andere.

**Ressourcen und Störungen:**
- Daten werden erst beim Einschalten geladen, je Ebene einmal; das Radar alle 5 Minuten neu
  (nur neue Bilder), solange Niederschlag sichtbar ist.
- Verschieben und Zoomen lösen keine Abrufe aus. Radar und Raster decken die ganze Schweiz ab.
- Ausgeschaltet werden Schleier, Quellen und Ebenen entfernt, die Beschriftungen zurückgesetzt.
- Fehler bleiben in der Wetterkomponente. Das Panel meldet sie, Karte und Suche laufen weiter.
- Ist das letzte Radarbild älter als 30 Minuten, steht «Keine aktuellen Radardaten – letzte Messung …».

**Radar:**
- `GET /api/weather/radar` listet die jüngsten 12 Bilder aus dem STAC-Katalog (Cache 2 min).
- `GET /api/weather/radar/<JJJJMMTTHHMM>/data` liefert ein **Datenbild**:
  1. HDF5-Datei laden (~30 KB);
  2. mit **jsfive** lesen (reiner JavaScript-Leser von NIST, ohne WebAssembly);
  3. auf Web-Mercator umrechnen (650 × 468 px);
  4. je Pixel die Intensität als Byte speichern (0 = trocken, 1–255 = 0,1–100 mm/h logarithmisch)
     und als Graustufen-PNG ausliefern (meist nur wenige KB).
  Gefärbt, weichgezeichnet und überblendet wird im Browser; das PNG wird dort selbst dekodiert
  (ohne Farbmanagement, damit die Werte exakt bleiben).
- `GET /api/weather/radar/<JJJJMMTTHHMM>` liefert weiterhin das eingefärbte Bild (Klassen) für
  andere Verwendungen.
- Ein Bild ändert sich nach der Veröffentlichung nicht mehr. Das CDN hält es deshalb dauerhaft
  (`s-maxage=1 Jahr`); gerechnet wird es einmal.
- Die Ausrichtung ist an SwissMetNet-Regenmessern geprüft. Nasse Messer zeigten im Mittel 0,63 mm/h
  Radar, trockene 0,35 mm/h; im gespiegelten Raster wäre es umgekehrt (0,29 bzw. 0,40).

**Prognoseraster:** `GET /api/weather/forecast?var=precip|cloud|snowfall|temp|gust` liest die
Datenbank (CDN-Cache 30 min). Für `gust` kommt die Windrichtung je Stunde und Zelle mit. Es
entstehen keine Abrufe bei Open-Meteo.

## Quellen

| Quelle | Herkunft / Abruf | Aktualisierung | Lizenz | Verfügbarkeit | Zuverlässigkeit und Grenzen |
|---|---|---|---|---|---|
| **Sperrungen Wanderwege** | geo.admin.ch, Ebene `ch.astra.wanderland-sperrungen_umleitungen`, offizielle Identify-Schnittstelle, ~1100 Meldungen in 6 Seiten | Worker «weather» alle 6 h | Bundesgeodaten (OGD), Quellenangabe «ASTRA, Schweizer Wanderwege, kantonale Fachstellen» | öffentlich, ohne Schlüssel | gemeldet von Fachstellen; nur amtliches Wanderwegnetz; Dauer als Freitext (nicht ausgewertet); kurzfristige Sperrungen können fehlen |
| **SLF IMIS** | `measurement-api.slf.ch`, Tageswerte Schneehöhe/Neuschnee (132 Stationen, 1300–2950 m) | Worker «ski» alle 3 h, «weather» alle 6 h | CC BY 4.0, Quellenangabe SLF mit Link; Schnittstelle nicht für Abfragen je Nutzeranfrage | öffentlich | Messfelder sind flach; Tageswert ohne Uhrzeit |
| **MeteoSchweiz Schneemessnetz** | geo.admin.ch GeoJSON (manuell 1×/Tag, automatisch 10 min; ~240 Stationen) | wie IMIS | OGD, CC BY 4.0, «Quelle: MeteoSchweiz» | öffentlich | überwiegend tiefe Lagen |
| **MeteoSchweiz Radar** | STAC `ch.meteoschweiz.ogd-radar-precip`, Produkt RZC, 5 min, 14 Tage | beim Öffnen der Karte | OGD, CC BY 4.0 | öffentlich, ~1 min nach Messzeit | Radar unterschätzt bzw. verpasst Niederschlag hinter Bergen; sehr leichter Niederschlag erscheint, bevor ihn ein Regenmesser registriert |
| **Open-Meteo** | stündliche Prognose je 0,1°-Zelle (Niederschlag, Neuschnee, Wettercode, Böen, Windrichtung, Temperatur, Bewölkung) für heute bis übermorgen | Worker «weather» alle 6 h | CC BY 4.0, gratis nur nicht-kommerziell | ohne Garantie | Modell, kein Messwert; Zelle ≈ 11 × 8 km, Werte auf Höhe des Modellgeländes (Temperatur für die Route mit 0,65 °C/100 m umgerechnet) |
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
  bisher ab, mit 13 Variablen (neu: Windrichtung für die Böen-Striche), also 1,3 Abrufe je Zelle.
  Das sind rund 2'900 Abrufe/Tag. Zusammen mit dem Ski-Lauf (~5'100/Tag) liegt Peakr bei etwa
  8'000/Tag. Die Wetterkarte löst keine Abrufe aus.
- **Radar:** ein Funktionsaufruf je neuem 5-Minuten-Bild, das jemand ansieht, sonst CDN. Das
  Datenbild ist meist nur wenige KB gross.
- **Neon:** Das Prognoseraster für Böen liest zusätzlich die Windrichtung (gut doppelt so viele
  Daten wie die anderen Ebenen); der CDN-Cache von 30 min begrenzt das auf rund 48 Lesungen je
  Ebene, Tag und CDN-Region.
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
  Nord-Süd-Lage, Farbklassen, PNG-Aufbau, Datenbild (Byte je Pixel, Graustufen-PNG).
- `packages/shared/test/weatherScales.test.ts`: Wert ↔ Byte (log/linear), Radar-Byte zurück auf
  mm/h (≤ 3 % Abweichung), Farbtabelle, Legendenlage, Worte je Stufe.
- `apps/frontend/lib/weatherField.test.ts`: Färben und Ausblenden, Weichzeichner (Summe erhalten),
  Zwischenbilder, Rastergeometrie in Mercator, bilinearer Wert, Windrichtung «woher» → Vektor
  «wohin», PNG-Dekodierung aller fünf Filter.
- `apps/frontend/lib/weatherParticles.test.ts`: Striche ziehen mit dem Wind, stehen bei Pause still,
  keine Striche bei Windstille oder ohne Daten, Flocken fallen; Start der Zeitachse bei «jetzt».
- `apps/frontend/lib/peakr.test.ts`: Planungsdatum in Schweizer Zeit, Beschriftungen, Gründe.
- Browsertest Desktop 1360 × 900, Mobil 390 × 844 (Chrome) und iPhone-Ansicht in WebKit (Safari):
  - keine Wetterabrufe vor dem Einschalten; Fahrzeit-Fenster vollständig im Bild;
  - läuft nach dem Einschalten von selbst und bei zugeklappten Einstellungen weiter;
  - Pause hält Zeit, Bild und Böen-Striche an; abgespielt ziehen die Striche;
  - Radar als Messung, spätere Stunden als Prognose gekennzeichnet; Wert unter dem Zeiger;
  - dunkle Ansicht eingeschaltet, ausgeschaltet wieder hell;
  - keine Skriptfehler.
