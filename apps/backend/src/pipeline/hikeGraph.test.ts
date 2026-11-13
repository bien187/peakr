import { describe, expect, it } from 'vitest';
import { simplifyIndices, simplifyLine } from './hikeGraph';

// 201 Punkte auf einer geraden Linie nach Osten, 5 m Abstand (1 km).
const n = 201;
const lats = Array.from({ length: n }, () => 46.5);
const lngs = Array.from({ length: n }, (_, i) => 8 + (i * 5) / (111_320 * Math.cos((46.5 * Math.PI) / 180)));

describe('simplifyIndices', () => {
  it('reduziert eine flache Gerade auf Anfang und Ende', () => {
    expect(simplifyIndices(lngs, lats, 10, new Array(n).fill(1500), 5)).toEqual([0, n - 1]);
  });

  it('behält eine Kuppe im Höhenprofil, obwohl die Linie gerade ist', () => {
    // 30 m hohe Kuppe bei 500 m: ohne Höhenkriterium ginge sie verloren.
    const elevs = Array.from({ length: n }, (_, i) => 1500 + Math.max(0, 30 - Math.abs(i - 100) * 0.6));
    const kept = simplifyIndices(lngs, lats, 10, elevs, 5);
    expect(kept).toContain(100);
    expect(simplifyIndices(lngs, lats, 10)).toEqual([0, n - 1]);
    // Jeder weggelassene Punkt liegt höchstens 5 m neben dem interpolierten Profil.
    for (let k = 0; k + 1 < kept.length; k++) {
      const [a, b] = [kept[k], kept[k + 1]];
      for (let i = a + 1; i < b; i++) {
        const interp = elevs[a] + ((i - a) / (b - a)) * (elevs[b] - elevs[a]);
        expect(Math.abs(elevs[i] - interp)).toBeLessThanOrEqual(5);
      }
    }
  });

  it('ignoriert Höhenwellen unter der Toleranz', () => {
    const elevs = Array.from({ length: n }, (_, i) => 1500 + 2 * Math.sin(i / 7));
    expect(simplifyIndices(lngs, lats, 10, elevs, 5)).toEqual([0, n - 1]);
  });

  it('übergeht unbekannte Höhen (NaN) und rechnet nur mit der Lage', () => {
    const elevs = Array.from({ length: n }, (_, i) => (i % 3 === 0 ? NaN : 1500));
    expect(simplifyIndices(lngs, lats, 10, elevs, 5)).toEqual([0, n - 1]);
  });

  it('behält seitliche Abweichungen über der Lagetoleranz', () => {
    // Ein einzelner Ausreisser von 20 m: er und seine Nachbarn (19,6 m neben der neuen Sehne) bleiben.
    const bent = lats.map((lat, i) => (i === 50 ? lat + 20 / 111_320 : lat));
    expect(simplifyIndices(lngs, bent, 10)).toEqual([0, 49, 50, 51, n - 1]);
    expect(simplifyLine(lngs, bent, 10)[2]).toEqual([Math.round(lngs[50] * 1e6) / 1e6, Math.round(bent[50] * 1e6) / 1e6]);
  });
});
