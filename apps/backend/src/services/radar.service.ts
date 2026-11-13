/**
 * Niederschlagsradar von MeteoSchweiz (Open Government Data, CC BY 4.0,
 * «Quelle: MeteoSchweiz») als Kartenbild.
 *
 * Produkt RZC («PRECIP»): Niederschlagsintensität in mm/h aus dem Verbund der
 * fünf Schweizer Wetterradare, alle 5 Minuten, ODIM-HDF5, 710 × 640 Zellen à
 * 1 km in LV95 (E 2'255'000–2'965'000, N 840'000–1'480'000). Abgelegt auf
 * data.geo.admin.ch (STAC-Sammlung ch.meteoschweiz.ogd-radar-precip), 14 Tage.
 *
 * Die Website rechnet ein Bild erst, wenn jemand die Wetterebene öffnet, und
 * lässt es danach im CDN liegen (ein Radarbild ändert sich nicht mehr).
 */
import { deflateSync } from 'node:zlib';
import { scaleClass, WEATHER_SCALES } from '@ch-alpineroute/shared';
import { wgs84ToLv95 } from '../geo/lv95';
import { fetchJson } from '../lib/http';

const STAC_ITEMS = 'https://data.geo.admin.ch/api/stac/v1/collections/ch.meteoschweiz.ogd-radar-precip/items';
const ASSETS = 'https://data.geo.admin.ch/ch.meteoschweiz.ogd-radar-precip';

/** Radarraster (Zellränder) in LV95. */
export const GRID = { e0: 2_255_000, n0: 1_480_000, cell: 1000, cols: 710, rows: 640 } as const;

/** Kartenausschnitt des Bildes (WGS84): Schweiz mit Rand. */
export const RADAR_BOUNDS = { west: 5.0, east: 11.5, south: 45.2, north: 48.4 } as const;
const OUT_WIDTH = 650;

// ── Zeitstempel und Dateien ──────────────────────────────────────────────────

/** «202611131625» (UTC) ↔ Date. */
export function stampOf(d: Date): string {
  return d.toISOString().slice(0, 16).replace(/[-T:]/g, '');
}
export function parseStamp(stamp: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return Number.isFinite(d.getTime()) && d.getUTCMinutes() % 5 === 0 ? d : null;
}

const dayOfYear = (d: Date): number => Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;

/** Dateiname wie auf data.geo.admin.ch: rzc + JJ + Tag des Jahres + HHMM + «vl.001.h5». */
export function radarFileName(d: Date): string {
  const yy = String(d.getUTCFullYear()).slice(2);
  const ddd = String(dayOfYear(d)).padStart(3, '0');
  const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `rzc${yy}${ddd}${hhmm}vl.001.h5`;
}

export function radarAssetUrl(d: Date): string {
  const day = d.toISOString().slice(0, 10).replace(/-/g, '');
  return `${ASSETS}/${day}-ch/${radarFileName(d)}`;
}

/** Zeitpunkt aus einem Dateinamen der Sammlung (oder null für andere Produkte). */
export function timeFromFileName(name: string): Date | null {
  const m = /^rzc(\d{2})(\d{3})(\d{2})(\d{2})vl\.001\.h5$/.exec(name);
  if (!m) return null;
  const year = 2000 + Number(m[1]);
  const d = new Date(Date.UTC(year, 0, 1) + (Number(m[2]) - 1) * 86_400_000);
  d.setUTCHours(Number(m[3]), Number(m[4]));
  return d;
}

/** Die jüngsten Radarbilder (aufsteigend), aus den STAC-Einträgen von heute und gestern. */
export async function listRadarFrames(now: Date, count = 12): Promise<Date[]> {
  const days = [now, new Date(now.getTime() - 86_400_000)].map((d) => d.toISOString().slice(0, 10).replace(/-/g, ''));
  const times: Date[] = [];
  for (const day of days) {
    try {
      const item = await fetchJson<{ assets?: Record<string, unknown> }>(`${STAC_ITEMS}/${day}-ch`, { timeoutMs: 15_000, retries: 1 });
      for (const key of Object.keys(item.assets ?? {})) {
        const t = timeFromFileName(key);
        if (t && t <= now) times.push(t);
      }
    } catch {
      // Tag noch nicht angelegt (kurz nach Mitternacht) – der andere reicht.
    }
    if (times.length >= count) break;
  }
  return [...new Set(times.map((t) => t.getTime()))]
    .sort((a, b) => a - b)
    .slice(-count)
    .map((t) => new Date(t));
}

// ── Dekodieren ───────────────────────────────────────────────────────────────

export interface RadarGrid {
  /** Zeilen von Nord nach Süd, Spalten von West nach Ost; NaN = ausserhalb der Radarabdeckung. */
  data: Float64Array | Float32Array | number[];
  rows: number;
  cols: number;
}

/** HDF5-Text aus einer Attribut-Antwort (kann mit NUL/Leerzeichen aufgefüllt sein). */
const attrText = (v: unknown): string => String(v ?? '').replace(/\0/g, '').trim();

/**
 * Liest das Raster aus einer ODIM-HDF5-Datei (RZC) und prüft Grösse und Einheit.
 * jsfive ist ein reiner JavaScript-Leser (NIST, ohne WebAssembly) – er läuft
 * in der Vercel-Funktion ohne besondere Bündelung.
 */
export async function decodeRadar(bytes: Uint8Array): Promise<RadarGrid> {
  // HDF5-Signatur prüfen, bevor eine Fehlerseite als Datei gelesen wird.
  const SIG = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || SIG.some((b, i) => bytes[i] !== b)) throw new Error('Keine HDF5-Datei');
  // jsfive bringt keine Typen mit; die genutzte Schnittstelle ist hier beschrieben.
  const { File } = (await import('jsfive' as string)) as {
    File: new (buffer: ArrayBuffer, name?: string) => { get(path: string): { attrs: Record<string, unknown>; value?: ArrayLike<number> } };
  };
  const f = new File(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 'radar.h5');
  const where = f.get('where').attrs;
  const size = (k: string) => Number(where[k]);
  if (size('xsize') !== GRID.cols || size('ysize') !== GRID.rows || size('xscale') !== GRID.cell) {
    throw new Error(`Unerwartetes Radarraster ${size('xsize')}×${size('ysize')} à ${size('xscale')} m`);
  }
  const what = f.get('dataset1/data1/what').attrs;
  const quantity = attrText(what.quantity);
  if (quantity !== 'RATE') throw new Error(`Unerwartete Grösse ${quantity}`);
  const gain = Number(what.gain ?? 1);
  const offset = Number(what.offset ?? 0);
  const raw = f.get('dataset1/data1/data').value;
  if (!raw || raw.length !== GRID.cols * GRID.rows) throw new Error('Radarraster unvollständig');
  const data = gain === 1 && offset === 0 ? Float64Array.from(raw) : Float64Array.from(raw, (v) => v * gain + offset);
  return { data, rows: GRID.rows, cols: GRID.cols };
}

// ── Darstellung ──────────────────────────────────────────────────────────────

/** Farbklassen (mm/h) – dieselben wie Legende und Prognoseraster der Website. */
const SCALE = WEATHER_SCALES.precip;
const ALPHA = Math.round(255 * SCALE.opacity);
const RGB = SCALE.colors.map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);

const mercY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latOfMercY = (y: number): number => (Math.atan(Math.sinh(y)) * 180) / Math.PI;

export function outputSize(): { width: number; height: number } {
  const b = RADAR_BOUNDS;
  const width = OUT_WIDTH;
  const height = Math.round((width * (mercY(b.north) - mercY(b.south))) / (((b.east - b.west) * Math.PI) / 180));
  return { width, height };
}

/** Wert des Rasters an einem WGS84-Punkt (nächste Zelle); NaN ausserhalb. */
export function sampleGrid(grid: RadarGrid, lat: number, lng: number): number {
  const { e, n } = wgs84ToLv95(lat, lng);
  const col = Math.floor((e - GRID.e0) / GRID.cell);
  const row = Math.floor((GRID.n0 - n) / GRID.cell);
  if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return Number.NaN;
  const v = grid.data[row * grid.cols + col];
  return typeof v === 'number' ? v : Number.NaN;
}

/**
 * RGBA-Bild in Web-Mercator für RADAR_BOUNDS: jede Bildzelle holt den Wert der
 * Radarzelle an ihrem Mittelpunkt. Dadurch liegt das Bild ohne Verzerrung als
 * MapLibre-«image»-Quelle über der Karte.
 */
export function renderRadar(grid: RadarGrid): { width: number; height: number; rgba: Uint8Array } {
  const { width, height } = outputSize();
  const b = RADAR_BOUNDS;
  const rgba = new Uint8Array(width * height * 4);
  const y0 = mercY(b.north);
  const y1 = mercY(b.south);
  for (let py = 0; py < height; py++) {
    const lat = latOfMercY(y0 + ((py + 0.5) / height) * (y1 - y0));
    for (let px = 0; px < width; px++) {
      const lng = b.west + ((px + 0.5) / width) * (b.east - b.west);
      const k = scaleClass(SCALE, sampleGrid(grid, lat, lng));
      if (k < 0) continue; // NaN, 0 und Spuren bleiben transparent
      const o = (py * width + px) * 4;
      rgba[o] = RGB[k][0];
      rgba[o + 1] = RGB[k][1];
      rgba[o + 2] = RGB[k][2];
      rgba[o + 3] = ALPHA;
    }
  }
  return { width, height, rgba };
}

// ── PNG (ohne Abhängigkeiten) ────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGBA → PNG (Farbtyp 6, 8 bit, Filter 0). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Lädt ein Radarbild und liefert es als PNG; null, wenn MeteoSchweiz es (noch) nicht anbietet. */
export async function radarPng(at: Date): Promise<Buffer | null> {
  const res = await fetch(radarAssetUrl(at), { signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Radar ${res.status}`);
  const grid = await decodeRadar(new Uint8Array(await res.arrayBuffer()));
  const img = renderRadar(grid);
  return encodePng(img.width, img.height, img.rgba);
}

/** Ecken des Bildes für MapLibre (oben links, oben rechts, unten rechts, unten links). */
export function radarCoordinates(): [[number, number], [number, number], [number, number], [number, number]] {
  const b = RADAR_BOUNDS;
  return [
    [b.west, b.north],
    [b.east, b.north],
    [b.east, b.south],
    [b.west, b.south],
  ];
}
