import type {
  DataSourceInfo,
  DestinationDetail,
  DestinationWithStatus,
  HikeRouteDetail,
  LiveStatus,
  RouteWaypoint,
  SacDifficulty,
  Trailhead,
} from '@ch-alpineroute/shared';
import { queryClient as sql } from '../db';
import { toIso, toIsoOrNull } from '../lib/dates';
import { hikeLive } from '../services/search.service';
import { getAvalancheLevels, getWeatherCells } from './search.repo';

interface DestRow {
  id: string;
  name: string;
  type: DestinationDetail['type'];
  canton: string | null;
  lat: number;
  lng: number;
  elevation_base_m: number | null;
  elevation_top_m: number | null;
  sac_difficulty: SacDifficulty | null;
  ascent_m: number | null;
  distance_km: number | null;
  wikipedia_title: string | null;
  slf_region_id: string | null;
  poi_kind: string | null;
  object_class: string | null;
  quality_score: number | null;
  route_status: string;
  source_layer: string | null;
  weather_cell: string | null;
  names: Record<string, unknown> | null;
  updated_at: Date | string | null;
  trend_score: number | null;
  trend_rationale: string | null;
  trend_source: string | null;
  trend_is_estimate: boolean | null;
  trend_updated_at: Date | string | null;
}

const DEST_COLUMNS = sql`
  d.id, d.name, d.type, d.canton, d.lat::float8 AS lat, d.lng::float8 AS lng,
  d.elevation_base_m, d.elevation_top_m, d.sac_difficulty, d.ascent_m, d.distance_km,
  d.wikipedia_title, d.slf_region_id, d.poi_kind, d.object_class, d.quality_score, d.route_status,
  d.source_layer, d.weather_cell, d.names, d.updated_at,
  ts.score AS trend_score, ts.rationale AS trend_rationale, ts.source AS trend_source,
  ts.is_estimate AS trend_is_estimate, ts.updated_at AS trend_updated_at
`;

function base(r: DestRow): DestinationWithStatus {
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
    objectClass: r.object_class,
    qualityScore: r.quality_score,
    routeStatus: r.route_status,
    sourceLayer: r.source_layer,
    live: null,
    trend:
      r.trend_score == null
        ? null
        : {
            score: r.trend_score,
            rationale: r.trend_rationale,
            source: r.trend_source,
            isEstimate: r.trend_is_estimate ?? true,
            updatedAt: toIsoOrNull(r.trend_updated_at),
          },
  };
}

interface LiveRow {
  captured_at: Date | string;
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
  lift_source: string | null;
}

function liveFromRow(h: LiveRow, liftsTotal: number | null): LiveStatus {
  return {
    capturedAt: toIso(h.captured_at),
    temperatureC: h.temperature_c,
    weatherCode: h.weather_code,
    visibilityM: h.visibility_m,
    windKmh: h.wind_kmh,
    snowDepthValleyCm: h.snow_depth_valley_cm,
    snowDepthTopCm: h.snow_depth_top_cm,
    freshSnowCm: h.fresh_snow_cm,
    avalancheLevel: h.avalanche_level,
    liftsOpen: h.lifts_open,
    liftsTotal: liftsTotal ?? h.lifts_total,
    slopesOpenKm: h.slopes_open_km,
    trailStatus: h.trail_status,
    liftSource: h.lift_source,
  };
}

/** Aktuelle Bedingungen: Skigebiete aus live_status, Wanderziele aus dem Wetterraster. */
async function attachLive(rows: DestRow[]): Promise<Map<string, LiveStatus | null>> {
  const out = new Map<string, LiveStatus | null>();
  const skiIds = rows.filter((r) => r.type === 'ski_resort').map((r) => r.id);
  const [weather, avalanche] = await Promise.all([getWeatherCells(), getAvalancheLevels()]);
  if (skiIds.length > 0) {
    const live = await sql<(LiveRow & { destination_id: string; resort_lifts: number | null })[]>`
      SELECT DISTINCT ON (l.destination_id) l.destination_id, l.captured_at, l.temperature_c, l.weather_code,
             l.visibility_m, l.wind_kmh, l.snow_depth_valley_cm, l.snow_depth_top_cm, l.fresh_snow_cm, l.avalanche_level,
             l.lifts_open, l.lifts_total, l.slopes_open_km, l.trail_status, l.lift_source, s.lifts_total AS resort_lifts
      FROM live_status l
      LEFT JOIN ski_resort_details s ON s.destination_id = l.destination_id
      WHERE l.destination_id = ANY(${skiIds})
      ORDER BY l.destination_id, l.captured_at DESC
    `;
    for (const l of live) out.set(l.destination_id, liveFromRow(l, l.resort_lifts));
  }
  for (const r of rows) {
    if (r.type === 'ski_resort') {
      if (!out.has(r.id)) out.set(r.id, null);
      continue;
    }
    const level = r.slf_region_id ? (avalanche.get(r.slf_region_id)?.level ?? null) : null;
    out.set(r.id, hikeLive(r.weather_cell ? weather.get(r.weather_cell) : undefined, r.elevation_top_m, level));
  }
  return out;
}

export async function listDestinationsByIds(ids: string[]): Promise<DestinationWithStatus[]> {
  if (ids.length === 0) return [];
  const rows = await sql<DestRow[]>`
    SELECT ${DEST_COLUMNS} FROM destinations d
    LEFT JOIN trend_scores ts ON ts.destination_id = d.id
    WHERE d.id = ANY(${ids})
  `;
  const live = await attachLive(rows);
  const byId = new Map(rows.map((r) => [r.id, { ...base(r), live: live.get(r.id) ?? null }]));
  return ids.map((id) => byId.get(id)).filter((d): d is DestinationWithStatus => d !== undefined);
}

interface RouteRow {
  id: number;
  rank: number;
  distance_m: number;
  ascent_m: number;
  descent_m: number;
  duration_up_min: number;
  duration_down_min: number;
  min_elev_m: number | null;
  max_elev_m: number | null;
  sac_min: SacDifficulty | null;
  sac_max: SacDifficulty | null;
  sac_known_share: number;
  official_share: number;
  end_gap_m: number;
  source: string;
  computed_at: Date | string;
  geojson: string;
  elevations: (number | null)[] | null;
  th_id: string;
  th_kind: Trailhead['kind'];
  th_name: string | null;
  th_lat: number;
  th_lng: number;
  th_elev: number | null;
  th_quality: number;
  road_snap_m: number | null;
  th_fee: string | null;
  th_capacity: string | null;
  drive_lat: number | null;
  drive_lng: number | null;
}

/** Punkt auf dem Strassennetz je Ausgangspunkt (für die Fahrzeit in der Detailansicht). */
export type DrivePoints = Map<string, { lat: number; lng: number }>;

/**
 * Die Spalte hike_routes.elevations (Migration 0003) entsteht erst beim nächsten
 * Datenaufbau. Bis dahin liefert die Detailansicht Routen ohne Höhen statt eines
 * Fehlers. «Fehlt» wird nur 10 Minuten zwischengespeichert.
 */
let elevationsColumn: { exists: boolean; checkedAt: number } | null = null;
async function hasElevationsColumn(): Promise<boolean> {
  if (elevationsColumn && (elevationsColumn.exists || Date.now() - elevationsColumn.checkedAt < 600_000)) {
    return elevationsColumn.exists;
  }
  const rows = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'hike_routes' AND column_name = 'elevations'
  `;
  elevationsColumn = { exists: rows.length > 0, checkedAt: Date.now() };
  return elevationsColumn.exists;
}

/** Höchstabstand eines benannten Ortes vom Weg, damit er als Wegpunkt gilt. */
const WAYPOINT_MAX_OFFSET_M = 50;

/**
 * Benannte Ziele (Hütten, Pässe, Seen, Gipfel …), an denen die Routen eines Ziels
 * höchstens 50 m vorbeiführen – in Gehrichtung, je Route und Name einmal.
 */
async function routeWaypoints(destinationId: string): Promise<Map<number, RouteWaypoint[]>> {
  const rows = await sql<{
    route_id: number | string; name: string; poi_kind: string | null; object_class: string | null; lat: number; lng: number;
    elevation_top_m: number | null; along_m: number;
  }[]>`
    SELECT hr.id AS route_id, d.name, d.poi_kind, d.object_class, d.lat::float8 AS lat, d.lng::float8 AS lng, d.elevation_top_m,
           round(ST_LineLocatePoint(ST_Transform(hr.geom, 2056), ST_Transform(d.geom, 2056)) * hr.distance_m)::int AS along_m
    FROM hike_routes hr
    JOIN destinations d
      ON d.geom && ST_Expand(hr.geom, 0.001)
     AND ST_DWithin(d.geom::geography, hr.geom::geography, ${WAYPOINT_MAX_OFFSET_M})
    WHERE hr.destination_id = ${destinationId}
      AND d.id <> hr.destination_id
      AND d.retired_at IS NULL
      AND d.type <> 'ski_resort'
    ORDER BY hr.id, along_m
  `;
  const out = new Map<number, RouteWaypoint[]>();
  for (const w of rows) {
    const id = Number(w.route_id);
    const list = out.get(id) ?? [];
    if (list.some((x) => x.name === w.name)) continue;
    list.push({
      name: w.name, kind: w.poi_kind, objectClass: w.object_class, location: { lat: w.lat, lng: w.lng },
      elevationM: w.elevation_top_m, alongM: w.along_m,
    });
    out.set(id, list);
  }
  return out;
}

/** Detailansicht inkl. aller Routenvarianten, Zufahrt, Verlauf und Datenquellen. */
export async function getDestinationDetail(
  id: string,
): Promise<{ detail: DestinationDetail; drivePoints: DrivePoints; weatherCell: string | null } | null> {
  const rows = await sql<DestRow[]>`
    SELECT ${DEST_COLUMNS} FROM destinations d
    LEFT JOIN trend_scores ts ON ts.destination_id = d.id
    WHERE d.id = ${id} LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  const isSki = r.type === 'ski_resort';
  const elevations = !isSki && (await hasElevationsColumn()) ? sql`hr.elevations` : sql`NULL::smallint[] AS elevations`;

  const [live, routeRows, skiRows, historyRows, sourceRows, waypoints] = await Promise.all([
    attachLive([r]),
    sql<RouteRow[]>`
      SELECT hr.id, hr.rank, hr.distance_m, hr.ascent_m, hr.descent_m, hr.duration_up_min, hr.duration_down_min,
             hr.min_elev_m, hr.max_elev_m, hr.sac_min, hr.sac_max, hr.sac_known_share, hr.official_share, hr.end_gap_m,
             hr.source, hr.computed_at, ST_AsGeoJSON(hr.geom, 6) AS geojson, ${elevations},
             t.id AS th_id, t.kind AS th_kind, t.name AS th_name, t.lat::float8 AS th_lat, t.lng::float8 AS th_lng,
             t.elevation_m AS th_elev, t.quality AS th_quality, t.road_snap_m,
             t.tags->>'fee' AS th_fee, t.tags->>'capacity' AS th_capacity,
             t.drive_lat::float8 AS drive_lat, t.drive_lng::float8 AS drive_lng
      FROM hike_routes hr JOIN trailheads t ON t.id = hr.trailhead_id
      WHERE hr.destination_id = ${id} ORDER BY hr.rank
    `,
    sql<{
      lifts_total: number; lifts_by_type: Record<string, number>; piste_km: number | null;
      piste_km_by_difficulty: Record<string, number>; grouping: string;
      th_id: string | null; th_name: string | null; th_lat: number | null; th_lng: number | null;
      th_elev: number | null; th_quality: number | null; road_snap_m: number | null;
      drive_lat: number | null; drive_lng: number | null;
    }[]>`
      SELECT s.lifts_total, s.lifts_by_type, s.piste_km, s.piste_km_by_difficulty, s.grouping,
             t.id AS th_id, t.name AS th_name, t.lat::float8 AS th_lat, t.lng::float8 AS th_lng,
             t.elevation_m AS th_elev, t.quality AS th_quality, t.road_snap_m,
             t.drive_lat::float8 AS drive_lat, t.drive_lng::float8 AS drive_lng
      FROM ski_resort_details s LEFT JOIN trailheads t ON t.id = s.trailhead_id
      WHERE s.destination_id = ${id}
    `,
    isSki
      ? sql<LiveRow[]>`
          SELECT captured_at, temperature_c, weather_code, visibility_m, wind_kmh, snow_depth_valley_cm,
                 snow_depth_top_cm, fresh_snow_cm, avalanche_level, lifts_open, lifts_total, slopes_open_km,
                 trail_status, lift_source
          FROM live_status WHERE destination_id = ${id} ORDER BY captured_at DESC LIMIT 120
        `
      : Promise.resolve([] as LiveRow[]),
    sql<{ id: string; name: string; attribution: string | null; license: string | null; version: string | null; fetched_at: Date | string | null }[]>`
      SELECT id, name, attribution, license, version, fetched_at FROM data_sources ORDER BY id
    `,
    isSki ? Promise.resolve(new Map<number, RouteWaypoint[]>()) : routeWaypoints(id),
  ]);

  const ski = skiRows[0];
  const usedSources = new Set<string>(
    isSki ? ['osm', 'open_meteo', 'slf'] : [r.source_layer ?? 'osm', 'open_meteo', ...(routeRows.length > 0 ? ['osm', 'swisstlm3d_wanderwege', 'terrain_tiles'] : [])],
  );
  const sources: DataSourceInfo[] = sourceRows
    .filter((s) => usedSources.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, attribution: s.attribution, license: s.license, version: s.version, fetchedAt: toIsoOrNull(s.fetched_at) }));

  const routes: HikeRouteDetail[] = routeRows.map((x) => {
    const line = (JSON.parse(x.geojson) as { coordinates: [number, number][] }).coordinates;
    return {
    routeId: Number(x.id),
    rank: x.rank,
    distanceKm: Math.round(x.distance_m / 100) / 10,
    ascentM: x.ascent_m,
    descentM: x.descent_m,
    durationUpMin: x.duration_up_min,
    durationDownMin: x.duration_down_min,
    minElevM: x.min_elev_m,
    maxElevM: x.max_elev_m,
    sacMin: x.sac_min,
    sacMax: x.sac_max,
    sacKnownShare: x.sac_known_share,
    officialShare: x.official_share,
    endGapM: x.end_gap_m,
    source: x.source,
    computedAt: toIso(x.computed_at),
    trailhead: {
      id: x.th_id, kind: x.th_kind, name: x.th_name, location: { lat: x.th_lat, lng: x.th_lng },
      elevationM: x.th_elev, quality: x.th_quality, roadGapM: x.road_snap_m, fee: x.th_fee, capacity: x.th_capacity,
    },
    line,
    // Nur verwenden, wenn die Höhen exakt zu den Stützpunkten passen.
    elevations: x.elevations && x.elevations.length === line.length ? x.elevations.map((z) => (z == null ? null : Number(z))) : null,
    waypoints: waypoints.get(Number(x.id)) ?? [],
    };
  });

  const names = r.names ?? {};
  const { alt, ...languages } = names as { alt?: string[] } & Record<string, string>;

  const drivePoints: DrivePoints = new Map();
  for (const x of routeRows) {
    if (x.drive_lat !== null && x.drive_lng !== null) drivePoints.set(x.th_id, { lat: x.drive_lat, lng: x.drive_lng });
  }
  if (ski?.th_id && ski.drive_lat !== null && ski.drive_lng !== null) {
    drivePoints.set(ski.th_id, { lat: ski.drive_lat, lng: ski.drive_lng });
  }

  const detail: DestinationDetail = {
    ...base(r),
    names: languages,
    altNames: Array.isArray(alt) ? alt : [],
    live: live.get(r.id) ?? null,
    history: historyRows.map((h) => liveFromRow(h, ski?.lifts_total ?? null)),
    routes,
    ski: ski
      ? {
          liftsTotal: ski.lifts_total, liftsByType: ski.lifts_by_type ?? {}, pisteKm: ski.piste_km,
          pisteKmByDifficulty: ski.piste_km_by_difficulty ?? {}, grouping: ski.grouping,
        }
      : null,
    access:
      ski && ski.th_id && ski.th_lat !== null && ski.th_lng !== null
        ? {
            id: ski.th_id, kind: 'valley_station', name: ski.th_name, location: { lat: ski.th_lat, lng: ski.th_lng },
            elevationM: ski.th_elev, quality: ski.th_quality ?? 1, roadGapM: ski.road_snap_m,
          }
        : null,
    sources,
    updatedAt: toIsoOrNull(r.updated_at),
  };
  return { detail, drivePoints, weatherCell: r.weather_cell };
}
