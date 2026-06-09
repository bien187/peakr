-- hiking_routes: swisstopo/OSM Wanderwege als PostGIS-Referenznetz für Qualitätsfilter
CREATE TABLE IF NOT EXISTS "hiking_routes" (
  "id"     bigserial PRIMARY KEY,
  "osm_id" text UNIQUE,
  "source" text NOT NULL DEFAULT 'osm',
  "geom"   geography(Geometry, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS "hiking_routes_geom_idx" ON "hiking_routes" USING GIST("geom");

-- Neue Qualitätsspalten an destinations
ALTER TABLE "destinations"
  ADD COLUMN IF NOT EXISTS "poi_kind"       text,
  ADD COLUMN IF NOT EXISTS "source_layer"   text,
  ADD COLUMN IF NOT EXISTS "nearest_route_m" integer,
  ADD COLUMN IF NOT EXISTS "quality_score"  smallint;

CREATE INDEX IF NOT EXISTS "destinations_quality_idx" ON "destinations" ("quality_score");
CREATE INDEX IF NOT EXISTS "destinations_poi_kind_idx" ON "destinations" ("poi_kind");
