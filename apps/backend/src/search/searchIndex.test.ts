import { searchInputSchema } from '@ch-alpineroute/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeRoadGraph, encodeRoadGraph, TIME_UNIT_S } from '../routing/roadGraph';
import { SEARCH_INDEX_FORMAT, type SearchIndexFile } from './indexFormat';
import { parseSearchIndex } from './searchIndex';

/**
 * Kleiner Suchindex: ein Gipfel mit Route ab Parkplatz, ein Gipfel ohne Route,
 * ein See mit Route, ein Ausgangspunkt ohne Strassenanschluss, ein Skigebiet.
 */
function sampleFile(): SearchIndexFile {
  return {
    format: SEARCH_INDEX_FORMAT,
    builtAt: '2026-11-13T00:00:00.000Z',
    graphBuiltAt: '2026-11-13T00:00:00.000Z',
    routeSource: 'osm+swisstlm3d',
    routesComputedAt: '2026-11-13T00:00:00.000Z',
    destinations: [
      ['00000000-0000-4000-8000-000000000001', 0, 'Testgipfel', 'ZH', 47.39, 8.61, 1200, null, 'peak', 'Gipfel', 85, 3, null, null, 'swissnames3d', '473_86', 1],
      ['00000000-0000-4000-8000-000000000002', 0, 'Wegloser Gipfel', 'ZH', 47.385, 8.6, 1500, null, 'peak', 'Gipfel', 70, 3, null, null, 'swissnames3d', null, 0],
      ['00000000-0000-4000-8000-000000000003', 0, 'Testsee', 'ZH', 47.381, 8.605, 900, null, 'lake', 'See', 70, 2, null, null, 'swissnames3d', null, 1],
      ['00000000-0000-4000-8000-000000000004', 1, 'Testskigebiet', 'ZH', 47.4, 8.62, 1800, 1000, null, 'Skigebiet', 80, 3, null, null, 'osm', null, 0],
    ],
    trailheads: [
      ['00000000-0000-4000-8000-0000000000a1', 0, 'Parkplatz Test', 47.38, 8.6, 47.38, 8.6, 5, 700, 3, 'yes', '20'],
      ['00000000-0000-4000-8000-0000000000a2', 1, null, 47.38, 8.6, null, null, null, 700, 1, null, null],
      ['00000000-0000-4000-8000-0000000000a3', 2, 'Talstation Test', 47.38, 8.6, 47.38, 8.6, 50, 1000, 3, null, null],
    ],
    routes: [
      [11, 0, 0, 1, 2500, 500, 0, 120, 80, 700, 1200, 2, 3, 1, 0.9, 3],
      [12, 2, 1, 1, 900, 50, 0, 20, 15, 700, 900, 1, 1, 1, 1, 0],
      [13, 2, 0, 2, 1200, 200, 0, 50, 35, 700, 900, 1, 1, 1, 1, 0],
    ],
    ski: [[3, 2, 12, { Sesselbahn: 4 }, 40.5, { easy: 10 }, 'winter_sports-Fläche']],
  };
}

describe('Suchindex', () => {
  it('liest Tupel korrekt zurück, inklusive SAC-Bereich und unbekannter Werte', () => {
    const idx = parseSearchIndex(sampleFile());
    expect(idx.destinations).toHaveLength(4);
    const route = idx.routes[0];
    expect(route.dest.name).toBe('Testgipfel');
    expect(route.trailhead.kind).toBe('parking');
    expect(route.sacMin).toBe('T2');
    expect(route.sacMax).toBe('T3');
    expect(idx.routes[1].trailhead.driveLat).toBeNull();
    expect(idx.ski[0].trailhead?.kind).toBe('valley_station');
    expect(idx.ski[0].dest.ski).toBe(true);
  });

  it('lehnt ein unbekanntes Dateiformat ab', () => {
    expect(() => parseSearchIndex({ ...sampleFile(), format: 999 })).toThrow(/Format/);
  });
});

describe('Kandidaten aus dem Index', () => {
  const bounds = { minLat: 47.3, maxLat: 47.5, minLng: 8.5, maxLng: 8.7 };

  it('filtert nach Rechteck, Zielart und Mindesthöhe; Ausgangspunkte ohne Strasse fallen weg', async () => {
    const { findHikeCandidates } = await import('../repositories/search.repo');
    const idx = parseSearchIndex(sampleFile());
    const all = findHikeCandidates(idx, bounds, undefined, undefined, new Map());
    // Route 12 startet an einem Punkt ohne Strassenanschluss → kein Kandidat.
    expect(all.map((r) => r.route_id).sort()).toEqual([11, 13]);
    expect(findHikeCandidates(idx, bounds, ['lake'], undefined, new Map()).map((r) => r.route_id)).toEqual([13]);
    expect(findHikeCandidates(idx, bounds, undefined, 1000, new Map()).map((r) => r.route_id)).toEqual([11]);
    expect(findHikeCandidates(idx, { ...bounds, maxLat: 47.35 }, undefined, undefined, new Map())).toHaveLength(0);
  });

  it('liefert Ziele ohne Route nur einzeln und ohne Skigebiete', async () => {
    const { findUnroutedDestinations } = await import('../repositories/search.repo');
    const idx = parseSearchIndex(sampleFile());
    expect(findUnroutedDestinations(idx, bounds, undefined, undefined).map((r) => r.name)).toEqual(['Wegloser Gipfel']);
  });
});

describe('Verbindungs-URL', () => {
  it('entfernt libpq-Parameter, die postgres.js als Startparameter an den Server schicken würde', async () => {
    const { sanitizeDatabaseUrl } = await import('../db');
    const url = sanitizeDatabaseUrl(
      'postgresql://u:p%40ss@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require&options=endpoint%3Dep-x',
    );
    expect(url).not.toMatch(/sslmode|channel_binding/);
    expect(url).toMatch(/options=endpoint%3Dep-x/);
    expect(url).toMatch(/p%40ss@ep-x-pooler/);
    expect(sanitizeDatabaseUrl('kein url')).toBe('kein url');
  });
});

describe('Suche ohne erreichbare Datenbank', () => {
  // Port 9 (discard) ist lokal nie ein Postgres: jede Live-Abfrage scheitert sofort.
  const saved = process.env.DATABASE_URL;
  beforeAll(() => {
    process.env.DATABASE_URL = 'postgresql://peakr:peakr@127.0.0.1:9/peakr';
    globalThis.__peakrSql = undefined;
    globalThis.__peakrLiveCache = undefined;
    globalThis.__peakrSearchCache = undefined;
  });
  afterAll(() => {
    process.env.DATABASE_URL = saved;
    globalThis.__peakrSql = undefined;
  });

  it('liefert Treffer mit echter Fahrzeit und meldet die fehlenden Live-Daten', async () => {
    const { setRoadGraphForTests } = await import('../routing/driveTime');
    const { setSearchIndexForTests } = await import('./searchIndex');
    const { search } = await import('../services/search.service');

    // Start (47.37, 8.54) ──10 min── Parkplatz/Talstation (47.38, 8.60)
    const lat = Int32Array.from([47.37, 47.38].map((v) => Math.round(v * 1e7)));
    const lng = Int32Array.from([8.54, 8.6].map((v) => Math.round(v * 1e7)));
    const time = Math.round(600 / TIME_UNIT_S);
    setRoadGraphForTests(
      decodeRoadGraph(
        encodeRoadGraph({
          builtAt: 1_794_528_000, osmTimestamp: 0, nodeCount: 2, edgeCount: 2, lat, lng,
          offsets: Uint32Array.from([0, 1, 2]), targets: Uint32Array.from([1, 0]),
          timeDs: Uint16Array.from([time, time]), lenM: Uint16Array.from([5000, 5000]),
        }),
      ),
    );
    setSearchIndexForTests(parseSearchIndex(sampleFile()));

    const hike = await search(
      searchInputSchema.parse({ origin: { lat: 47.37, lng: 8.54 }, mode: 'hike', maxMinutes: 30, toleranceMinutes: 0 }),
    );
    expect(hike.meta.liveData).toBe('unavailable');
    expect(hike.meta.routing.status).toBe('ok');
    expect(hike.totals.results).toBe(2);
    const peak = hike.items.find((i) => i.name === 'Testgipfel')!;
    expect(peak.driveMinutes).toBeCloseTo(10, 0);
    expect(peak.driveEstimated).toBe(false);
    expect(peak.live).toBeNull();

    // Auch über den API-Einstieg: das Rate-Limit braucht die Datenbank, darf die Suche aber nicht blockieren.
    const { apiSearch } = await import('../server');
    const viaApi = await apiSearch({ origin: { lat: 47.37, lng: 8.54 }, mode: 'hike', maxMinutes: 30, toleranceMinutes: 0 }, '198.51.100.7');
    expect(viaApi.totals.results).toBe(2);

    const ski = await search(
      searchInputSchema.parse({ origin: { lat: 47.37, lng: 8.54 }, mode: 'ski', maxMinutes: 30, toleranceMinutes: 0 }),
    );
    expect(ski.totals.results).toBe(1);
    expect(ski.items[0].ski?.liftsTotal).toBe(12);
    // Ohne Messwert keine erfundenen Schnee- oder Liftzahlen.
    expect(ski.items[0].live?.snowDepthTopCm ?? null).toBeNull();
    expect(ski.items[0].live?.liftsOpen ?? null).toBeNull();

    setRoadGraphForTests(null);
    setSearchIndexForTests(null);
    // Erstes Laden aller Server-Module dauert auf CI-Maschinen mehrere Sekunden.
  }, 30_000);
});
