import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../../lib/logger';
import { download, run } from '../io/files';
import { ensureDirs, PATHS } from '../paths';

/**
 * Schritt «prepare»: Rohdaten laden und mit osmium vorfiltern.
 *
 * OpenStreetMap kommt als kompletter Schweiz-Auszug von Geofabrik (täglich neu)
 * und wird lokal gefiltert. Öffentliche Overpass-Server werden nicht mehr
 * verwendet: kein Rate-Limit, keine Obergrenze der Treffer, reproduzierbar.
 */

const UA_HEADERS = { 'user-agent': 'peakr-data-pipeline/1.0 (+https://github.com/bien187/peakr)' };
const STAC = 'https://data.geo.admin.ch/api/stac/v0.9/collections';
const GEOFABRIK = 'https://download.geofabrik.de/europe/switzerland-latest.osm.pbf';

interface StacItem {
  id: string;
  properties: { datetime?: string };
  assets: Record<string, { href: string }>;
}

/** Neuesten Stand eines swisstopo-Datensatzes über die STAC-API finden. */
async function latestAsset(collection: string, suffix: string): Promise<{ href: string; version: string }> {
  const res = await fetch(`${STAC}/${collection}/items?limit=100`, { headers: UA_HEADERS });
  if (!res.ok) throw new Error(`STAC ${collection}: HTTP ${res.status}`);
  const body = (await res.json()) as { features: StacItem[] };
  const items = [...body.features].sort((a, b) =>
    (a.properties.datetime ?? '').localeCompare(b.properties.datetime ?? ''),
  );
  for (let i = items.length - 1; i >= 0; i--) {
    const asset = Object.values(items[i].assets).find((a) => a.href.endsWith(suffix));
    if (asset) return { href: asset.href, version: (items[i].properties.datetime ?? items[i].id).slice(0, 10) };
  }
  throw new Error(`STAC ${collection}: kein Asset mit Endung ${suffix} gefunden`);
}

export interface SourcesMeta {
  osm: { url: string; timestamp: string | null };
  swissnames3d: { url: string; version: string };
  wanderwege: { url: string; version: string };
  preparedAt: string;
}

export function readSourcesMeta(): SourcesMeta {
  if (!existsSync(PATHS.sourcesMeta)) {
    throw new Error('Rohdaten fehlen. Zuerst «pnpm pipeline prepare» ausführen.');
  }
  return JSON.parse(readFileSync(PATHS.sourcesMeta, 'utf8')) as SourcesMeta;
}

function newer(source: string, target: string): boolean {
  return !existsSync(target) || statSync(source).mtimeMs > statSync(target).mtimeMs;
}

export async function prepare(opts: { maxAgeHours: number }): Promise<SourcesMeta> {
  ensureDirs();

  const names = await latestAsset('ch.swisstopo.swissnames3d', '_2056.csv.zip');
  const trails = await latestAsset('ch.swisstopo.swisstlm3d-wanderwege', '.gpkg.zip');

  // Amtliche Datensätze ändern sich höchstens jährlich bzw. monatlich.
  const namesDl = await download(names.href, PATHS.namesZip, Math.max(opts.maxAgeHours, 24 * 30));
  if (namesDl.downloaded || !existsSync(resolve(PATHS.namesDir, 'swissNAMES3D_PKT.csv'))) {
    await run('unzip', ['-o', '-q', PATHS.namesZip, '-d', PATHS.namesDir]);
  }
  const trailsDl = await download(trails.href, PATHS.trailsZip, Math.max(opts.maxAgeHours, 24 * 14));
  if (trailsDl.downloaded || trailGeoPackage(false) === null) {
    await run('unzip', ['-o', '-q', PATHS.trailsZip, '-d', PATHS.trailsDir]);
  }

  await download(GEOFABRIK, PATHS.osmPbf, opts.maxAgeHours);
  const osmTimestamp = (
    await run('osmium', ['fileinfo', '-g', 'header.option.osmosis_replication_timestamp', PATHS.osmPbf])
  ).trim();

  if (newer(PATHS.osmPbf, PATHS.networkOpl)) {
    logger.info('osmium: Strassen- und Wegnetz filtern …');
    await run('osmium', [
      'tags-filter', PATHS.osmPbf,
      'w/highway', 'w/aerialway', 'w/piste:type', 'w/route=ferry,shuttle_train',
      '-o', PATHS.networkPbf, '--overwrite',
    ]);
    await run('osmium', [
      'add-locations-to-ways', PATHS.networkPbf,
      '-o', PATHS.networkOpl, '-f', 'opl,add_metadata=false', '--overwrite',
    ]);
  }
  if (newer(PATHS.osmPbf, PATHS.poisGeoJson)) {
    logger.info('osmium: Ziele, Parkplätze und Skigebietsflächen filtern …');
    await run('osmium', [
      'tags-filter', PATHS.osmPbf,
      'nwr/amenity=parking', 'nwr/natural=peak,saddle,water',
      'nwr/tourism=alpine_hut,wilderness_hut,viewpoint', 'nwr/landuse=winter_sports',
      'r/site=piste', 'nwr/mountain_pass=yes', 'n/place=city,town,village,hamlet',
      'nwr/aerialway=station',
      '-o', PATHS.poisPbf, '--overwrite',
    ]);
    await run('osmium', [
      'export', PATHS.poisPbf, '-f', 'geojsonseq', '--add-unique-id=type_id',
      '-o', PATHS.poisGeoJson, '--overwrite',
    ]);
  }
  if (newer(PATHS.osmPbf, PATHS.cantonsGeoJson)) {
    await run('osmium', ['tags-filter', PATHS.osmPbf, 'r/admin_level=4', '-o', PATHS.cantonsPbf, '--overwrite']);
    await run('osmium', [
      'export', PATHS.cantonsPbf, '-f', 'geojsonseq', '--geometry-types=polygon',
      '-o', PATHS.cantonsGeoJson, '--overwrite',
    ]);
  }

  const meta: SourcesMeta = {
    osm: { url: GEOFABRIK, timestamp: osmTimestamp || null },
    swissnames3d: { url: names.href, version: names.version },
    wanderwege: { url: trails.href, version: trails.version },
    preparedAt: new Date().toISOString(),
  };
  writeFileSync(PATHS.sourcesMeta, JSON.stringify(meta, null, 2));
  logger.info(meta, 'Rohdaten bereit');
  return meta;
}

/** Pfad zum entpackten Wanderwege-GeoPackage. */
export function trailGeoPackage(required = true): string | null {
  if (existsSync(PATHS.trailsDir)) {
    const file = readdirSync(PATHS.trailsDir).find((f) => f.toLowerCase().endsWith('.gpkg'));
    if (file) return resolve(PATHS.trailsDir, file);
  }
  if (required) throw new Error('Wanderwege-GeoPackage fehlt. Zuerst «pnpm pipeline prepare» ausführen.');
  return null;
}
