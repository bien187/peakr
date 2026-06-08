import type { DestinationWithStatus } from '@ch-alpineroute/shared';
import { queryClient as sql } from '../db';

export async function addFavorite(userId: string, destinationId: string): Promise<void> {
  await sql`
    INSERT INTO favorites (user_id, destination_id)
    VALUES (${userId}, ${destinationId})
    ON CONFLICT (user_id, destination_id) DO NOTHING
  `;
}

export async function removeFavorite(userId: string, destinationId: string): Promise<void> {
  await sql`DELETE FROM favorites WHERE user_id = ${userId} AND destination_id = ${destinationId}`;
}

interface FavoriteRow {
  id: string;
  name: string;
  type: DestinationWithStatus['type'];
  canton: string | null;
  lat: number;
  lng: number;
  elevation_base_m: number | null;
  elevation_top_m: number | null;
  sac_difficulty: DestinationWithStatus['sacDifficulty'];
  ascent_m: number | null;
  distance_km: number | null;
  wikipedia_title: string | null;
  slf_region_id: string | null;
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
  favorited_at: Date;
}

export async function listFavorites(userId: string): Promise<DestinationWithStatus[]> {
  const rows = await sql<FavoriteRow[]>`
    SELECT d.id, d.name, d.type, d.canton,
      ST_Y(d.location::geometry) AS lat, ST_X(d.location::geometry) AS lng,
      d.elevation_base_m, d.elevation_top_m, d.sac_difficulty, d.ascent_m, d.distance_km,
      d.wikipedia_title, d.slf_region_id,
      ls.captured_at, ls.temperature_c, ls.weather_code, ls.visibility_m, ls.wind_kmh,
      ls.snow_depth_valley_cm, ls.snow_depth_top_cm, ls.fresh_snow_cm, ls.avalanche_level,
      ls.lifts_open, ls.lifts_total, ls.slopes_open_km, ls.trail_status,
      ts.score AS trend_score, ts.rationale AS trend_rationale, ts.source AS trend_source,
      ts.is_estimate AS trend_is_estimate, ts.updated_at AS trend_updated_at,
      f.created_at AS favorited_at
    FROM favorites f
    JOIN destinations d ON d.id = f.destination_id
    LEFT JOIN LATERAL (
      SELECT * FROM live_status l WHERE l.destination_id = d.id ORDER BY l.captured_at DESC LIMIT 1
    ) ls ON true
    LEFT JOIN trend_scores ts ON ts.destination_id = d.id
    WHERE f.user_id = ${userId}
    ORDER BY f.created_at DESC
  `;

  return rows.map((r) => ({
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
    live: r.captured_at
      ? {
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
        }
      : null,
    trend:
      r.trend_score == null
        ? null
        : {
            score: r.trend_score,
            rationale: r.trend_rationale,
            source: r.trend_source,
            isEstimate: r.trend_is_estimate ?? true,
            updatedAt: r.trend_updated_at ? r.trend_updated_at.toISOString() : null,
          },
  }));
}
