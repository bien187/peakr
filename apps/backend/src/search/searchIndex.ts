import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { SEARCH_INDEX_PATH } from '../config/env';
import { logger } from '../lib/logger';
import { SAC_GRADES, SEARCH_INDEX_FORMAT, TRAILHEAD_KINDS, type SearchIndexFile } from './indexFormat';

export interface IndexDestination {
  id: string;
  ski: boolean;
  name: string;
  canton: string | null;
  lat: number;
  lng: number;
  elevationTopM: number | null;
  elevationBaseM: number | null;
  poiKind: string | null;
  objectClass: string | null;
  qualityScore: number | null;
  importance: number | null;
  wikipediaTitle: string | null;
  slfRegionId: string | null;
  sourceLayer: string | null;
  weatherCell: string | null;
  routed: boolean;
}

export interface IndexTrailhead {
  id: string;
  kind: (typeof TRAILHEAD_KINDS)[number];
  name: string | null;
  lat: number;
  lng: number;
  driveLat: number | null;
  driveLng: number | null;
  roadSnapM: number | null;
  elevationM: number | null;
  quality: number;
  fee: string | null;
  capacity: string | null;
}

export interface IndexRoute {
  id: number;
  dest: IndexDestination;
  trailhead: IndexTrailhead;
  rank: number;
  distanceM: number;
  ascentM: number;
  descentM: number;
  durationUpMin: number;
  durationDownMin: number;
  minElevM: number | null;
  maxElevM: number | null;
  sacMin: string | null;
  sacMax: string | null;
  sacKnownShare: number;
  officialShare: number;
  endGapM: number;
}

export interface IndexSki {
  dest: IndexDestination;
  trailhead: IndexTrailhead | null;
  liftsTotal: number;
  liftsByType: Record<string, number>;
  pisteKm: number | null;
  pisteKmByDifficulty: Record<string, number>;
  grouping: string;
}

export interface SearchIndex {
  builtAt: string;
  graphBuiltAt: string | null;
  routeSource: string;
  routesComputedAt: string | null;
  destinations: IndexDestination[];
  routes: IndexRoute[];
  ski: IndexSki[];
}

declare global {
  var __peakrSearchIndex: { index: SearchIndex | null } | undefined;
}

const sac = (n: number): string | null => (n > 0 ? SAC_GRADES[n - 1] : null);

export function parseSearchIndex(file: SearchIndexFile): SearchIndex {
  if (file.format !== SEARCH_INDEX_FORMAT) {
    throw new Error(`Suchindex: Format ${file.format} wird nicht unterstützt (erwartet ${SEARCH_INDEX_FORMAT}).`);
  }
  const destinations: IndexDestination[] = file.destinations.map((d) => ({
    id: d[0], ski: d[1] === 1, name: d[2], canton: d[3], lat: d[4], lng: d[5], elevationTopM: d[6], elevationBaseM: d[7],
    poiKind: d[8], objectClass: d[9], qualityScore: d[10], importance: d[11], wikipediaTitle: d[12], slfRegionId: d[13],
    sourceLayer: d[14], weatherCell: d[15], routed: d[16] === 1,
  }));
  const trailheads: IndexTrailhead[] = file.trailheads.map((t) => ({
    id: t[0], kind: TRAILHEAD_KINDS[t[1]], name: t[2], lat: t[3], lng: t[4], driveLat: t[5], driveLng: t[6],
    roadSnapM: t[7], elevationM: t[8], quality: t[9], fee: t[10], capacity: t[11],
  }));
  const routes: IndexRoute[] = file.routes.map((r) => ({
    id: r[0], dest: destinations[r[1]], trailhead: trailheads[r[2]], rank: r[3], distanceM: r[4], ascentM: r[5],
    descentM: r[6], durationUpMin: r[7], durationDownMin: r[8], minElevM: r[9], maxElevM: r[10], sacMin: sac(r[11]),
    sacMax: sac(r[12]), sacKnownShare: r[13], officialShare: r[14], endGapM: r[15],
  }));
  const ski: IndexSki[] = file.ski.map((s) => ({
    dest: destinations[s[0]], trailhead: s[1] >= 0 ? trailheads[s[1]] : null, liftsTotal: s[2], liftsByType: s[3],
    pisteKm: s[4], pisteKmByDifficulty: s[5], grouping: s[6],
  }));
  return {
    builtAt: file.builtAt,
    graphBuiltAt: file.graphBuiltAt,
    routeSource: file.routeSource,
    routesComputedAt: file.routesComputedAt,
    destinations,
    routes,
    ski,
  };
}

function candidatePaths(): string[] {
  return [
    SEARCH_INDEX_PATH,
    // Vercel/Next: Datei liegt im Funktions-Bundle neben der App.
    resolve(process.cwd(), 'data/search-index.json.gz'),
    resolve(process.cwd(), 'apps/frontend/data/search-index.json.gz'),
    resolve(process.cwd(), '../../.data/artifacts/search-index.json.gz'),
  ];
}

/** Suchindex einmal je Prozess laden; null, wenn keine Datei vorhanden ist. */
export function getSearchIndex(): SearchIndex | null {
  const holder = globalThis.__peakrSearchIndex;
  if (holder) return holder.index;
  for (const path of candidatePaths()) {
    if (!existsSync(path)) continue;
    try {
      const started = Date.now();
      const file = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as SearchIndexFile;
      const index = parseSearchIndex(file);
      globalThis.__peakrSearchIndex = { index };
      logger.info({ path, destinations: index.destinations.length, routes: index.routes.length, ms: Date.now() - started }, 'Suchindex geladen');
      return index;
    } catch (err) {
      logger.error({ path, error: err instanceof Error ? err.message : String(err) }, 'Suchindex nicht lesbar');
    }
  }
  globalThis.__peakrSearchIndex = { index: null };
  logger.error({ tried: candidatePaths() }, 'Suchindex fehlt – die Suche liefert keine Treffer');
  return null;
}

/** Nur für Tests. */
export function setSearchIndexForTests(index: SearchIndex | null): void {
  globalThis.__peakrSearchIndex = index ? { index } : undefined;
}
