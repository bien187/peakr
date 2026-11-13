-- Grundlagen der Verfügbarkeitsprüfung: Wegsperrungen, Schneemessungen und
-- stündliche Prognosen. Alles wird von den Workern laufend ersetzt; nichts davon
-- ist Stammdatum.

-- Sperrungen und Umleitungen auf Wanderwegen (geo.admin.ch, Ebene
-- ch.astra.wanderland-sperrungen_umleitungen; ASTRA, Schweizer Wanderwege, Kantone).
CREATE TABLE IF NOT EXISTS "trail_closures" (
  "id"          text PRIMARY KEY,
  -- 'closed_way' = gesperrter Abschnitt, 'detour' = signalisierte Umleitung
  "kind"        text NOT NULL,
  "title"       text,
  "reason"      text,
  "duration"    text,
  "description" text,
  "url"         text,
  "provider"    text,
  "validated"   boolean NOT NULL DEFAULT false,
  "geom"        geometry(Geometry, 4326) NOT NULL,
  "fetched_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trail_closures_geom_idx" ON "trail_closures" USING gist ("geom");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hike_routes_geom_idx" ON "hike_routes" USING gist ("geom");
--> statement-breakpoint

-- Routen, die einen gesperrten Abschnitt nutzen. Neu berechnet nach jedem Abruf
-- der Sperrungen und nach jedem Neuaufbau der Routen.
CREATE TABLE IF NOT EXISTS "route_closures" (
  "route_id"   bigint NOT NULL REFERENCES "hike_routes"("id") ON DELETE CASCADE,
  "closure_id" text NOT NULL REFERENCES "trail_closures"("id") ON DELETE CASCADE,
  "overlap_m"  integer NOT NULL,
  "has_detour" boolean NOT NULL DEFAULT false,
  PRIMARY KEY ("route_id", "closure_id")
);
--> statement-breakpoint

-- Schneehöhen an Messstationen (SLF IMIS, MeteoSchweiz). Eine Zeile je Station,
-- jeweils der letzte Messwert.
CREATE TABLE IF NOT EXISTS "snow_observations" (
  "station_id"  text PRIMARY KEY,
  "source"      text NOT NULL,
  "name"        text NOT NULL,
  "lat"         double precision NOT NULL,
  "lng"         double precision NOT NULL,
  "elevation_m" integer NOT NULL,
  "snow_cm"     real,
  "new_snow_cm" real,
  "measured_at" timestamptz NOT NULL,
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Stündliche Prognose je Wetterzelle (Open-Meteo): Arrays ab "start" (UTC).
ALTER TABLE "weather_cells"
  ADD COLUMN IF NOT EXISTS "forecast" jsonb,
  ADD COLUMN IF NOT EXISTS "forecast_at" timestamptz;
