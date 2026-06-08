import type { LiveStatus, TrendScore } from '@ch-alpineroute/shared';
import { describe, expect, it } from 'vitest';
import { avalanchePenalty, computeScore } from './score.service';

const live = (over: Partial<LiveStatus> = {}): LiveStatus => ({
  capturedAt: new Date().toISOString(),
  temperatureC: -3,
  weatherCode: 0,
  visibilityM: 20000,
  windKmh: 10,
  snowDepthValleyCm: 50,
  snowDepthTopCm: 150,
  freshSnowCm: 0,
  avalancheLevel: 1,
  liftsOpen: 10,
  liftsTotal: 10,
  slopesOpenKm: 30,
  trailStatus: 'open',
  ...over,
});

const trend = (score: number): TrendScore => ({
  score,
  rationale: null,
  source: 'wikipedia',
  isEstimate: true,
  updatedAt: null,
});

describe('score.service', () => {
  it('Ski: Breakdown summiert sich (mit Abzug) zum total und bleibt 0..100', () => {
    const { score, breakdown } = computeScore({ mode: 'ski', live: live(), trend: trend(80) });
    const sum =
      breakdown.base +
      breakdown.snow +
      breakdown.freshSnow +
      breakdown.liftsOpen +
      breakdown.conditions +
      breakdown.trendBonus -
      breakdown.avalanchePenalty;
    expect(breakdown.total).toBe(Math.min(100, Math.max(0, sum)));
    expect(score).toBe(breakdown.total);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('Ski: viel Neuschnee + perfekte Bedingungen ergibt hohen Score', () => {
    const { score } = computeScore({
      mode: 'ski',
      live: live({ snowDepthTopCm: 300, freshSnowCm: 30, weatherCode: 0, visibilityM: 30000 }),
      trend: trend(90),
    });
    expect(score).toBeGreaterThan(80);
  });

  it('Ski: höhere Lawinenstufe senkt den Score', () => {
    const safe = computeScore({
      mode: 'ski',
      live: live({ avalancheLevel: 1 }),
      trend: trend(50),
    }).score;
    const risky = computeScore({
      mode: 'ski',
      live: live({ avalancheLevel: 3 }),
      trend: trend(50),
    }).score;
    expect(risky).toBeLessThan(safe);
  });

  it('avalanchePenalty steigt mit der Stufe', () => {
    expect(avalanchePenalty(1)).toBe(0);
    expect(avalanchePenalty(null)).toBe(0);
    expect(avalanchePenalty(2)).toBeLessThan(avalanchePenalty(3));
    expect(avalanchePenalty(3)).toBeLessThan(avalanchePenalty(4));
    expect(avalanchePenalty(4)).toBeLessThan(avalanchePenalty(5));
  });

  it('Wandern: kein Schnee/Lift-Beitrag, nutzt Basis + Bedingungen + Trend', () => {
    const { breakdown, score } = computeScore({
      mode: 'hike',
      live: live({ weatherCode: 0, visibilityM: 30000 }),
      trend: trend(100),
    });
    expect(breakdown.snow).toBe(0);
    expect(breakdown.freshSnow).toBe(0);
    expect(breakdown.liftsOpen).toBe(0);
    expect(breakdown.avalanchePenalty).toBe(0);
    expect(score).toBeGreaterThanOrEqual(breakdown.base);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('liefert plausiblen Score auch ohne Live-Daten (null)', () => {
    const { score } = computeScore({ mode: 'hike', live: null, trend: null });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
