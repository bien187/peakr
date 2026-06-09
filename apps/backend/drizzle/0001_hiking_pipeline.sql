ALTER TABLE "destinations"
  ADD COLUMN IF NOT EXISTS "poi_kind"         text,
  ADD COLUMN IF NOT EXISTS "source_layer"     text,
  ADD COLUMN IF NOT EXISTS "nearest_route_m"  integer,
  ADD COLUMN IF NOT EXISTS "quality_score"    smallint;

CREATE INDEX IF NOT EXISTS "destinations_quality_idx"  ON "destinations" ("quality_score");
CREATE INDEX IF NOT EXISTS "destinations_poi_kind_idx" ON "destinations" ("poi_kind");
