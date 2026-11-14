import { describe, expect, it } from 'vitest';
import { darkColor, darkRole, darkValue, parseColor, rgbToOklch, type DarkRole } from './darkStyle';

const L = (role: DarkRole, css: string) => {
  const c = darkColor(role, parseColor(css)!);
  return rgbToOklch(c[0], c[1], c[2]);
};

describe('Farben lesen', () => {
  it('rgb, rgba, hsl, hex – und nichts anderes', () => {
    expect(parseColor('rgba(255, 50, 50, 1)')).toEqual([255, 50, 50, 1]);
    expect(parseColor('rgb(186,210,172)')).toEqual([186, 210, 172, 1]);
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    const h = parseColor('hsl(220, 10%, 82%)')!;
    expect(Math.round(h[0])).toBe(205);
    expect(parseColor('class')).toBeNull();
    expect(parseColor('forest')).toBeNull();
    expect(parseColor('rgba')).toBeNull();
  });
});

describe('Dunkle Karte', () => {
  it('Flächen dunkel, Reihenfolge bleibt: Schatten und Wald dunkler als offenes Land', () => {
    const land = L('area', 'rgba(252, 252, 252, 1)')[0];
    const shadow = L('area', 'rgb(200,210,213)')[0];
    const forest = L('area', 'rgb(186, 210, 172)')[0];
    expect(land).toBeLessThan(0.32);
    expect(shadow).toBeLessThan(land);
    expect(forest).toBeLessThan(land);
  });

  it('Wald grün abgesetzt, Gebäude als hellere Blöcke', () => {
    const [, cf, hf] = L('area', 'rgb(186, 210, 172)');
    expect(cf).toBeGreaterThan(0.03);
    expect(hf).toBeGreaterThan(95);
    expect(hf).toBeLessThan(175);
    expect(L('building', 'hsl(220, 10%, 82%)')[0]).toBeGreaterThan(L('area', 'rgba(252, 252, 252, 1)')[0]);
    expect(darkRole('building', 'fill', 'fill-color')).toBe('building');
  });

  it('Wasser dunkelblau, dunkler als Land', () => {
    const [l, c, h] = L('water', 'rgb(199, 224, 245)');
    expect(l).toBeLessThan(L('area', 'rgba(252, 252, 252, 1)')[0]);
    expect(c).toBeGreaterThan(0.03);
    expect(h).toBeGreaterThan(200);
    expect(h).toBeLessThan(270);
  });

  it('Strassen hell, Autobahnen bernstein; Kontur dunkel', () => {
    expect(L('road', 'rgb(255,255,255)')[0]).toBeGreaterThan(0.78);
    const [lm, cm, hm] = L('road', 'rgb(255,230,160)');
    expect(lm).toBeGreaterThan(0.7);
    expect(cm).toBeGreaterThan(0.04);
    expect(hm).toBeGreaterThan(60);
    expect(hm).toBeLessThan(100);
    expect(L('casing', 'rgb(80, 80, 80)')[0]).toBeLessThan(0.2);
  });

  it('Wege und Pfade hell, Bahnen bleiben rot, Höhenlinien sichtbar', () => {
    expect(L('mark', 'rgba(115, 115, 115, 1)')[0]).toBeGreaterThan(0.6);
    expect(L('mark', 'rgb(90, 90, 90)')[0]).toBeGreaterThan(0.6);
    const rail = darkColor('mark', parseColor('rgba(255, 50, 50, 1)')!);
    expect(rail[0]).toBeGreaterThan(200);
    expect(rail[1]).toBeLessThan(120);
    expect(L('mark', 'rgb(191,138,64)')[0]).toBeGreaterThan(0.6);
  });

  it('Beschriftung hell, farbige behalten ihren Farbton; Schein dunkel', () => {
    expect(L('text', 'rgba(64, 64, 64, 1)')[0]).toBeGreaterThan(0.85);
    const [lb, , hb] = L('text', 'rgb(47, 134, 188)');
    expect(lb).toBeGreaterThan(0.74);
    expect(hb).toBeGreaterThan(200);
    expect(hb).toBeLessThan(260);
    const halo = darkColor('halo', parseColor('rgba(242, 242, 242, 0.6)')!);
    expect(halo[0]).toBeLessThan(30);
    expect(halo[3]).toBeGreaterThanOrEqual(0.7);
  });

  it('rechnet Farben in Ausdrücken und alten Stufenfunktionen um, lässt alles andere stehen', () => {
    const expr = ['match', ['get', 'class'], ['forest', 'wood'], 'rgb(186, 210, 172)', 'rgba(0, 0, 0, 0)'];
    const out = darkValue('area', expr) as unknown[];
    expect(out[0]).toBe('match');
    expect(out[1]).toEqual(['get', 'class']);
    expect(out[2]).toEqual(['forest', 'wood']);
    expect(out[3]).toMatch(/^rgba\(/);
    expect(out[3]).not.toBe('rgb(186, 210, 172)');
    expect(out[4]).toMatch(/, 0\)$/); // durchsichtig bleibt durchsichtig
    const legacy = darkValue('mark', { stops: [[6, 'hsl(300, 55%, 80%)'], [9, 'hsl(315, 40%, 85%)']] }) as { stops: [number, string][] };
    expect(legacy.stops[0][0]).toBe(6);
    expect(legacy.stops[0][1]).toMatch(/^rgba\(/);
  });

  it('Rollen der swisstopo-Ebenen', () => {
    expect(darkRole('background', 'background', 'background-color')).toBe('area');
    expect(darkRole('hillshade_grey', 'fill', 'fill-color')).toBe('area');
    expect(darkRole('hillshade_yellow', 'fill', 'fill-color')).toBeNull();
    expect(darkRole('water', 'fill', 'fill-color')).toBe('water');
    expect(darkRole('road_fill', 'line', 'line-color')).toBe('road');
    expect(darkRole('l2_fill', 'line', 'line-color')).toBe('road');
    expect(darkRole('l1_road_casing', 'line', 'line-color')).toBe('casing');
    expect(darkRole('road_path_footway_ferry', 'line', 'line-color')).toBe('mark');
    expect(darkRole('place_city', 'symbol', 'text-halo-color')).toBe('halo');
    expect(darkRole('place_city', 'symbol', 'text-color')).toBe('text');
  });
});
