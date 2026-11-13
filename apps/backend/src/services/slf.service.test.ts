import { describe, expect, it } from 'vitest';
import { normalizeRegionId, parseBulletins, parseDangerLevel } from './slf.service';

describe('SLF-Bulletin', () => {
  it('liest die Gefahrenstufe als Wort (CAAML v6) und als Zahl', () => {
    expect(parseDangerLevel('moderate')).toBe(2);
    expect(parseDangerLevel('very_high')).toBe(5);
    expect(parseDangerLevel(3)).toBe(3);
    expect(parseDangerLevel('3')).toBe(3);
    expect(parseDangerLevel('no_snow')).toBeNull();
    expect(parseDangerLevel(undefined)).toBeNull();
  });

  it('normalisiert Regions-IDs', () => {
    expect(normalizeRegionId('CH-1111')).toBe('1111');
    expect(normalizeRegionId('1111')).toBe('1111');
  });

  it('nimmt je Region die höchste Stufe aller Bulletins', () => {
    const map = parseBulletins([
      { regions: [{ regionID: 'CH-1111' }, { regionID: 'CH-2222' }], dangerRatings: [{ mainValue: 'low' }, { mainValue: 'moderate' }], validTime: { endTime: 'x' } },
      { regions: [{ regionID: 'CH-2222' }], dangerRatings: [{ mainValue: 'considerable' }] },
      { regions: [{ regionID: 'CH-3333' }], dangerRatings: [{ mainValue: 'no_rating' }] },
    ]);
    expect(map.get('1111')?.level).toBe(2);
    expect(map.get('2222')?.level).toBe(3);
    expect(map.has('3333')).toBe(false);
  });

  it('übernimmt Höhenlage und Expositionen der Kernzone, darunter eine Stufe tiefer', () => {
    // Struktur wie im Bulletin vom 15.02.2026: «erheblich (3) an SW über N bis SO über 1800 m»
    const map = parseBulletins([
      {
        regions: [{ regionID: 'CH-1222' }],
        validTime: { endTime: '2026-02-15T16:00:00Z' },
        dangerRatings: [{ mainValue: 'considerable' }],
        avalancheProblems: [
          { problemType: 'wind_slab', dangerRatingValue: 'considerable', elevation: { lowerBound: 1800, upperBound: null }, aspects: ['N', 'NE', 'E', 'SE', 'SW', 'W', 'NW'] },
          { problemType: 'persistent_weak_layers', dangerRatingValue: 'considerable', elevation: { lowerBound: 'treeline' }, aspects: ['N'] },
        ],
      },
    ]);
    const info = map.get('1222')!;
    expect(info.level).toBe(3);
    expect(info.ratings).toContainEqual({ level: 3, lowerM: 1800, upperM: null, aspects: ['N', 'NE', 'E', 'SE', 'SW', 'W', 'NW'] });
    expect(info.ratings).toContainEqual({ level: 3, lowerM: 1800, upperM: null, aspects: ['N'] });
    expect(info.ratings).toContainEqual({ level: 2, lowerM: null, upperM: null, aspects: [] });
  });

  it('gilt ohne Höhenangabe überall', () => {
    const info = parseBulletins([{ regions: [{ regionID: '7111' }], dangerRatings: [{ mainValue: 'moderate' }] }]).get('7111')!;
    expect(info.ratings).toEqual([{ level: 2, lowerM: null, upperM: null, aspects: [] }]);
  });
});
