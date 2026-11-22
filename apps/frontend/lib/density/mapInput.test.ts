import { describe, expect, it } from 'vitest';
import type { PPoint } from '@/lib/peakr';
import { fitPoints, heatPoints } from './mapInput';

const pt = (id: string, over: Partial<PPoint> = {}): PPoint => ({
  id, name: id, lat: 47.3, lng: 8.5, kind: 'peak', type: 'hike', section: 'result', score: 50, driveMin: 20, status: 'available', ...over,
});

describe('Heatmap und Kartenausschnitt: nur Treffer innerhalb der Fahrzeit', () => {
  it('«≤ 30 min +60»: 728 Treffer leuchten, die 5174 «knapp ausserhalb» nicht', () => {
    const points = [
      ...Array.from({ length: 728 }, (_, i) => pt(`r${i}`, { driveMin: 10 + (i % 20) })),
      ...Array.from({ length: 5174 }, (_, i) => pt(`s${i}`, { section: 'suggestion', driveMin: 31 + (i % 59) })),
    ];
    expect(heatPoints(points)).toHaveLength(728);
    expect(fitPoints(points)).toHaveLength(728);
    expect(Math.max(...fitPoints(points).map((p) => p.driveMin ?? 0))).toBeLessThanOrEqual(30);
  });

  it('ohne Treffer zeigt der Ausschnitt die Vorschläge (Heatmap bleibt leer)', () => {
    const points = [pt('s1', { section: 'suggestion', driveMin: 40 }), pt('u1', { section: 'unrouted', driveMin: null })];
    expect(heatPoints(points)).toHaveLength(0);
    expect(fitPoints(points).map((p) => p.id)).toEqual(['s1']);
  });

  it('unsichere Treffer zählen mit, nicht verfügbare, unbekannte Schwierigkeit und Ziele ohne Route nicht', () => {
    const points = [
      pt('a'),
      pt('u', { status: 'uncertain' }),
      pt('x', { status: 'unavailable' }),
      pt('k', { section: 'sac_unknown' }),
      pt('n', { section: 'unrouted', driveMin: null }),
    ];
    expect(heatPoints(points).map((p) => p.id)).toEqual(['a', 'u']);
    expect(heatPoints(points).every((p) => p.weight === 1)).toBe(true);
  });
});
