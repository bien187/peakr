-- 0002 – PostGIS zurück, Herkunft, Ausgangspunkte, Wanderrouten, Skilifte, Wetterraster.
--
-- Läuft auf einer leeren Datenbank (nach 0000/0001) UND auf einer bestehenden
-- Datenbank mit Altdaten. Es wird nichts gelöscht: bestehende Ziele, Konten und
-- Favoriten bleiben erhalten; alte OSM-Referenzen werden in destination_sources
-- übernommen, damit der neue Import dieselben Ziel-IDs weiterverwendet.

CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint

-- ── Herkunft & Importläufe ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "data_sources" (
  "id"          text PRIMARY KEY,
  "name"        text NOT NULL,
  "url"         text,
  "license"     text,
  "attribution" text,
  "version"     text,
  "fetched_at"  timestamptz,
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_runs" (
  "id"          bigserial PRIMARY KEY,
  "job"         text NOT NULL,
  "source_id"   text REFERENCES "data_sources"("id"),
  "status"      text NOT NULL DEFAULT 'running' CHECK ("status" IN ('running', 'success', 'partial', 'failed')),
  "started_at"  timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "stats"       jsonb,
  "error"       text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_runs_job_started_idx" ON "import_runs" ("job", "started_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_meta" (
  "key"        text PRIMARY KEY,
  "value"      jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Sperre gegen parallele Worker-Läufe; läuft von selbst ab, falls ein Lauf abstürzt.
CREATE TABLE IF NOT EXISTS "job_locks" (
  "job"          text PRIMARY KEY,
  "owner"        text NOT NULL,
  "locked_until" timestamptz NOT NULL
);
--> statement-breakpoint
-- Zähler für Rate-Limits (Serverless-Instanzen teilen keinen Arbeitsspeicher).
CREATE TABLE IF NOT EXISTS "rate_limits" (
  "bucket"       text NOT NULL,
  "window_start" timestamptz NOT NULL,
  "hits"         integer NOT NULL DEFAULT 1,
  PRIMARY KEY ("bucket", "window_start")
);
--> statement-breakpoint

-- ── SLF-Warnregionen ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "avalanche_regions" (
  "id"         text PRIMARY KEY,
  "name"       text,
  "geom"       geometry(MultiPolygon, 4326) NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "avalanche_regions_geom_idx" ON "avalanche_regions" USING gist ("geom");
--> statement-breakpoint

-- ── Kantone (für die Zuordnung der Ziele per ST_Contains) ─────────────────────
CREATE TABLE IF NOT EXISTS "cantons" (
  "code"       text PRIMARY KEY,
  "name"       text NOT NULL,
  "geom"       geometry(MultiPolygon, 4326) NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cantons_geom_idx" ON "cantons" USING gist ("geom");
--> statement-breakpoint

-- ── Ziele ─────────────────────────────────────────────────────────────────────
-- Getrennt gehalten werden: Existenz (Zeile), Metadaten-Qualität (quality_score),
-- Wanderbarkeit (route_status + hike_routes) und Erreichbarkeit (trailheads).
ALTER TABLE "destinations"
  ADD COLUMN IF NOT EXISTS "geom" geometry(Point, 4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("lng"::float8, "lat"::float8), 4326)) STORED,
  ADD COLUMN IF NOT EXISTS "object_class" text,
  ADD COLUMN IF NOT EXISTS "names"        jsonb,
  ADD COLUMN IF NOT EXISTS "wikidata_id"  text,
  ADD COLUMN IF NOT EXISTS "importance"   smallint,
  ADD COLUMN IF NOT EXISTS "extent_m"     integer,
  ADD COLUMN IF NOT EXISTS "weather_cell" text,
  ADD COLUMN IF NOT EXISTS "route_status" text NOT NULL DEFAULT 'unrouted',
  ADD COLUMN IF NOT EXISTS "retired_at"   timestamptz,
  ADD COLUMN IF NOT EXISTS "updated_at"   timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "destinations" ADD CONSTRAINT "destinations_route_status_chk"
    CHECK ("route_status" IN ('unrouted', 'routed', 'no_route', 'not_applicable'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "destinations" ADD CONSTRAINT "destinations_slf_region_fk"
    FOREIGN KEY ("slf_region_id") REFERENCES "avalanche_regions"("id") ON DELETE SET NULL NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "destinations_geom_idx" ON "destinations" USING gist ("geom");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "destinations_type_kind_idx" ON "destinations" ("type", "poi_kind") WHERE "retired_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "destinations_weather_cell_idx" ON "destinations" ("weather_cell");
--> statement-breakpoint

-- Eindeutige Quellenreferenzen: ein Ziel kann aus mehreren Quellen stammen
-- (swissNAMES3D + OSM), jede Referenz zeigt auf genau ein Ziel.
CREATE TABLE IF NOT EXISTS "destination_sources" (
  "source"         text NOT NULL,
  "source_ref"     text NOT NULL,
  "destination_id" uuid NOT NULL REFERENCES "destinations"("id") ON DELETE CASCADE,
  "last_seen_at"   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("source", "source_ref")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "destination_sources_dest_idx" ON "destination_sources" ("destination_id");
--> statement-breakpoint
-- Altdaten: OSM-IDs aus source_ref übernehmen (ältestes Ziel gewinnt bei Doppelten).
INSERT INTO "destination_sources" ("source", "source_ref", "destination_id")
SELECT DISTINCT ON (d."source_ref"->>'osmId') 'osm', d."source_ref"->>'osmId', d."id"
FROM "destinations" d
WHERE d."source_ref" ? 'osmId'
ORDER BY d."source_ref"->>'osmId', d."created_at"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ── Ausgangspunkte (Parkplätze, Strassenzugänge, Talstationen) ────────────────
CREATE TABLE IF NOT EXISTS "trailheads" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind"        text NOT NULL CHECK ("kind" IN ('parking', 'road_access', 'valley_station')),
  "ref"         text NOT NULL UNIQUE,
  "name"        text,
  "lat"         numeric(9, 6) NOT NULL,
  "lng"         numeric(9, 6) NOT NULL,
  "geom"        geometry(Point, 4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint("lng"::float8, "lat"::float8), 4326)) STORED,
  -- Punkt auf dem Strassennetz, zu dem die Autofahrzeit gerechnet wird.
  "drive_lat"   numeric(9, 6),
  "drive_lng"   numeric(9, 6),
  "road_snap_m" real,
  "elevation_m" integer,
  -- 3 = öffentlicher Parkplatz, 2 = Parkplatz ohne Zugangsangabe, 1 = Strassenzugang ohne bestätigten Parkplatz
  "quality"     smallint NOT NULL CHECK ("quality" BETWEEN 1 AND 3),
  "tags"        jsonb,
  "source"      text NOT NULL DEFAULT 'osm',
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trailheads_geom_idx" ON "trailheads" USING gist ("geom");
--> statement-breakpoint

-- ── Wanderrouten Ausgangspunkt → Ziel (berechnet, mehrere Varianten je Ziel) ──
CREATE TABLE IF NOT EXISTS "hike_routes" (
  "id"                bigserial PRIMARY KEY,
  "destination_id"    uuid NOT NULL REFERENCES "destinations"("id") ON DELETE CASCADE,
  "trailhead_id"      uuid NOT NULL REFERENCES "trailheads"("id") ON DELETE CASCADE,
  "rank"              smallint NOT NULL,
  "distance_m"        integer NOT NULL,
  "ascent_m"          integer NOT NULL,
  "descent_m"         integer NOT NULL,
  "duration_up_min"   integer NOT NULL,
  "duration_down_min" integer NOT NULL,
  "min_elev_m"        integer,
  "max_elev_m"        integer,
  -- NULL = Schwierigkeit unbekannt. Bereich, weil die amtliche Signalisation nur
  -- drei Klassen kennt (gelb = T1, weiss-rot-weiss = T2–T3, weiss-blau-weiss = T4–T6).
  "sac_min"           "sac_difficulty",
  "sac_max"           "sac_difficulty",
  "sac_known_share"   real NOT NULL DEFAULT 0,
  "official_share"    real NOT NULL DEFAULT 0,
  "end_gap_m"         integer NOT NULL DEFAULT 0,
  "geom"              geometry(LineString, 4326) NOT NULL,
  "source"            text NOT NULL,
  "computed_at"       timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("destination_id", "rank")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hike_routes_trailhead_idx" ON "hike_routes" ("trailhead_id");
--> statement-breakpoint

-- ── Skigebiete: Zufahrt und Anlagen ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ski_resort_details" (
  "destination_id"   uuid PRIMARY KEY REFERENCES "destinations"("id") ON DELETE CASCADE,
  "trailhead_id"     uuid REFERENCES "trailheads"("id") ON DELETE SET NULL,
  "lifts_total"      integer NOT NULL DEFAULT 0,
  "lifts_by_type"    jsonb NOT NULL DEFAULT '{}'::jsonb,
  "piste_km"         real,
  "piste_km_by_difficulty" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Punkte für die Schneeabfrage: tiefste und höchste Station.
  "base_lat"         numeric(9, 6),
  "base_lng"         numeric(9, 6),
  "top_lat"          numeric(9, 6),
  "top_lng"          numeric(9, 6),
  "grouping"         text NOT NULL,
  "updated_at"       timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ski_lifts" (
  "id"             bigserial PRIMARY KEY,
  "destination_id" uuid NOT NULL REFERENCES "destinations"("id") ON DELETE CASCADE,
  "ref"            text NOT NULL UNIQUE,
  "name"           text,
  "lift_type"      text NOT NULL,
  "length_m"       integer,
  "bottom_lat"     numeric(9, 6),
  "bottom_lng"     numeric(9, 6),
  "bottom_elev_m"  integer,
  "top_lat"        numeric(9, 6),
  "top_lng"        numeric(9, 6),
  "top_elev_m"     integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ski_lifts_dest_idx" ON "ski_lifts" ("destination_id");
--> statement-breakpoint

-- ── Wetterraster ──────────────────────────────────────────────────────────────
-- Ein Datensatz je Rasterzelle (0,1°), wird überschrieben statt angehängt. Ersetzt
-- die frühere Punktabfrage je Ziel, die das Open-Meteo-Kontingent sprengte.
CREATE TABLE IF NOT EXISTS "weather_cells" (
  "cell"           text PRIMARY KEY,
  "lat"            real NOT NULL,
  "lng"            real NOT NULL,
  "model_elev_m"   integer,
  "captured_at"    timestamptz NOT NULL DEFAULT now(),
  "temperature_c"  real,
  "weather_code"   integer,
  "visibility_m"   integer,
  "wind_kmh"       real,
  "snow_depth_cm"  integer,
  "fresh_snow_cm"  real
);
--> statement-breakpoint

-- live_status bleibt als Verlauf für Skigebiete; Herkunft und Stand je Zeile.
ALTER TABLE "live_status"
  ADD COLUMN IF NOT EXISTS "lift_source" text,
  ADD COLUMN IF NOT EXISTS "avalanche_valid_until" timestamptz;
