import type { Geometry } from 'geojson';
import { queryClient as sql } from '../db';

/** Upsert einer SLF-Warnregion. Geometrie kommt als GeoJSON → MultiPolygon-geography. */
export async function upsertAvalancheRegion(
  id: string,
  name: string | null,
  geometry: Geometry,
): Promise<void> {
  const geomJson = JSON.stringify(geometry);
  await sql`
    INSERT INTO avalanche_regions (id, name, geom)
    VALUES (
      ${id},
      ${name},
      ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326))::geography
    )
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name, geom = EXCLUDED.geom
  `;
}

/** Verknüpft jedes Ziel mit der SLF-Region, in der es geografisch liegt (ST_Contains). */
export async function linkDestinationsToRegions(): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    WITH updated AS (
      UPDATE destinations d
      SET slf_region_id = r.id
      FROM avalanche_regions r
      WHERE ST_Contains(r.geom::geometry, d.location::geometry)
      RETURNING d.id
    )
    SELECT count(*)::int AS count FROM updated
  `;
  return rows[0]?.count ?? 0;
}

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
}

/** Existiert bereits ein Ziel mit dieser OSM-Referenz (source_ref->>'osmId')? */
export async function destinationExistsByOsmId(osmId: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM destinations WHERE source_ref->>'osmId' = ${osmId}) AS exists
  `;
  return rows[0]?.exists ?? false;
}

/** Existiert bereits ein Ziel mit gleichem Namen + Typ (für kuratierte Einträge)? */
export async function destinationExistsByNameType(name: string, type: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM destinations WHERE name = ${name} AND type = ${type}::destination_type) AS exists
  `;
  return rows[0]?.exists ?? false;
}

export async function insertDestination(d: DestinationInsert): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO destinations (
      name, type, canton, location, elevation_base_m, elevation_top_m,
      sac_difficulty, ascent_m, distance_km, wikipedia_title, source_ref
    ) VALUES (
      ${d.name},
      ${d.type}::destination_type,
      ${d.canton ?? null},
      ST_SetSRID(ST_MakePoint(${d.lng}, ${d.lat}), 4326)::geography,
      ${d.elevationBaseM ?? null},
      ${d.elevationTopM ?? null},
      ${d.sacDifficulty ?? null}::sac_difficulty,
      ${d.ascentM ?? null},
      ${d.distanceKm ?? null},
      ${d.wikipediaTitle ?? null},
      ${d.sourceRef ? JSON.stringify(d.sourceRef) : null}::jsonb
    )
    RETURNING id
  `;
  return rows[0].id;
}

export async function countDestinations(): Promise<number> {
  const rows = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM destinations`;
  return rows[0]?.count ?? 0;
}
