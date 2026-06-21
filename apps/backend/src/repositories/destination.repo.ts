import type {
  Destination,
  DestinationDetail,
  LiveStatus,
  SearchInput,
  TrendScore,
} from '@ch-alpineroute/shared';
import { queryClient as sql } from '../db';
import { toIso, toIsoOrNull } from '../lib/dates';

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
  poi_kind: string | null;
  quality_score: number | null;
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
    poiKind: r.poi_kind,
    qualityScore: r.quality_score,
  };
}

function rowToLive(r: CandidateRow): LiveStatus | null {
  if (!r.captured_at) return null;
  return {
    capturedAt: toIso(r.captured_at),
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
    updatedAt: toIsoOrNull(r.trend_updated_at),
  };
}

// Gemeinsame Spaltenliste (destination + neuester live-Snapshot + trend).
const CANDIDATE_COLUMNS = sql`
  d.id, d.name, d.type, d.canton,
  d.lat::float8 AS lat,
  d.lng::float8 AS lng,
  d.elevation_base_m, d.elevation_top_m, d.sac_difficulty, d.ascent_m, d.distance_km,
  d.wikipedia_title, d.slf_region_id, d.poi_kind, d.quality_score,
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
 * Obergrenze der Kandidaten (mit Live-/Trend-Daten) für Liste UND Karte. Hoch
 * genug, dass praktisch ALLE im Fahrzeit-Budget erreichbaren Ziele zurückkommen
 * – sonst entsteht durch den nächste-N-Cutoff ein künstlicher Ring am Kreisrand
 * statt echter, schweizweiter Streuung. Der Live-Join läuft ohnehin über alle
 * erreichbaren Zeilen; das LIMIT begrenzt nur die Ausgabe. Liste ist virtualisiert.
 */
const CANDIDATE_LIMIT = 8000;

/**
 * Schritt 1 der Suche: PostGIS-Grobfilter per ST_DWithin, ein einziger Query
 * (kein N+1) mit neuestem Live-Snapshot via LATERAL und Trend.
 * Sortiert nach Luftlinie, LIMIT {@link CANDIDATE_LIMIT}.
 */
const POI_KINDS = ['peak', 'lake', 'hut', 'viewpoint'] as const;

/** Typ- und SAC-Filter (für Kandidaten- und Kartenpunkt-Query identisch). */
function buildFilters(input: SearchInput) {
  const kind = input.hikeKind;
  const typeCond =
    input.mode === 'ski'
      ? sql`d.type = 'ski_resort'`
      : kind === 'route'
        ? sql`d.type = 'hike_route'`
        : kind && (POI_KINDS as readonly string[]).includes(kind)
          ? // Nach Zielart filtern (Gipfel/Bergsee/Hütte/Aussicht) – sonst kämen
            // bei der nächstgelegenen-N-Auswahl fast nur Gipfel zurück.
            sql`d.type = 'hike_destination' AND d.poi_kind = ${kind}`
          : sql`d.type IN ('hike_route', 'hike_destination')`;

  const sacCond = input.maxSacDifficulty
    ? sql`AND (d.sac_difficulty IS NULL OR d.sac_difficulty <= ${input.maxSacDifficulty}::sac_difficulty)`
    : sql``;

  return { typeCond, sacCond };
}

/** Luftlinie in km (Haversine) – günstig in JS statt teurer PostGIS-Geography. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

export async function findCandidates(input: SearchInput, radiusM: number): Promise<Candidate[]> {
  const { lat, lng } = input.origin;
  const { typeCond, sacCond } = buildFilters(input);

  // Bounding-Box-Vorfilter auf lat/lng + planarer Abstand zum Sortieren – um
  // Größenordnungen schneller als ST_DWithin/ST_Distance auf einer berechneten
  // Geography (kein Index). Die echte Fahrzeit-Filterung passiert ohnehin später.
  const latDelta = radiusM / 111_000;
  const lngDelta = radiusM / 75_000;

  const rows = await sql<CandidateRow[]>`
    SELECT ${CANDIDATE_COLUMNS}
    FROM destinations d
    ${LATEST_LIVE_JOIN}
    WHERE d.lat BETWEEN ${lat - latDelta} AND ${lat + latDelta}
      AND d.lng BETWEEN ${lng - lngDelta} AND ${lng + lngDelta}
      AND ${typeCond}
      ${sacCond}
    ORDER BY (d.lat - ${lat}) * (d.lat - ${lat}) + (d.lng - ${lng}) * (d.lng - ${lng}) * 0.46 ASC
    LIMIT ${CANDIDATE_LIMIT}
  `;

  return rows.map((r) => ({
    destination: rowToDestination(r),
    airKm: haversineKm(lat, lng, r.lat, r.lng),
    live: rowToLive(r),
    trend: rowToTrend(r),
  }));
}

/** Detailansicht inkl. Live-Historie für Charts. */
export async function getDestinationDetail(id: string): Promise<DestinationDetail | null> {
  const rows = await sql<CandidateRow[]>`
    SELECT ${CANDIDATE_COLUMNS}
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
      capturedAt: toIso(h.captured_at as string),
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
