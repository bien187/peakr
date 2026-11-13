# Peakr – Datenqualitätsbericht

Erstellt am 13.11.2026, 01:47:47 mit `pnpm report:quality` aus der Datenbank.

## Quellen

| Quelle | Stand |
|---|---|
| OpenStreetMap (Geofabrik-Auszug Schweiz) | 2026-11-11T21:22:47Z |
| WSL-Institut für Schnee- und Lawinenforschung SLF | laufend |
| swisstopo swissNAMES3D | 2026-06-01 |
| swisstopo swissTLM3D Wanderwege | 2026-07-28 |
| Terrain Tiles (Mapzen/AWS Open Data) | laufend |

## Wanderziele

**19'225** aktive Wanderziele in **26** Kantonen; 411 stillgelegt (nicht mehr in den Quellen bzw. ausserhalb der Schweiz).

| Art | Anzahl | mit Route | ohne Route im Wegnetz | swissNAMES3D | nur OSM | aus beiden Quellen | ohne Höhe |
|---|---:|---:|---:|---:|---:|---:|---:|
| Gipfel | 11'010 | 6'291 (57.1 %) | 4'719 | 9'798 | 1'212 | 6'724 | 117 |
| Hütten/Berggasthäuser | 2'903 | 2'688 (92.6 %) | 215 | 2'558 | 345 | 492 | 230 |
| Pässe/Sättel | 2'611 | 1'383 (53.0 %) | 1'228 | 2'310 | 301 | 2'060 | 32 |
| Seen | 1'727 | 1'476 (85.5 %) | 251 | 1'391 | 336 | 917 | 309 |
| Aussichtspunkte | 974 | 916 (94.0 %) | 58 | 60 | 914 | 24 | 809 |
| **Summe** | **19'225** | **12'754 (66.3 %)** | | | | | |

Gipfel unter 1'200 m (früher hart ausgeschlossen): 3'722, davon unter 800 m: 2'608.

**Abgleich mit den Rohdaten des letzten Imports:**

- swissNAMES3D: 487'083 Namenseinträge gelesen → 9'845 Gipfel, 2'433 Pässe, 2'842 Hütten, 1'487 Seen, 94 Aussichtspunkte als Wanderziel-Objektarten.
- OpenStreetMap: 67'518 Objekte gelesen, 5'114 ohne Namen und 1'095 Kleinstgewässer verworfen.
- 30'451 Kandidaten → 10'997 als Doppel zusammengeführt → 19'225 Ziele; 229 lagen ausserhalb der Schweiz.

Nach Kanton: AG 560 · AI 113 · AR 108 · BE 2'467 · BL 317 · BS 12 · FR 417 · GE 18 · GL 453 · GR 3'924 · JU 178 · LU 427 · NE 165 · NW 156 · OW 252 · SG 980 · SH 245 · SO 434 · SZ 525 · TG 404 · TI 1'454 · UR 764 · VD 722 · VS 3'043 · ZG 76 · ZH 1'011

## Wanderrouten

- 22'403 Routen zu 12'754 Zielen (9'649 davon zusätzliche Varianten).
- Schwierigkeit unbekannt: 3'774 Routen (16.8 %); als Bereich (amtliche Wegkategorie, z. B. T2–T3): 2'887.
- Vollständig auf signalisierten Wanderwegen: 4'631 (20.7 %).
- Weg endet mehr als 150 m vor dem Zielpunkt: 0.

Beste Route je Ziel nach SAC: T1 6'214 · T2 1'288 · T3 2'589 · T4 476 · T5 129 · T6 148 · unbekannt 1'910

Wegnetz: 276'144 km begehbare Wege, davon 70'415 km amtliche Wanderwege (swissTLM3D: 67'020 km); 22'252 km ohne Schwierigkeitsangabe.
Strassennetz: 92'279 km, 1'391'201 Knoten.
Ohne Route: 5'472 Ziele ohne Weg in der Nähe, 999 ohne erreichbaren Ausgangspunkt.

## Ausgangspunkte und Fahrzeiten

| Art | Qualität | Anzahl | ohne Strassenanschluss |
|---|---:|---:|---:|
| Parkplatz | 2 | 5'553 | 0 |
| Parkplatz | 3 | 2'648 | 0 |
| Strassenzugang | 1 | 802 | 0 |
| Talstation | 1 | 13 | 0 |
| Talstation | 3 | 304 | 0 |

Fahrzeiten werden je Suche über den Strassengraphen gerechnet. Ein Ausgangspunkt ohne Strassenanschluss erhält nie eine Fahrzeit.

## Skigebiete

- 317 Skigebiete mit 1'760 Anlagen und 5'263 km Pisten (OpenStreetMap).
- Gruppierung: 536 räumliche Gruppen, 301 OSM-Skigebietsflächen, 21 gleichnamige zusammengeführt, 165 einzelne Anlagen ohne Pisten verworfen.
- Zufahrt bis zur Talstation: 317; Strasse endet über 600 m vorher (autofreie Orte): 13.
- Mit aktuellen Wetterdaten: 317, mit Schneehöhe: 317, mit Live-Liftstatus: 0.

## Prüfungen

| Prüfung | Befund |
|---|---:|
| Mögliche Doppel (gleiche Art, gleicher Name, < 300 m) | 10 |
| Koordinaten ausserhalb der Schweiz | 0 |
| Höhe ausserhalb 190–4'640 m | 0 |
| Ziele ohne Namen | 0 |
| Ungültige Routengeometrien | 0 |

