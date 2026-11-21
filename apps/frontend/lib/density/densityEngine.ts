/**
 * PeakrDensityEngine – Dichte der Ziele für die Heatmap und die Hotspot-Zahlen.
 * Ohne DOM und ohne Karte, vollständig testbar.
 *
 * Kern
 *  Derselbe Gauss-Kern wie die MapLibre-Heatmap auf der GPU: Beitrag eines Ziels
 *  = Gewicht · Intensität · 1/√(2π) · exp(−d²/2σ²) mit σ = Radius/3, gerechnet in
 *  Bildschirmpixeln der jeweiligen Zoomstufe (Web Mercator, 512-px-Kacheln). Was
 *  die Engine als Hotspot findet, leuchtet auf der Karte genau dort.
 *
 * Radius
 *  Geografisch festgelegt (km je Zoomstufe, dazwischen log-linear) und erst dann
 *  in Pixel umgerechnet: Beim Hineinzoomen wachsen die Flecken mit der Karte mit
 *  und werden dabei geografisch enger – die Hotspots werden präziser.
 *
 * Normalisierung
 *  Je Zoomstufe das robuste Maximum (98. Perzentil der Dichte an den Zielen) →
 *  heatmap-intensity. Die dichtesten 2 % erreichen die oberste Farbe, Ausreisser
 *  werden dort abgeschnitten. Ein einzelnes Ziel bleibt immer unter «mittel» –
 *  keine künstlichen Hotspots.
 *
 * Hotspots
 *  Dichtefeld auf einem Raster, Einzugsgebiete der Dichtemaxima (aufsteigend
 *  zusammengefügt, kleine Nebenmaxima werden dem Nachbarn zugeschlagen). Jedes
 *  Ziel im sichtbar leuchtenden Bereich gehört zu genau einem Hotspot; die Zahl
 *  ist die echte Anzahl dieser Ziele.
 */

// ── Geometrie ────────────────────────────────────────────────────────────────

const TILE_PX = 512;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
/** Bezugsbreite der Schweiz (Mitte); die Abweichung bis zum Rand beträgt < 2 %. */
export const REF_LAT = 46.8;
const GAUSS_COEF = 0.3989422804014327;

/** Meter je Bildschirmpixel bei Zoom z (MapLibre, 512-px-Kacheln). */
export function metersPerPixel(zoom: number, lat = REF_LAT): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (TILE_PX * 2 ** zoom);
}

const mercX = (lng: number): number => (lng + 180) / 360;
function mercY(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
const unmercX = (x: number): number => x * 360 - 180;
const unmercY = (y: number): number => (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;

// ── Radius (geografisch) ─────────────────────────────────────────────────────

/**
 * Radius des Kerns in km je Zoomstufe. Ganze Schweiz (Zoom 6–7): 10–15 km, also
 * Regionen; mittlerer Zoom (8–9): 4–7 km, Täler und Gebiete; nah (10–11): 2–3 km.
 */
const RADIUS_KM: readonly (readonly [number, number])[] = [
  [4, 32],
  [5, 23],
  [6, 15],
  [7, 10],
  [8, 6.7],
  [9, 4.4],
  [10, 2.8],
  [11, 1.7],
  [12, 1.05],
  [13, 0.65],
];

export function radiusKm(zoom: number): number {
  const s = RADIUS_KM;
  if (zoom <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (zoom <= s[i][0]) {
      const [z0, r0] = s[i - 1];
      const [z1, r1] = s[i];
      const t = (zoom - z0) / (z1 - z0);
      return Math.exp(Math.log(r0) + t * (Math.log(r1) - Math.log(r0)));
    }
  }
  return s[s.length - 1][1];
}

/** Radius in Bildschirmpixeln – wächst beim Hineinzoomen (geografisch skaliert, nicht fix). */
export function radiusPx(zoom: number): number {
  return (radiusKm(zoom) * 1000) / metersPerPixel(zoom);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** `heatmap-radius` als Zoom-Ausdruck, Stützstellen alle halben Zoomstufen. */
export function radiusExpression(): unknown[] {
  const stops: number[] = [];
  for (let z = 4; z <= 13.0001; z += 0.5) stops.push(z, round2(radiusPx(z)));
  return ['interpolate', ['linear'], ['zoom'], ...stops];
}

// ── Eingabe ──────────────────────────────────────────────────────────────────

export interface DensityPoint {
  id: string;
  name: string;
  lng: number;
  lat: number;
  /** Art (peak, lake, hut …) – für die Aufschlüsselung je Hotspot. */
  kind: string;
  /** Beitrag zur Heatmap: Treffer 1, «knapp ausserhalb» und Ziele ohne Angabe weniger. */
  weight: number;
}

export interface PreparedPoints {
  n: number;
  ids: string[];
  kinds: string[];
  lng: Float64Array;
  lat: Float64Array;
  /** Web-Mercator-Weltkoordinaten (0–1). */
  mx: Float64Array;
  my: Float64Array;
  w: Float32Array;
}

/**
 * Doppelte entfernen: gleiche ID nur einmal; gleicher Ort (≈ 1 m) mit gleichem
 * Namen nur einmal. Verschiedene Ziele am selben Ort (z. B. See und Hütte) bleiben.
 * Punkte ohne gültige Koordinaten fallen weg.
 */
export function preparePoints(points: readonly DensityPoint[]): PreparedPoints {
  const seenId = new Set<string>();
  const seenPlace = new Set<string>();
  const keep: DensityPoint[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 85) continue;
    if (seenId.has(p.id)) continue;
    const place = `${p.lat.toFixed(5)},${p.lng.toFixed(5)},${p.name.trim().toLowerCase()}`;
    if (seenPlace.has(place)) continue;
    seenId.add(p.id);
    seenPlace.add(place);
    keep.push(p);
  }
  const n = keep.length;
  const out: PreparedPoints = {
    n,
    ids: keep.map((p) => p.id),
    kinds: keep.map((p) => p.kind),
    lng: new Float64Array(n),
    lat: new Float64Array(n),
    mx: new Float64Array(n),
    my: new Float64Array(n),
    w: new Float32Array(n),
  };
  keep.forEach((p, i) => {
    out.lng[i] = p.lng;
    out.lat[i] = p.lat;
    out.mx[i] = mercX(p.lng);
    out.my[i] = mercY(p.lat);
    out.w[i] = Math.max(0, Math.min(1, p.weight));
  });
  return out;
}

// ── Dichtefeld ───────────────────────────────────────────────────────────────

/** Höchstens so viele Rasterzellen je Zoomstufe (sonst wird die Zelle gröber). */
const MAX_CELLS = 320_000;

interface Field {
  zoom: number;
  /** Zellgrösse in Bildschirmpixeln der Zoomstufe. */
  cell: number;
  /** Ursprung (Weltpixel) und Grösse. */
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  /** Dichte je Zelle ohne Intensität: Σ Gewicht · 1/√(2π) · exp(−d²/2σ²). */
  d: Float32Array;
  /** Zelle je Ziel. */
  cellOf: Int32Array;
}

/**
 * Dichtefeld bei Zoom z: Ziele ins Raster legen (Zelle ≈ σ/2), dann trennbar mit
 * dem Gauss-Kern falten. Das Raster deckt nur die Ziele samt Kernreichweite ab.
 */
function densityField(pts: PreparedPoints, zoom: number): Field {
  const scale = TILE_PX * 2 ** zoom;
  const sigma = radiusPx(zoom) / 3;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.n; i++) {
    const x = pts.mx[i] * scale;
    const y = pts.my[i] * scale;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const margin = 3 * sigma;
  const spanX = maxX - minX + 2 * margin;
  const spanY = maxY - minY + 2 * margin;
  const cell = Math.max(sigma / 2, Math.sqrt((spanX * spanY) / MAX_CELLS), 0.5);
  const cols = Math.max(1, Math.ceil(spanX / cell) + 1);
  const rows = Math.max(1, Math.ceil(spanY / cell) + 1);
  const x0 = minX - margin;
  const y0 = minY - margin;

  const binned = new Float32Array(cols * rows);
  const cellOf = new Int32Array(pts.n);
  for (let i = 0; i < pts.n; i++) {
    const cx = Math.min(cols - 1, Math.max(0, Math.round((pts.mx[i] * scale - x0) / cell)));
    const cy = Math.min(rows - 1, Math.max(0, Math.round((pts.my[i] * scale - y0) / cell)));
    const c = cy * cols + cx;
    cellOf[i] = c;
    binned[c] += pts.w[i];
  }

  // Trennbarer Gauss-Kern, abgeschnitten bei 3σ wie auf der GPU.
  const reach = Math.max(1, Math.ceil((3 * sigma) / cell));
  const kernel = new Float32Array(2 * reach + 1);
  for (let k = -reach; k <= reach; k++) {
    const dist = k * cell;
    kernel[k + reach] = dist * dist <= 9 * sigma * sigma ? Math.exp(-(dist * dist) / (2 * sigma * sigma)) : 0;
  }
  const tmp = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    const row = y * cols;
    for (let x = 0; x < cols; x++) {
      const v = binned[row + x];
      if (v === 0) continue;
      const from = Math.max(0, x - reach);
      const to = Math.min(cols - 1, x + reach);
      for (let t = from; t <= to; t++) tmp[row + t] += v * kernel[t - x + reach];
    }
  }
  const d = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    const from = Math.max(0, y - reach);
    const to = Math.min(rows - 1, y + reach);
    const row = y * cols;
    for (let x = 0; x < cols; x++) {
      const v = tmp[row + x];
      if (v === 0) continue;
      for (let t = from; t <= to; t++) d[t * cols + x] += v * kernel[t - y + reach];
    }
  }
  // Die radiale Abschneidung (3σ) ist im trennbaren Kern ein Quadrat – die Ecken
  // tragen < 1 % bei und sind hier vernachlässigt.
  for (let i = 0; i < d.length; i++) d[i] *= GAUSS_COEF;
  return { zoom, cell, x0, y0, cols, rows, d, cellOf };
}

/** p-Quantil (0–1) der Dichte an den Zielen. */
function quantileAtPoints(f: Field, pts: PreparedPoints, p: number): number {
  if (pts.n === 0) return 0;
  const vals = new Float32Array(pts.n);
  for (let i = 0; i < pts.n; i++) vals[i] = f.d[f.cellOf[i]];
  vals.sort();
  return vals[Math.min(pts.n - 1, Math.max(0, Math.round(p * (pts.n - 1))))];
}

// ── Normalisierung ───────────────────────────────────────────────────────────

/** Dieses Quantil der Dichte an den Zielen erreicht die oberste Farbe. */
const ROBUST_QUANTILE = 0.98;
/** Obergrenze der Intensität: ein einzelnes Ziel (Gewicht 1) erreicht höchstens 0,85 · 0,399 ≈ 0,34. */
export const MAX_INTENSITY = 0.85;
const MIN_INTENSITY = 0.002;
/** Zoomstufen, für die die Intensität berechnet wird (dazwischen interpoliert). */
const INTENSITY_ZOOMS = [5, 6, 7, 8, 9, 10, 11];

function intensityFor(robustMax: number): number {
  if (!(robustMax > 0)) return MAX_INTENSITY;
  return Math.min(MAX_INTENSITY, Math.max(MIN_INTENSITY, 1 / robustMax));
}

// ── Hotspots ─────────────────────────────────────────────────────────────────

/**
 * Stufen der normalisierten Dichte (0–1) – gemeinsam für die Farbskala der
 * Heatmap und die Hotspot-Erkennung. Gesetzt nach der gemessenen Verteilung an
 * den Zielen (Suchindex 11/2026, über Zoom 6–10 und Datenmengen stabil): Median
 * ≈ 0,4 → «niedrig», oberstes Viertel → «mittel», oberste 10 % → «hoch»,
 * oberste 2 % → «sehr hoch». So bleibt das Grundleuchten schwach, echte
 * Konzentrationen heben sich ab.
 */
export const DENSITY_LEVELS = { veryLow: 0.18, low: 0.4, medium: 0.6, high: 0.8, veryHigh: 1 } as const;

/** Ab hier wird das Leuchten wahrnehmbar (etwa halbe erste Farbstufe) – Grenze eines Hotspots. */
export const VISIBLE_DENSITY = 0.1;
/**
 * Ein Hotspot (zum Antippen) braucht am Maximum mindestens «niedrig» – ein
 * einzelnes Ziel (≈ 0,34) nie. Zahlen bekommen nur Hotspots ab «hoch» (hotspotLayer).
 */
const RELEVANT_DENSITY = DENSITY_LEVELS.low;
/** Nebenmaxima, die weniger als so viel über dem Sattel liegen, gehören zum Nachbarn. */
const PERSISTENCE = 0.12;

export interface Hotspot {
  /** Lage des Dichtemaximums. */
  lng: number;
  lat: number;
  /** Echte Anzahl der Ziele im leuchtenden Einzugsgebiet; jedes Ziel zählt höchstens einmal. */
  count: number;
  /** Anzahl je Art. */
  kinds: Record<string, number>;
  /** Ausdehnung der zugehörigen Ziele: West, Süd, Ost, Nord. */
  bbox: [number, number, number, number];
  /** Normalisierte Dichte am Maximum (≥ 1 = oberste Farbe). */
  peak: number;
}

export interface HotspotBand {
  /** Zoomstufe, für die das Feld gerechnet wurde. */
  zoom: number;
  /** Hotspots, gross zuerst (nur relevante: Maximum mindestens «mittel»). */
  hotspots: Hotspot[];
  /**
   * Raster zum Nachschlagen beim Tippen: Zelle → Index in `hotspots`, −1 = kein
   * relevanter Hotspot. Reine Daten, damit das Band aus einem Web Worker kommen kann.
   */
  lookup: { x0: number; y0: number; cell: number; cols: number; rows: number; index: Int32Array };
}

/** Hotspot unter einem Ort (nur im sichtbar leuchtenden Bereich eines relevanten Hotspots), sonst null. */
export function hotspotAt(band: HotspotBand, lng: number, lat: number): Hotspot | null {
  const { x0, y0, cell, cols, rows, index } = band.lookup;
  const scale = TILE_PX * 2 ** band.zoom;
  const x = Math.round((mercX(lng) * scale - x0) / cell);
  const y = Math.round((mercY(lat) * scale - y0) / cell);
  if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
  const i = index[y * cols + x];
  return i >= 0 ? (band.hotspots[i] ?? null) : null;
}

function detectHotspots(pts: PreparedPoints, f: Field, intensity: number): HotspotBand {
  const { cols, rows, d } = f;
  const n = cols * rows;
  const visible = VISIBLE_DENSITY / intensity;
  const tau = PERSISTENCE / intensity;

  // Zellen im leuchtenden Bereich, dichteste zuerst.
  let m = 0;
  for (let i = 0; i < n; i++) if (d[i] >= visible) m++;
  const order = new Uint32Array(m);
  m = 0;
  for (let i = 0; i < n; i++) if (d[i] >= visible) order[m++] = i;
  const sorted = Array.from(order).sort((a, b) => d[b] - d[a]);

  // Union-Find über die Zellen: jede Zelle schliesst sich dem Nachbarn mit dem
  // höchsten Maximum an; flache Nebenmaxima werden dabei zusammengelegt.
  const parent = new Int32Array(n).fill(-1);
  const peak = new Float32Array(n);
  const peakCell = new Int32Array(n);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) {
      const next = parent[i];
      parent[i] = r;
      i = next;
    }
    return r;
  };
  const roots: number[] = [];
  for (const i of sorted) {
    parent[i] = i;
    peak[i] = d[i];
    peakCell[i] = i;
    const x = i % cols;
    const y = (i - x) / cols;
    roots.length = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= rows) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if ((dx === 0 && dy === 0) || xx < 0 || xx >= cols) continue;
        const j = yy * cols + xx;
        if (parent[j] === -1) continue;
        const r = find(j);
        if (!roots.includes(r)) roots.push(r);
      }
    }
    if (roots.length === 0) continue; // neues Maximum
    let best = roots[0];
    for (const r of roots) if (peak[r] > peak[best]) best = r;
    parent[i] = best;
    for (const r of roots) {
      if (r !== best && peak[r] - d[i] < tau) parent[r] = best;
    }
  }

  // Ziele den Einzugsgebieten zuordnen.
  interface Acc {
    count: number;
    kinds: Record<string, number>;
    w: number;
    s: number;
    e: number;
    nn: number;
  }
  const acc = new Map<number, Acc>();
  for (let i = 0; i < pts.n; i++) {
    const c = f.cellOf[i];
    if (parent[c] === -1) continue; // ausserhalb des leuchtenden Bereichs
    const r = find(c);
    let a = acc.get(r);
    if (!a) {
      a = { count: 0, kinds: {}, w: Infinity, s: Infinity, e: -Infinity, nn: -Infinity };
      acc.set(r, a);
    }
    a.count++;
    a.kinds[pts.kinds[i]] = (a.kinds[pts.kinds[i]] ?? 0) + 1;
    if (pts.lng[i] < a.w) a.w = pts.lng[i];
    if (pts.lng[i] > a.e) a.e = pts.lng[i];
    if (pts.lat[i] < a.s) a.s = pts.lat[i];
    if (pts.lat[i] > a.nn) a.nn = pts.lat[i];
  }

  const scale = TILE_PX * 2 ** f.zoom;
  const hotspotOfRoot = new Map<number, Hotspot>();
  const all: Hotspot[] = [];
  for (const [r, a] of acc) {
    // Lage: dichtegewichteter Schwerpunkt der 3×3 Zellen um das Maximum.
    const pc = peakCell[r];
    const px = pc % cols;
    const py = (pc - px) / cols;
    let sw = 0;
    let sx = 0;
    let sy = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = px + dx;
        const yy = py + dy;
        if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
        const v = d[yy * cols + xx];
        sw += v;
        sx += v * xx;
        sy += v * yy;
      }
    }
    const cx = sw > 0 ? sx / sw : px;
    const cy = sw > 0 ? sy / sw : py;
    const h: Hotspot = {
      lng: unmercX((f.x0 + cx * f.cell) / scale),
      lat: unmercY((f.y0 + cy * f.cell) / scale),
      count: a.count,
      kinds: a.kinds,
      bbox: [a.w, a.s, a.e, a.nn],
      peak: peak[r] * intensity,
    };
    hotspotOfRoot.set(r, h);
    all.push(h);
  }

  const relevant = all.filter((h) => h.peak >= RELEVANT_DENSITY).sort((a, b) => b.count - a.count || b.peak - a.peak);

  // Nachschlage-Raster: jede leuchtende Zelle → ihr relevanter Hotspot.
  const indexOf = new Map<Hotspot, number>();
  relevant.forEach((h, i) => indexOf.set(h, i));
  const indexOfRoot = new Map<number, number>();
  for (const [r, h] of hotspotOfRoot) {
    const i = indexOf.get(h);
    if (i !== undefined) indexOfRoot.set(r, i);
  }
  const index = new Int32Array(n).fill(-1);
  for (const c of sorted) index[c] = indexOfRoot.get(find(c)) ?? -1;

  return {
    zoom: f.zoom,
    hotspots: relevant,
    lookup: { x0: f.x0, y0: f.y0, cell: f.cell, cols, rows, index },
  };
}

// ── Gesamtmodell ─────────────────────────────────────────────────────────────

export interface DensityModel {
  /** Ziele nach dem Entfernen von Doppelten. */
  points: number;
  /** [Zoom, heatmap-intensity] – aufsteigend. */
  intensity: [number, number][];
  /** Hotspots je Zoomband, aufsteigend nach Zoom. */
  bands: HotspotBand[];
  /** Rechenzeit in ms (zur Kontrolle auf schwachen Geräten). */
  ms: number;
}

/** Zoomstufen der Hotspot-Bänder (Zahlen auf mittlerem Zoom). */
export const BAND_ZOOMS = [7.5, 8.5, 9.5];

export function buildDensityModel(
  points: readonly DensityPoint[] | PreparedPoints,
  opts: { bandZooms?: readonly number[] } = {},
): DensityModel {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const pts = 'mx' in points ? points : preparePoints(points);
  const bandZooms = opts.bandZooms ?? BAND_ZOOMS;
  if (pts.n === 0) {
    return { points: 0, intensity: INTENSITY_ZOOMS.map((z) => [z, MAX_INTENSITY]), bands: [], ms: 0 };
  }
  const intensity: [number, number][] = INTENSITY_ZOOMS.map((z) => [
    z,
    intensityFor(quantileAtPoints(densityField(pts, z), pts, ROBUST_QUANTILE)),
  ]);
  const bands = bandZooms.map((z) => {
    const f = densityField(pts, z);
    return detectHotspots(pts, f, intensityAt(intensity, z));
  });
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { points: pts.n, intensity, bands, ms: Math.round(t1 - t0) };
}

/** Intensität bei Zoom z (linear zwischen den Stützstellen, wie der Kartenausdruck). */
export function intensityAt(stops: readonly [number, number][], zoom: number): number {
  if (stops.length === 0) return MAX_INTENSITY;
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (zoom <= stops[i][0]) {
      const [z0, v0] = stops[i - 1];
      const [z1, v1] = stops[i];
      return v0 + ((zoom - z0) / (z1 - z0)) * (v1 - v0);
    }
  }
  return stops[stops.length - 1][1];
}

/** `heatmap-intensity` als Zoom-Ausdruck. */
export function intensityExpression(stops: readonly [number, number][]): unknown[] {
  if (stops.length === 0) return ['literal', MAX_INTENSITY] as unknown[];
  if (stops.length === 1) return ['interpolate', ['linear'], ['zoom'], stops[0][0], stops[0][1], stops[0][0] + 1, stops[0][1]];
  return ['interpolate', ['linear'], ['zoom'], ...stops.flatMap(([z, v]) => [z, Math.round(v * 10_000) / 10_000])];
}

/** Normalisierte Dichte (wie auf der Karte) an einem Ort bei Zoom z – für Tests und Diagnose. */
export function densityAt(pts: PreparedPoints, intensity: number, zoom: number, lng: number, lat: number): number {
  const scale = TILE_PX * 2 ** zoom;
  const sigma = radiusPx(zoom) / 3;
  const x = mercX(lng) * scale;
  const y = mercY(lat) * scale;
  let sum = 0;
  for (let i = 0; i < pts.n; i++) {
    const dx = pts.mx[i] * scale - x;
    const dy = pts.my[i] * scale - y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 9 * sigma * sigma) continue;
    sum += pts.w[i] * Math.exp(-d2 / (2 * sigma * sigma));
  }
  return sum * GAUSS_COEF * intensity;
}
