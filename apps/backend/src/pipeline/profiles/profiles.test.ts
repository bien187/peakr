import { describe, expect, it } from 'vitest';
import { carProfile, closedByCondition, parseDuration } from './car';
import { hikeProfile, hikingMinutes, parseSacScale } from './hike';

describe('Autoprofil', () => {
  const nov = new Date(Date.UTC(2026, 10, 15));
  const jul = new Date(Date.UTC(2026, 6, 15));

  it('erkennt Wintersperren von Passstrassen', () => {
    expect(closedByCondition('no @ (Nov-May)', nov)).toBe(true);
    expect(closedByCondition('no @ (Nov-May)', jul)).toBe(false);
    expect(closedByCondition('no @ (Oct 15-Jun 15)', nov)).toBe(true);
    expect(closedByCondition('no @ winter', nov)).toBe(true);
  });

  it('ignoriert Sperren an einzelnen Wochentagen und Baustellen mit Jahreszahl', () => {
    expect(closedByCondition('no @ (Sun May-Sep)', jul)).toBe(false);
    expect(closedByCondition('no @ (2026 Nov 01-2026 Dec 01)', nov)).toBe(false);
  });

  it('liest Dauer-Tags', () => {
    expect(parseDuration('00:15')).toBe(900);
    expect(parseDuration('15')).toBe(900);
    expect(parseDuration('1:05:00')).toBe(3900);
    expect(parseDuration('abc')).toBeNull();
  });

  it('Wanderwege und private Strassen sind keine Autostrassen', () => {
    expect(carProfile({ highway: 'path' }, jul)).toBeNull();
    expect(carProfile({ highway: 'residential', access: 'private' }, jul)).toBeNull();
    expect(carProfile({ highway: 'motorway' }, jul)).not.toBeNull();
  });
});

describe('Wanderprofil', () => {
  it('liest sac_scale inkl. Mehrfachwerten', () => {
    expect(parseSacScale('hiking')).toBe(1);
    expect(parseSacScale('mountain_hiking')).toBe(2);
    expect(parseSacScale('alpine_hiking;demanding_mountain_hiking')).toBe(4);
    expect(parseSacScale(undefined)).toBe(0);
  });

  it('Autobahnen sind nicht begehbar, Wanderwege schon', () => {
    expect(hikeProfile({ highway: 'motorway' })).toBeNull();
    expect(hikeProfile({ highway: 'path', sac_scale: 'mountain_hiking' })?.sac).toBe(2);
  });

  it('Gehzeit nach DIN 33466', () => {
    // 8 km flach = 2 h
    expect(hikingMinutes(8000, 0, 0)).toBeCloseTo(120, 5);
    // 4 km, 600 Hm auf: horizontal 1 h, vertikal 2 h → 2 h + 0,5 h
    expect(hikingMinutes(4000, 600, 0)).toBeCloseTo(150, 5);
  });
});
