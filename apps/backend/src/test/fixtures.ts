import { searchInputSchema, type SearchInput } from '@ch-alpineroute/shared';
import type { HikeCandidateRow, SkiCandidateRow } from '../repositories/search.repo';
import type { AssembleContext } from '../services/search.service';

export const ZURICH = { lat: 47.3769, lng: 8.5417 };

export function input(over: Record<string, unknown> = {}): SearchInput {
  return searchInputSchema.parse({ origin: ZURICH, mode: 'hike', maxMinutes: 90, toleranceMinutes: 10, ...over });
}

export const ctx: AssembleContext = {
  weather: new Map(),
  avalanche: new Map(),
  routing: { provider: 'test', graphBuiltAt: null },
};

let seq = 0;
/** Eine Route (Ausgangspunkt → Ziel) als Kandidatenzeile, wie sie aus der Datenbank kommt. */
export function hikeRow(over: Partial<HikeCandidateRow> = {}): HikeCandidateRow {
  seq++;
  return {
    route_id: seq, rank: 1, distance_m: 5000, ascent_m: 800, descent_m: 20, duration_up_min: 180, duration_down_min: 120,
    min_elev_m: 1000, max_elev_m: 1800, sac_min: 'T2', sac_max: 'T2', sac_known_share: 1, official_share: 1, end_gap_m: 0,
    route_source: 'test', computed_at: new Date(0), th_id: `th-${seq}`, th_kind: 'parking', th_name: null, th_lat: 47, th_lng: 8.5,
    drive_lat: 47, drive_lng: 8.5, road_snap_m: 5, th_elev: 1000, th_quality: 3, th_fee: null, th_capacity: null,
    id: `dest-${seq}`, name: `Ziel ${seq}`, canton: 'SZ', lat: 47.01, lng: 8.51, elevation_top_m: 1800, poi_kind: 'peak',
    object_class: 'Gipfel', quality_score: 80, importance: 3, wikipedia_title: null, slf_region_id: null, source_layer: 'swissnames3d',
    weather_cell: null, trend_score: null, trend_rationale: null, trend_source: null, trend_is_estimate: null, trend_updated_at: null,
    ...over,
  };
}

export function skiRow(over: Partial<SkiCandidateRow> = {}): SkiCandidateRow {
  seq++;
  return {
    id: `ski-${seq}`, name: `Skigebiet ${seq}`, canton: 'GR', lat: 46.8, lng: 9.8, elevation_base_m: 1200, elevation_top_m: 2500,
    object_class: 'Skigebiet', quality_score: 80, importance: 3, wikipedia_title: null, slf_region_id: null, source_layer: 'osm',
    lifts_total: 10, lifts_by_type: {}, piste_km: 40, piste_km_by_difficulty: {}, grouping: 'test',
    th_id: `th-${seq}`, th_name: null, th_lat: 46.8, th_lng: 9.8, drive_lat: 46.8, drive_lng: 9.8, road_snap_m: 10, th_elev: 1200,
    th_quality: 3, weather_cell: null, captured_at: null, temperature_c: null, weather_code: null, visibility_m: null, wind_kmh: null,
    snow_depth_valley_cm: null, snow_depth_top_cm: null, fresh_snow_cm: null, avalanche_level: null, lifts_open: null,
    slopes_open_km: null, lift_source: null, trend_score: null, trend_rationale: null, trend_source: null, trend_is_estimate: null,
    trend_updated_at: null,
    ...over,
  } as SkiCandidateRow;
}
