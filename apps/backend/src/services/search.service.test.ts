import type { Destination, LiveStatus, SearchInput } from '@ch-alpineroute/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candidate } from '../repositories/destination.repo';

// Externe IO mocken, damit der Such-Service ohne DB/ORS testbar ist.
vi.mock('../repositories/destination.repo', () => ({ findCandidates: vi.fn() }));
vi.mock('./ors.service', () => ({
  isOrsConfigured: vi.fn(),
  drivingMatrixMinutes: vi.fn(),
}));

import { findCandidates } from '../repositories/destination.repo';
import { drivingMatrixMinutes, isOrsConfigured } from './ors.service';
import { assembleResponse, estimateDriveMinutes, search } from './search.service';

const destination = (id: string, name: string): Destination => ({
  id,
  name,
  type: 'ski_resort',
  canton: 'VS',
  location: { lat: 46, lng: 7.7 },
  elevationBaseM: 1600,
  elevationTopM: 3000,
  sacDifficulty: null,
  ascentM: null,
  distanceKm: null,
  wikipediaTitle: name,
  slfRegionId: '1111',
});

const live = (over: Partial<LiveStatus> = {}): LiveStatus => ({
  capturedAt: new Date().toISOString(),
  temperatureC: -2,
  weatherCode: 0,
  visibilityM: 20000,
  windKmh: 8,
  snowDepthValleyCm: 60,
  snowDepthTopCm: 180,
  freshSnowCm: 10,
  avalancheLevel: 1,
  liftsOpen: 8,
  liftsTotal: 10,
  slopesOpenKm: 25,
  trailStatus: 'open',
  ...over,
});

const candidate = (id: string, airKm: number, over: Partial<LiveStatus> = {}): Candidate => ({
  destination: destination(id, `Ziel-${id}`),
  airKm,
  live: live(over),
  trend: { score: 60, rationale: null, source: 'wikipedia', isEstimate: true, updatedAt: null },
});

const input: SearchInput = {
  origin: { lat: 46.2, lng: 7.5 },
  mode: 'ski',
  maxMinutes: 60,
  toleranceMinutes: 15,
};

describe('search.service – assembleResponse', () => {
  it('teilt in results (≤ max) und suggestions (≤ max + Toleranz) auf; jenseits wird verworfen', () => {
    const cands = [candidate('a', 20), candidate('b', 40), candidate('c', 80)];
    const drive = [30, 70, 200]; // a=within, b=suggestion(+10), c=verworfen
    const res = assembleResponse(input, cands, drive, true);

    expect(res.results.map((r) => r.id)).toEqual(['a']);
    expect(res.suggestions.map((r) => r.id)).toEqual(['b']);
    expect(res.suggestions[0].overBudgetMinutes).toBe(10);
    expect(res.results[0].overBudgetMinutes).toBeNull();
    expect(res.meta.matrixUsed).toBe(true);
  });

  it('verwirft unerreichbare Kandidaten (Fahrzeit null)', () => {
    const res = assembleResponse(input, [candidate('a', 20)], [null], true);
    expect(res.results).toHaveLength(0);
    expect(res.suggestions).toHaveLength(0);
  });

  it('Sicherheits-Gate: Ski-Ziel mit Lawinenstufe ≥4 wird blockiert und ans Ende sortiert', () => {
    const cands = [candidate('safe', 20), candidate('danger', 10, { avalancheLevel: 4 })];
    const res = assembleResponse(input, cands, [30, 25], true);

    const danger = res.results.find((r) => r.id === 'danger');
    expect(danger?.blocked).toBe(true);
    expect(danger?.blockedReason).toContain('Lawinengefahr');
    // blockiert steht nach nicht-blockiert
    expect(res.results[res.results.length - 1].id).toBe('danger');
  });

  it('sortiert nicht-blockierte Ergebnisse nach Score absteigend', () => {
    const cands = [
      candidate('low', 20, { snowDepthTopCm: 0, freshSnowCm: 0, liftsOpen: 0, liftsTotal: 10 }),
      candidate('high', 25, { snowDepthTopCm: 300, freshSnowCm: 30 }),
    ];
    const res = assembleResponse(input, cands, [30, 35], true);
    expect(res.results[0].id).toBe('high');
    expect(res.results[0].score).toBeGreaterThanOrEqual(res.results[1].score);
  });
});

describe('search.service – estimateDriveMinutes', () => {
  it('ist monoton steigend mit der Luftlinie', () => {
    expect(estimateDriveMinutes(10)).toBeLessThan(estimateDriveMinutes(50));
    expect(estimateDriveMinutes(0)).toBe(0);
  });
});

describe('search.service – search (gemockte externe Calls)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('nutzt die ORS-Matrix, wenn konfiguriert', () => {
    vi.mocked(findCandidates).mockResolvedValue([candidate('a', 20), candidate('b', 40)]);
    vi.mocked(isOrsConfigured).mockReturnValue(true);
    vi.mocked(drivingMatrixMinutes).mockResolvedValue([30, 50]);

    return search(input).then((res) => {
      expect(drivingMatrixMinutes).toHaveBeenCalledOnce();
      expect(res.meta.matrixUsed).toBe(true);
      expect(res.results).toHaveLength(2);
    });
  });

  it('fällt auf Luftlinien-Schätzung zurück, wenn ORS nicht konfiguriert ist', () => {
    vi.mocked(findCandidates).mockResolvedValue([candidate('a', 20)]);
    vi.mocked(isOrsConfigured).mockReturnValue(false);

    return search(input).then((res) => {
      expect(drivingMatrixMinutes).not.toHaveBeenCalled();
      expect(res.meta.matrixUsed).toBe(false);
    });
  });

  it('gibt leere Antwort zurück, wenn keine Kandidaten gefunden werden', () => {
    vi.mocked(findCandidates).mockResolvedValue([]);
    vi.mocked(isOrsConfigured).mockReturnValue(true);

    return search(input).then((res) => {
      expect(res.results).toHaveLength(0);
      expect(res.meta.candidatesEvaluated).toBe(0);
      expect(drivingMatrixMinutes).not.toHaveBeenCalled();
    });
  });
});
