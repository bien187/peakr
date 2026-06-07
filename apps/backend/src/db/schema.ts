import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, geographyLineString, geographyMultiPolygon, geographyPoint } from './types';

// --- Enums -----------------------------------------------------------------
export const destinationTypeEnum = pgEnum('destination_type', [
  'ski_resort',
  'hike_route',
  'hike_destination',
]);
export const sacDifficultyEnum = pgEnum('sac_difficulty', ['T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);

// --- users -----------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  homeLocation: geographyPoint('home_location'),
  homeLabel: text('home_label'),
  openaiKeyEnc: bytea('openai_key_enc'),
  openaiKeyIv: bytea('openai_key_iv'),
  role: userRoleEnum('role').notNull().default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- avalanche_regions (SLF-Warnregionen) ----------------------------------
export const avalancheRegions = pgTable(
  'avalanche_regions',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    geom: geographyMultiPolygon('geom').notNull(),
  },
  (t) => ({
    geomIdx: index('avalanche_regions_geom_idx').using('gist', t.geom),
  }),
);

// --- destinations ----------------------------------------------------------
export const destinations = pgTable(
  'destinations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    type: destinationTypeEnum('type').notNull(),
    canton: text('canton'),
    location: geographyPoint('location').notNull(),
    elevationBaseM: integer('elevation_base_m'),
    elevationTopM: integer('elevation_top_m'),
    sacDifficulty: sacDifficultyEnum('sac_difficulty'),
    ascentM: integer('ascent_m'),
    distanceKm: real('distance_km'),
    routeGeom: geographyLineString('route_geom'),
    slfRegionId: text('slf_region_id').references(() => avalancheRegions.id),
    wikipediaTitle: text('wikipedia_title'),
    sourceRef: jsonb('source_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    locationIdx: index('destinations_location_idx').using('gist', t.location),
    typeIdx: index('destinations_type_idx').on(t.type),
  }),
);

// --- live_status (append-only Snapshots) -----------------------------------
export const liveStatus = pgTable(
  'live_status',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    destinationId: uuid('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    temperatureC: real('temperature_c'),
    weatherCode: integer('weather_code'),
    visibilityM: integer('visibility_m'),
    windKmh: real('wind_kmh'),
    snowDepthValleyCm: integer('snow_depth_valley_cm'),
    snowDepthTopCm: integer('snow_depth_top_cm'),
    freshSnowCm: real('fresh_snow_cm'),
    avalancheLevel: smallint('avalanche_level'),
    liftsOpen: integer('lifts_open'),
    liftsTotal: integer('lifts_total'),
    slopesOpenKm: real('slopes_open_km'),
    trailStatus: text('trail_status'),
    rawPayload: jsonb('raw_payload'),
  },
  (t) => ({
    destCapturedIdx: index('live_status_dest_captured_idx').on(
      t.destinationId,
      t.capturedAt.desc(),
    ),
    avalancheChk: check(
      'live_status_avalanche_chk',
      sql`${t.avalancheLevel} IS NULL OR (${t.avalancheLevel} BETWEEN 1 AND 5)`,
    ),
  }),
);

// --- trend_scores ----------------------------------------------------------
export const trendScores = pgTable(
  'trend_scores',
  {
    destinationId: uuid('destination_id')
      .primaryKey()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    score: smallint('score').notNull(),
    rationale: text('rationale'),
    source: text('source'),
    isEstimate: boolean('is_estimate').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scoreChk: check('trend_scores_score_chk', sql`${t.score} BETWEEN 1 AND 100`),
  }),
);

// --- favorites -------------------------------------------------------------
export const favorites = pgTable(
  'favorites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    destinationId: uuid('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.destinationId] }),
  }),
);

// --- inferred row types ----------------------------------------------------
export type UserRow = typeof users.$inferSelect;
export type DestinationRow = typeof destinations.$inferSelect;
export type AvalancheRegionRow = typeof avalancheRegions.$inferSelect;
export type LiveStatusRow = typeof liveStatus.$inferSelect;
export type TrendScoreRow = typeof trendScores.$inferSelect;
export type FavoriteRow = typeof favorites.$inferSelect;
