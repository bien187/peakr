CREATE TYPE "public"."destination_type" AS ENUM('ski_resort', 'hike_route', 'hike_destination');
CREATE TYPE "public"."sac_difficulty" AS ENUM('T1', 'T2', 'T3', 'T4', 'T5', 'T6');
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');

CREATE TABLE "destinations" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name"             text NOT NULL,
  "type"             "destination_type" NOT NULL,
  "canton"           text,
  "lat"              DECIMAL(9,6) NOT NULL,
  "lng"              DECIMAL(9,6) NOT NULL,
  "elevation_base_m" integer,
  "elevation_top_m"  integer,
  "sac_difficulty"   "sac_difficulty",
  "ascent_m"         integer,
  "distance_km"      real,
  "slf_region_id"    text,
  "wikipedia_title"  text,
  "source_ref"       jsonb,
  "created_at"       timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "favorites" (
  "user_id"         uuid NOT NULL,
  "destination_id"  uuid NOT NULL,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "favorites_user_id_destination_id_pk" PRIMARY KEY("user_id","destination_id")
);

CREATE TABLE "live_status" (
  "id"                    bigserial PRIMARY KEY NOT NULL,
  "destination_id"        uuid NOT NULL,
  "captured_at"           timestamp with time zone DEFAULT now() NOT NULL,
  "temperature_c"         real,
  "weather_code"          integer,
  "visibility_m"          integer,
  "wind_kmh"              real,
  "snow_depth_valley_cm"  integer,
  "snow_depth_top_cm"     integer,
  "fresh_snow_cm"         real,
  "avalanche_level"       smallint,
  "lifts_open"            integer,
  "lifts_total"           integer,
  "slopes_open_km"        real,
  "trail_status"          text,
  "raw_payload"           jsonb,
  CONSTRAINT "live_status_avalanche_chk" CHECK ("live_status"."avalanche_level" IS NULL OR ("live_status"."avalanche_level" BETWEEN 1 AND 5))
);

CREATE TABLE "trend_scores" (
  "destination_id" uuid PRIMARY KEY NOT NULL,
  "score"          smallint NOT NULL,
  "rationale"      text,
  "source"         text,
  "is_estimate"    boolean DEFAULT true NOT NULL,
  "updated_at"     timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "trend_scores_score_chk" CHECK ("trend_scores"."score" BETWEEN 1 AND 100)
);

CREATE TABLE "users" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email"           text NOT NULL,
  "password_hash"   text NOT NULL,
  "display_name"    text,
  "home_lat"        DECIMAL(9,6),
  "home_lng"        DECIMAL(9,6),
  "home_label"      text,
  "openai_key_enc"  bytea,
  "openai_key_iv"   bytea,
  "role"            "user_role" DEFAULT 'user' NOT NULL,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"      timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email")
);

ALTER TABLE "favorites"   ADD CONSTRAINT "favorites_user_id_users_id_fk"             FOREIGN KEY ("user_id")         REFERENCES "public"."users"("id")        ON DELETE cascade;
ALTER TABLE "favorites"   ADD CONSTRAINT "favorites_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE cascade;
ALTER TABLE "live_status" ADD CONSTRAINT "live_status_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE cascade;
ALTER TABLE "trend_scores" ADD CONSTRAINT "trend_scores_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE cascade;

CREATE INDEX "destinations_lat_lng_idx"        ON "destinations" ("lat", "lng");
CREATE INDEX "destinations_type_idx"           ON "destinations" ("type");
CREATE INDEX "live_status_dest_captured_idx"   ON "live_status"  ("destination_id", "captured_at" DESC NULLS LAST);
