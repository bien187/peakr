import { queryClient as sql } from '../db';

// avalanche_regions table removed (no PostGIS) — these are stubs
export async function upsertAvalancheRegion(): Promise<void> { /* no-op */ }
export async function linkDestinationsToRegions(): Promise<number> { return 0; }

export interface DestinationInsert {
  name: string;
  type: 'ski_resort' | 'hike_route' | 'hike_destination';
  canton: string | null;
  lat: number;
  lng: number;
  elevationBaseM?: number | null;
  elevationTopM?: number | null;
  sacDifficulty?: string | null;
  ascentM?: number | null;
  distanceKm?: number | null;
  wikipediaTitle?: string | null;
  sourceRef?: Record<string, unknown> | null;
  poiKind?: string | null;
  sourceLayer?: string | null;
  nearestRouteM?: number | null;
  qualityScore?: number | null;
}

export async function destinationExistsByOsmId(osmId: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM destinations WHERE source_ref->>'osmId' = ${osmId}) AS exists
  `;
  return rows[0]?.exists ?? false;
}

export async function destinationExistsByNameType(name: string, type: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM destinations WHERE name = ${name} AND type = ${type}::destination_type) AS exists
  `;
  return rows[0]?.exists ?? false;
}

export async function insertDestination(d: DestinationInsert): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO destinations (
      name, type, canton, lat, lng, elevation_base_m, elevation_top_m,
      sac_difficulty, ascent_m, distance_km, wikipedia_title, source_ref,
      poi_kind, source_layer, nearest_route_m, quality_score
    ) VALUES (
      ${d.name},
      ${d.type}::destination_type,
      ${d.canton ?? null},
      ${d.lat},
      ${d.lng},
      ${d.elevationBaseM ?? null},
      ${d.elevationTopM ?? null},
      ${d.sacDifficulty ?? null}::sac_difficulty,
      ${d.ascentM ?? null},
      ${d.distanceKm ?? null},
      ${d.wikipediaTitle ?? null},
      ${d.sourceRef ? JSON.stringify(d.sourceRef) : null}::jsonb,
      ${d.poiKind ?? null},
      ${d.sourceLayer ?? null},
      ${d.nearestRouteM ?? null},
      ${d.qualityScore ?? null}
    )
    RETURNING id
  `;
  return rows[0].id;
}

export async function updateDestinationQuality(
  id: string,
  qualityScore: number,
  nearestRouteM: number | null,
): Promise<void> {
  await sql`
    UPDATE destinations
    SET quality_score = ${qualityScore}, nearest_route_m = ${nearestRouteM ?? null}
    WHERE id = ${id}
  `;
}

/** Entfernt Duplikate (gleicher Name, < ~50m, schlechterer quality_score). Uses plain lat/lng approximation. */
export async function removeDuplicateDestinations(): Promise<number> {
  const rows = await sql<{ c: number }[]>`
    WITH dupes AS (
      SELECT d1.id
      FROM destinations d1
      JOIN destinations d2 ON
        d1.id != d2.id AND
        d1.type = d2.type AND
        abs(d1.lat - d2.lat) < 0.0005 AND abs(d1.lng - d2.lng) < 0.0007 AND
        lower(d1.name) = lower(d2.name)
      WHERE d1.type != 'ski_resort'
        AND (
          COALESCE(d1.quality_score, 0) < COALESCE(d2.quality_score, 0)
          OR (
            COALESCE(d1.quality_score, 0) = COALESCE(d2.quality_score, 0)
            AND d1.source_layer IS DISTINCT FROM 'swisstopo_names3d'
            AND d2.source_layer = 'swisstopo_names3d'
          )
        )
    )
    DELETE FROM destinations WHERE id IN (SELECT id FROM dupes)
    RETURNING 1 AS c
  `;
  return rows.length;
}

export async function removeUnqualifiedDestinations(minScore: number): Promise<number> {
  const rows = await sql<{ c: number }[]>`
    DELETE FROM destinations
    WHERE type = 'hike_destination'
      AND (quality_score IS NULL OR quality_score < ${minScore})
    RETURNING 1 AS c
  `;
  return rows.length;
}

export async function countDestinations(): Promise<number> {
  const rows = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM destinations`;
  return rows[0]?.count ?? 0;
}
