import { queryClient as sql } from '../db';

/**
 * Fügt einen Wanderweg-Abschnitt (LineString oder MultiLineString als WKT/GeoJSON)
 * in hiking_routes ein. Doppelte osmId werden übersprungen.
 */
export async function insertHikingRoute(
  osmId: string | null,
  source: string,
  geomGeoJson: string,
): Promise<void> {
  await sql`
    INSERT INTO hiking_routes (osm_id, source, geom)
    VALUES (
      ${osmId},
      ${source},
      ST_SetSRID(ST_GeomFromGeoJSON(${geomGeoJson}), 4326)::geography
    )
    ON CONFLICT (osm_id) DO NOTHING
  `;
}

/** Anzahl vorhandener Routen (für Skip-Check). */
export async function countHikingRoutes(): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM hiking_routes
  `;
  return rows[0]?.count ?? 0;
}

/**
 * Gibt die Distanz (m) vom Punkt zum nächsten Wanderweg zurück.
 * NULL wenn die Tabelle leer ist (kein Routing-Import gelaufen).
 */
export async function nearestHikingRouteM(lat: number, lng: number): Promise<number | null> {
  const rows = await sql<{ dist: number | null }[]>`
    SELECT ST_Distance(
      geom,
      ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
    )::int AS dist
    FROM hiking_routes
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
    LIMIT 1
  `;
  return rows[0]?.dist ?? null;
}

/**
 * Batch-Variante: berechnet für alle Destinations ohne nearest_route_m die Distanz
 * und schreibt sie zurück. Nutzt PostGIS KNN-Index (<->) für Performance.
 */
export async function updateNearestRouteDistances(): Promise<number> {
  // Arbeitet nur wenn hiking_routes Daten enthält
  const count = await countHikingRoutes();
  if (count === 0) return 0;

  const rows = await sql<{ updated: number }[]>`
    WITH nearest AS (
      SELECT
        d.id AS dest_id,
        (
          SELECT ST_Distance(hr.geom, d.location)::int
          FROM hiking_routes hr
          ORDER BY hr.geom <-> d.location
          LIMIT 1
        ) AS dist_m
      FROM destinations d
      WHERE d.type != 'ski_resort'
        AND d.nearest_route_m IS NULL
    )
    UPDATE destinations d
    SET nearest_route_m = n.dist_m
    FROM nearest n
    WHERE d.id = n.dest_id
    RETURNING 1
  `;
  return rows.length;
}

/** Löscht alle Wanderwege (für Re-Import). */
export async function clearHikingRoutes(): Promise<void> {
  await sql`TRUNCATE hiking_routes`;
}
