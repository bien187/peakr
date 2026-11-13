-- Höhe je Stützpunkt der Routenlinie (gleiche Reihenfolge und Länge wie die Punkte von
-- "geom"). Quelle: amtliche Wegdaten swissTLM3D bzw. Geländemodell, am Ziel die
-- amtliche Höhe. NULL = für diese Route nicht gespeichert (vor dem nächsten
-- Datenaufbau); einzelne NULL-Einträge = Höhe an diesem Punkt unbekannt.
ALTER TABLE "hike_routes" ADD COLUMN IF NOT EXISTS "elevations" smallint[];
