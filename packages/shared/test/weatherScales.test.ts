import { describe, expect, it } from 'vitest';
import {
  bandLabel,
  buildLut,
  byteToValue,
  decodeRate,
  encodeRate,
  gradientAt,
  legendPosition,
  valueToByte,
  valueToByteF,
  WEATHER_SCALES,
} from '../src/weatherScales';

describe('Verläufe der Wetterkarte', () => {
  it('Wert ↔ Byte: log-Skala für Niederschlag, unter dem Minimum transparent, fehlend = NaN', () => {
    const s = WEATHER_SCALES.precip;
    expect(valueToByte(s, 0)).toBe(0);
    expect(valueToByte(s, 0.05)).toBe(0);
    expect(valueToByte(s, 0.1)).toBe(1);
    expect(valueToByte(s, 100)).toBe(255);
    expect(valueToByte(s, 5000)).toBe(255);
    // 1 mm/h liegt auf einem Drittel (log 0,1–100 = drei Dekaden)
    expect(valueToByteF(s, 1)).toBeCloseTo(1 + 254 / 3, 6);
    expect(Number.isNaN(valueToByteF(s, null))).toBe(true);
    expect(valueToByte(s, null)).toBe(0);
    for (const v of [0.1, 0.37, 2.5, 12, 99]) expect(byteToValue(s, valueToByteF(s, v))).toBeCloseTo(v, 6);
  });

  it('Temperatur linear, Werte ausserhalb werden an den Rand geklemmt (nie transparent)', () => {
    const s = WEATHER_SCALES.temp;
    expect(valueToByte(s, -60)).toBe(1);
    expect(valueToByte(s, 80)).toBe(255);
    expect(byteToValue(s, valueToByteF(s, 0))).toBeCloseTo(0, 6);
  });

  it('Radar-Datenbild: Intensität passt durch ein Byte und zurück (≈ 3 % Auflösung)', () => {
    expect(encodeRate(0)).toBe(0);
    expect(decodeRate(0)).toBe(0);
    for (const v of [0.1, 0.8, 3, 20, 80]) {
      const back = decodeRate(encodeRate(v));
      expect(Math.abs(back - v) / v).toBeLessThan(0.03);
    }
  });

  it('Farbtabelle: Eintrag 0 durchsichtig, Deckkraft steigt mit der Intensität', () => {
    const lut = buildLut(WEATHER_SCALES.precip);
    expect(lut.length).toBe(256 * 4);
    expect(lut[3]).toBe(0);
    let prev = 0;
    for (let b = 1; b < 256; b += 10) {
      expect(lut[b * 4 + 3]).toBeGreaterThanOrEqual(prev);
      prev = lut[b * 4 + 3];
    }
    // Ende des Verlaufs: hell und voll deckend (wie «extrem» bei Apple Wetter: gelb)
    expect(gradientAt(WEATHER_SCALES.precip, 1000)).toEqual([0xff, 0xf7, 0xc2, 255]);
  });

  it('Legende: Lage steigt mit dem Wert; Worte für die Stufen', () => {
    const s = WEATHER_SCALES.precip;
    expect(legendPosition(s, 0.1)).toBe(0);
    expect(legendPosition(s, 100)).toBe(1);
    expect(legendPosition(s, 10)).toBeGreaterThan(legendPosition(s, 1));
    expect(bandLabel(s, 0.05)).toBeNull();
    expect(bandLabel(s, 0.4)).toBe('leicht');
    expect(bandLabel(s, 4)).toBe('mässig');
    expect(bandLabel(s, 12)).toBe('stark');
    expect(bandLabel(s, 70)).toBe('extrem');
    expect(bandLabel(WEATHER_SCALES.temp, 5)).toBeNull();
    expect(bandLabel(WEATHER_SCALES.gust, 95)).toBe('Sturm');
  });

  it('jede Ebene: Verlauf aufsteigend, Stufen aufsteigend, Ticks innerhalb der Domäne', () => {
    for (const s of Object.values(WEATHER_SCALES)) {
      for (let i = 1; i < s.gradient.length; i++) expect(s.gradient[i].value).toBeGreaterThan(s.gradient[i - 1].value);
      for (const g of s.gradient) expect(g.color).toMatch(/^#[0-9a-f]{6}$/);
      for (let i = 1; i < (s.bands?.length ?? 0); i++) expect(s.bands![i].from).toBeGreaterThan(s.bands![i - 1].from);
      for (const t of s.ticks) {
        expect(t.value).toBeGreaterThanOrEqual(s.domain.min);
        expect(t.value).toBeLessThanOrEqual(s.domain.max);
      }
    }
  });
});
