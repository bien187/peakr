import type { HikeKind } from '@ch-alpineroute/shared';
import { queryClient as sql } from '../db';
import { logger } from '../lib/logger';
import type { IndexRoute, IndexSki, SearchIndex } from '../search/searchIndex';

/**
 * Datenzugriff der Suche.
 *
 * Statische Daten (Ziele, Ausgangspunkte, Routen, Skigebiete) kommen aus dem
 * Suchindex im Arbeitsspeicher. Aus der Datenbank werden nur noch kleine,
 * häufig wechselnde Live-Daten gelesen und je Instanz einige Minuten
 * zwischengespeichert. Das hält den Datenverkehr klein (Neon-Gratisstufe:
 * 5 GB/Monat) und die Suche lauffähig, wenn die Datenbank kurz fehlt.
 */

/** Rechteck in WGS84 für den räumlichen Vorfilter. */
export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface TrendFields {
  trend_score: number | null;
  trend_rationale: string | null;
  trend_source: string | null;
  trend_is_estimate: boolean | null;
  trend_updated_at: Date | string | null;
}

export interface HikeCandidateRow extends TrendFields {
  route_id: number;
  rank: number;
  distance_m: number;
  ascent_m: number;
  descent_m: number;
  duration_up_min: number;
  duration_down_min: number;
  min_elev_m: number | null;
  max_elev_m: number | null;
  sac_min: string | null;
  sac_max: string | null;
  sac_known_share: number;
  official_share: number;
  end_gap_m: number;
  route_source: string;
  computed_at: Date | string;
  th_id: string;
  th_kind: 'parking' | 'road_access' | 'valley_station';
  th_name: string | null;
  th_lat: number;
  th_lng: number;
  drive_lat: number | null;
  drive_lng: number | null;
  road_snap_m: number | null;
  th_elev: number | null;
  th_quality: number;
  th_fee: string | null;
  th_capacity: string | null;
  id: string;
  name: string;
  canton: string | null;
  lat: number;
  lng: number;
  elevation_top_m: number | null;
  poi_kind: string | null;
  object_class: string | null;
  quality_score: number | null;
  importance: number | null;
  wikipedia_title: string | null;
  slf_region_id: string | null;
  source_layer: string | null;
  weather_cell: string | null;
}

export interface UnroutedRow {
  id: string;
  name: string;
  canton: string | null;
  lat: number;
  lng: number;
  elevation_top_m: number | null;
  poi_kind: string | null;
  object_class: string | null;
  quality_score: number | null;
  importance: number | null;
  wikipedia_title: string | null;
  slf_region_id: string | null;
  source_layer: string | null;
  weather_cell: string | null;
}

export interface SkiLiveRow {
  captured_at: Date | string | null;
  temperature_c: number | null;
  weather_code: number | null;
  visibility_m: number | null;
  wind_kmh: number | null;
  snow_depth_valley_cm: number | null;
  snow_depth_top_cm: number | null;
  fresh_snow_cm: number | null;
  avalanche_level: number | null;
  lifts_open: number | null;
  slopes_open_km: number | null;
  lift_source: string | null;
}

export interface SkiCandidateRow extends SkiLiveRow, TrendFields {
  id: string;
  name: string;
  canton: string | null;
  lat: number;
  lng: number;
  elevation_base_m: number | null;
  elevation_top_m: number | null;
  object_class: string | null;
  quality_score: number | null;
  importance: number | null;
  wikipedia_title: string | null;
  slf_region_id: string | null;
  source_layer: string | null;
  lifts_total: number;
  lifts_by_type: Record<string, number>;
  piste_km: number | null;
  piste_km_by_difficulty: Record<string, number>;
  grouping: string;
  th_id: string | null;
  th_name: string | null;
  th_lat: number | null;
  th_lng: number | null;
  drive_lat: number | null;
  drive_lng: number | null;
  road_snap_m: number | null;
  th_elev: number | null;
  th_quality: number | null;
}

export interface WeatherCellRow {
  cell: string;
  model_elev_m: number | null;
  captured_at: Date | string;
  temperature_c: number | null;
  weather_code: number | null;
  visibility_m: number | null;
  wind_kmh: number | null;
  snow_depth_cm: number | null;
  fresh_snow_cm: number | null;
}

export interface TrendRow {
  score: number;
  rationale: string | null;
  source: string | null;
  is_estimate: boolean;
  updated_at: Date | string | null;
}

type AvalancheMap = Map<string, { level: number; validUntil: string | null }>;

// ── Live-Daten aus der Datenbank (zwischengespeichert) ────────────────────────

interface Cached<T> {
  at: number;
  value: T;
}

declare global {
  var __peakrLiveCache: Map<string, Cached<unknown>> | undefined;
}

const LIVE_TTL_MS = 5 * 60_000;

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const store = (globalThis.__peakrLiveCache ??= new Map());
  const hit = store.get(key) as Cached<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await load();
  store.set(key, { at: Date.now(), value });
  return value;
}

/** Wetterraster (wenige hundert Zeilen). */
export function getWeatherCells(): Promise<Map<string, WeatherCellRow>> {
  return cached('weather', LIVE_TTL_MS, async () => {
    const rows = await sql<WeatherCellRow[]>`
      SELECT cell, model_elev_m, captured_at, temperature_c, weather_code, visibility_m, wind_kmh, snow_depth_cm, fresh_snow_cm
      FROM weather_cells
    `;
    return new Map(rows.map((r) => [r.cell, r]));
  });
}

/** Lawinenstufen je SLF-Region aus dem letzten Bulletin (abgelaufene Einträge zählen nicht). */
export function getAvalancheLevels(): Promise<AvalancheMap> {
  return cached('avalanche', LIVE_TTL_MS, async () => {
    const rows = await sql<{ value: { levels?: Record<string, { level: number; validUntil: string | null }> } }[]>`
      SELECT value FROM app_meta WHERE key = 'avalanche_levels'
    `;
    const levels: AvalancheMap = new Map();
    const now = Date.now();
    for (const [region, info] of Object.entries(rows[0]?.value.levels ?? {})) {
      if (info.validUntil && Date.parse(info.validUntil) < now - 6 * 3_600_000) continue;
      levels.set(region, info);
    }
    return levels;
  });
}

/** Bekanntheit je Ziel (nur Ziele mit Wikipedia-Artikel, wenige tausend Zeilen). */
export function getTrendScores(): Promise<Map<string, TrendRow>> {
  return cached('trend', 30 * 60_000, async () => {
    const rows = await sql<(TrendRow & { destination_id: string })[]>`
      SELECT destination_id, score, rationale, source, is_estimate, updated_at FROM trend_scores
    `;
    return new Map(rows.map((r) => [r.destination_id, r]));
  });
}

/** Letzter Messwert je Skigebiet (höchstens drei Tage alt). */
export function getSkiLive(): Promise<Map<string, SkiLiveRow>> {
  return cached('skiLive', LIVE_TTL_MS, async () => {
    const rows = await sql<(SkiLiveRow & { destination_id: string })[]>`
      SELECT DISTINCT ON (destination_id) destination_id, captured_at, temperature_c, weather_code, visibility_m, wind_kmh,
             snow_depth_valley_cm, snow_depth_top_cm, fresh_snow_cm, avalanche_level, lifts_open, slopes_open_km, lift_source
      FROM live_status
      WHERE captured_at > now() - interval '3 days'
      ORDER BY destination_id, captured_at DESC
    `;
    return new Map(rows.map((r) => [r.destination_id, r]));
  });
}

/** Stand der Live-Daten; ändert sich mit jedem Worker-Lauf und entwertet Such-Caches. */
export function getLiveVersion(): Promise<string | null> {
  return cached('liveVersion', 60_000, async () => {
    const rows = await sql<{ version: string | null }[]>`
      SELECT value->>'version' AS version FROM app_meta WHERE key = 'live_version'
    `;
    return rows[0]?.version ?? null;
  });
}

export interface LiveContext {
  weather: Map<string, WeatherCellRow>;
  avalanche: AvalancheMap;
  trends: Map<string, TrendRow>;
  skiLive: Map<string, SkiLiveRow>;
  liveVersion: string | null;
  /** false, wenn mindestens eine Live-Quelle aus der Datenbank nicht geladen werden konnte. */
  ok: boolean;
}

/**
 * Lädt alle Live-Daten für eine Suche. Fehler einzelner Abfragen werden
 * abgefangen: Die Suche läuft dann mit leeren Live-Daten weiter und meldet das.
 */
export async function getLiveContext(includeSki: boolean): Promise<LiveContext> {
  let ok = true;
  const safe = async <T>(name: string, load: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await load();
    } catch (err) {
      ok = false;
      logger.warn({ source: name, error: err instanceof Error ? err.message : String(err) }, 'Live-Daten nicht verfügbar');
      return fallback;
    }
  };
  const [weather, avalanche, trends, skiLive, liveVersion] = await Promise.all([
    safe('weather_cells', getWeatherCells, new Map<string, WeatherCellRow>()),
    safe('avalanche', getAvalancheLevels, new Map() as AvalancheMap),
    safe('trend_scores', getTrendScores, new Map<string, TrendRow>()),
    includeSki ? safe('live_status', getSkiLive, new Map<string, SkiLiveRow>()) : Promise.resolve(new Map<string, SkiLiveRow>()),
    safe('live_version', getLiveVersion, null),
  ]);
  return { weather, avalanche, trends, skiLive, liveVersion, ok };
}

/** Für Tests und nach Worker-Läufen im selben Prozess. */
export function clearSearchCaches(): void {
  globalThis.__peakrLiveCache = new Map();
}

// ── Kandidaten aus dem Suchindex ─────────────────────────────────────────────

const inBounds = (b: Bounds, lat: number, lng: number): boolean =>
  lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;

function trendFields(t: TrendRow | undefined): TrendFields {
  return {
    trend_score: t?.score ?? null,
    trend_rationale: t?.rationale ?? null,
    trend_source: t?.source ?? null,
    trend_is_estimate: t?.is_estimate ?? null,
    trend_updated_at: t?.updated_at ?? null,
  };
}

function hikeRow(index: SearchIndex, r: IndexRoute, trend: TrendRow | undefined): HikeCandidateRow {
  const t = r.trailhead;
  const d = r.dest;
  return {
    route_id: r.id,
    rank: r.rank,
    distance_m: r.distanceM,
    ascent_m: r.ascentM,
    descent_m: r.descentM,
    duration_up_min: r.durationUpMin,
    duration_down_min: r.durationDownMin,
    min_elev_m: r.minElevM,
    max_elev_m: r.maxElevM,
    sac_min: r.sacMin,
    sac_max: r.sacMax,
    sac_known_share: r.sacKnownShare,
    official_share: r.officialShare,
    end_gap_m: r.endGapM,
    route_source: index.routeSource,
    computed_at: index.routesComputedAt ?? index.builtAt,
    th_id: t.id,
    th_kind: t.kind,
    th_name: t.name,
    th_lat: t.lat,
    th_lng: t.lng,
    drive_lat: t.driveLat,
    drive_lng: t.driveLng,
    road_snap_m: t.roadSnapM,
    th_elev: t.elevationM,
    th_quality: t.quality,
    th_fee: t.fee,
    th_capacity: t.capacity,
    id: d.id,
    name: d.name,
    canton: d.canton,
    lat: d.lat,
    lng: d.lng,
    elevation_top_m: d.elevationTopM,
    poi_kind: d.poiKind,
    object_class: d.objectClass,
    quality_score: d.qualityScore,
    importance: d.importance,
    wikipedia_title: d.wikipediaTitle,
    slf_region_id: d.slfRegionId,
    source_layer: d.sourceLayer,
    weather_cell: d.weatherCell,
    ...trendFields(trend),
  };
}

/**
 * Stufe 1 der Wandersuche: alle Routen, deren Ausgangspunkt im Rechteck der
 * erreichbaren Strassen liegt. Ohne Obergrenze – die Fahrzeit wird danach für
 * jeden Kandidaten ausgewertet.
 */
export function findHikeCandidates(
  index: SearchIndex,
  bounds: Bounds,
  kinds: HikeKind[] | undefined,
  minElevationM: number | undefined,
  trends: Map<string, TrendRow>,
): HikeCandidateRow[] {
  const kindSet = kinds && kinds.length > 0 ? new Set<string>(kinds) : null;
  const out: HikeCandidateRow[] = [];
  for (const r of index.routes) {
    const t = r.trailhead;
    if (t.driveLat === null || t.driveLng === null || !inBounds(bounds, t.lat, t.lng)) continue;
    const d = r.dest;
    if (kindSet && (d.poiKind === null || !kindSet.has(d.poiKind))) continue;
    if (minElevationM && (d.elevationTopM === null || d.elevationTopM < minElevationM)) continue;
    out.push(hikeRow(index, r, trends.get(d.id)));
  }
  return out;
}

/** Ziele ohne bekannte Wanderroute im Rechteck (nur auf ausdrücklichen Wunsch). */
export function findUnroutedDestinations(
  index: SearchIndex,
  bounds: Bounds,
  kinds: HikeKind[] | undefined,
  minElevationM: number | undefined,
): UnroutedRow[] {
  const kindSet = kinds && kinds.length > 0 ? new Set<string>(kinds) : null;
  const out: UnroutedRow[] = [];
  for (const d of index.destinations) {
    if (d.ski || d.routed || !inBounds(bounds, d.lat, d.lng)) continue;
    if (kindSet && (d.poiKind === null || !kindSet.has(d.poiKind))) continue;
    if (minElevationM && (d.elevationTopM === null || d.elevationTopM < minElevationM)) continue;
    out.push({
      id: d.id, name: d.name, canton: d.canton, lat: d.lat, lng: d.lng, elevation_top_m: d.elevationTopM,
      poi_kind: d.poiKind, object_class: d.objectClass, quality_score: d.qualityScore, importance: d.importance,
      wikipedia_title: d.wikipediaTitle, slf_region_id: d.slfRegionId, source_layer: d.sourceLayer, weather_cell: d.weatherCell,
    });
  }
  return out;
}

const NO_LIVE: SkiLiveRow = {
  captured_at: null, temperature_c: null, weather_code: null, visibility_m: null, wind_kmh: null,
  snow_depth_valley_cm: null, snow_depth_top_cm: null, fresh_snow_cm: null, avalanche_level: null,
  lifts_open: null, slopes_open_km: null, lift_source: null,
};

function skiRow(s: IndexSki, live: SkiLiveRow | undefined, trend: TrendRow | undefined): SkiCandidateRow {
  const d = s.dest;
  const t = s.trailhead;
  return {
    id: d.id, name: d.name, canton: d.canton, lat: d.lat, lng: d.lng, elevation_base_m: d.elevationBaseM,
    elevation_top_m: d.elevationTopM, object_class: d.objectClass, quality_score: d.qualityScore, importance: d.importance,
    wikipedia_title: d.wikipediaTitle, slf_region_id: d.slfRegionId, source_layer: d.sourceLayer,
    lifts_total: s.liftsTotal, lifts_by_type: s.liftsByType, piste_km: s.pisteKm, piste_km_by_difficulty: s.pisteKmByDifficulty,
    grouping: s.grouping,
    th_id: t?.id ?? null, th_name: t?.name ?? null, th_lat: t?.lat ?? null, th_lng: t?.lng ?? null,
    drive_lat: t?.driveLat ?? null, drive_lng: t?.driveLng ?? null, road_snap_m: t?.roadSnapM ?? null,
    th_elev: t?.elevationM ?? null, th_quality: t?.quality ?? null,
    ...(live ?? NO_LIVE),
    ...trendFields(trend),
  };
}

/** Alle Skigebiete (wenige hundert) samt Zufahrtspunkt und letztem Messwert. */
export function findSkiCandidates(
  index: SearchIndex,
  minElevationM: number | undefined,
  skiLive: Map<string, SkiLiveRow>,
  trends: Map<string, TrendRow>,
): SkiCandidateRow[] {
  const out: SkiCandidateRow[] = [];
  for (const s of index.ski) {
    const d = s.dest;
    if (minElevationM && (d.elevationTopM === null || d.elevationTopM < minElevationM)) continue;
    out.push(skiRow(s, skiLive.get(d.id), trends.get(d.id)));
  }
  return out;
}
