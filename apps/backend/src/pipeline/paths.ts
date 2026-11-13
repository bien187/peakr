import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR, ROAD_GRAPH_PATH } from '../config/env';

/** Alle Dateien der Datenpipeline an einem Ort. Jede Quelle hat ein eigenes Verzeichnis. */
export const PATHS = {
  osmPbf: resolve(DATA_DIR, 'downloads/osm/switzerland-latest.osm.pbf'),
  namesZip: resolve(DATA_DIR, 'downloads/swissnames3d/swissnames3d.csv.zip'),
  namesDir: resolve(DATA_DIR, 'downloads/swissnames3d/extracted'),
  trailsZip: resolve(DATA_DIR, 'downloads/wanderwege/wanderwege.gpkg.zip'),
  trailsDir: resolve(DATA_DIR, 'downloads/wanderwege/extracted'),
  demDir: resolve(DATA_DIR, 'downloads/terrain'),
  work: resolve(DATA_DIR, 'work'),
  networkPbf: resolve(DATA_DIR, 'work/network.osm.pbf'),
  networkOpl: resolve(DATA_DIR, 'work/network.opl'),
  poisPbf: resolve(DATA_DIR, 'work/pois.osm.pbf'),
  poisGeoJson: resolve(DATA_DIR, 'work/pois.geojsonl'),
  cantonsPbf: resolve(DATA_DIR, 'work/cantons.osm.pbf'),
  cantonsGeoJson: resolve(DATA_DIR, 'work/cantons.geojsonl'),
  sourcesMeta: resolve(DATA_DIR, 'work/sources.json'),
  roadGraph: ROAD_GRAPH_PATH,
  reports: resolve(DATA_DIR, 'reports'),
};

export function ensureDirs(): void {
  for (const dir of [PATHS.work, PATHS.demDir, PATHS.reports, resolve(PATHS.roadGraph, '..')]) {
    mkdirSync(dir, { recursive: true });
  }
}
