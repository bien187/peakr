import { queryClient as sql } from '../db';
import { logger } from '../lib/logger';

export interface DataSource {
  id: string;
  name: string;
  url: string;
  license: string;
  attribution: string;
  version?: string | null;
}

/** Katalog aller Datenquellen mit Lizenz und Pflicht-Attribution. */
export const SOURCES: Record<string, DataSource> = {
  swissnames3d: {
    id: 'swissnames3d',
    name: 'swisstopo swissNAMES3D',
    url: 'https://www.swisstopo.admin.ch/de/landschaftsmodell-swissnames3d',
    license: 'Open Government Data (OGD) swisstopo – freie Nutzung mit Quellenangabe',
    attribution: '© swisstopo',
  },
  swisstlm3d_wanderwege: {
    id: 'swisstlm3d_wanderwege',
    name: 'swisstopo swissTLM3D Wanderwege',
    url: 'https://opendata.swiss/de/dataset/swisstlm3d-wanderwege',
    license: 'Open Government Data (OGD) swisstopo – freie Nutzung mit Quellenangabe',
    attribution: '© swisstopo, Schweizer Wanderwege',
  },
  osm: {
    id: 'osm',
    name: 'OpenStreetMap (Geofabrik-Auszug Schweiz)',
    url: 'https://download.geofabrik.de/europe/switzerland.html',
    license: 'Open Database License (ODbL) 1.0',
    attribution: '© OpenStreetMap-Mitwirkende',
  },
  terrain_tiles: {
    id: 'terrain_tiles',
    name: 'Terrain Tiles (Mapzen/AWS Open Data)',
    url: 'https://registry.opendata.aws/terrain-tiles/',
    license: 'Offene Daten, Quellenangabe je Ursprungsdatensatz (u. a. EU-DEM, SRTM)',
    attribution: 'Terrain Tiles: Mapzen, EU-DEM © Copernicus, SRTM (NASA)',
  },
  slf: {
    id: 'slf',
    name: 'WSL-Institut für Schnee- und Lawinenforschung SLF',
    url: 'https://www.slf.ch',
    license: 'CC BY 4.0',
    attribution: '© WSL-Institut für Schnee- und Lawinenforschung SLF',
  },
  open_meteo: {
    id: 'open_meteo',
    name: 'Open-Meteo',
    url: 'https://open-meteo.com',
    license: 'CC BY 4.0, kostenlos für nicht-kommerzielle Nutzung',
    attribution: 'Wetterdaten: Open-Meteo.com',
  },
  wikipedia: {
    id: 'wikipedia',
    name: 'Wikimedia Pageviews',
    url: 'https://wikimedia.org/api/rest_v1/',
    license: 'CC0',
    attribution: 'Wikimedia Foundation',
  },
  astra_closures: {
    id: 'astra_closures',
    name: 'Sperrungen Wanderwege (geo.admin.ch)',
    url: 'https://map.geo.admin.ch/#/map?layers=ch.astra.wanderland-sperrungen_umleitungen',
    license: 'Open Government Data des Bundes – freie Nutzung mit Quellenangabe',
    attribution: 'ASTRA, Schweizer Wanderwege und kantonale Fachstellen',
  },
  meteoswiss: {
    id: 'meteoswiss',
    name: 'MeteoSchweiz (Messnetz, Radar)',
    url: 'https://www.meteoschweiz.admin.ch/service-und-publikationen/service/open-data.html',
    license: 'Open Government Data, CC BY 4.0',
    attribution: 'Quelle: MeteoSchweiz',
  },
};

export async function upsertDataSource(id: keyof typeof SOURCES, version?: string | null): Promise<void> {
  const s = SOURCES[id];
  await sql`
    INSERT INTO data_sources (id, name, url, license, attribution, version, fetched_at, updated_at)
    VALUES (${s.id}, ${s.name}, ${s.url}, ${s.license}, ${s.attribution}, ${version ?? null}, now(), now())
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, url = EXCLUDED.url, license = EXCLUDED.license,
      attribution = EXCLUDED.attribution,
      version = COALESCE(EXCLUDED.version, data_sources.version),
      fetched_at = now(), updated_at = now()
  `;
}

/**
 * Protokolliert einen Lauf in import_runs. Wirft die Funktion, wird der Lauf als
 * fehlgeschlagen vermerkt und der Fehler weitergereicht.
 */
export async function withRun<T extends Record<string, unknown>>(
  job: string,
  sourceId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const [{ id }] = await sql<{ id: number }[]>`
    INSERT INTO import_runs (job, source_id) VALUES (${job}, ${sourceId}) RETURNING id
  `;
  const started = Date.now();
  try {
    const stats = await fn();
    const status = stats.partial === true ? 'partial' : 'success';
    await sql`
      UPDATE import_runs SET status = ${status}, finished_at = now(), stats = ${sql.json(stats as never)}
      WHERE id = ${id}
    `;
    logger.info({ job, seconds: Math.round((Date.now() - started) / 1000), ...stats } as Record<string, unknown>, `✅ ${job}`);
    return stats;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`
      UPDATE import_runs SET status = 'failed', finished_at = now(), error = ${message.slice(0, 2000)}
      WHERE id = ${id}
    `.catch(() => undefined);
    logger.error({ job, error: message }, `❌ ${job}`);
    throw err;
  }
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await sql`
    INSERT INTO app_meta (key, value, updated_at) VALUES (${key}, ${sql.json(value as never)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

export async function getMeta<T>(key: string): Promise<T | null> {
  const rows = await sql<{ value: T }[]>`SELECT value FROM app_meta WHERE key = ${key}`;
  return rows[0]?.value ?? null;
}

/** Teilt ein Array in Blöcke fester Grösse. */
export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
