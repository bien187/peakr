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
});
