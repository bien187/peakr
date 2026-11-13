import type { SearchItem, Trailhead } from '@ch-alpineroute/shared';
import { describe, expect, it } from 'vitest';
import { adaptPoint, adaptResult, classLabel, fmtDuration, sacLabel, trailheadLabel, weatherInfo } from './peakr';

const th = (over: Partial<Trailhead> = {}): Trailhead => ({
  id: '00000000-0000-0000-0000-000000000001', kind: 'parking', name: null, location: { lat: 47, lng: 8 },
  elevationM: 992, quality: 3, roadGapM: 5, ...over,
});

describe('Anzeige', () => {
  it('SAC: unbekannt bleibt unbekannt, amtliche Kategorie als Bereich', () => {
    expect(sacLabel(null, null)).toBe('unbekannt');
    expect(sacLabel('T2', 'T3')).toBe('T2–T3');
    expect(sacLabel('T3', 'T3')).toBe('T3');
  });

  it('Dauer', () => {
    expect(fmtDuration(45)).toBe('45 min');
    expect(fmtDuration(125)).toBe('2 h 05');
    expect(fmtDuration(null)).toBe('–');
  });

  it('unbenannte Ausgangspunkte werden über die Höhe unterscheidbar', () => {
    expect(trailheadLabel(th())).toMatch(/^Parkplatz auf 992 m$/);
    expect(trailheadLabel(th({ name: 'Brunni' }))).toBe('Brunni');
    expect(trailheadLabel(th({ kind: 'valley_station', elevationM: null }))).toBe('Talstation');
  });

  it('kein «Regen» bei Frost am Ziel', () => {
    expect(weatherInfo(61, 5).label).toBe('Regen');
    expect(weatherInfo(61, -4).label).toBe('Niederschlag');
    expect(weatherInfo(null).label).toBe('Wetter unbekannt');
  });

  it('Objektarten lesbar, reine OSM-Tags ausgeblendet', () => {
    expect(classLabel('Haupthuegel')).toBe('Haupthügel');
    expect(classLabel('Huegel')).toBe('Hügel');
    expect(classLabel('OSM natural=peak')).toBeNull();
    expect(classLabel('See (OSM)')).toBe('See');
  });
});

describe('Adapter', () => {
  it('übernimmt Fahrzeit, Status und Route unverändert – nichts wird ergänzt', () => {
    const item = {
      id: 'x', name: 'Gross Mythen', type: 'hike_destination', canton: 'SZ', location: { lat: 47.03, lng: 8.68 },
      elevationBaseM: 1300, elevationTopM: 1898, sacDifficulty: 'T3', ascentM: 600, distanceKm: 2.5,
      wikipediaTitle: null, slfRegionId: null, poiKind: 'peak', objectClass: 'Hauptgipfel', qualityScore: 90,
      driveMinutes: 52.3, driveEstimated: false, routingProvider: 'peakr-osm-graph', routingStatus: 'ok',
      routeDistanceKm: 48.1, routingUpdatedAt: null, distanceAirKm: 38, trailhead: th(),
      hike: {
        routeId: 7, rank: 1, distanceKm: 2.5, ascentM: 600, descentM: 0, durationUpMin: 130, durationDownMin: 80,
        minElevM: 1300, maxElevM: 1898, sacMin: null, sacMax: null, sacKnownShare: 0, officialShare: 1, endGapM: 0,
        source: 'osm', computedAt: '2026-11-12T00:00:00Z',
      },
      hikeVariants: 2, ski: null, score: 70,
      scoreBreakdown: { base: 0, snow: 0, freshSnow: 0, liftsOpen: 0, conditions: 0, avalanchePenalty: 0, trendBonus: 0, size: 0, data: 0, total: 70 },
      live: null, trend: null, blocked: false, blockedReason: null, overBudgetMinutes: null, section: 'result',
    } as SearchItem;
    const c = adaptResult(item);
    expect(c.driveMin).toBe(52.3);
    expect(c.driveKm).toBe(48.1);
    expect(c.hike?.sacKnown).toBe(false);
    expect(c.hike?.sacLabel).toBe('unbekannt');
    expect(c.hike?.variants).toBe(2);
    expect(c.weather).toBeNull();
    expect(c.liftsOpen).toBeNull();
  });

  it('Kartenpunkt', () => {
    const p = adaptPoint(['id', 'Säntis', 47.25, 9.34, 'peak', 'suggestion', 60, 95]);
    expect(p).toMatchObject({ name: 'Säntis', kind: 'peak', type: 'hike', section: 'suggestion', driveMin: 95 });
    expect(adaptPoint(['id', 'X', 46, 9, 'ski', 'result', 50, null]).type).toBe('ski');
  });
});

describe('Planung und Verfügbarkeit', () => {
  it('Datum in Schweizer Zeit, auch kurz vor Mitternacht UTC', async () => {
    const { planDate } = await import('./peakr');
    const now = new Date('2026-11-13T23:30:00Z'); // 00:30 am 14.11. in der Schweiz
    expect(planDate(0, now)).toBe('2026-11-14');
    expect(planDate(2, now)).toBe('2026-11-16');
  });

  it('beschreibt die Planung in Worten', async () => {
    const { planLabel } = await import('./peakr');
    const now = new Date('2026-11-13T10:00:00Z');
    expect(planLabel({ date: '2026-11-13', startHour: 12 }, now)).toBe('heute ab 12 Uhr');
    expect(planLabel({ date: '2026-11-14', startHour: 8 }, now)).toBe('morgen ab 8 Uhr');
    expect(planLabel({ date: '2026-11-15', startHour: 8 }, now)).toMatch(/15\.11\. ab 8 Uhr$/);
    expect(planLabel(null, now)).toBeNull();
  });

  it('fasst die Gründe ausgeblendeter Ziele zusammen, häufigster zuerst', async () => {
    const { reasonSummary } = await import('./peakr');
    expect(reasonSummary({ snow: 250, closure: 16, daylight: 78 })).toBe('Schnee 250 · Tageslicht 78 · Sperrungen 16');
    expect(reasonSummary({})).toBe('');
  });
});
