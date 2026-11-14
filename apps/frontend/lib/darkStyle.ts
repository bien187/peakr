/**
 * Dunkle Variante der swisstopo-Grundkarte – ohne eigenen Kartenstil: die
 * Farben des hellen Stils werden je Rolle umgerechnet (in OKLCH, Farbton bleibt).
 *
 *  - Flächen (Land, Wald, Gelände-Schattierung, Wasser): dunkel, Reihenfolge der
 *    Helligkeit bleibt – Schatten bleiben dunkler, Wald dunkler als offenes Land,
 *    das Relief ist weiter zu sehen.
 *  - Strassen (Füllung): hell, Autobahnen bernsteinfarben.
 *  - Konturen von Strassen und Flächen: dunkel (Umriss).
 *  - Markierungen (Wege, Höhenlinien, Grenzen, Bahnen, Gewässerlinien …): hell
 *    bzw. farbig sichtbar – so gut lesbar wie im hellen Modus.
 *  - Beschriftungen: hell, farbige behalten ihren Farbton; Schein (Halo) dunkel.
 */

export type DarkRole = 'area' | 'water' | 'building' | 'road' | 'casing' | 'mark' | 'text' | 'halo';

type RGBA = [number, number, number, number];

// ── Farben lesen und schreiben ───────────────────────────────────────────────

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** CSS-Farbe (rgb/rgba/hsl/hsla/#hex) → RGBA (0–255, Alpha 0–1); null, wenn keine Farbe. */
export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h) || ![3, 4, 6, 8].includes(h.length)) return null;
    const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
  }
  const m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (!m) return null;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (p: string, scale: number) => (p.endsWith('%') ? (parseFloat(p) / 100) * scale : parseFloat(p));
  const alpha = parts[3] !== undefined ? num(parts[3], 1) : 1;
  if (m[1].startsWith('rgb')) {
    const rgb = parts.slice(0, 3).map((p) => num(p, 255));
    if (rgb.some((x) => Number.isNaN(x))) return null;
    return [rgb[0], rgb[1], rgb[2], Number.isNaN(alpha) ? 1 : alpha];
  }
  const h = parseFloat(parts[0]);
  const sat = parseFloat(parts[1]) / 100;
  const lig = parseFloat(parts[2]) / 100;
  if ([h, sat, lig].some((x) => Number.isNaN(x))) return null;
  const [r, g, b] = hslToRgb(((h % 360) + 360) % 360, clamp01(sat), clamp01(lig));
  return [r, g, b, Number.isNaN(alpha) ? 1 : alpha];
}

const toLin = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const fromLin = (x: number) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055);

/** sRGB (0–255) → OKLCH [L 0–1, C, H Grad]. */
export function rgbToOklch(r: number, g: number, b: number): [number, number, number] {
  const R = toLin(r);
  const G = toLin(g);
  const B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  const H = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}

/** OKLCH → sRGB (0–255), ausserhalb des Farbraums mit weniger Buntheit. */
export function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  for (let c = C; ; c *= 0.85) {
    const h = (H * Math.PI) / 180;
    const a = c * Math.cos(h);
    const b = c * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    if (lin.every((x) => x >= -1e-4 && x <= 1 + 1e-4) || c < 1e-4) return lin.map((x) => fromLin(clamp01(x))) as [number, number, number];
  }
}

const fmt = ([r, g, b, a]: RGBA): string => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.round(a * 1000) / 1000})`;

// ── Umrechnung je Rolle ──────────────────────────────────────────────────────

/** Eine Farbe des hellen Stils für die dunkle Karte umrechnen. */
export function darkColor(role: DarkRole, rgba: RGBA): RGBA {
  const [r, g, b, a] = rgba;
  if (role === 'halo') return [14, 17, 22, Math.max(a, 0.7)];
  const [L, C, H] = rgbToOklch(r, g, b);
  let L2 = L;
  let C2 = C;
  switch (role) {
    case 'area':
      // Hell → dunkel, Reihenfolge bleibt (Weiss ≈ 0,28, Wald/Schatten dunkler).
      // Grüntöne (Wald, Wiesen) behalten mehr Farbe – sie sollen sich abheben wie im hellen Modus.
      L2 = 0.15 + clamp01((L - 0.72) / 0.28) * 0.13;
      C2 = H > 95 && H < 175 ? Math.max(C * 0.9, Math.min(C, 0.035)) : C * 0.4;
      break;
    case 'building':
      // Gebäude als hellere Blöcke auf dunklem Land (im hellen Modus: dunkler auf hell).
      L2 = 0.3 + clamp01(1 - L) * 0.4;
      C2 = C * 0.4;
      break;
    case 'water':
      L2 = 0.2 + clamp01((L - 0.72) / 0.28) * 0.04;
      C2 = Math.max(C, 0.04);
      break;
    case 'road':
      // Strassen hell hervorheben (Weiss ≈ 0,82; Autobahnen bernstein).
      L2 = 0.58 + clamp01((L - 0.8) / 0.2) * 0.24;
      C2 = C * 0.85;
      break;
    case 'casing':
      L2 = 0.11 + L * 0.08;
      C2 = C * 0.6;
      break;
    case 'mark':
      if (C > 0.08) {
        // Farbige Linien (Bahnen rot, Grenzen, Höhenlinien) behalten ihre Farbe, mindestens mittelhell.
        L2 = Math.min(0.8, Math.max(0.62, L));
      } else {
        // Graue/schwarze Markierungen (Wege, Pfade, Tunnel) werden hell.
        L2 = 0.9 - L * 0.45;
      }
      break;
    case 'text':
      if (C < 0.05) L2 = 0.93 - L * 0.15;
      else {
        L2 = Math.max(0.76, L);
        C2 = Math.min(C, 0.14);
      }
      break;
  }
  const [r2, g2, b2] = oklchToRgb(clamp01(L2), C2, H);
  return [r2, g2, b2, a];
}

/** Alle Farben in einem Stilwert (Zeichenkette, Ausdruck, alte Stufenfunktion) umrechnen. */
export function darkValue(role: DarkRole, value: unknown): unknown {
  if (typeof value === 'string') {
    const c = parseColor(value);
    return c ? fmt(darkColor(role, c)) : value;
  }
  if (Array.isArray(value)) return value.map((v) => darkValue(role, v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = darkValue(role, v);
    return out;
  }
  return value;
}

/** Vorgaben der Stil-Spezifikation, wenn eine Eigenschaft im Stil fehlt. */
export const PAINT_DEFAULT: Record<string, string> = {
  'background-color': '#000000',
  'fill-color': '#000000',
  'line-color': '#000000',
  'text-color': '#000000',
  'text-halo-color': 'rgba(0, 0, 0, 0)',
  'icon-color': '#000000',
  'icon-halo-color': 'rgba(0, 0, 0, 0)',
};

/** Farbeigenschaften je Ebenentyp, die die dunkle Karte anfasst. */
export const COLOR_PROPS: Record<string, string[]> = {
  background: ['background-color'],
  fill: ['fill-color', 'fill-outline-color'],
  line: ['line-color'],
  symbol: ['text-color', 'text-halo-color', 'icon-color', 'icon-halo-color'],
};

/** Rolle einer Farbeigenschaft; null = unverändert lassen. */
export function darkRole(layerId: string, type: string, prop: string): DarkRole | null {
  const id = layerId.toLowerCase();
  if (type === 'background') return 'area';
  if (type === 'fill') {
    if (prop === 'fill-outline-color') return 'mark';
    if (id.includes('hillshade_yellow')) return null; // zarter Sonnenschein, bleibt
    if (id === 'water' || id.startsWith('water_') || id.includes('ocean') || id.includes('lake')) return 'water';
    if (id === 'building' || id.startsWith('building_') || id === 'construct') return 'building';
    return 'area';
  }
  if (type === 'line') {
    if (id.includes('casing')) return 'casing';
    if (id === 'road_fill' || /^l\d+_fill$/.test(id) || id.endsWith('road_fill')) return 'road';
    return 'mark';
  }
  if (type === 'symbol') {
    if (prop === 'text-halo-color' || prop === 'icon-halo-color') return 'halo';
    return 'text';
  }
  return null;
}
