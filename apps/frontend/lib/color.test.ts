import { describe, expect, it } from 'vitest';
import { oklchToHex } from './color';
import { chromeColors } from './theme';

describe('Farben der Browser-Oberfläche', () => {
  it('OKLCH → Hex: Weiss, Schwarz, sRGB-Rot', () => {
    expect(oklchToHex(1, 0, 0)).toBe('#ffffff');
    expect(oklchToHex(0, 0, 0)).toBe('#000000');
    expect(oklchToHex(0.62796, 0.25768, 29.2339)).toBe('#ff0000');
  });

  it('Statusleiste hell im hellen, dunkelgrau im dunklen Modus – nie die Akzentfarbe', () => {
    const lum = (hex: string) => [1, 3, 5].reduce((s, i) => s + parseInt(hex.slice(i, i + 2), 16), 0) / 3;
    for (const d of ['paper', 'glacier', 'pine'] as const) {
      expect(lum(chromeColors(d, 'light').bar)).toBeGreaterThan(245);
      expect(lum(chromeColors(d, 'dark').bar)).toBeLessThan(45);
    }
    expect(chromeColors('glacier', 'light').bar).toBe('#f7fbfe'); // = layout.tsx/manifest.ts
  });
});
