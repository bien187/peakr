import { describe, expect, it } from 'vitest';
import { sunTimes } from './sun';
import { hhmm, planDates, resolvePlan, zurichParts, zurichToUtc } from './time';

describe('Schweizer Zeit', () => {
  it('rechnet Winter- und Sommerzeit richtig um', () => {
    expect(zurichToUtc('2026-01-15', 8).toISOString()).toBe('2026-01-15T07:00:00.000Z');
    expect(zurichToUtc('2026-07-15', 8).toISOString()).toBe('2026-07-15T06:00:00.000Z');
    // Tag der Umstellung (29.03.2026, 02:00 → 03:00)
    expect(zurichToUtc('2026-03-29', 8).toISOString()).toBe('2026-03-29T06:00:00.000Z');
    expect(zurichParts(new Date('2026-11-13T23:30:00Z'))).toEqual({ date: '2026-11-14', hour: 0, minute: 30 });
  });

  it('plant ohne Angabe heute ab der nächsten Stunde, nachmittags morgen ab 8 Uhr', () => {
    expect(resolvePlan(undefined, new Date('2026-11-13T08:20:00Z'))).toEqual({ date: '2026-11-13', startHour: 10 });
    expect(resolvePlan(undefined, new Date('2026-11-13T04:10:00Z'))).toEqual({ date: '2026-11-13', startHour: 7 });
    expect(resolvePlan(undefined, new Date('2026-11-13T14:00:00Z'))).toEqual({ date: '2026-11-14', startHour: 8 });
  });

  it('setzt einen vergangenen Start auf die nächste Stunde und begrenzt auf drei Tage', () => {
    const now = new Date('2026-11-13T10:30:00Z'); // 11:30 Schweizer Zeit
    expect(resolvePlan({ date: '2026-11-13', startHour: 8 }, now)).toEqual({ date: '2026-11-13', startHour: 12 });
    expect(resolvePlan({ date: '2026-11-15', startHour: 6 }, now)).toEqual({ date: '2026-11-15', startHour: 6 });
    expect(resolvePlan({ date: '2026-11-20', startHour: 9 }, now)).toEqual({ date: '2026-11-13', startHour: 12 });
    expect(planDates(now)).toEqual(['2026-11-13', '2026-11-14', '2026-11-15']);
  });
});

describe('Sonnenauf- und -untergang', () => {
  // Referenz: Almanach für Zürich (47,377° N, 8,540° E), auf ±3 min
  const within = (d: Date | null, utc: string) => {
    expect(d).not.toBeNull();
    expect(Math.abs(d!.getTime() - Date.parse(utc)) / 60_000).toBeLessThanOrEqual(3);
  };

  it('Sommersonnenwende', () => {
    const s = sunTimes('2026-06-21', 47.377, 8.54);
    within(s.sunrise, '2026-06-21T03:28:00Z');
    within(s.sunset, '2026-06-21T19:26:00Z');
    expect(hhmm(s.sunset!)).toMatch(/^21:2[3-9]$/);
  });

  it('Wintersonnenwende', () => {
    const s = sunTimes('2026-12-21', 47.377, 8.54);
    within(s.sunrise, '2026-12-21T07:13:00Z');
    within(s.sunset, '2026-12-21T15:37:00Z');
    // Bürgerliche Dämmerung endet gut eine halbe Stunde nach Sonnenuntergang.
    const dusk = (s.dusk!.getTime() - s.sunset!.getTime()) / 60_000;
    expect(dusk).toBeGreaterThan(30);
    expect(dusk).toBeLessThan(45);
  });
});
