import {
  SAC_ORDER,
  type Availability,
  type HikeRouteSummary,
  type TourPlan,
  type LiveStatus,
  type RoutingStatus,
  type SacDifficulty,
  type MapPoint,
  type SearchInput,
  type SearchItem,
  type SearchResponse,
  type SearchResult,
  type SearchSection,
  type Trailhead,
  type TrendScore,
} from '@ch-alpineroute/shared';
import { haversineM } from '../geo/lv95';
import { toIso, toIsoOrNull } from '../lib/dates';
import { AppError } from '../lib/errors';
import {
  findHikeCandidates,
  findSkiCandidates,
  findUnroutedDestinations,
  getLiveContext,
  type HikeCandidateRow,
  type LiveContext,
  type SkiCandidateRow,
  type UnroutedRow,
  type WeatherCellRow,
} from '../repositories/search.repo';
import { getSearchIndex } from '../search/searchIndex';
import { evaluateHikeRoute, evaluateSkiResort, reasonKind, type ConditionsContext, type HikeRouteFacts } from '../availability/engine';
import { resolvePlan } from '../availability/time';
import { conditionsMeta, getConditions } from '../repositories/conditions.repo';
import {
  computeDriveContext,
  driveTimeTo,
  graphInfo,
  ROUTING_PROVIDER,
  type DriveTime,
} from '../routing/driveTime';
import { computeScore } from './score.service';

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Strasse endet weiter als so viele Meter vor der Talstation → Zufahrt nur teilweise mit dem Auto. */
const ROAD_GAP_PARTIAL_M = 600;
/** Abnahme der Temperatur mit der Höhe (Standardatmosphäre), °C je Meter. */
const LAPSE_RATE = 0.0065;

type AvalancheMap = Map<string, { level: number; validUntil: string | null }>;

export interface RoutingMeta {
  provider: string;
  graphBuiltAt: string | null;
}

/** Wegen der Verfügbarkeit ausgeblendete Ziele (nur solche, die sonst angezeigt würden). */
export interface HiddenCounts {
  uncertain: number;
  unavailable: number;
  /** Prüfung (closure, snow …) → Anzahl Ziele, gezählt nach dem massgebenden Grund. */
  reasons: Record<string, number>;
}

export interface HikeSections {
  results: SearchResult[];
  suggestions: SearchResult[];
  sacUnknown: SearchResult[];
  hidden: HiddenCounts;
}
export interface SkiSections {
  results: SearchResult[];
  suggestions: SearchResult[];
  unrouted: SearchResult[];
  excludedUnknownSnow: number;
  hidden: HiddenCounts;
}

/** Verfügbarkeitsprüfung für eine Suche; fehlt sie (ältere Tests), wird nicht gefiltert. */
export interface AvailabilitySettings {
  conditions: ConditionsContext;
  plan: TourPlan;
  now: Date;
  includeUncertain: boolean;
}

export interface AssembleContext {
  weather: Map<string, WeatherCellRow>;
  avalanche: AvalancheMap;
  routing: RoutingMeta;
  availability?: AvailabilitySettings;
}

const emptyHidden = (): HiddenCounts => ({ uncertain: 0, unavailable: 0, reasons: {} });

/** Sichtbar: verfügbar, oder unsicher mit includeUncertain. Ohne Prüfung immer. */
function isVisible(a: Availability | null, s: AvailabilitySettings | undefined): boolean {
  return !a || !s || a.status === 'available' || (a.status === 'uncertain' && s.includeUncertain);
}

/** Zählt ein ausgeblendetes Ziel mit seinem massgebenden Grund. */
function countHidden(h: HiddenCounts, a: Availability): void {
  if (a.status === 'uncertain') h.uncertain++;
  else h.unavailable++;
  const kind = reasonKind(a) ?? 'other';
  h.reasons[kind] = (h.reasons[kind] ?? 0) + 1;
}

const STATUS_RANK = { available: 0, uncertain: 1, unavailable: 2 } as const;

function airKm(input: SearchInput, lat: number, lng: number): number {
  return round1(haversineM(input.origin.lat, input.origin.lng, lat, lng) / 1000);
}

function trend(r: {
  trend_score: number | null;
  trend_rationale: string | null;
  trend_source: string | null;
  trend_is_estimate: boolean | null;
  trend_updated_at: Date | string | null;
}): TrendScore | null {
  if (r.trend_score == null) return null;
  return {
    score: r.trend_score,
    rationale: r.trend_rationale,
    source: r.trend_source,
    isEstimate: r.trend_is_estimate ?? true,
    updatedAt: toIsoOrNull(r.trend_updated_at),
  };
}

/** Bedingungen an einem Wanderziel aus dem Wetterraster; Temperatur auf die Zielhöhe umgerechnet. */
export function hikeLive(
  cell: WeatherCellRow | undefined,
  elevationM: number | null,
  avalancheLevel: number | null,
): LiveStatus | null {
  if (!cell) {
    if (avalancheLevel === null) return null;
    return {
      capturedAt: new Date().toISOString(), temperatureC: null, weatherCode: null, visibilityM: null, windKmh: null,
      snowDepthValleyCm: null, snowDepthTopCm: null, freshSnowCm: null, avalancheLevel, liftsOpen: null,
      liftsTotal: null, slopesOpenKm: null, trailStatus: null,
    };
  }
  let temperatureC = cell.temperature_c;
  let adjusted = false;
  if (temperatureC !== null && elevationM !== null && cell.model_elev_m !== null) {
    temperatureC = round1(temperatureC - (elevationM - cell.model_elev_m) * LAPSE_RATE);
    adjusted = Math.abs(elevationM - cell.model_elev_m) > 50;
  }
  return {
    capturedAt: toIso(cell.captured_at),
    temperatureC,
    temperatureAdjusted: adjusted,
    weatherCode: cell.weather_code,
    visibilityM: cell.visibility_m,
    windKmh: cell.wind_kmh,
    // Schneehöhe gilt für die Modellhöhe der Rasterzelle, nicht für das Ziel → nicht ausweisen.
    snowDepthValleyCm: null,
    snowDepthTopCm: null,
    freshSnowCm: cell.fresh_snow_cm,
    avalancheLevel,
    liftsOpen: null,
    liftsTotal: null,
    slopesOpenKm: null,
    trailStatus: null,
  };
}

function hikeTrailhead(r: HikeCandidateRow): Trailhead {
  return {
    id: r.th_id,
    kind: r.th_kind,
    name: r.th_name,
    location: { lat: r.th_lat, lng: r.th_lng },
    elevationM: r.th_elev,
    quality: r.th_quality,
    roadGapM: r.road_snap_m,
    fee: r.th_fee,
    capacity: r.th_capacity,
  };
}

function hikeSummary(r: HikeCandidateRow): HikeRouteSummary {
  return {
    routeId: Number(r.route_id),
    rank: r.rank,
    distanceKm: round1(r.distance_m / 1000),
    ascentM: r.ascent_m,
    descentM: r.descent_m,
    durationUpMin: r.duration_up_min,
    durationDownMin: r.duration_down_min,
    minElevM: r.min_elev_m,
    maxElevM: r.max_elev_m,
    sacMin: r.sac_min as SacDifficulty | null,
    sacMax: r.sac_max as SacDifficulty | null,
    sacKnownShare: r.sac_known_share,
    officialShare: r.official_share,
    endGapM: r.end_gap_m,
    source: r.route_source,
    computedAt: toIso(r.computed_at),
  };
}

interface Option {
  row: HikeCandidateRow;
  drive: DriveTime;
  /** Verfügbarkeit dieser Variante; null = nicht geprüft. */
  availability: Availability | null;
}

/** Rangfolge der Routenvarianten: kurze Gehzeit; Strassenzugang ohne Parkplatz zählt 30 min schlechter. */
function optionCost(o: Option): number {
  return o.row.duration_up_min + (o.row.th_quality === 1 ? 30 : 0);
}

/** Beste Variante: verfügbare vor unsicheren, dann kürzere Gehzeit, dann kürzere Fahrt. */
function pickBest(options: Option[]): Option {
  const rank = (o: Option): number => (o.availability ? STATUS_RANK[o.availability.status] : 0);
  return options.reduce((best, o) => {
    const r = rank(o) - rank(best);
    if (r !== 0) return r < 0 ? o : best;
    const d = optionCost(o) - optionCost(best);
    if (d < 0) return o;
    if (d === 0 && o.drive.minutes < best.drive.minutes) return o;
    return best;
  });
}

/** Grundlagen der Prüfung einer Wanderroute aus der Kandidatenzeile. */
function routeFacts(r: HikeCandidateRow): HikeRouteFacts {
  return {
    destinationId: r.id, rank: r.rank, lat: r.lat, lng: r.lng, minElevM: r.min_elev_m, maxElevM: r.max_elev_m ?? r.elevation_top_m,
    durationUpMin: r.duration_up_min, durationDownMin: r.duration_down_min, officialShare: r.official_share,
    weatherCell: r.weather_cell, slfRegionId: r.slf_region_id,
  };
}

function buildHikeResult(
  input: SearchInput,
  chosen: Option,
  variants: number,
  ctx: AssembleContext,
): SearchResult {
  const r = chosen.row;
  const avalanche = r.slf_region_id ? (ctx.avalanche.get(r.slf_region_id)?.level ?? null) : null;
  const live = hikeLive(r.weather_cell ? ctx.weather.get(r.weather_cell) : undefined, r.elevation_top_m, avalanche);
  const trendScore = trend(r);
  const { score, breakdown } = computeScore({
    mode: 'hike',
    live,
    trend: trendScore,
    importance: r.importance,
    qualityScore: r.quality_score,
    officialShare: r.official_share,
    sacKnown: r.sac_max !== null,
  });
  const minutes = round1(chosen.drive.minutes);
  const within = minutes <= input.maxMinutes;
  return {
    id: r.id,
    name: r.name,
    type: 'hike_destination',
    canton: r.canton,
    location: { lat: r.lat, lng: r.lng },
    elevationBaseM: r.th_elev,
    elevationTopM: r.elevation_top_m,
    // Schwierigkeit, Aufstieg und Distanz gelten für die gewählte Route.
    sacDifficulty: r.sac_max as SacDifficulty | null,
    ascentM: r.ascent_m,
    distanceKm: round1(r.distance_m / 1000),
    wikipediaTitle: r.wikipedia_title,
    slfRegionId: r.slf_region_id,
    poiKind: r.poi_kind,
    objectClass: r.object_class,
    qualityScore: r.quality_score,
    routeStatus: 'routed',
    sourceLayer: r.source_layer,
    driveMinutes: minutes,
    driveEstimated: false,
    routingProvider: ctx.routing.provider,
    routingStatus: 'ok',
    routeDistanceKm: round1(chosen.drive.distanceKm),
    routingUpdatedAt: ctx.routing.graphBuiltAt,
    distanceAirKm: airKm(input, r.lat, r.lng),
    trailhead: hikeTrailhead(r),
    hike: hikeSummary(r),
    hikeVariants: variants,
    ski: null,
    score,
    scoreBreakdown: breakdown,
    live,
    trend: trendScore,
    blocked: false,
    blockedReason: null,
    overBudgetMinutes: within ? null : Math.ceil(minutes - input.maxMinutes),
    availability: chosen.availability,
  };
}

function sortResults(list: SearchResult[]): void {
  list.sort(
    (a, b) =>
      Number(a.blocked) - Number(b.blocked) ||
      b.score - a.score ||
      (a.driveMinutes ?? Infinity) - (b.driveMinutes ?? Infinity) ||
      a.name.localeCompare(b.name),
  );
}

function sortSuggestions(list: SearchResult[]): void {
  list.sort(
    (a, b) =>
      Number(a.blocked) - Number(b.blocked) ||
      (a.overBudgetMinutes ?? 0) - (b.overBudgetMinutes ?? 0) ||
      b.score - a.score ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Reine Funktion: wählt je Ziel die passende Route und teilt die Ziele ein.
 *
 *  results      Fahrzeit ≤ maxMinutes
 *  suggestions  maxMinutes < Fahrzeit ≤ maxMinutes + Toleranz
 *  sacUnknown   in Reichweite, aber nur über Routen unbekannter Schwierigkeit
 *               erreichbar, während ein SAC-Filter aktiv ist
 *
 * Der SAC-Filter gilt für die tatsächlich gewählte Route, nicht pauschal fürs
 * Ziel. Unbekannte Schwierigkeit erfüllt den Filter nie stillschweigend.
 */
export function assembleHike(
  input: SearchInput,
  rows: HikeCandidateRow[],
  driveOf: (row: HikeCandidateRow) => DriveTime | null,
  ctx: AssembleContext,
): HikeSections {
  const limit = input.maxMinutes + input.toleranceMinutes;
  const maxSac = input.maxSac ? SAC_ORDER[input.maxSac] : null;
  const av = ctx.availability;

  const byDest = new Map<string, Option[]>();
  for (const row of rows) {
    if (input.maxHikeMinutes !== undefined && row.duration_up_min > input.maxHikeMinutes) continue;
    const drive = driveOf(row);
    // Ohne berechnete Strassenroute zählt eine Variante nicht – keine Schätzung.
    if (!drive || round1(drive.minutes) > limit) continue;
    const availability = av ? evaluateHikeRoute(routeFacts(row), av.conditions, av.plan, av.now) : null;
    const list = byDest.get(row.id);
    if (list) list.push({ row, drive, availability });
    else byDest.set(row.id, [{ row, drive, availability }]);
  }

  const results: SearchResult[] = [];
  const suggestions: SearchResult[] = [];
  const sacUnknown: SearchResult[] = [];
  const hidden = emptyHidden();

  for (const options of byDest.values()) {
    const accepted: Option[] = [];
    const unknown: Option[] = [];
    for (const o of options) {
      if (maxSac === null) accepted.push(o);
      else if (o.row.sac_max === null) (input.includeUnknownSac ? accepted : unknown).push(o);
      else if (SAC_ORDER[o.row.sac_max as SacDifficulty] <= maxSac) accepted.push(o);
    }

    const place = (all: Option[], target: 'main' | 'unknown'): boolean => {
      // Nur Varianten, die nach der Verfügbarkeitsprüfung gezeigt werden dürfen.
      const pool = all.filter((o) => isVisible(o.availability, av));
      if (pool.length === 0) return false;
      const within = pool.filter((o) => round1(o.drive.minutes) <= input.maxMinutes);
      const usable = within.length > 0 ? within : pool;
      const result = buildHikeResult(input, pickBest(usable), usable.length - 1, ctx);
      if (target === 'unknown') sacUnknown.push(result);
      else (within.length > 0 ? results : suggestions).push(result);
      return true;
    };
    if (place(accepted, 'main') || place(unknown, 'unknown')) continue;
    // Ausgeblendet: mit dem Grund der am wenigsten schlechten Variante zählen.
    const candidates = (accepted.length > 0 ? accepted : unknown).filter((o) => o.availability);
    if (candidates.length > 0) countHidden(hidden, pickBest(candidates).availability!);
  }

  sortResults(results);
  sortSuggestions(suggestions);
  sortResults(sacUnknown);
  return { results, suggestions, sacUnknown, hidden };
}

function unroutedResult(input: SearchInput, r: UnroutedRow, ctx: AssembleContext, status: RoutingStatus): SearchResult {
  const avalanche = r.slf_region_id ? (ctx.avalanche.get(r.slf_region_id)?.level ?? null) : null;
  const live = hikeLive(r.weather_cell ? ctx.weather.get(r.weather_cell) : undefined, r.elevation_top_m, avalanche);
  const { score, breakdown } = computeScore({
    mode: 'hike', live, trend: null, importance: r.importance, qualityScore: r.quality_score, officialShare: 0, sacKnown: false,
  });
  return {
    id: r.id, name: r.name, type: 'hike_destination', canton: r.canton, location: { lat: r.lat, lng: r.lng },
    elevationBaseM: null, elevationTopM: r.elevation_top_m, sacDifficulty: null, ascentM: null, distanceKm: null,
    wikipediaTitle: r.wikipedia_title, slfRegionId: r.slf_region_id, poiKind: r.poi_kind, objectClass: r.object_class,
    qualityScore: r.quality_score, routeStatus: 'no_route', sourceLayer: r.source_layer,
    driveMinutes: null, driveEstimated: false, routingProvider: ctx.routing.provider, routingStatus: status,
    routeDistanceKm: null, routingUpdatedAt: ctx.routing.graphBuiltAt, distanceAirKm: airKm(input, r.lat, r.lng),
    trailhead: null, hike: null, hikeVariants: 0, ski: null, score, scoreBreakdown: breakdown, live, trend: null,
    blocked: false, blockedReason: null, overBudgetMinutes: null,
    // Ohne Route keine Prüfung: diese Ziele erscheinen nur auf ausdrücklichen Wunsch («ohne Route»).
    availability: null,
  };
}

/** Reine Funktion: Skigebiete nach Fahrzeit einteilen, Filter anwenden, bewerten. */
export function assembleSki(
  input: SearchInput,
  rows: SkiCandidateRow[],
  driveOf: (row: SkiCandidateRow) => DriveTime | null,
  ctx: AssembleContext,
): SkiSections {
  const limit = input.maxMinutes + input.toleranceMinutes;
  const results: SearchResult[] = [];
  const suggestions: SearchResult[] = [];
  const unrouted: SearchResult[] = [];
  let excludedUnknownSnow = 0;
  const hidden = emptyHidden();
  const av = ctx.availability;

  for (const r of rows) {
    const hasAccess = r.th_id !== null && r.drive_lat !== null && r.drive_lng !== null;
    const drive = hasAccess ? driveOf(r) : null;
    if (hasAccess && (!drive || round1(drive.minutes) > limit)) continue; // ausserhalb der Reichweite

    // Verfügbarkeit: ohne verlässlichen Live-Betriebsstatus nie «verfügbar».
    const availability = av
      ? evaluateSkiResort(
          {
            lat: r.lat, lng: r.lng, topElevM: r.elevation_top_m, baseElevM: r.elevation_base_m, slfRegionId: r.slf_region_id,
            lifts: { liftsOpen: r.lifts_open, liftsTotal: r.lifts_total, source: r.lift_source, capturedAt: toIsoOrNull(r.captured_at) },
            snowTopCm: r.snow_depth_top_cm, snowValleyCm: r.snow_depth_valley_cm, snowAt: toIsoOrNull(r.captured_at),
            forecast: r.weather_cell ? av.conditions.forecasts.get(r.weather_cell) : undefined,
          },
          av.conditions, av.plan, av.now,
        )
      : null;
    if (!isVisible(availability, av)) {
      countHidden(hidden, availability!);
      continue;
    }

    // Lawinenstufe: Messwert des letzten Laufs, sonst aktuelles Bulletin der Region.
    const avalanche = r.avalanche_level ?? (r.slf_region_id ? (ctx.avalanche.get(r.slf_region_id)?.level ?? null) : null);
    const live: LiveStatus | null = r.captured_at
      ? {
          capturedAt: toIso(r.captured_at),
          temperatureC: r.temperature_c,
          weatherCode: r.weather_code,
          visibilityM: r.visibility_m,
          windKmh: r.wind_kmh,
          snowDepthValleyCm: r.snow_depth_valley_cm,
          snowDepthTopCm: r.snow_depth_top_cm,
          freshSnowCm: r.fresh_snow_cm,
          avalancheLevel: avalanche,
          liftsOpen: r.lifts_open,
          // Gesamtzahl der Anlagen ist statisch (OSM); «offen» nur mit Live-Quelle.
          liftsTotal: r.lifts_total,
          slopesOpenKm: r.slopes_open_km,
          trailStatus: null,
          liftSource: r.lift_source,
        }
      : avalanche !== null
        ? {
            capturedAt: new Date().toISOString(), temperatureC: null, weatherCode: null, visibilityM: null, windKmh: null,
            snowDepthValleyCm: null, snowDepthTopCm: null, freshSnowCm: null, avalancheLevel: avalanche, liftsOpen: null,
            liftsTotal: r.lifts_total, slopesOpenKm: null, trailStatus: null, liftSource: null,
          }
        : null;

    if (input.minSnowCm !== undefined && input.minSnowCm > 0) {
      const snow = live?.snowDepthTopCm ?? null;
      if (snow === null) {
        excludedUnknownSnow++;
        continue;
      }
      if (snow < input.minSnowCm) continue;
    }

    const trendScore = trend(r);
    const { score, breakdown } = computeScore({ mode: 'ski', live, trend: trendScore, liftsTotal: r.lifts_total });
    const level = live?.avalancheLevel ?? null;
    const blocked = level !== null && level >= 4;
    const gap = r.road_snap_m ?? 0;
    const status: RoutingStatus = !drive ? 'no_route' : gap > ROAD_GAP_PARTIAL_M ? 'partial' : 'ok';
    const minutes = drive ? round1(drive.minutes) : null;
    const within = minutes !== null && minutes <= input.maxMinutes;

    const result: SearchResult = {
      id: r.id, name: r.name, type: 'ski_resort', canton: r.canton, location: { lat: r.lat, lng: r.lng },
      elevationBaseM: r.elevation_base_m, elevationTopM: r.elevation_top_m, sacDifficulty: null, ascentM: null,
      distanceKm: null, wikipediaTitle: r.wikipedia_title, slfRegionId: r.slf_region_id, poiKind: null,
      objectClass: r.object_class, qualityScore: r.quality_score, routeStatus: 'not_applicable', sourceLayer: r.source_layer,
      driveMinutes: minutes, driveEstimated: false, routingProvider: ctx.routing.provider, routingStatus: status,
      routeDistanceKm: drive ? round1(drive.distanceKm) : null, routingUpdatedAt: ctx.routing.graphBuiltAt,
      distanceAirKm: airKm(input, r.lat, r.lng),
      trailhead:
        r.th_id !== null && r.th_lat !== null && r.th_lng !== null
          ? {
              id: r.th_id, kind: 'valley_station', name: r.th_name, location: { lat: r.th_lat, lng: r.th_lng },
              elevationM: r.th_elev, quality: r.th_quality ?? 1, roadGapM: r.road_snap_m,
            }
          : null,
      hike: null, hikeVariants: 0,
      ski: {
        liftsTotal: r.lifts_total, liftsByType: r.lifts_by_type ?? {}, pisteKm: r.piste_km,
        pisteKmByDifficulty: r.piste_km_by_difficulty ?? {}, grouping: r.grouping,
      },
      score, scoreBreakdown: breakdown, live, trend: trendScore, blocked,
      blockedReason: blocked ? `Lawinengefahr Stufe ${level} – nicht empfohlen` : null,
      overBudgetMinutes: minutes === null || within ? null : Math.ceil(minutes - input.maxMinutes),
      availability,
    };

    if (minutes === null) unrouted.push(result);
    else (within ? results : suggestions).push(result);
  }

  sortResults(results);
  sortSuggestions(suggestions);
  unrouted.sort((a, b) => a.distanceAirKm - b.distanceAirKm);
  return { results, suggestions, unrouted, excludedUnknownSnow, hidden };
}

// ── Zwischenspeicher, Sortierung und Seiten ──────────────────────────────────

/** Vollständiges Ergebnis einer Suche (alle Abschnitte, unsortiert nach Nutzerwunsch). */
export interface FullSearch {
  results: SearchResult[];
  suggestions: SearchResult[];
  sacUnknown: SearchResult[];
  unrouted: SearchResult[];
  hidden: HiddenCounts;
  meta: Omit<SearchResponse['meta'], 'cached' | 'tookMs'>;
}

declare global {
  var __peakrSearchCache: Map<string, { at: number; full: FullSearch }> | undefined;
}
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 16;

/**
 * Schlüssel aus Start (auf ~11 m gerundet), allen Filtern, Modus und Datenstand.
 * Sortierung und Seite gehören nicht dazu: sie werden aus dem gespeicherten
 * Gesamtergebnis bedient.
 */
export function searchCacheKey(input: SearchInput, dataVersion: string | null, plan: TourPlan | null = null, timeBucket = 0): string {
  return JSON.stringify([
    input.origin.lat.toFixed(4), input.origin.lng.toFixed(4), input.mode, input.maxMinutes, input.toleranceMinutes,
    [...(input.kinds ?? [])].sort(), input.maxSac ?? null, input.includeUnknownSac, input.maxHikeMinutes ?? null,
    input.includeUnrouted, input.minElevationM ?? null, input.minSnowCm ?? null, dataVersion,
    // Verfügbarkeit hängt von Planung und Uhrzeit ab (Alter der Daten, Tageslicht).
    plan ? `${plan.date}T${plan.startHour}` : null, input.includeUncertain, timeBucket,
  ]);
}

export function clearSearchResponseCache(): void {
  globalThis.__peakrSearchCache = new Map();
}

type Sort = SearchInput['sort'];

function sortSection(list: SearchResult[], sort: Sort): SearchResult[] {
  if (sort === 'score') return list; // Abschnitte liegen bereits nach Bewertung sortiert vor
  const key: (r: SearchResult) => number =
    sort === 'drive'
      ? (r) => r.driveMinutes ?? Infinity
      : sort === 'hike'
        ? (r) => r.hike?.durationUpMin ?? Infinity
        : sort === 'elevation'
          ? (r) => -(r.elevationTopM ?? -1)
          : (r) => -(r.live?.snowDepthTopCm ?? -1);
  return [...list].sort((a, b) => key(a) - key(b) || b.score - a.score || a.name.localeCompare(b.name));
}

/** Schneidet aus dem Gesamtergebnis die angeforderte Seite und baut die Kartenpunkte. */
export function pageResponse(full: FullSearch, input: SearchInput, cached: boolean, tookMs: number): SearchResponse {
  const sections: [SearchSection, SearchResult[]][] = [
    ['result', sortSection(full.results, input.sort)],
    ['suggestion', sortSection(full.suggestions, input.sort)],
    ['sac_unknown', sortSection(full.sacUnknown, input.sort)],
    ['unrouted', full.unrouted],
  ];
  const totals = {
    results: full.results.length,
    suggestions: full.suggestions.length,
    sacUnknown: full.sacUnknown.length,
    unrouted: full.unrouted.length,
    hiddenUncertain: full.hidden.uncertain,
    excludedUnavailable: full.hidden.unavailable,
    hiddenReasons: full.hidden.reasons,
  };
  const total = full.results.length + full.suggestions.length + full.sacUnknown.length + full.unrouted.length;
  const meta = { ...full.meta, cached, tookMs };

  if (input.ids && input.ids.length > 0) {
    const wanted = new Set(input.ids);
    const items: SearchItem[] = [];
    for (const [section, list] of sections) for (const r of list) if (wanted.has(r.id)) items.push({ ...r, section });
    return { items, totals, points: [], page: { offset: 0, limit: items.length, hasMore: false }, meta };
  }

  const items: SearchItem[] = [];
  let skip = input.offset;
  for (const [section, list] of sections) {
    if (items.length >= input.limit) break;
    if (skip >= list.length) {
      skip -= list.length;
      continue;
    }
    for (let i = skip; i < list.length && items.length < input.limit; i++) items.push({ ...list[i], section });
    skip = 0;
  }

  const points: MapPoint[] = [];
  if (input.offset === 0) {
    for (const [section, list] of sections) {
      for (const r of list) {
        points.push([
          r.id, r.name, r.location.lat, r.location.lng, r.type === 'ski_resort' ? 'ski' : (r.poiKind ?? 'peak'),
          section, r.score, r.driveMinutes,
        ]);
      }
    }
  }
  return {
    items,
    totals,
    points,
    page: { offset: input.offset, limit: input.limit, hasMore: input.offset + items.length < total },
    meta,
  };
}

/**
 * Kern-Suche: Fahrzeitfeld → räumlicher Vorfilter im Suchindex → Fahrzeit je
 * Kandidat → Auswahl → Bewertung. Die Datenbank liefert nur Live-Daten.
 */
/**
 * Interne Optionen (nicht über die API erreichbar): `skipAvailability` prüft nur
 * Fahrzeit und Daten, ohne Verfügbarkeitsfilter – für Datenqualitätstests und
 * Diagnose. Die Website sucht immer mit Prüfung.
 */
export interface SearchOptions {
  skipAvailability?: boolean;
}

export async function search(input: SearchInput, opts: SearchOptions = {}): Promise<SearchResponse> {
  const started = Date.now();
  const now = new Date();
  const index = getSearchIndex();
  const [live, cond] = await Promise.all([getLiveContext(input.mode === 'ski'), getConditions()]);
  const plan = resolvePlan(input.plan, now);
  // Datenstand = Suchindex + letzter Worker-Lauf; ohne Live-Daten eigener Schlüssel,
  // damit eine Antwort ohne Wetter nicht nach der Störung weiter ausgeliefert wird.
  const dataVersion = index
    ? `${index.builtAt}|${live.ok ? (live.liveVersion ?? '-') : 'nolive'}|${cond.ok ? 'cond' : 'nocond'}`
    : null;
  const cache = (globalThis.__peakrSearchCache ??= new Map());
  const key = searchCacheKey(input, dataVersion, plan, Math.floor(now.getTime() / 1_800_000)) + (opts.skipAvailability ? '|ohne-pruefung' : '');
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return pageResponse(cached.full, input, true, Date.now() - started);
  }
  const full = computeSearch(input, dataVersion, live, {
    conditions: cond.conditions,
    plan,
    now,
    includeUncertain: input.includeUncertain,
  }, opts.skipAvailability === true);
  // Ohne Strassennetz/Index nichts merken: sobald die Daten da sind, soll die Suche sofort funktionieren.
  if (full.meta.routing.status !== 'unavailable') {
    cache.set(key, { at: Date.now(), full });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  }
  return pageResponse(full, input, false, Date.now() - started);
}

function computeSearch(
  input: SearchInput,
  dataVersion: string | null,
  live: LiveContext,
  availability: AvailabilitySettings,
  skipAvailability = false,
): FullSearch {
  const info = graphInfo();
  const index = getSearchIndex();
  const limit = input.maxMinutes + input.toleranceMinutes;
  const base = { provider: ROUTING_PROVIDER, graphBuiltAt: info.graphBuiltAt, osmTimestamp: info.osmTimestamp };
  const metaFor = (status: 'ok' | 'unavailable', candidates: number, originSnapM: number | null, excludedUnknownSnow = 0) => ({
    candidatesEvaluated: candidates,
    routing: { ...base, status, originSnapM },
    excludedUnknownSnow,
    liveData: live.ok ? ('ok' as const) : ('unavailable' as const),
    plan: availability.plan,
    conditions: conditionsMeta(availability.conditions),
    dataVersion,
    generatedAt: new Date().toISOString(),
  });

  // Ohne Strassennetz oder Suchindex gibt es keine Fahrzeit bzw. keine Kandidaten –
  // also auch keine Treffer «in Reichweite». Keine Schätzung als Ersatz.
  const drive = index ? computeDriveContext(input.origin, limit) : ({ status: 'unavailable' } as const);
  if (drive.status === 'origin_off_road') {
    throw new AppError(422, 'ORIGIN_OFF_ROAD', 'Vom Startort aus ist im Umkreis von 3 km keine Strasse erreichbar.');
  }
  if (drive.status === 'unavailable' || !index) {
    return { results: [], suggestions: [], sacUnknown: [], unrouted: [], hidden: emptyHidden(), meta: metaFor('unavailable', 0, null) };
  }

  const { ctx } = drive;
  const assembleCtx: AssembleContext = {
    weather: live.weather,
    avalanche: live.avalanche,
    routing: { provider: ROUTING_PROVIDER, graphBuiltAt: info.graphBuiltAt },
    availability: skipAvailability ? undefined : availability,
  };
  const snapM = Math.round(ctx.originSnapM);

  if (input.mode === 'ski') {
    const rows = findSkiCandidates(index, input.minElevationM, live.skiLive, live.trends);
    const part = assembleSki(input, rows, (r) => driveTimeTo(ctx, r.drive_lat!, r.drive_lng!), assembleCtx);
    return {
      results: part.results, suggestions: part.suggestions, sacUnknown: [], unrouted: part.unrouted, hidden: part.hidden,
      meta: metaFor('ok', rows.length, snapM, part.excludedUnknownSnow),
    };
  }

  // Vorfilter: Rechteck der innerhalb der Grenze erreichten Strassen, plus Rand
  // für Parkplätze knapp neben dem letzten erreichten Knoten.
  const b = ctx.bounds;
  const bounds = b
    ? { minLat: b.minLat - 0.01, maxLat: b.maxLat + 0.01, minLng: b.minLng - 0.015, maxLng: b.maxLng + 0.015 }
    : null;
  const rows = bounds ? findHikeCandidates(index, bounds, input.kinds, input.minElevationM, live.trends) : [];
  // Mehrere Routen teilen sich einen Ausgangspunkt: Fahrzeit je Punkt nur einmal bestimmen.
  const memo = new Map<string, DriveTime | null>();
  const driveOf = (r: HikeCandidateRow): DriveTime | null => {
    let d = memo.get(r.th_id);
    if (d === undefined) {
      d = driveTimeTo(ctx, r.drive_lat!, r.drive_lng!);
      memo.set(r.th_id, d);
    }
    return d;
  };
  const part = assembleHike(input, rows, driveOf, assembleCtx);

  let unrouted: SearchResult[] = [];
  if (input.includeUnrouted && bounds) {
    const shown = new Set([...part.results, ...part.suggestions, ...part.sacUnknown].map((r) => r.id));
    unrouted = findUnroutedDestinations(index, bounds, input.kinds, input.minElevationM)
      .filter((r) => !shown.has(r.id))
      .map((r) => unroutedResult(input, r, assembleCtx, 'no_route'))
      .sort((a, b2) => a.distanceAirKm - b2.distanceAirKm);
  }
  return { ...part, unrouted, meta: metaFor('ok', rows.length, snapM) };
}
