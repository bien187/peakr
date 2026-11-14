/**
 * Rechenkern der Wetterkarte (ohne DOM, testbar): Werte → weiche Farbflächen.
 *
 * Alle Ebenen rechnen im «Byte-Raum» der Farbskala (Kommazahl 0–255, siehe
 * valueToByteF): 0 = nichts (trocken bzw. unter dem Minimum), 1–255 = Lage auf
 * dem Verlauf, NaN = keine Daten. Darin wird zeitlich überblendet, räumlich
 * weichgezeichnet und über eine Farbtabelle eingefärbt. Ränder der
 * Datenabdeckung laufen über die Deckkraft weich aus.
 *
 * Die Bilder liegen in Web-Mercator (Zeilen gleichabständig in Mercator-y),
 * damit MapLibre sie als Canvas-Quelle unverzerrt über die Karte legen kann.
 */
import {
  buildLut,
  valueToByteF,
  type ForecastGridResponse,
  type WeatherScale,
} from '@ch-alpineroute/shared';

export type Corners = [[number, number], [number, number], [number, number], [number, number]];

export const mercY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
export const latOfMercY = (y: number): number => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;

/** Weicher Übergang 0→1 zwischen e0 und e1. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ── Farbtabelle ──────────────────────────────────────────────────────────────

export interface Palette {
  /** RGB je Byte als Little-Endian-Wort (Kanal A = 0). */
  rgb: Uint32Array;
  alpha: Uint8Array;
  /** Unterhalb dieses Byte-Werts läuft die Deckkraft linear gegen 0 (log-Skalen: weicher Rand der Fläche). */
  fadeBelow: number;
}

export function palette(scale: WeatherScale): Palette {
  const lut = buildLut(scale);
  const rgb = new Uint32Array(256);
  const alpha = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    rgb[i] = lut[i * 4] | (lut[i * 4 + 1] << 8) | (lut[i * 4 + 2] << 16);
    alpha[i] = lut[i * 4 + 3];
  }
  return { rgb, alpha, fadeBelow: scale.domain.kind === 'log' ? 14 : 0 };
}

/** Deckkraft am Rand der Datenabdeckung (Abdeckung 0–1 nach dem Weichzeichnen). */
const coverageFade = (c: number): number => smoothstep(0.12, 0.8, c);

/**
 * Färbt Byte-Werte in RGBA-Pixel (Uint32-Sicht auf ImageData, nicht vormultipliziert).
 * coverage (optional) blendet den Rand der Datenabdeckung aus.
 */
export function colorize(values: Float32Array, coverage: Float32Array | null, pal: Palette, out: Uint32Array): void {
  const { rgb, alpha, fadeBelow } = pal;
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const b = values[i];
    if (!(b > 0.05)) {
      out[i] = 0;
      continue;
    }
    let k = (b + 0.5) | 0;
    if (k < 1) k = 1;
    else if (k > 255) k = 255;
    let a = alpha[k];
    if (b < fadeBelow) a *= b / fadeBelow;
    if (coverage) {
      const c = coverage[i];
      if (c < 0.8) a *= coverageFade(c);
    }
    out[i] = ((a | 0) << 24) | rgb[k];
  }
}

// ── Weichzeichnen ────────────────────────────────────────────────────────────

/**
 * Kastenfilter (Radius r) in x und y, Werte ausserhalb gelten als 0. Zweimal
 * angewendet entspricht er annähernd einem Gaussfilter. tmp: gleich gross wie src.
 */
export function boxBlur(src: Float32Array, w: number, h: number, r: number, tmp: Float32Array): void {
  if (r < 1) return;
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = 0; x < r && x < w; x++) acc += src[row + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) acc += src[row + x + r];
      if (x - r - 1 >= 0) acc -= src[row + x - r - 1];
      tmp[row + x] = acc * norm;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = 0; y < r && y < h; y++) acc += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + r < h) acc += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) acc -= tmp[(y - r - 1) * w + x];
      src[y * w + x] = acc * norm;
    }
  }
}

// ── Radar ────────────────────────────────────────────────────────────────────

/** Radius des Weichzeichners für das Radarbild (Pixel ≈ km). */
export const RADAR_BLUR = 2;

/**
 * Radarbild (Bytes je Pixel) → weichgezeichnet, als Festkomma (Byte × 256).
 * Zweimal Kastenfilter: kleine Zellen bekommen einen weichen Hof, Kanten
 * verschwinden, die Fläche wirkt wie gemalt statt gekachelt.
 */
export function prepareRadarFrame(bytes: Uint8Array, w: number, h: number, r = RADAR_BLUR): Uint16Array {
  const f = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = bytes[i];
  const tmp = new Float32Array(w * h);
  boxBlur(f, w, h, r, tmp);
  boxBlur(f, w, h, r, tmp);
  const out = new Uint16Array(w * h);
  for (let i = 0; i < f.length; i++) out[i] = Math.min(65535, Math.round(f[i] * 256));
  return out;
}

/** Zwischenbild zweier Radarbilder (t 0–1) als Byte-Werte. */
export function radarValues(a: Uint16Array, b: Uint16Array | null, t: number, out: Float32Array): void {
  const n = out.length;
  if (!b || t <= 0) {
    for (let i = 0; i < n; i++) out[i] = a[i] / 256;
    return;
  }
  for (let i = 0; i < n; i++) out[i] = (a[i] + (b[i] - a[i]) * t) / 256;
}

/** Wert (Byte) eines Radarbilds an einem Ort; NaN ausserhalb. */
export function radarByteAt(frame: Uint16Array, w: number, h: number, corners: Corners, lng: number, lat: number): number {
  const west = corners[0][0];
  const east = corners[1][0];
  const north = corners[0][1];
  const south = corners[2][1];
  if (lng < west || lng > east || lat < south || lat > north) return Number.NaN;
  const x = Math.min(w - 1, Math.floor(((lng - west) / (east - west)) * w));
  const y0 = mercY(north);
  const y = Math.min(h - 1, Math.floor(((y0 - mercY(lat)) / (y0 - mercY(south))) * h));
  return frame[y * w + x] / 256;
}

// ── Prognoseraster ───────────────────────────────────────────────────────────

/** Bildpunkte je Rasterzelle (0,1°) auf der Canvas-Quelle; MapLibre interpoliert weiter. */
const PX_PER_CELL = 8;
/** Weichzeichner im Raster-Bild (Pixel); ≈ eine halbe Zelle, glättet die Kanten der bilinearen Interpolation. */
const GRID_BLUR = 4;

export interface GridGeom {
  /** Zellen in x/y inkl. eines leeren Rands; Index j·nx + i, j von Süd nach Nord. */
  nx: number;
  ny: number;
  lng0: number;
  lat0: number;
  d: number;
  /** Zelle der Antwort → Index im Raster. */
  idx: Int32Array;
  /** Bildgrösse und -ecken der Canvas-Quelle. */
  W: number;
  H: number;
  corners: Corners;
  /** Je Bildspalte/-zeile: linke/untere Nachbarzelle (bezogen auf Zellmitten) und Anteil zur nächsten. */
  colI: Int32Array;
  colF: Float32Array;
  rowJ: Int32Array;
  rowF: Float32Array;
}

export function gridGeom(g: ForecastGridResponse, pxPerCell = PX_PER_CELL): GridGeom | null {
  if (g.cells.length === 0) return null;
  const d = g.cellDeg;
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of g.cells) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  // Ein leerer Rand ringsum: dort läuft die Fläche innerhalb des Bilds weich aus.
  const lng0 = minLng - d;
  const lat0 = minLat - d;
  const nx = Math.round((maxLng - minLng) / d) + 3;
  const ny = Math.round((maxLat - minLat) / d) + 3;
  const idx = new Int32Array(g.cells.length);
  g.cells.forEach(([lat, lng], k) => {
    idx[k] = Math.round((lat - lat0) / d) * nx + Math.round((lng - lng0) / d);
  });
  const lng1 = lng0 + nx * d;
  const lat1 = lat0 + ny * d;
  const yTop = mercY(lat1);
  const yBot = mercY(lat0);
  const W = nx * pxPerCell;
  const H = Math.max(2, Math.round((W * (yTop - yBot)) / ((nx * d * Math.PI) / 180)));
  const colI = new Int32Array(W);
  const colF = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const gx = ((x + 0.5) / W) * nx - 0.5;
    colI[x] = Math.floor(gx);
    colF[x] = gx - colI[x];
  }
  const rowJ = new Int32Array(H);
  const rowF = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const lat = latOfMercY(yTop - ((y + 0.5) / H) * (yTop - yBot));
    const gy = (lat - lat0) / d - 0.5;
    rowJ[y] = Math.floor(gy);
    rowF[y] = gy - rowJ[y];
  }
  return {
    nx, ny, lng0, lat0, d, idx, W, H, colI, colF, rowJ, rowF,
    corners: [[lng0, lat1], [lng1, lat1], [lng1, lat0], [lng0, lat0]],
  };
}

/** Rohwerte einer Stunde ins Raster (NaN = keine Zelle bzw. kein Wert). */
export function gridRaw(geom: GridGeom, values: (number | null)[]): Float32Array {
  const out = new Float32Array(geom.nx * geom.ny).fill(Number.NaN);
  for (let k = 0; k < geom.idx.length; k++) {
    const v = values[k];
    if (typeof v === 'number') out[geom.idx[k]] = v;
  }
  return out;
}

/** Rohwerte → Byte-Werte der Skala (NaN bleibt NaN). */
export function toBytes(scale: WeatherScale, raw: Float32Array): Float32Array {
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = valueToByteF(scale, raw[i]);
  return out;
}

/** Zeitliche Überblendung zweier Raster; fehlt einer der Werte, bleibt NaN. */
export function lerpGrid(a: Float32Array, b: Float32Array | null, t: number, out: Float32Array): void {
  if (!b || t <= 0) {
    out.set(a);
    return;
  }
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
}

/**
 * Raster → Bild: bilinear zwischen den Zellmitten (fehlende Zellen zählen
 * nicht), dann weichgezeichnet. Gerechnet wird vormultipliziert (Wert ×
 * Abdeckung), damit der Rand weder heller noch dunkler wird: Ergebnis in
 * `values` (Byte-Werte) und `coverage` (0–1).
 */
export function renderGrid(
  geom: GridGeom,
  grid: Float32Array,
  values: Float32Array,
  coverage: Float32Array,
  tmp: Float32Array,
  blur = GRID_BLUR,
): void {
  const { nx, ny, W, H, colI, colF, rowJ, rowF } = geom;
  for (let y = 0; y < H; y++) {
    const j0 = rowJ[y];
    const fy = rowF[y];
    for (let x = 0; x < W; x++) {
      const i0 = colI[x];
      const fx = colF[x];
      let v = 0;
      let c = 0;
      for (let q = 0; q < 4; q++) {
        const i = i0 + (q & 1);
        const j = j0 + (q >> 1);
        if (i < 0 || i >= nx || j < 0 || j >= ny) continue;
        const val = grid[j * nx + i];
        if (val !== val) continue; // NaN
        const w = (q & 1 ? fx : 1 - fx) * (q >> 1 ? fy : 1 - fy);
        v += w * val;
        c += w;
      }
      const k = y * W + x;
      values[k] = v;
      coverage[k] = c;
    }
  }
  if (blur > 0) {
    boxBlur(values, W, H, blur, tmp);
    boxBlur(values, W, H, blur, tmp);
    boxBlur(coverage, W, H, blur, tmp);
    boxBlur(coverage, W, H, blur, tmp);
  }
  for (let k = 0; k < W * H; k++) {
    const c = coverage[k];
    values[k] = c > 1e-3 ? values[k] / c : Number.NaN;
  }
}

/** Bilinearer Wert des Rasters an einem Ort (fehlende Zellen zählen nicht); NaN ohne Daten. */
export function sampleGrid(geom: GridGeom, grid: Float32Array, lng: number, lat: number): number {
  const gx = (lng - geom.lng0) / geom.d - 0.5;
  const gy = (lat - geom.lat0) / geom.d - 0.5;
  const i0 = Math.floor(gx);
  const j0 = Math.floor(gy);
  const fx = gx - i0;
  const fy = gy - j0;
  let v = 0;
  let c = 0;
  for (let q = 0; q < 4; q++) {
    const i = i0 + (q & 1);
    const j = j0 + (q >> 1);
    if (i < 0 || i >= geom.nx || j < 0 || j >= geom.ny) continue;
    const val = grid[j * geom.nx + i];
    if (val !== val) continue;
    const w = (q & 1 ? fx : 1 - fx) * (q >> 1 ? fy : 1 - fy);
    v += w * val;
    c += w;
  }
  // Nur dort, wo Daten tragen (nicht weit über den Rand der Abdeckung hinaus).
  return c > 0.25 ? v / c : Number.NaN;
}

// ── Wind ─────────────────────────────────────────────────────────────────────

/** Wind je Stunde als Vektor (km/h, wohin: u nach Osten, v nach Norden) im Raster. */
export interface WindField {
  u: Float32Array[];
  v: Float32Array[];
}

/**
 * Böen (Stärke) und Windrichtung (woher, Grad) → Vektoren. Ohne Richtungen
 * (ältere Prognosen) null: dann zeigt die Karte keine Bewegung statt einer
 * erfundenen.
 */
export function windField(geom: GridGeom, g: ForecastGridResponse): WindField | null {
  const dirs = g.directions;
  if (!dirs || dirs.length < g.hours) return null;
  const u: Float32Array[] = [];
  const v: Float32Array[] = [];
  for (let h = 0; h < g.hours; h++) {
    const uh = new Float32Array(geom.nx * geom.ny).fill(Number.NaN);
    const vh = new Float32Array(geom.nx * geom.ny).fill(Number.NaN);
    for (let k = 0; k < geom.idx.length; k++) {
      const speed = g.values[h]?.[k];
      const from = dirs[h]?.[k];
      if (typeof speed !== 'number' || typeof from !== 'number') continue;
      const rad = (from * Math.PI) / 180;
      uh[geom.idx[k]] = -Math.sin(rad) * speed;
      vh[geom.idx[k]] = -Math.cos(rad) * speed;
    }
    u.push(uh);
    v.push(vh);
  }
  return { u, v };
}

// ── PNG (Graustufen) ─────────────────────────────────────────────────────────

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Graustufen-PNG (8 bit, ohne Interlace) → Bytes je Pixel, exakt wie gespeichert.
 * Eigene Dekodierung statt <img>/Canvas: dort könnte das Farbmanagement des
 * Browsers die Werte verschieben – hier sind die Bytes Messwerte, keine Farben.
 */
export async function decodeGrayPng(buf: ArrayBuffer): Promise<{ width: number; height: number; bytes: Uint8Array }> {
  const u8 = new Uint8Array(buf);
  if (u8.length < 8 || PNG_SIG.some((b, i) => u8[i] !== b)) throw new Error('Kein PNG');
  const dv = new DataView(buf);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let color = -1;
  let interlace = 0;
  const parts: Uint8Array[] = [];
  while (pos + 8 <= u8.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(u8[pos + 4], u8[pos + 5], u8[pos + 6], u8[pos + 7]);
    if (type === 'IHDR') {
      width = dv.getUint32(pos + 8);
      height = dv.getUint32(pos + 12);
      depth = u8[pos + 16];
      color = u8[pos + 17];
      interlace = u8[pos + 20];
    } else if (type === 'IDAT') {
      parts.push(u8.subarray(pos + 8, pos + 8 + len));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (color !== 0 || depth !== 8 || interlace !== 0 || width <= 0 || height <= 0) throw new Error('PNG-Format nicht unterstützt');
  const total = parts.reduce((n, p) => n + p.length, 0);
  const zdata = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    zdata.set(p, o);
    o += p.length;
  }
  const raw = await inflate(zdata);
  if (raw.length < (width + 1) * height) throw new Error('PNG unvollständig');
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)];
    const src = y * (width + 1) + 1;
    const dst = y * width;
    for (let x = 0; x < width; x++) {
      const a = x > 0 ? out[dst + x - 1] : 0;
      const b = y > 0 ? out[dst - width + x] : 0;
      const c = x > 0 && y > 0 ? out[dst - width + x - 1] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[dst + x] = (raw[src + x] + pred) & 255;
    }
  }
  return { width, height, bytes: out };
}
