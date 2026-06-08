import type {
  Destination,
  DestinationDetail,
  LiveStatus,
  SearchInput,
  TrendScore,
} from '@ch-alpineroute/shared';
import { queryClient as sql } from '../db';

/** Roh-Zeile aus dem Kandidaten-Query (destination + neuester live + trend). */
interface CandidateRow {
  id: string;
  name: string;
  type: Destination['type'];
  canton: string | null;
  lat: number;
  lng: number;
  elevation_base_m: number | null;
  elevation_top_m: number | null;
  sac_difficulty: Destination['sacDifficulty'];
  ascent_m: number | null;
  distance_km: number | null;
  wikipedia_title: string | null;
  slf_region_id: string | null;
  air_m: number;
  captured_at: Date | null;
  temperature_c: number | null;
  weather_code: number | null;
  visibility_m: number | null;
  wind_kmh: number | null;
  snow_depth_valley_cm: number | null;
  snow_depth_top_cm: number | null;
  fresh_snow_cm: number | null;
  avalanche_level: number | null;
  lifts_open: number | null;
  lifts_total: number | null;
  slopes_open_km: number | null;
  trail_status: string | null;
  trend_score: number | null;
  trend_rationale: string | null;
  trend_source: string | null;
  trend_is_estimate: boolean | null;
  trend_updated_at: Date | null;
}

export interface Candidate {
  destination: Destination;
  airKm: number;
  live: LiveStatus | null;
  trend: TrendScore | null;
}

function rowToDestination(r: CandidateRow): Destination {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    canton: r.canton,
    location: { lat: r.lat, lng: r.lng },
    elevationBaseM: r.elevation_base_m,
    elevationTopM: r.elevation_top_m,
    sacDifficulty: r.sac_difficulty,
    ascentM: r.ascent_m,
    distanceKm: r.distance_km,
    wikipediaTitle: r.wikipedia_title,
    slfRegionId: r.slf_region_id,
  };
}

function rowToLive(r: CandidateRow): LiveStatus | null {
  if (!r.captured_at) return null;
  return {
    capturedAt: r.captured_at.toISOString(),
    temperatureC: r.temperature_c,
    weatherCode: r.weather_code,
    visibilityM: r.visibility_m,
    windKmh: r.wind_kmh,
    snowDepthValleyCm: r.snow_depth_valley_cm,
    snowDepthTopCm: r.snow_depth_top_cm,
    freshSnowCm: r.fresh_snow_cm,
    avalancheLevel: r.avalanche_level,
    liftsOpen: r.lifts_open,
    liftsTotal: r.lifts_total,
    slopesOpenKm: r.slopes_open_km,
    trailStatus: r.trail_status,
  };
}

function rowToTrend(r: CandidateRow): TrendScore | null {
  if (r.trend_score == null) return null;
  return {
    score: r.trend_score,
    rationale: r.trend_rationale,
    source: r.trend_source,
    isEstimate: r.trend_is_estimate ?? true,
    updatedAt: r.trend_updated_at ? r.trend_updated_at.toISOString() : null,
  };
}

// Gemeinsame Spaltenliste (destination + neuester live-Snapshot + trend).
const CANDIDATE_COLUMNS = sql`
  d.id, d.name, d.type, d.canton,
  ST_Y(d.location::geometry) AS lat,
  ST_X(d.location::geometry) AS lng,
  d.elevation_base_m, d.elevation_top_m, d.sac_difficulty, d.ascent_m, d.distance_km,
  d.wikipedia_title, d.slf_region_id,
  ls.captured_at, ls.temperature_c, ls.weather_code, ls.visibility_m, ls.wind_kmh,
  ls.snow_depth_valley_cm, ls.snow_depth_top_cm, ls.fresh_snow_cm, ls.avalanche_level,
  ls.lifts_open, ls.lifts_total, ls.slopes_open_km, ls.trail_status,
  ts.score AS trend_score, ts.rationale AS trend_rationale, ts.source AS trend_source,
  ts.is_estimate AS trend_is_estimate, ts.updated_at AS trend_updated_at
`;

const LATEST_LIVE_JOIN = sql`
  LEFT JOIN LATERAL (
    SELECT * FROM live_status l WHERE l.destination_id = d.id ORDER BY l.captured_at DESC LIMIT 1
  ) ls ON true
  LEFT JOIN trend_scores ts ON ts.destination_id = d.id
`;

/**
 * Schritt 1 der Suche: PostGIS-Grobfilter per ST_DWithin, ein einziger Query
 * (kein N+1) mit neuestem Live-Snapshot via DISTINCT-ON/LATERAL und Trend.
 * Sortiert nach Luftlinie, LIMIT 60.
 */
export async function findCandidates(input: SearchInput, radiusM: number): Promise<Candidate[]> {
  const { lat, lng } = input.origin;

  const typeCond =
    input.mode === 'ski'
      ? sql`d.type = 'ski_resort'`
      : input.hikeKind === 'route'
        ? sql`d.type = 'hike_route'`
        : input.hikeKind && input.hikeKind !== 'any'
          ? sql`d.type = 'hike_destination'`
          : sql`d.type IN ('hike_route', 'hike_destination')`;

  const sacCond = input.maxSacDifficulty
    ? sql`AND (d.sac_difficulty IS NULL OR d.sac_difficulty <= ${input.maxSacDifficulty}::sac_difficulty)`
    : sql``;

  const rows = await sql<CandidateRow[]>`
    SELECT ${CANDIDATE_COLUMNS},
      ST_Distance(d.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS air_m
    FROM destinations d
    ${LATEST_LIVE_JOIN}
    WHERE ST_DWithin(
            d.location,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
            ${radiusM}
          )
      AND ${typeCond}
      ${sacCond}
    ORDER BY air_m ASC
    LIMIT 60
  `;

  return rows.map((r) => ({
    destination: rowToDestination(r),
    airKm: Math.round((r.air_m / 1000) * 10) / 10,
    live: rowToLive(r),
    trend: rowToTrend(r),
  }));
}

/** Detailansicht inkl. Live-Historie für Charts. */
export async function getDestinationDetail(id: string): Promise<DestinationDetail | null> {
  const rows = await sql<CandidateRow[]>`
    SELECT ${CANDIDATE_COLUMNS}, 0::float8 AS air_m
    FROM destinations d
    ${LATEST_LIVE_JOIN}
    WHERE d.id = ${id}
    LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;

  const history = await sql<Record<string, unknown>[]>`
    SELECT captured_at, temperature_c, weather_code, visibility_m, wind_kmh,
           snow_depth_valley_cm, snow_depth_top_cm, fresh_snow_cm, avalanche_level,
           lifts_open, lifts_total, slopes_open_km, trail_status
    FROM live_status
    WHERE destination_id = ${id}
    ORDER BY captured_at DESC
    LIMIT 60
  `;

  return {
    ...rowToDestination(r),
    live: rowToLive(r),
    trend: rowToTrend(r),
    history: history.map((h) => ({
      capturedAt: (h.captured_at as Date).toISOString(),
      temperatureC: h.temperature_c as number | null,
      weatherCode: h.weather_code as number | null,
      visibilityM: h.visibility_m as number | null,
      windKmh: h.wind_kmh as number | null,
      snowDepthValleyCm: h.snow_depth_valley_cm as number | null,
      snowDepthTopCm: h.snow_depth_top_cm as number | null,
      freshSnowCm: h.fresh_snow_cm as number | null,
      avalancheLevel: h.avalanche_level as number | null,
      liftsOpen: h.lifts_open as number | null,
      liftsTotal: h.lifts_total as number | null,
      slopesOpenKm: h.slopes_open_km as number | null,
      trailStatus: h.trail_status as string | null,
    })),
  };
}
