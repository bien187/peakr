# Peakr – Datenquellen (Stand 13.11.2026)

Alle Quellen sind kostenlos. Geprüft wurden jeweils: Kosten, Nutzungsbedingungen, Qualität,
Aktualisierung, technische Abrufbarkeit, Überschneidung mit anderen Quellen. Die Stände der
eingesetzten Quellen speichert Peakr in der Tabelle `data_sources` und zeigt sie in der
Detailansicht und unter `/api/health`.

## Eingesetzt

| Quelle | Wofür | Lizenz / Bedingungen | Aktualisierung bei Peakr | Abruf |
|---|---|---|---|---|
| **swisstopo swissNAMES3D** | Amtliche Namen, Lage, Höhe und Objektart von Gipfeln, Hügeln, Pässen, Aussichtspunkten, Seen, Hütten; Sprachvarianten | Open Government Data, freie Nutzung mit Quellenangabe «© swisstopo» | wöchentlich geprüft (Datensatz erscheint ca. jährlich) | STAC-API `data.geo.admin.ch`, CSV-ZIP 29 MB |
| **swisstopo swissTLM3D Wanderwege** | Amtliches Wanderwegnetz mit Wegkategorie (gelb / weiss-rot-weiss / weiss-blau-weiss) und 3D-Höhen | OGD, «© swisstopo, Schweizer Wanderwege» | wöchentlich geprüft (jährlich) | GeoPackage 198 MB, LV95 |
| **OpenStreetMap** (Geofabrik-Auszug Schweiz) | Strassennetz (Fahrzeit), Fusswege mit `sac_scale`, Parkplätze, zusätzliche Ziele, Wikidata/Wikipedia-Verweise, Lifte, Pisten, Skigebietsflächen | ODbL 1.0, «© OpenStreetMap-Mitwirkende»; abgeleitete Datenbanken bei Weitergabe ebenfalls unter ODbL | wöchentlich (Auszug täglich verfügbar) | `.osm.pbf` 551 MB, lokal mit `osmium` gefiltert – keine Overpass-Last |
| **Terrain Tiles** (Mapzen, AWS Open Data) | Höhen für Wege ohne amtliche 3D-Koordinate (Auf-/Abstieg) | Offene Daten; Quellenangabe EU-DEM © Copernicus, SRTM (NASA) u. a. | einmalig, zwischengespeichert | ~1'200 PNG-Kacheln (Zoom 12) |
| **Open-Meteo** | Wetter, Temperatur, Wind, Schneehöhe, Neuschnee; stündliche Prognose bis übermorgen für Tourplanung und Wetterkarte (Modelle u. a. MeteoSchweiz ICON-CH) | Kostenlos für nicht-kommerzielle Nutzung bis 10'000 Abrufe/Tag; Daten CC BY 4.0 | Skigebiete 3-stündlich, Wetterraster 6-stündlich | gebündelte Mehrort-Abfragen; ~8'000 Abrufe/Tag |
| **SLF** (WSL-Institut für Schnee- und Lawinenforschung) | Warnregionen (Polygone), Gefahrenstufe und Kernzonen (Höhe, Expositionen) aus dem Lawinenbulletin; Schneehöhe und Neuschnee der IMIS-Stationen | CC BY 4.0, Quellenangabe SLF mit Link; Messschnittstelle nur periodisch abfragen | 3-stündlich mit dem Ski-Job, IMIS auch im Wetterlauf; Bulletin erscheint saisonal | `aws.slf.ch` CAAML-JSON, `measurement-api.slf.ch` |
| **Sperrungen Wanderwege** (ASTRA, Schweizer Wanderwege, Kantone) | Gesperrte Abschnitte und Umleitungen auf dem amtlichen Wanderwegnetz | Bundesgeodaten (OGD), Quellenangabe | 6-stündlich (Worker «weather») | GeoAdmin-Identify `ch.astra.wanderland-sperrungen_umleitungen` |
| **MeteoSchweiz** | Schneehöhen (manuelles und automatisches Messnetz); Niederschlagsradar (PRECIP, 5 min) für die Wetterkarte | OGD, CC BY 4.0, «Quelle: MeteoSchweiz» | Schnee mit den Workern; Radar beim Öffnen der Karte | GeoJSON auf `data.geo.admin.ch`, STAC `ch.meteoschweiz.ogd-radar-precip` |
| **Wikimedia Pageviews** | Bekanntheit (Seitenaufrufe 30 Tage) für Ziele mit Wikipedia-Artikel | CC0; User-Agent mit Kontakt Pflicht | wöchentlich | REST-API |
| **swisstopo Kartendienste** (Browser) | Grundkarte (Vektor), Luftbild SWISSIMAGE, Wanderwege-Overlay, Ortssuche | OGD, Quellenangabe; faire Nutzung | live | `vectortiles.geo.admin.ch`, `wmts.geo.admin.ch`, `api3.geo.admin.ch` |
| **OpenStreetMap / Mapterhorn** (Browser, 3D-Ansicht) | Rasterkarte und Höhenmodell der 3D-Ansicht | ODbL bzw. offene Höhendaten, Quellenangabe in der Karte | live | Kachel-Server |
| **Overpass API** (Browser) | Feuerstellen auf der Karte ab Zoom 13 | ODbL; öffentlicher Dienst mit Fair-Use | je Kartenkachel einmal pro Sitzung | `overpass-api.de` |

Attribution in der App: Kartenecke (MapLibre), Detailansicht → «Datenquellen» und «Verfügbarkeit» (Quelle je Prüfung), Wetterkarte (Quellenzeile), Lawinenhinweis.
Details zu Verfügbarkeit und Wetterkarte: [VERFUEGBARKEIT_UND_WETTER.md](VERFUEGBARKEIT_UND_WETTER.md).

## Geprüft, nicht eingesetzt

| Quelle | Grund |
|---|---|
| `wfs.geo.admin.ch` (alte swissNAMES3D-Anbindung) | Dienst existiert nicht (DNS). Ersetzt durch den Download über die STAC-API. |
| OpenRouteService | Gratis-Kontingent (500 Matrix-Anfragen/Tag) war die Ursache der 60-Kandidaten-Grenze. Nur noch für den einmaligen Kalibriervergleich (`calibrate:drive`). |
| Eigener Valhalla-/OSRM-Server | Genau, aber ein dauerhaft laufender Server kostet Geld. Der eigene Graph erreicht 2,6 % Median-Abweichung kostenlos. |
| Öffentliche Overpass-Server für den Import | Nicht als Produktionsinfrastruktur geeignet (Limits, Abbrüche); der Geofabrik-Auszug ist vollständig und reproduzierbar. |
| Wikidata direkt | Die Verknüpfungen kommen bereits über die OSM-Tags `wikidata`/`wikipedia`; eigene SPARQL-Abfragen brächten wenig zusätzliche Ziele. |
| swisstopo swissALTI3D / DHM25 | Genauer als Terrain Tiles; swissALTI3D (2 m) ist aber viele GB gross, DHM25 wurde heruntergeladen und geprüft. Für Höhenmeter auf Wanderrouten reicht die Kombination aus amtlichen 3D-Wegen und Terrain Tiles; mögliche spätere Verbesserung. |
| SchweizMobil-Routen | Keine offene Lizenz für die Weiterverwendung der Tourendaten. |
| Liftstatus der Bergbahnen / Sammelportale | Keine offene Lizenz, Nutzungsbedingungen verbieten automatisierten Abruf. Peakr zeigt deshalb keinen Liftstatus statt erfundener Werte. Adapter für zugelassene Einzelquellen: `apps/backend/src/lifts`. |
| MeteoSchweiz-Modellprognosen (ICON-CH, GRIB2) | Open-Meteo liefert diese Modelle bereits in einfach abrufbarer Form; Messnetz und Radar von MeteoSchweiz sind eingesetzt (siehe oben). |
| RainViewer (Radar) | Bedingungen erlauben nur persönliche bzw. Ausbildungsnutzung; das Radar von MeteoSchweiz ist offen und für die Schweiz genauer. |
| Wetterwarnungen MeteoSchweiz | Keine offene, maschinenlesbare Quelle gefunden – die Wetterkarte zeigt deshalb keine Warnebene. |
| opentransportdata.swiss (ÖV) | Wertvoll für eine spätere ÖV-Anreise; nicht Teil des Auftrags (Auto). |
| OpenAI (Trend-Anreicherung) | Kostenpflichtig; bleibt optional und ist standardmässig aus (`ENABLE_OPENAI_TREND=false`). |

## Gleiche Objekte aus mehreren Quellen

swissNAMES3D ist führend für Name, Lage und Höhe. OSM-Objekte werden zugeordnet, wenn Art, Name,
Abstand und Höhe zusammenpassen (`pipeline/steps/destinations.ts → isSameObject`), und ergänzen dann
Wikidata/Wikipedia, Sprachvarianten und Flächen. Die Herkunft jedes Ziels steht in
`destination_sources`; 10'200 Ziele sind durch beide Quellen bestätigt.
