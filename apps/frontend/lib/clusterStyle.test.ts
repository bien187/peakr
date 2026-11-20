import { describe, expect, it } from 'vitest';
import {
  clusterAriaLabel,
  clusterCategories,
  clusterInfoLine,
  clusterScale,
  clusterSize,
  clusterTier,
  formatCount,
} from './clusterStyle';

describe('Grösse der Sammelmarkierungen', () => {
  it('wächst logarithmisch: 600 Ziele wirken nicht 30-mal so gross wie 20', () => {
    expect(clusterScale(2)).toBe(0);
    expect(clusterScale(1000)).toBe(1);
    expect(clusterScale(5000)).toBe(1);
    expect(clusterSize(600, false) / clusterSize(20, false)).toBeLessThan(1.5);
    for (let c = 2; c < 2000; c += 7) expect(clusterScale(c + 7)).toBeGreaterThanOrEqual(clusterScale(c));
  });

  it('bleibt in den Bereichen: Desktop 42–70 px, Handy 36–58 px, in 2-px-Stufen', () => {
    for (const c of [2, 5, 20, 50, 100, 300, 600, 1000, 5000]) {
      const d = clusterSize(c, false);
      const m = clusterSize(c, true);
      expect(d).toBeGreaterThanOrEqual(42);
      expect(d).toBeLessThanOrEqual(70);
      expect(m).toBeGreaterThanOrEqual(36);
      expect(m).toBeLessThanOrEqual(58);
      expect(d % 2).toBe(0);
      expect(m).toBeLessThan(d);
    }
    // Orientierung aus dem Auftrag: klein 42–46, mittel 50–56, gross 60–68, sehr gross ≤ 74
    expect(clusterSize(5, false)).toBeLessThanOrEqual(46);
    expect(clusterSize(40, false)).toBeGreaterThanOrEqual(50);
    expect(clusterSize(40, false)).toBeLessThanOrEqual(56);
    expect(clusterSize(300, false)).toBeGreaterThanOrEqual(60);
    expect(clusterSize(300, false)).toBeLessThanOrEqual(68);
  });

  it('springt nicht bei kleinen Änderungen der Anzahl', () => {
    expect(clusterSize(100, false)).toBe(clusterSize(102, false));
    expect(clusterSize(530, false)).toBe(clusterSize(540, false));
  });

  it('Stufen: klein < 20, mittel < 100, gross < 400, sehr gross', () => {
    expect(clusterTier(2)).toBe('sm');
    expect(clusterTier(19)).toBe('sm');
    expect(clusterTier(20)).toBe('md');
    expect(clusterTier(99)).toBe('md');
    expect(clusterTier(100)).toBe('lg');
    expect(clusterTier(399)).toBe('lg');
    expect(clusterTier(400)).toBe('xl');
  });
});

describe('Inhalt der Sammelmarkierungen', () => {
  it('Zahl mit Schweizer Tausendertrennung', () => {
    expect(formatCount(530)).toBe('530');
    expect(formatCount(1317)).toMatch(/^1.317$/);
  });

  it('Kategorien nur aus vorhandenen Zahlen, häufigste zuerst, Einzahl/Mehrzahl', () => {
    const cats = clusterCategories({ peak: 18, viewpoint: 11, hut: 1, lake: 0, pass: undefined, ski: 'x', cluster_id: 5 } as never);
    expect(cats.map((c) => `${c.count} ${c.label}`)).toEqual(['18 Gipfel', '11 Aussicht', '1 Hütte']);
    expect(clusterCategories({})).toEqual([]);
  });

  it('Zusatzzeile nur bei grossen Zählern und nur, wenn sie etwas sagt', () => {
    const cats = clusterCategories({ peak: 180, hut: 120, lake: 90, viewpoint: 140 });
    expect(clusterInfoLine(530, cats)).toBe('180 Gipfel · 140 Aussicht');
    expect(clusterInfoLine(50, cats)).toBeNull(); // mittel: nur Zahl und Bergsymbol
    expect(clusterInfoLine(8, cats)).toBeNull();
    // Nur Skigebiete: «210 Skigebiete» wiederholt bloss die Zahl
    expect(clusterInfoLine(210, clusterCategories({ ski: 210 }))).toBeNull();
    expect(clusterInfoLine(210, [])).toBeNull();
  });

  it('Vorlesetext mit Anzahl und Arten', () => {
    const label = clusterAriaLabel(530, clusterCategories({ peak: 18, viewpoint: 11 }));
    expect(label).toBe('530 Ziele: 18 Gipfel, 11 Aussicht – hineinzoomen');
  });
});
