import { describe, expect, it } from 'vitest';
import { pageviewsToScore } from './wikipedia.service';

describe('wikipedia.service – pageviewsToScore', () => {
  it('bleibt immer im Bereich 1..100 und ist eine Schätzung', () => {
    for (const v of [null, 0, -5, 1, 100, 5000, 1_000_000]) {
      const { score, isEstimate } = pageviewsToScore(v);
      expect(score).toBeGreaterThanOrEqual(1);
      expect(score).toBeLessThanOrEqual(100);
      expect(isEstimate).toBe(true);
    }
  });

  it('ist monoton: mehr Aufrufe => nicht kleinerer Score', () => {
    const a = pageviewsToScore(100).score;
    const b = pageviewsToScore(5000).score;
    const c = pageviewsToScore(100_000).score;
    expect(a).toBeLessThanOrEqual(b);
    expect(b).toBeLessThanOrEqual(c);
  });

  it('gibt für 0/null den Minimalscore 1', () => {
    expect(pageviewsToScore(0).score).toBe(1);
    expect(pageviewsToScore(null).score).toBe(1);
  });
});
