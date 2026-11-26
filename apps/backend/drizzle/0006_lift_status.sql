-- Betriebsstatus von Liften und Pisten aus Statusberichten (Quelle: LiftRadar).
--
-- Eine Zeile je Gebiet der Quelle. Mehrere Quellgebiete können zu einem
-- Peakr-Skigebiet gehören (z. B. Verbier, Nendaz, Thyon … → 4 Vallées); die
-- Zuordnung steht versioniert im Code (apps/backend/src/lifts/mapping.ts).
-- Zählerwerte sind NULL, wenn die Quelle sie nicht liefert – nie geschätzt.

CREATE TABLE IF NOT EXISTS "ski_resort_status" (
  "source"             text NOT NULL,
  "source_resort_id"   text NOT NULL,
  "destination_id"     uuid NOT NULL REFERENCES "destinations"("id") ON DELETE CASCADE,
  "source_name"        text NOT NULL,
  -- Wie die Zuordnung entstand und ob sie von Hand geprüft ist.
  "match_method"       text NOT NULL,
  "match_verified"     boolean NOT NULL DEFAULT false,
  -- 'open' | 'closed' | 'no_report' (kein aktueller Bericht) | 'unknown'
  "resort_status"      text NOT NULL CHECK ("resort_status" IN ('open', 'closed', 'no_report', 'unknown')),
  "lifts_open"         integer,
  "lifts_closed"       integer,
  "lifts_preparation"  integer,
  "lifts_unknown"      integer,
  "lifts_total"        integer,
  "slopes_open"        integer,
  "slopes_closed"      integer,
  "slopes_preparation" integer,
  "slopes_unknown"     integer,
  "slopes_total"       integer,
  "slopes_open_km"     real,
  "slopes_total_km"    real,
  "lifts_by_type"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "slopes_by_difficulty" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Schneehöhen laut Bericht des Gebiets (nicht die Modellwerte von Open-Meteo).
  "snow_valley_cm"     integer,
  "snow_mountain_cm"   integer,
  "fresh_snow_cm"      integer,
  -- Drei verschiedene Zeitpunkte, nie gegenseitig ersetzt:
  --   report_at   Bericht des Gebiets selbst (NULL, wenn die Quelle keinen nennt)
  --   checked_at  wann die Quelle den Bericht gelesen hat
  --   values_from Werte stammen aus einem älteren Lauf der Quelle (sonst NULL)
  --   fetched_at  wann Peakr die Daten zuletzt erfolgreich abgeglichen hat
  "report_at"          timestamptz,
  "checked_at"         timestamptz,
  "values_from"        timestamptz,
  "fetched_at"         timestamptz NOT NULL,
  "changed_at"         timestamptz NOT NULL,
  "website_url"        text,
  "source_url"         text NOT NULL,
  -- Originalquellen laut Quelle: [{ "url": …, "attributionRequired": true|false|null }]
  "source_links"       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- ETag der Gebietsdatei (If-None-Match) und Prüfsumme des Inhalts ohne Zeitstempel.
  "etag"               text,
  "content_hash"       text,
  "updated_at"         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("source", "source_resort_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ski_resort_status_dest_idx" ON "ski_resort_status" ("destination_id");
--> statement-breakpoint

-- Einzelne Lifte und Pisten, wie die Quelle sie auflistet. Werden je Gebiet nur
-- zusammen mit einem vollständig gelesenen Bericht ersetzt.
CREATE TABLE IF NOT EXISTS "ski_resort_status_items" (
  "source"           text NOT NULL,
  "source_resort_id" text NOT NULL,
  "kind"             text NOT NULL CHECK ("kind" IN ('lift', 'slope')),
  "item_id"          text NOT NULL,
  "position"         integer NOT NULL,
  "ref"              text,
  "name"             text NOT NULL,
  -- Lift: gondola, chairlift … · Piste: easy, intermediate, difficult, ski_route, other
  "item_type"        text,
  -- Piste: Farbe laut Quelle (blue, red, black, yellow …)
  "colour"           text,
  "status"           text NOT NULL CHECK ("status" IN ('open', 'closed', 'preparation', 'unknown')),
  "status_raw"       text,
  "length_m"         integer,
  PRIMARY KEY ("source", "source_resort_id", "kind", "item_id"),
  FOREIGN KEY ("source", "source_resort_id") REFERENCES "ski_resort_status"("source", "source_resort_id") ON DELETE CASCADE
);
