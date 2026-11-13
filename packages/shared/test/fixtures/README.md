# Testdaten

`rigi-kulm-route.json` ist die Routenvariante 1 zum Rigi Kulm, so wie sie die Detail-API
(`getDestinationDetail`) nach dem Datenaufbau vom 13.11.2026 liefert: Linie, Höhen je Stützpunkt
und benannte Orte am Weg. Die Daten stammen aus OpenStreetMap (© OpenStreetMap-Mitwirkende, ODbL)
sowie swissTLM3D und swissNAMES3D (© swisstopo).

Neu erzeugen nach einer Änderung am Datenformat: Detailabfrage für die Ziel-ID
`dcf83416-d393-4a6f-a642-63e7f63be0dd` gegen eine befüllte Datenbank ausführen und `destination`
(id, name, location, elevationTopM, poiKind, objectClass), `routes[0]` ohne `drive` sowie die
Anzahl Varianten als `variantCount` speichern.

`../gpx-1.1.xsd` ist das offizielle GPX-1.1-Schema von https://www.topografix.com/GPX/1/1/gpx.xsd.
