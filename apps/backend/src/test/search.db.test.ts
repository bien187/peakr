/**
 * Geografische Testmatrix gegen die echte Datenbank und den echten Strassengraphen.
 *
 * Je Region ein Startort, 90 min Fahrzeit, 10 min Toleranz. Geprüft wird:
 *  – bekannte Gipfel werden gefunden (amtliche swissNAMES3D-Schreibweise),
 *  – ihre Fahrzeit liegt in einem realistischen Bereich (Strassenroute bis zum Ausgangspunkt),
 *  – die Abschnitte halten die Zeitgrenzen exakt ein,
 *  – nichts wird stillschweigend abgeschnitten.
 */
import { searchInputSchema, type SearchResponse } from '@ch-alpineroute/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { queryClient } from '../db';
import { search } from '../services/search.service';
import { getDestinationDetail } from '../repositories/destination.repo';

interface Case {
  region: string;
  origin: { lat: number; lng: number };
  /** Gipfel → erlaubter Bereich der Autofahrzeit in Minuten. */
  peaks: Record<string, [number, number]>;
  /** Skigebiete, die in 100 min erreichbar sein müssen. */
  ski: string[];
}

const MATRIX: Case[] = [
  {
    region: 'Zürich',
    origin: { lat: 47.3779, lng: 8.5403 },
    peaks: { Uetliberg: [10, 30], 'Rigi Kulm': [30, 60], 'Gross Mythen': [35, 70], Säntis: [60, 95], Hörnli: [20, 45], Bachtel: [30, 55] },
    ski: ['Hoch-Ybrig', 'Flumserberg'],
  },
  {
    region: 'Zentralschweiz (Luzern)',
    origin: { lat: 47.0502, lng: 8.3093 },
    peaks: { 'Rigi Kulm': [20, 45], Stanserhorn: [20, 50], Napf: [35, 65], Tomlishorn: [10, 45] },
    ski: ['Engelberg-Titlis'],
  },
  {
    region: 'Berner Oberland (Interlaken)',
    origin: { lat: 46.6863, lng: 7.8632 },
    peaks: { Niesen: [20, 50], Schilthorn: [8, 30], Faulhorn: [30, 65], Stockhorn: [35, 70], Harderkulm: [3, 25] },
    ski: ['Mürren/Schilthorn', 'Adelboden - Lenk'],
  },
  {
    region: 'Wallis (Sion)',
    origin: { lat: 46.2276, lng: 7.3594 },
    peaks: { 'Pierre Avoi': [25, 60], 'Bella Tola': [30, 60], Sasseneire: [30, 65] },
    ski: ['Crans-Montana', 'Saas Fee'],
  },
  {
    region: 'Graubünden (Chur)',
    origin: { lat: 46.8508, lng: 9.532 },
    peaks: { Hochwang: [10, 35], Stätzerhorn: [15, 45], Pizol: [20, 50], 'Piz Beverin': [50, 95] },
    ski: ['Arosa Lenzerheide', 'Laax-Flims-Falera'],
  },
  {
    region: 'Ostschweiz (St. Gallen)',
    origin: { lat: 47.4245, lng: 9.3767 },
    peaks: { Säntis: [30, 60], Gäbris: [20, 45], Kronberg: [25, 55], 'Hoher Kasten': [45, 85] },
    ski: [],
  },
  {
    region: 'Tessin (Lugano)',
    origin: { lat: 46.0037, lng: 8.9511 },
    peaks: { 'Monte Brè': [10, 30], 'Monte Generoso': [20, 45], 'Monte Lema': [20, 45], 'Monte San Giorgio': [5, 30] },
    ski: ['Airolo - Pesciüm'],
  },
  {
    region: 'Jura (Delémont)',
    origin: { lat: 47.3653, lng: 7.3446 },
    peaks: { Chasseral: [45, 80], Hasenmatt: [40, 75], 'Mont Raimeux': [20, 45] },
    ski: [],
  },
];

const run = (raw: Record<string, unknown>): Promise<SearchResponse> =>
  // Datenqualität und Fahrzeit unabhängig von der Tagesverfügbarkeit prüfen (Schnee, Betrieb …).
  search(searchInputSchema.parse({ maxMinutes: 90, toleranceMinutes: 10, ...raw }), { skipAvailability: true });

afterAll(async () => {
  await queryClient.end({ timeout: 5 });
});

describe.each(MATRIX)('$region', ({ origin, peaks, ski }) => {
  it('findet bekannte Gipfel mit realistischer Fahrzeit bis zum Ausgangspunkt', async () => {
    const res = await run({ origin, mode: 'hike', kinds: ['peak'] });
    expect(res.meta.routing.status).toBe('ok');
    for (const [name, [lo, hi]] of Object.entries(peaks)) {
      const hits = res.points.filter((p) => p[1] === name && p[7] !== null);
      expect(hits.length, `${name} nicht gefunden`).toBeGreaterThan(0);
      const best = Math.min(...hits.map((p) => p[7] as number));
      expect(best, `${name}: ${best} min`).toBeGreaterThanOrEqual(lo);
      expect(best, `${name}: ${best} min`).toBeLessThanOrEqual(hi);
    }
  });

  it('hält die Zeitbereiche exakt ein und schneidet nichts ab', async () => {
    const res = await run({ origin, mode: 'hike' });
    const total = res.totals.results + res.totals.suggestions + res.totals.sacUnknown + res.totals.unrouted;
    expect(res.points).toHaveLength(total);
    for (const p of res.points) {
      if (p[5] === 'result') expect(p[7]).toBeLessThanOrEqual(90);
      if (p[5] === 'suggestion') {
        expect(p[7]).toBeGreaterThan(90);
        expect(p[7]).toBeLessThanOrEqual(100);
      }
    }
    for (const it of res.items) {
      expect(it.driveEstimated).toBe(false);
      if (it.section !== 'unrouted') {
        expect(it.trailhead).not.toBeNull();
        expect(it.hike).not.toBeNull();
        expect(it.routingStatus).toBe('ok');
      }
    }
  });

  it('SAC-Filter: Treffer bis T2 haben nur Routen bis T2, Unbekanntes steht separat', async () => {
    const res = await run({ origin, mode: 'hike', maxSac: 'T2', limit: 200 });
    for (const it of res.items) {
      if (it.section === 'result' || it.section === 'suggestion') {
        expect(it.hike?.sacMax).not.toBeNull();
        expect(['T1', 'T2']).toContain(it.hike?.sacMax);
      }
      if (it.section === 'sac_unknown') expect(it.hike?.sacMax).toBeNull();
    }
  });

  it('Skigebiete in Reichweite inkl. Zufahrt zur Talstation', async () => {
    const res = await run({ origin, mode: 'ski', maxMinutes: 100, toleranceMinutes: 0, limit: 200 });
    const names = res.items.filter((i) => i.section === 'result').map((i) => i.name);
    for (const s of ski) expect(names, `${s} fehlt`).toContain(s);
    for (const it of res.items.filter((i) => i.section === 'result')) {
      expect(it.trailhead?.kind).toBe('valley_station');
      expect(it.live?.liftsOpen ?? null).toBeNull(); // keine Live-Quelle → kein erfundener Wert
    }
  });
});

describe('Detailansicht', () => {
  it('liefert Routen mit Geometrie vom Ausgangspunkt bis nahe ans Ziel', async () => {
    const res = await run({ origin: MATRIX[0].origin, mode: 'hike', kinds: ['peak'] });
    const id = res.points.find((p) => p[1] === 'Rigi Kulm')?.[0];
    expect(id).toBeDefined();
    const found = await getDestinationDetail(id!);
    expect(found?.detail.routes.length).toBeGreaterThan(0);
    for (const r of found!.detail.routes) {
      expect(r.line.length).toBeGreaterThan(5);
      expect(r.ascentM).toBeGreaterThan(100);
      expect(r.endGapM).toBeLessThan(300);
    }
  });
});

describe('Datenbestand', () => {
  it('deckt alle 26 Kantone ab und hat keine Ziele ausserhalb der Schweiz', async () => {
    const [row] = await queryClient<{ cantons: number; outside: number }[]>`
      SELECT count(DISTINCT canton)::int AS cantons,
             count(*) FILTER (WHERE canton IS NULL)::int AS outside
      FROM destinations WHERE retired_at IS NULL AND type = 'hike_destination'
    `;
    expect(row.cantons).toBe(26);
    expect(row.outside).toBe(0);
  });

  it('keine Wanderziele unter willkürlicher Mindesthöhe ausgeschlossen (Mittelland und Jura vorhanden)', async () => {
    const [row] = await queryClient<{ low: number }[]>`
      SELECT count(*)::int AS low FROM destinations
      WHERE retired_at IS NULL AND poi_kind = 'peak' AND elevation_top_m < 1200
    `;
    expect(row.low).toBeGreaterThan(1000);
  });
});

describe('Verfügbarkeit mit echten Daten', () => {
  it('bewertet jeden Treffer und blendet nur nach Regel aus', async () => {
    const res = await search(
      searchInputSchema.parse({ origin: { lat: 47.3769, lng: 8.5417 }, mode: 'hike', maxMinutes: 90, toleranceMinutes: 10 }),
    );
    expect(res.items.length).toBeGreaterThan(0);
    for (const item of res.items) {
      // Ohne «unsichere zeigen» erscheinen nur verfügbare Ziele, jeweils mit allen fünf Prüfungen.
      expect(item.availability?.status).toBe('available');
      expect(item.availability?.checks.map((c) => c.kind)).toEqual(['closure', 'avalanche', 'snow', 'weather', 'daylight']);
    }
    const all = await search(
      searchInputSchema.parse({ origin: { lat: 47.3769, lng: 8.5417 }, mode: 'hike', maxMinutes: 90, toleranceMinutes: 10, includeUncertain: true }),
    );
    expect(all.totals.results + all.totals.suggestions).toBeGreaterThanOrEqual(res.totals.results + res.totals.suggestions);
    expect(all.totals.hiddenUncertain).toBe(0);
  }, 60_000);
});
