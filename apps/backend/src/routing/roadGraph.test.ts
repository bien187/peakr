import { describe, expect, it } from 'vitest';
import { decodeRoadGraph, driveTimesFrom, encodeRoadGraph, snapToRoad, TIME_UNIT_S } from './roadGraph';

/**
 * Kleines Netz:  0 ──60 s── 1 ──60 s── 2
 *                 \                    /
 *                  └──────300 s───────┘      3 isoliert
 */
function sample() {
  const coords = [
    [47.0, 8.0],
    [47.0, 8.01],
    [47.0, 8.02],
    [47.5, 8.5],
  ];
  const adj: [number, number, number][][] = [
    [[1, 60, 760], [2, 300, 1600]],
    [[0, 60, 760], [2, 60, 760]],
    [[1, 60, 760], [0, 300, 1600]],
    [],
  ];
  const offsets = new Uint32Array(coords.length + 1);
  const targets: number[] = [];
  const time: number[] = [];
  const len: number[] = [];
  adj.forEach((edges, i) => {
    offsets[i] = targets.length;
    for (const [t, s, m] of edges) {
      targets.push(t);
      time.push(Math.round(s / TIME_UNIT_S));
      len.push(m);
    }
  });
  offsets[coords.length] = targets.length;
  const bytes = encodeRoadGraph({
    builtAt: 1_700_000_000,
    osmTimestamp: 1_699_000_000,
    nodeCount: coords.length,
    edgeCount: targets.length,
    lat: Int32Array.from(coords.map((c) => Math.round(c[0] * 1e7))),
    lng: Int32Array.from(coords.map((c) => Math.round(c[1] * 1e7))),
    offsets,
    targets: Uint32Array.from(targets),
    timeDs: Uint16Array.from(time),
    lenM: Uint16Array.from(len),
  });
  return decodeRoadGraph(bytes);
}

describe('roadGraph', () => {
  it('übersteht Kodieren und Dekodieren verlustfrei', () => {
    const g = sample();
    expect(g.nodeCount).toBe(4);
    expect(g.edgeCount).toBe(6);
    expect(g.osmTimestamp).toBe(1_699_000_000);
  });

  it('findet den schnellsten Weg statt der direkten Kante', () => {
    const f = driveTimesFrom(sample(), 0, 3600);
    expect(f.timeS[2]).toBeCloseTo(120, 3);
    expect(f.distM[2]).toBe(1520);
  });

  it('nicht verbundene Knoten bleiben unerreichbar (keine Schätzung)', () => {
    const f = driveTimesFrom(sample(), 0, 3600);
    expect(Number.isFinite(f.timeS[3])).toBe(false);
  });

  it('bricht an der Zeitgrenze ab', () => {
    const f = driveTimesFrom(sample(), 0, 90);
    expect(f.timeS[1]).toBeCloseTo(60, 3);
    // Knoten 2 wird zwar vorgemerkt (120 s), aber nicht mehr als erreicht abgeschlossen.
    expect(f.settled).toBe(2);
  });

  it('rastet auf den nächsten Knoten ein und respektiert den Suchradius', () => {
    const g = sample();
    const near = snapToRoad(g, 47.0003, 8.0101, 500);
    expect(near?.node).toBe(1);
    expect(near!.distM).toBeLessThan(50);
    expect(snapToRoad(g, 47.2, 8.2, 500)).toBeNull();
  });
});
