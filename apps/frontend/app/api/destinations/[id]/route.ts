import sql from '@/lib/server/db';
import { err, ok } from '@/lib/server/response';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return err(400, 'VALIDATION', 'Ungültige ID');

  try {
    const rows = await sql<{
      id: string; name: string; type: string; canton: string | null;
      lat: number; lng: number; elevation_base_m: number | null; elevation_top_m: number | null;
      sac_difficulty: string | null; ascent_m: number | null; distance_km: number | null;
      wikipedia_title: string | null; slf_region_id: string | null;
      poi_kind: string | null; quality_score: number | null;
      captured_at: Date | null; temperature_c: number | null; weather_code: number | null;
      visibility_m: number | null; wind_kmh: number | null; snow_depth_valley_cm: number | null;
      snow_depth_top_cm: number | null; fresh_snow_cm: number | null; avalanche_level: number | null;
      lifts_open: number | null; lifts_total: number | null; slopes_open_km: number | null;
      trail_status: string | null; trend_score: number | null; trend_rationale: string | null;
      trend_source: string | null; trend_is_estimate: boolean | null; trend_updated_at: Date | null;
    }[]>`
      SELECT d.id, d.name, d.type, d.canton,
        d.lat::float AS lat, d.lng::float AS lng,
        d.elevation_base_m, d.elevation_top_m, d.sac_difficulty, d.ascent_m, d.distance_km,
        d.wikipedia_title, d.slf_region_id, d.poi_kind, d.quality_score,
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
      WHERE d.id = ${id} LIMIT 1
    `;
    const r = rows[0];
    if (!r) return err(404, 'NOT_FOUND', 'Ziel nicht gefunden.');

    const history = await sql<Record<string, unknown>[]>`
      SELECT captured_at, temperature_c, weather_code, visibility_m, wind_kmh,
        snow_depth_valley_cm, snow_depth_top_cm, fresh_snow_cm, avalanche_level,
        lifts_open, lifts_total, slopes_open_km, trail_status
      FROM live_status WHERE destination_id = ${id} ORDER BY captured_at DESC LIMIT 60
    `;

    return ok({
      id: r.id, name: r.name, type: r.type, canton: r.canton,
      location: { lat: r.lat, lng: r.lng }, elevationBaseM: r.elevation_base_m,
      elevationTopM: r.elevation_top_m, sacDifficulty: r.sac_difficulty,
      ascentM: r.ascent_m, distanceKm: r.distance_km, wikipediaTitle: r.wikipedia_title,
      slfRegionId: r.slf_region_id, poiKind: r.poi_kind, qualityScore: r.quality_score,
      live: r.captured_at ? {
        capturedAt: r.captured_at.toISOString(), temperatureC: r.temperature_c, weatherCode: r.weather_code,
        visibilityM: r.visibility_m, windKmh: r.wind_kmh, snowDepthValleyCm: r.snow_depth_valley_cm,
        snowDepthTopCm: r.snow_depth_top_cm, freshSnowCm: r.fresh_snow_cm, avalancheLevel: r.avalanche_level,
        liftsOpen: r.lifts_open, liftsTotal: r.lifts_total, slopesOpenKm: r.slopes_open_km, trailStatus: r.trail_status,
      } : null,
      trend: r.trend_score == null ? null : {
        score: r.trend_score, rationale: r.trend_rationale, source: r.trend_source,
        isEstimate: r.trend_is_estimate ?? true, updatedAt: r.trend_updated_at?.toISOString() ?? null,
      },
      history: history.map(h => ({
        capturedAt: new Date(h.captured_at as string).toISOString(),
        temperatureC: h.temperature_c as number | null, weatherCode: h.weather_code as number | null,
        visibilityM: h.visibility_m as number | null, windKmh: h.wind_kmh as number | null,
        snowDepthValleyCm: h.snow_depth_valley_cm as number | null, snowDepthTopCm: h.snow_depth_top_cm as number | null,
        freshSnowCm: h.fresh_snow_cm as number | null, avalancheLevel: h.avalanche_level as number | null,
        liftsOpen: h.lifts_open as number | null, liftsTotal: h.lifts_total as number | null,
        slopesOpenKm: h.slopes_open_km as number | null, trailStatus: h.trail_status as string | null,
      })),
    });
  } catch (e) {
    console.error(e);
    return err(500, 'INTERNAL', 'Ziel konnte nicht geladen werden.');
  }
}
