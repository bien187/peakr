import { db, queryClient as sql } from '../db';
import { liveStatus } from '../db/schema';

export interface WorkerDestination {
  id: string;
  name: string;
  type: 'ski_resort' | 'hike_route' | 'hike_destination';
  canton: string | null;
  lat: number;
  lng: number;
  slfRegionId: string | null;
  wikipediaTitle: string | null;
}

export async function listDestinationsForWorker(): Promise<WorkerDestination[]> {
  const rows = await sql<
    {
      id: string;
      name: string;
      type: WorkerDestination['type'];
      canton: string | null;
      lat: number;
      lng: number;
      slf_region_id: string | null;
      wikipedia_title: string | null;
    }[]
  >`
    SELECT id, name, type, canton,
      lat::float AS lat, lng::float AS lng,
      slf_region_id, wikipedia_title
    FROM destinations
    ORDER BY name
  `;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    canton: r.canton,
    lat: r.lat,
    lng: r.lng,
    slfRegionId: r.slf_region_id,
    wikipediaTitle: r.wikipedia_title,
  }));
}

export interface LiveStatusInsert {
  destinationId: string;
  temperatureC: number | null;
  weatherCode: number | null;
  visibilityM: number | null;
  windKmh: number | null;
  snowDepthValleyCm: number | null;
  snowDepthTopCm: number | null;
  freshSnowCm: number | null;
  avalancheLevel: number | null;
  liftsOpen: number | null;
  liftsTotal: number | null;
  slopesOpenKm: number | null;
  trailStatus: string | null;
  rawPayload: unknown;
}

export async function insertLiveStatus(row: LiveStatusInsert): Promise<void> {
  await db.insert(liveStatus).values({
    destinationId: row.destinationId,
    temperatureC: row.temperatureC,
    weatherCode: row.weatherCode,
    visibilityM: row.visibilityM,
    windKmh: row.windKmh,
    snowDepthValleyCm: row.snowDepthValleyCm,
    snowDepthTopCm: row.snowDepthTopCm,
    freshSnowCm: row.freshSnowCm,
    avalancheLevel: row.avalancheLevel,
    liftsOpen: row.liftsOpen,
    liftsTotal: row.liftsTotal,
    slopesOpenKm: row.slopesOpenKm,
    trailStatus: row.trailStatus,
    rawPayload: row.rawPayload as never,
  });
}

export async function upsertTrend(
  destinationId: string,
  data: { score: number; rationale: string | null; source: string; isEstimate: boolean },
): Promise<void> {
  await sql`
    INSERT INTO trend_scores (destination_id, score, rationale, source, is_estimate, updated_at)
    VALUES (${destinationId}, ${data.score}, ${data.rationale}, ${data.source}, ${data.isEstimate}, now())
    ON CONFLICT (destination_id) DO UPDATE
      SET score = EXCLUDED.score,
          rationale = EXCLUDED.rationale,
          source = EXCLUDED.source,
          is_estimate = EXCLUDED.is_estimate,
          updated_at = now()
  `;
}
