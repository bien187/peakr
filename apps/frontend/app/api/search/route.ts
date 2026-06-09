import { isInSwitzerland, searchInputSchema } from '@ch-alpineroute/shared';
import type { LiveStatus, Mode, ScoreBreakdown, TrendScore } from '@ch-alpineroute/shared';
import sql from '@/lib/server/db';
import { err, ok } from '@/lib/server/response';

// ─── Score ────────────────────────────────────────────────────────────────────

function conditionsScore(live: LiveStatus | null, mode: Mode, max: number): number {
  if (!live) return Math.round(max * 0.5);
  let vis = 0.5;
  if (live.visibilityM != null) vis = live.visibilityM >= 10000 ? 1 : live.visibilityM >= 4000 ? 0.7 : live.visibilityM >= 1500 ? 0.4 : 0.1;
  let wth = 0.6;
  const wc = live.weatherCode;
  if (wc != null) {
    if (wc <= 1) wth = 1; else if (wc <= 3) wth = 0.8; else if (wc <= 48) wth = 0.45;
    else if (mode === 'ski' && wc >= 71 && wc <= 77) wth = 0.85; else wth = 0.3;
  }
  return Math.round((vis * 0.5 + wth * 0.5) * max);
}

function computeScore(mode: Mode, live: LiveStatus | null, trend: TrendScore | null, qualityScore: number | null) {
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  const qb = qualityScore != null ? Math.round((qualityScore / 100) * 5) : 2;
  const tb = Math.round(((trend?.score ?? 0) / 100) * 5);

  if (mode === 'ski') {
    const base = 25;
    const snow = Math.round(Math.min(30, (live?.snowDepthTopCm ?? live?.snowDepthValleyCm ?? 0) / 10));
    const fresh = Math.round(Math.min(15, (live?.freshSnowCm ?? 0) * 1.5));
    const lifts = live?.liftsTotal ? Math.round((Math.min(live.liftsOpen ?? 0, live.liftsTotal) / live.liftsTotal) * 10) : 0;
    const cond = conditionsScore(live, mode, 10);
    const penalty = [0, 0, 3, 12, 30, 50][live?.avalancheLevel ?? 0] ?? 0;
    const total = clamp(base + snow + fresh + lifts + cond + qb + tb - penalty);
    return { score: total, breakdown: { base, snow, freshSnow: fresh, liftsOpen: lifts, conditions: cond, avalanchePenalty: penalty, trendBonus: tb, total } satisfies ScoreBreakdown };
  }
  const base = 50, cond = conditionsScore(live, mode, 25);
  const total = clamp(base + cond + qb + tb);
  return { score: total, breakdown: { base, snow: 0, freshSnow: 0, liftsOpen: 0, conditions: cond, avalanchePenalty: 0, trendBonus: tb, total } satisfies ScoreBreakdown };
}

// ─── Route ────────────────────────────────────────────────────────────────────

interface CandidateRow {
  id: string; name: string; type: string; canton: string | null;
  lat: number; lng: number; elevation_base_m: number | null; elevation_top_m: number | null;
  sac_difficulty: string | null; ascent_m: number | null; distance_km: number | null;
  wikipedia_title: string | null; slf_region_id: string | null;
  poi_kind: string | null; quality_score: number | null; air_m: number;
  captured_at: Date | null; temperature_c: number | null; weather_code: number | null;
  visibility_m: number | null; wind_kmh: number | null; snow_depth_valley_cm: number | null;
  snow_depth_top_cm: number | null; fresh_snow_cm: number | null; avalanche_level: number | null;
  lifts_open: number | null; lifts_total: number | null; slopes_open_km: number | null;
  trail_status: string | null; trend_score: number | null; trend_rationale: string | null;
  trend_source: string | null; trend_is_estimate: boolean | null; trend_updated_at: Date | null;
}

export async function POST(req: Request) {
  try {
    const body = searchInputSchema.safeParse(await req.json());
    if (!body.success) return err(400, 'VALIDATION', body.error.errors[0]?.message ?? 'Ungültige Eingabe');
    const input = body.data;
    if (!isInSwitzerland(input.origin)) return err(400, 'OUT_OF_BOUNDS', 'Startort liegt außerhalb der Schweiz.');

    const { lat, lng } = input.origin;
    const radiusM = (input.maxMinutes + input.toleranceMinutes) * 1500;

    const typeCond = input.mode === 'ski'
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
      SELECT d.id, d.name, d.type, d.canton,
        ST_Y(d.location::geometry) AS lat, ST_X(d.location::geometry) AS lng,
        d.elevation_base_m, d.elevation_top_m, d.sac_difficulty, d.ascent_m, d.distance_km,
        d.wikipedia_title, d.slf_region_id, d.poi_kind, d.quality_score,
        ST_Distance(d.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS air_m,
        ls.captured_at, ls.temperature_c, ls.weather_code, ls.visibility_m, ls.wind_kmh,
        ls.snow_depth_valley_cm, ls.snow_depth_top_cm, ls.fresh_snow_cm, ls.avalanche_level,
        ls.lifts_open, ls.lifts_total, ls.slopes_open_km, ls.trail_status,
        ts.score AS trend_score, ts.rationale AS trend_rationale, ts.source AS trend_source,
        ts.is_estimate AS trend_is_estimate, ts.updated_at AS trend_updated_at
      FROM destinations d
      LEFT JOIN LATERAL (
        SELECT * FROM live_status l WHERE l.destination_id = d.id ORDER BY l.captured_at DESC LIMIT 1
      ) ls ON true
      LEFT JOIN trend_scores ts ON ts.destination_id = d.id
      WHERE ST_DWithin(d.location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusM})
        AND ${typeCond} ${sacCond}
      ORDER BY air_m ASC LIMIT 200
    `;

    type Item = { blocked: boolean; score: number; driveMinutes: number; overBudgetMinutes: number | null };
    const results: Item[] = [], suggestions: Item[] = [];
    for (const r of rows) {
      const airKm = Math.round((r.air_m / 1000) * 10) / 10;
      const driveMin = Math.round(((airKm * 1.4) / 50) * 60 * 10) / 10;
      const within = driveMin <= input.maxMinutes;
      const withinTol = driveMin <= input.maxMinutes + input.toleranceMinutes;
      if (!within && !withinTol) continue;

      const live: LiveStatus | null = r.captured_at ? {
        capturedAt: r.captured_at.toISOString(), temperatureC: r.temperature_c, weatherCode: r.weather_code,
        visibilityM: r.visibility_m, windKmh: r.wind_kmh, snowDepthValleyCm: r.snow_depth_valley_cm,
        snowDepthTopCm: r.snow_depth_top_cm, freshSnowCm: r.fresh_snow_cm, avalancheLevel: r.avalanche_level,
        liftsOpen: r.lifts_open, liftsTotal: r.lifts_total, slopesOpenKm: r.slopes_open_km, trailStatus: r.trail_status,
      } : null;
      const trend: TrendScore | null = r.trend_score == null ? null : {
        score: r.trend_score, rationale: r.trend_rationale, source: r.trend_source,
        isEstimate: r.trend_is_estimate ?? true, updatedAt: r.trend_updated_at?.toISOString() ?? null,
      };

      const { score, breakdown } = computeScore(input.mode as Mode, live, trend, r.quality_score);
      const blocked = input.mode === 'ski' && (live?.avalancheLevel ?? 0) >= 4;

      const item = {
        id: r.id, name: r.name, type: r.type, canton: r.canton,
        location: { lat: r.lat, lng: r.lng }, elevationBaseM: r.elevation_base_m,
        elevationTopM: r.elevation_top_m, sacDifficulty: r.sac_difficulty, ascentM: r.ascent_m,
        distanceKm: r.distance_km, wikipediaTitle: r.wikipedia_title, slfRegionId: r.slf_region_id,
        poiKind: r.poi_kind, qualityScore: r.quality_score,
        driveMinutes: driveMin, driveEstimated: true, distanceAirKm: airKm,
        score, scoreBreakdown: breakdown, live, trend, blocked,
        blockedReason: blocked ? `Lawinengefahr Stufe ${live?.avalancheLevel} – nicht empfohlen` : null,
        overBudgetMinutes: within ? null : Math.round(driveMin - input.maxMinutes),
      };
      (within ? results : suggestions).push(item);
    }

    results.sort((a, b) => Number(a.blocked) - Number(b.blocked) || b.score - a.score || a.driveMinutes - b.driveMinutes);
    suggestions.sort((a, b) => Number(a.blocked) - Number(b.blocked) || (a.overBudgetMinutes ?? 0) - (b.overBudgetMinutes ?? 0) || b.score - a.score);

    return ok({ results, suggestions, meta: { candidatesEvaluated: rows.length, matrixUsed: false, generatedAt: new Date().toISOString() } });
  } catch (e) {
    console.error(e);
    return err(500, 'INTERNAL', 'Suche fehlgeschlagen.');
  }
}
