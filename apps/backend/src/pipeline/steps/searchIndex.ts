import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { SEARCH_INDEX_PATH } from '../../config/env';
import { queryClient as sql } from '../../db';
import { toIso, toIsoOrNull } from '../../lib/dates';
import {
  SAC_GRADES,
  SEARCH_INDEX_FORMAT,
  TRAILHEAD_KINDS,
  type DestTuple,
  type RouteTuple,
  type SearchIndexFile,
  type SkiTuple,
  type TrailheadTuple,
} from '../../search/indexFormat';
import { getMeta } from '../runs';

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const sacIndex = (v: string | null): number => (v ? SAC_GRADES.indexOf(v as (typeof SAC_GRADES)[number]) + 1 : 0);

/** Schritt «index»: Suchindex aus der Datenbank schreiben (nach «network»). */
export async function buildSearchIndex(): Promise<Record<string, unknown>> {
  const dests = await sql<{
    id: string; type: string; name: string; canton: string | null; lat: number; lng: number;
    elevation_top_m: number | null; elevation_base_m: number | null; poi_kind: string | null; object_class: string | null;
    quality_score: number | null; importance: number | null; wikipedia_title: string | null; slf_region_id: string | null;
    source_layer: string | null; weather_cell: string | null; route_status: string;
  }[]>`
    SELECT id, type, name, canton, lat::float8 AS lat, lng::float8 AS lng, elevation_top_m, elevation_base_m, poi_kind,
           object_class, quality_score, importance, wikipedia_title, slf_region_id, source_layer, weather_cell, route_status
    FROM destinations
    WHERE retired_at IS NULL AND type IN ('hike_destination', 'ski_resort')
    ORDER BY id
  `;
  const destIdx = new Map(dests.map((d, i) => [d.id, i]));

  const ths = await sql<{
    id: string; kind: (typeof TRAILHEAD_KINDS)[number]; name: string | null; lat: number; lng: number;
    drive_lat: number | null; drive_lng: number | null; road_snap_m: number | null; elevation_m: number | null;
    quality: number; fee: string | null; capacity: string | null;
  }[]>`
    SELECT id, kind, name, lat::float8 AS lat, lng::float8 AS lng, drive_lat::float8 AS drive_lat, drive_lng::float8 AS drive_lng,
           road_snap_m, elevation_m, quality, tags->>'fee' AS fee, tags->>'capacity' AS capacity
    FROM trailheads ORDER BY id
  `;
  const thIdx = new Map(ths.map((t, i) => [t.id, i]));

  const routes = await sql<{
    id: number; destination_id: string; trailhead_id: string; rank: number; distance_m: number; ascent_m: number;
    descent_m: number; duration_up_min: number; duration_down_min: number; min_elev_m: number | null; max_elev_m: number | null;
    sac_min: string | null; sac_max: string | null; sac_known_share: number; official_share: number; end_gap_m: number;
    source: string; computed_at: Date | string;
  }[]>`
    SELECT id, destination_id, trailhead_id, rank, distance_m, ascent_m, descent_m, duration_up_min, duration_down_min,
           min_elev_m, max_elev_m, sac_min, sac_max, sac_known_share, official_share, end_gap_m, source, computed_at
    FROM hike_routes ORDER BY destination_id, rank
  `;
  const ski = await sql<{
    destination_id: string; trailhead_id: string | null; lifts_total: number; lifts_by_type: Record<string, number>;
    piste_km: number | null; piste_km_by_difficulty: Record<string, number>; grouping: string;
  }[]>`
    SELECT destination_id, trailhead_id, lifts_total, lifts_by_type, piste_km, piste_km_by_difficulty, grouping
    FROM ski_resort_details ORDER BY destination_id
  `;

  const file: SearchIndexFile = {
    format: SEARCH_INDEX_FORMAT,
    builtAt: new Date().toISOString(),
    graphBuiltAt: (await getMeta<{ builtAt?: string }>('road_graph'))?.builtAt ?? null,
    routeSource: routes[0]?.source ?? 'osm+swisstlm3d',
    routesComputedAt: routes[0] ? toIso(routes[0].computed_at) : null,
    destinations: dests.map((d): DestTuple => [
      d.id, d.type === 'ski_resort' ? 1 : 0, d.name, d.canton, r6(d.lat), r6(d.lng), d.elevation_top_m, d.elevation_base_m,
      d.poi_kind, d.object_class, d.quality_score, d.importance, d.wikipedia_title, d.slf_region_id, d.source_layer,
      d.weather_cell, d.route_status === 'routed' ? 1 : 0,
    ]),
    trailheads: ths.map((t): TrailheadTuple => [
      t.id, TRAILHEAD_KINDS.indexOf(t.kind) as 0 | 1 | 2, t.name, r6(t.lat), r6(t.lng),
      t.drive_lat === null ? null : r6(t.drive_lat), t.drive_lng === null ? null : r6(t.drive_lng),
      t.road_snap_m === null ? null : Math.round(t.road_snap_m), t.elevation_m, t.quality, t.fee, t.capacity,
    ]),
    routes: routes
      .filter((r) => destIdx.has(r.destination_id) && thIdx.has(r.trailhead_id))
      .map((r): RouteTuple => [
        Number(r.id), destIdx.get(r.destination_id)!, thIdx.get(r.trailhead_id)!, r.rank, r.distance_m, r.ascent_m,
        r.descent_m, r.duration_up_min, r.duration_down_min, r.min_elev_m, r.max_elev_m, sacIndex(r.sac_min),
        sacIndex(r.sac_max), r3(r.sac_known_share), r3(r.official_share), r.end_gap_m,
      ]),
    ski: ski
      .filter((s) => destIdx.has(s.destination_id))
      .map((s): SkiTuple => [
        destIdx.get(s.destination_id)!, s.trailhead_id ? (thIdx.get(s.trailhead_id) ?? -1) : -1, s.lifts_total,
        s.lifts_by_type ?? {}, s.piste_km, s.piste_km_by_difficulty ?? {}, s.grouping,
      ]),
  };

  const json = Buffer.from(JSON.stringify(file));
  const gz = gzipSync(json, { level: 9 });
  mkdirSync(dirname(SEARCH_INDEX_PATH), { recursive: true });
  writeFileSync(`${SEARCH_INDEX_PATH}.part`, gz);
  renameSync(`${SEARCH_INDEX_PATH}.part`, SEARCH_INDEX_PATH);

  return {
    file: SEARCH_INDEX_PATH,
    destinations: file.destinations.length,
    trailheads: file.trailheads.length,
    routes: file.routes.length,
    skiResorts: file.ski.length,
    jsonMb: Math.round(json.length / 1e5) / 10,
    gzipMb: Math.round(gz.length / 1e5) / 10,
    graphBuiltAt: toIsoOrNull(file.graphBuiltAt),
  };
}
