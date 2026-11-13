import { describe, expect, it } from 'vitest';
import { haversineM, lv95ToWgs84, weatherCell, weatherCellCenter, wgs84ToLv95 } from './lv95';

describe('LV95 ↔ WGS84 (Näherungsformeln swisstopo)', () => {
  it('Fixpunkt Bern (alte Sternwarte)', () => {
    const p = lv95ToWgs84(2_600_000, 1_200_000);
    expect(p.lat).toBeCloseTo(46.95108, 3);
    expect(p.lng).toBeCloseTo(7.43864, 3);
  });

  it('Hin- und Rückrechnung weicht weniger als 2 m ab', () => {
    for (const [lat, lng] of [
      [45.9763, 7.6586], // Matterhorn
      [47.2494, 9.3433], // Säntis
      [46.0037, 8.9511], // Lugano
    ]) {
      const { e, n } = wgs84ToLv95(lat, lng);
      const back = lv95ToWgs84(e, n);
      expect(haversineM(lat, lng, back.lat, back.lng)).toBeLessThan(2);
    }
  });

  it('Distanz Zürich HB – Bern Bahnhof ≈ 95 km', () => {
    expect(haversineM(47.3779, 8.5403, 46.949, 7.4391) / 1000).toBeCloseTo(95.5, 0);
  });

  it('Wetterzelle enthält den Punkt', () => {
    const cell = weatherCell(46.5584, 7.8352);
    const c = weatherCellCenter(cell);
    expect(Math.abs(c.lat - 46.5584)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(Math.abs(c.lng - 7.8352)).toBeLessThanOrEqual(0.05 + 1e-9);
  });
});
