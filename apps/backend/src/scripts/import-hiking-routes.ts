/**
 * STEP 1 — Wanderwege-Import
 *
 * Lädt sac_scale-Wanderwege aus OSM (Overpass) als PostGIS-Geometrien in hiking_routes.
 * Die Schweiz wird in 4 Quadranten aufgeteilt, um Overpass-Timeouts zu vermeiden.
 * Bereits vorhandene Daten werden übersprungen (osmId UNIQUE constraint).
 *
 * Laufzeit: ca. 5–15 min (abhängig von Overpass-Last).
 * Muss vor import-destinations laufen wenn PostGIS-Distanzfilter genutzt werden soll.
 */

import { queryClient } from '../db';
import { logger } from '../lib/logger';
import { overpassQuery } from '../services/overpass.service';
import { hikingWaysOverpassQL } from '../services/geoAdmin.service';
import { insertHikingRoute, countHikingRoutes, clearHikingRoutes } from '../repositories/hikingRoutes.repo';

// Schweiz in 4 Quadranten (minLat, minLng, maxLat, maxLng)
const QUADRANTS: [number, number, number, number][] = [
  [45.82, 5.96, 46.83, 8.20],  // SW
  [45.82, 8.20, 46.83, 10.49], // SE
  [46.83, 5.96, 47.81, 8.20],  // NW
  [46.83, 8.20, 47.81, 10.49], // NE
];

interface OverpassWay {
  type: 'way';
  id: number;
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
}

function wayToLineStringGeoJson(way: OverpassWay): string | null {
  if (!way.geometry || way.geometry.length < 2) return null;
  const coords = way.geometry.map((n) => [n.lon, n.lat]);
  return JSON.stringify({ type: 'LineString', coordinates: coords });
}

async function importQuadrant(
  quad: [number, number, number, number],
  label: string,
): Promise<number> {
  logger.info({ label }, '⏳ Overpass-Abfrage für Wanderwege …');
  const ql = hikingWaysOverpassQL(...quad);

  let elements: OverpassWay[];
  try {
    elements = (await overpassQuery(ql)) as OverpassWay[];
  } catch (err) {
    logger.error(
      { label, error: err instanceof Error ? err.message : String(err) },
      'Overpass fehlgeschlagen – Quadrant übersprungen',
    );
    return 0;
  }

  const ways = elements.filter((e) => e.type === 'way');
  logger.info({ label, count: ways.length }, 'Ways erhalten, einfügen …');

  let inserted = 0;
  for (const way of ways) {
    const geojson = wayToLineStringGeoJson(way);
    if (!geojson) continue;
    try {
      await insertHikingRoute(`way/${way.id}`, 'osm_sac_scale', geojson);
      inserted++;
    } catch (err) {
      logger.warn(
        { osmId: `way/${way.id}`, error: err instanceof Error ? err.message : String(err) },
        'Route übersprungen',
      );
    }
  }

  logger.info({ label, inserted, total: ways.length }, '✓ Quadrant fertig');
  return inserted;
}

async function main(): Promise<void> {
  const existing = await countHikingRoutes();
  if (existing > 0) {
    logger.info(
      { existing },
      'hiking_routes bereits befüllt — überspringe Import. Für Re-Import: clearHikingRoutes() aufrufen oder Tabelle leeren.',
    );
    await queryClient.end();
    return;
  }

  let total = 0;
  for (let i = 0; i < QUADRANTS.length; i++) {
    const quad = QUADRANTS[i];
    total += await importQuadrant(quad, `Q${i + 1}`);
    if (i < QUADRANTS.length - 1) {
      await new Promise((r) => setTimeout(r, 5000)); // Overpass Rate-Limit schonen
    }
  }

  logger.info({ total }, '✅ Wanderwege-Import abgeschlossen.');
  await queryClient.end();
}

main().catch((err) => {
  logger.error(err, 'Wanderwege-Import fehlgeschlagen');
  process.exit(1);
});
