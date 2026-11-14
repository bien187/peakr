/**
 * Farben der Wetterkarte – eine Quelle für Radarbild (Server), Karte und
 * Legende (Browser).
 *
 * Dargestellt wird mit fliessenden Verläufen (`gradient`): Werte werden auf
 * 0–255 abgebildet (`domain`, Niederschlag logarithmisch), eine Farbtabelle mit
 * 256 Einträgen färbt jedes Pixel; kleine Werte laufen über die Deckkraft weich
 * aus. Die Klassen (`from`/`colors`) bleiben für das bisherige Radarbild und für
 * Tests erhalten.
 */

export type WeatherLayerKey = 'precip' | 'snowfall' | 'gust' | 'temp' | 'cloud';

/** Stützpunkt eines Verlaufs: Wert, Farbe (#rrggbb), Deckkraft 0–1. */
export interface GradientStop {
  value: number;
  color: string;
  alpha: number;
}

export interface WeatherScale {
  key: WeatherLayerKey;
  label: string;
  unit: string;
  /** Fliessender Verlauf für Karte und Legende. */
  gradient: GradientStop[];
  /** Abbildung Wert → Byte 1–255 (0 = transparent / keine Daten). */
  domain: { kind: 'log' | 'linear'; min: number; max: number };
  /** Beschriftung der Legende. */
  ticks: { value: number; label: string }[];
  /** Worte für Wertebereiche (Legende und Wert unter dem Zeiger), aufsteigend ab `from`. */
  bands?: { from: number; label: string }[];
  /** Untergrenzen der Klassen; darunter transparent (bei divergierend: erste Klasse ab −∞). */
  from: number[];
  colors: string[];
  /** Divergierend: die erste Klasse reicht bis −∞. */
  diverging?: boolean;
  /** Deckkraft des Rasters auf der Karte. */
  opacity: number;
  /** Text der Legende je Klasse. */
  labels: string[];
}

export const WEATHER_SCALES: Record<WeatherLayerKey, WeatherScale> = {
  precip: {
    key: 'precip', label: 'Niederschlag', unit: 'mm/h',
    gradient: [
      { value: 0.1, color: '#5ac8fa', alpha: 0.3 },
      { value: 0.5, color: '#3b9cff', alpha: 0.55 },
      { value: 1.5, color: '#3a5bff', alpha: 0.72 },
      { value: 4, color: '#6a3cf0', alpha: 0.82 },
      { value: 8, color: '#b03cd0', alpha: 0.88 },
      { value: 15, color: '#ff5a5f', alpha: 0.92 },
      { value: 30, color: '#ff9f0a', alpha: 0.95 },
      { value: 60, color: '#ffd60a', alpha: 1 },
      { value: 100, color: '#fff7c2', alpha: 1 },
    ],
    domain: { kind: 'log', min: 0.1, max: 100 },
    ticks: [
      { value: 0.1, label: '0,1' },
      { value: 1, label: '1' },
      { value: 10, label: '10' },
      { value: 100, label: '100' },
    ],
    // Stufen wie beim Deutschen Wetterdienst: leicht < 2,5 · mässig < 10 · stark < 50 · extrem.
    bands: [
      { from: 0.1, label: 'leicht' },
      { from: 2.5, label: 'mässig' },
      { from: 10, label: 'stark' },
      { from: 50, label: 'extrem' },
    ],
    from: [0.1, 1, 2, 5, 10, 20],
    colors: ['#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
    opacity: 0.72,
    labels: ['0,1', '1', '2', '5', '10', '20+'],
  },
  snowfall: {
    key: 'snowfall', label: 'Neuschnee', unit: 'cm/h',
    gradient: [
      { value: 0.05, color: '#e6f0ff', alpha: 0.25 },
      { value: 0.3, color: '#cfe0ff', alpha: 0.5 },
      { value: 1, color: '#b3c7ff', alpha: 0.7 },
      { value: 2, color: '#c9b3ff', alpha: 0.85 },
      { value: 4, color: '#f3e8ff', alpha: 0.95 },
      { value: 8, color: '#ffffff', alpha: 1 },
    ],
    domain: { kind: 'log', min: 0.05, max: 8 },
    ticks: [
      { value: 0.1, label: '0,1' },
      { value: 0.5, label: '0,5' },
      { value: 2, label: '2' },
      { value: 8, label: '8' },
    ],
    bands: [
      { from: 0.05, label: 'leicht' },
      { from: 0.5, label: 'mässig' },
      { from: 2, label: 'stark' },
    ],
    from: [0.1, 0.5, 1, 2, 4],
    colors: ['#b9bafe', '#9996fa', '#7c6ff6', '#6254ce', '#493da1'],
    opacity: 0.72,
    labels: ['0,1', '0,5', '1', '2', '4+'],
  },
  gust: {
    key: 'gust', label: 'Windböen', unit: 'km/h',
    gradient: [
      { value: 0, color: '#3ed1c3', alpha: 0 },
      { value: 25, color: '#3ed1c3', alpha: 0.08 },
      { value: 45, color: '#a8e36b', alpha: 0.22 },
      { value: 65, color: '#ffd23f', alpha: 0.32 },
      { value: 85, color: '#ff8a3d', alpha: 0.42 },
      { value: 110, color: '#ff3b5c', alpha: 0.5 },
      { value: 150, color: '#c218ff', alpha: 0.55 },
    ],
    domain: { kind: 'linear', min: 0, max: 150 },
    ticks: [
      { value: 20, label: '20' },
      { value: 50, label: '50' },
      { value: 80, label: '80' },
      { value: 110, label: '110' },
      { value: 150, label: '150' },
    ],
    bands: [
      { from: 0, label: 'schwach' },
      { from: 30, label: 'kräftig' },
      { from: 60, label: 'stürmisch' },
      { from: 90, label: 'Sturm' },
    ],
    from: [30, 50, 70, 90, 110],
    colors: ['#f2b098', '#e68764', '#d95923', '#b44005', '#8a2e00'],
    opacity: 0.62,
    labels: ['30', '50', '70', '90', '110+'],
  },
  temp: {
    key: 'temp', label: 'Temperatur', unit: '°C',
    gradient: [
      { value: -30, color: '#3a1c71', alpha: 0.6 },
      { value: -20, color: '#2b3fbf', alpha: 0.6 },
      { value: -10, color: '#2f7bff', alpha: 0.6 },
      { value: -3, color: '#7cc7ff', alpha: 0.55 },
      { value: 0, color: '#e8f4ff', alpha: 0.5 },
      { value: 3, color: '#fff1b8', alpha: 0.5 },
      { value: 10, color: '#ffc061', alpha: 0.55 },
      { value: 18, color: '#ff7b3b', alpha: 0.6 },
      { value: 26, color: '#e8364f', alpha: 0.62 },
      { value: 35, color: '#9b1c73', alpha: 0.65 },
    ],
    domain: { kind: 'linear', min: -30, max: 40 },
    ticks: [
      { value: -20, label: '−20' },
      { value: -10, label: '−10' },
      { value: 0, label: '0' },
      { value: 10, label: '10' },
      { value: 20, label: '20' },
      { value: 30, label: '30' },
    ],
    from: [-Infinity, -20, -10, -5, -1, 1, 5, 10, 20],
    colors: ['#184f95', '#256abf', '#3987e5', '#9ec5f4', '#f0efec', '#f8aaa3', '#e24a48', '#bb3032', '#911e22'],
    diverging: true,
    opacity: 0.55,
    labels: ['<−20', '−20', '−10', '−5', '±1', '1', '5', '10', '20+'],
  },
  cloud: {
    key: 'cloud', label: 'Bewölkung', unit: '%',
    gradient: [
      { value: 0, color: '#ffffff', alpha: 0 },
      { value: 20, color: '#ffffff', alpha: 0.05 },
      { value: 50, color: '#f4f6f8', alpha: 0.3 },
      { value: 80, color: '#e9edf2', alpha: 0.5 },
      { value: 100, color: '#dfe4ea', alpha: 0.65 },
    ],
    domain: { kind: 'linear', min: 0, max: 100 },
    ticks: [
      { value: 0, label: '0' },
      { value: 50, label: '50' },
      { value: 100, label: '100' },
    ],
    bands: [
      { from: 0, label: 'klar' },
      { from: 20, label: 'teils bewölkt' },
      { from: 60, label: 'bewölkt' },
      { from: 90, label: 'bedeckt' },
    ],
    from: [25, 50, 75, 90],
    colors: ['#d0d0d0', '#b2b2b2', '#959595', '#797979'],
    opacity: 0.5,
    labels: ['25', '50', '75', '90+'],
  },
};

/** Klasse eines Werts (Index in `colors`) oder −1 = transparent. */
export function scaleClass(scale: WeatherScale, value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) return -1;
  if (!scale.diverging && value < scale.from[0]) return -1;
  let k = scale.from.length - 1;
  while (k > 0 && value < scale.from[k]) k--;
  return k;
}

/** Prognoseraster für die Karte: Werte je Stunde und Zelle (0,1°). */
export interface ForecastGridResponse {
  variable: WeatherLayerKey;
  /** Immer Modellprognose – nie als Messung darstellen. */
  evidence: 'forecast';
  source: string;
  /** Zeitpunkt des Prognoseabrufs (neueste Zelle). */
  fetchedAt: string | null;
  /** Erste Stunde (UTC, volle Stunde). */
  start: string;
  hours: number;
  cellDeg: number;
  /** Südwestecke je Zelle [lat, lng]. */
  cells: [number, number][];
  /** Modellhöhe je Zelle (m), wichtig für die Temperatur. */
  elevations: (number | null)[];
  /** values[stunde][zelle]; null = kein Wert. */
  values: (number | null)[][];
  /** Nur bei «gust»: Windrichtung (woher, Grad) je Stunde und Zelle; null = noch nicht erfasst. */
  directions?: (number | null)[][] | null;
}

/** Liste der jüngsten Radarbilder (Messung). */
export interface RadarFramesResponse {
  evidence: 'measured';
  source: string;
  frames: { time: string; stamp: string }[];
  /** Bildecken für MapLibre: oben links, oben rechts, unten rechts, unten links ([lng, lat]). */
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
}

// ── Verläufe ────────────────────────────────────────────────────────────────

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/**
 * Wert → Byte 1–255 als Kommazahl (für fliessende Übergänge); 0 = transparent
 * (fehlt bzw. unter dem Minimum bei log). NaN, wenn kein Wert vorliegt.
 */
export function valueToByteF(scale: WeatherScale, v: number | null | undefined): number {
  if (v === null || v === undefined || Number.isNaN(v)) return Number.NaN;
  const { kind, min, max } = scale.domain;
  let x: number;
  if (kind === 'log') {
    if (v < min) return 0;
    x = Math.log(v / min) / Math.log(max / min);
  } else {
    x = (v - min) / (max - min);
  }
  return 1 + Math.min(1, Math.max(0, x)) * 254;
}

/** Wert → Byte 1–255 entlang der Domäne; 0 = transparent (fehlt bzw. unter dem Minimum bei log). */
export function valueToByte(scale: WeatherScale, v: number | null | undefined): number {
  const b = valueToByteF(scale, v);
  return Number.isNaN(b) ? 0 : Math.round(b);
}

/** Byte 1–255 → Wert (Umkehrung von valueToByte, auch für Kommazahlen); 0 → NaN. */
export function byteToValue(scale: WeatherScale, b: number): number {
  if (!(b > 0)) return Number.NaN;
  const x = (Math.min(255, Math.max(1, b)) - 1) / 254;
  const { kind, min, max } = scale.domain;
  return kind === 'log' ? min * Math.pow(max / min, x) : min + x * (max - min);
}

/** Farbe und Deckkraft (0–255) an einer Stelle des Verlaufs. */
export function gradientAt(scale: WeatherScale, v: number): [number, number, number, number] {
  const g = scale.gradient;
  if (v <= g[0].value) return [...hex(g[0].color), Math.round(g[0].alpha * 255)];
  for (let i = 1; i < g.length; i++) {
    if (v <= g[i].value) {
      const a = g[i - 1];
      const b = g[i];
      // In der log-Domäne logarithmisch interpolieren, sonst linear.
      const t =
        scale.domain.kind === 'log' && a.value > 0
          ? Math.log(v / a.value) / Math.log(b.value / a.value)
          : (v - a.value) / (b.value - a.value);
      const ca = hex(a.color);
      const cb = hex(b.color);
      return [
        Math.round(ca[0] + (cb[0] - ca[0]) * t),
        Math.round(ca[1] + (cb[1] - ca[1]) * t),
        Math.round(ca[2] + (cb[2] - ca[2]) * t),
        Math.round((a.alpha + (b.alpha - a.alpha) * t) * 255),
      ];
    }
  }
  const last = g[g.length - 1];
  return [...hex(last.color), Math.round(last.alpha * 255)];
}

/** Farbtabelle: 256 × RGBA, Eintrag 0 transparent. */
export function buildLut(scale: WeatherScale): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let b = 1; b < 256; b++) lut.set(gradientAt(scale, byteToValue(scale, b)), b * 4);
  return lut;
}

/** Wort zum Wert (z. B. «mässig»); null ohne Stufen oder unter der ersten Stufe. */
export function bandLabel(scale: WeatherScale, v: number | null | undefined): string | null {
  if (!scale.bands || v === null || v === undefined || Number.isNaN(v)) return null;
  let label: string | null = null;
  for (const b of scale.bands) if (v >= b.from) label = b.label;
  return label;
}

/** Relative Lage eines Werts auf der Legende (0–1). */
export function legendPosition(scale: WeatherScale, v: number): number {
  return (Math.max(1, valueToByte(scale, v)) - 1) / 254;
}

/** Radar: Niederschlagsintensität (mm/h) ↔ Byte, gleiche Abbildung wie die Ebene «Niederschlag». */
export const encodeRate = (v: number): number => valueToByte(WEATHER_SCALES.precip, v);
export const decodeRate = (b: number): number => (b <= 0 ? 0 : byteToValue(WEATHER_SCALES.precip, b));
