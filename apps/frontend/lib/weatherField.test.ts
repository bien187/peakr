import { deflateSync } from 'node:zlib';
import { WEATHER_SCALES, type ForecastGridResponse } from '@ch-alpineroute/shared';
import { describe, expect, it } from 'vitest';
import {
  boxBlur,
  colorize,
  decodeGrayPng,
  gridGeom,
  gridRaw,
  latOfMercY,
  lerpGrid,
  mercY,
  palette,
  prepareRadarFrame,
  radarByteAt,
  radarValues,
  renderGrid,
  sampleGrid,
  toBytes,
  windField,
  type Corners,
} from './weatherField';

/** Raster 4 × 3 Zellen (0,1°) um Bern, Werte je Zelle. */
function grid(values: number[], directions?: number[]): ForecastGridResponse {
  const cells: [number, number][] = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) cells.push([46.9 + j * 0.1, 7.4 + i * 0.1]);
  return {
    variable: 'gust', evidence: 'forecast', source: 'test', fetchedAt: null, start: '2026-11-14T10:00:00Z', hours: 1,
    cellDeg: 0.1, cells, elevations: cells.map(() => null), values: [values], directions: directions ? [directions] : null,
  };
}

const alphaOf = (px: number) => px >>> 24;

describe('Farbe', () => {
  const pal = palette(WEATHER_SCALES.precip);

  it('trocken und fehlend durchsichtig; schwacher Regen läuft weich aus; starker voll', () => {
    const vals = Float32Array.from([0, Number.NaN, 2, 14, 120, 255]);
    const out = new Uint32Array(vals.length);
    colorize(vals, null, pal, out);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(alphaOf(out[2])).toBeGreaterThan(0);
    expect(alphaOf(out[2])).toBeLessThan(alphaOf(out[3])); // unter fadeBelow abgeschwächt
    expect(alphaOf(out[5])).toBe(255);
    // Little-Endian RGBA: rot im untersten Byte – gelbliches Ende des Verlaufs
    expect(out[5] & 0xff).toBe(0xff);
  });

  it('Rand der Datenabdeckung blendet aus', () => {
    const vals = Float32Array.from([200, 200, 200]);
    const cov = Float32Array.from([1, 0.5, 0.05]);
    const out = new Uint32Array(3);
    colorize(vals, cov, pal, out);
    expect(alphaOf(out[0])).toBeGreaterThan(alphaOf(out[1]));
    expect(alphaOf(out[2])).toBe(0);
  });
});

describe('Weichzeichnen', () => {
  it('erhält die Summe im Inneren und verteilt einen Punkt symmetrisch', () => {
    const w = 21;
    const h = 21;
    const f = new Float32Array(w * h);
    f[10 * w + 10] = 100;
    const tmp = new Float32Array(w * h);
    boxBlur(f, w, h, 2, tmp);
    boxBlur(f, w, h, 2, tmp);
    const sum = f.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 3);
    expect(f[10 * w + 10]).toBeLessThan(100);
    expect(f[10 * w + 12]).toBeCloseTo(f[10 * w + 8], 5);
    expect(f[12 * w + 10]).toBeCloseTo(f[8 * w + 10], 5);
    expect(f[0]).toBe(0);
  });

  it('Radarbild: weicher Hof statt Kante, Festkomma × 256', () => {
    const w = 30;
    const h = 20;
    const bytes = new Uint8Array(w * h);
    for (let y = 5; y < 15; y++) for (let x = 10; x < 20; x++) bytes[y * w + x] = 120;
    const out = prepareRadarFrame(bytes, w, h);
    expect(out[10 * w + 15] / 256).toBeCloseTo(120, 0); // Mitte der Fläche unverändert
    expect(out[10 * w + 9]).toBeGreaterThan(0); // knapp ausserhalb: Hof
    expect(out[10 * w + 9]).toBeLessThan(out[10 * w + 11]);
    expect(out[0]).toBe(0);
  });

  it('Zwischenbilder zweier Radarbilder', () => {
    const a = Uint16Array.from([0, 256 * 10]);
    const b = Uint16Array.from([256 * 20, 256 * 10]);
    const out = new Float32Array(2);
    radarValues(a, b, 0.5, out);
    expect([...out]).toEqual([10, 10]);
    radarValues(a, null, 0.5, out);
    expect([...out]).toEqual([0, 10]);
  });

  it('Wert eines Radarbilds am Ort (Mercator-Zeilen), ausserhalb NaN', () => {
    const corners: Corners = [[5, 48.4], [11.5, 48.4], [11.5, 45.2], [5, 45.2]];
    const w = 65;
    const h = 47;
    const frame = new Uint16Array(w * h);
    // Zeile von 47,0° N
    const y = Math.floor(((mercY(48.4) - mercY(47.0)) / (mercY(48.4) - mercY(45.2))) * h);
    frame[y * w + 30] = 256 * 77;
    const lng = 5 + (30.5 / w) * 6.5;
    expect(radarByteAt(frame, w, h, corners, lng, 47.0)).toBe(77);
    expect(Number.isNaN(radarByteAt(frame, w, h, corners, 4, 47))).toBe(true);
  });
});

describe('Prognoseraster', () => {
  it('Geometrie: Rand von einer Zelle, Bildecken, Zeilen in Mercator', () => {
    const geom = gridGeom(grid(new Array(12).fill(10)))!;
    expect(geom.nx).toBe(6);
    expect(geom.ny).toBe(5);
    expect(geom.lng0).toBeCloseTo(7.3, 9);
    expect(geom.lat0).toBeCloseTo(46.8, 9);
    expect(geom.corners[0][0]).toBeCloseTo(7.3, 9);
    expect(geom.corners[0][1]).toBeCloseTo(47.3, 9);
    expect(geom.corners[2][1]).toBeCloseTo(46.8, 9);
    expect(geom.W).toBe(48);
    // Seitenverhältnis wie auf der Karte (Mercator): Höhe/Breite ≈ Δy / Δx
    const ratio = (mercY(47.3) - mercY(46.8)) / ((0.6 * Math.PI) / 180);
    expect(geom.H / geom.W).toBeCloseTo(ratio, 1);
    expect(latOfMercY(mercY(46.95))).toBeCloseTo(46.95, 9);
  });

  it('gleichmässiges Feld bleibt innen gleich, aussen ohne Daten, Rand weich', () => {
    const g = grid(new Array(12).fill(40));
    const geom = gridGeom(g)!;
    const raw = gridRaw(geom, g.values[0]);
    const bytes = toBytes(WEATHER_SCALES.gust, raw);
    const n = geom.W * geom.H;
    const vals = new Float32Array(n);
    const cov = new Float32Array(n);
    renderGrid(geom, bytes, vals, cov, new Float32Array(n));
    const mid = Math.floor(geom.H / 2) * geom.W + Math.floor(geom.W / 2);
    const expected = bytes[geom.idx[5]];
    expect(vals[mid]).toBeCloseTo(expected, 3);
    expect(cov[mid]).toBeCloseTo(1, 3);
    expect(cov[0]).toBeLessThan(0.05); // Ecke im leeren Rand
    expect(Number.isNaN(vals[0]) || cov[0] < 0.05).toBe(true);
  });

  it('Wert am Ort: bilinear zwischen Zellmitten, ohne Daten NaN', () => {
    const values = [0, 10, 0, 0, 0, 20, 0, 0, 0, 0, 0, 0];
    const g = grid(values);
    const geom = gridGeom(g)!;
    const raw = gridRaw(geom, g.values[0]);
    // Mitte von Zelle (i=1, j=0): 7,55° / 46,95°
    expect(sampleGrid(geom, raw, 7.55, 46.95)).toBeCloseTo(10, 6);
    // zwischen den Mitten von (1,0) und (1,1)
    expect(sampleGrid(geom, raw, 7.55, 47.0)).toBeCloseTo(15, 6);
    expect(Number.isNaN(sampleGrid(geom, raw, 9.5, 46.9))).toBe(true);
  });

  it('zeitliche Überblendung; fehlende Werte bleiben fehlend', () => {
    const a = Float32Array.from([0, 100, Number.NaN]);
    const b = Float32Array.from([50, 100, 10]);
    const out = new Float32Array(3);
    lerpGrid(a, b, 0.5, out);
    expect(out[0]).toBe(25);
    expect(out[1]).toBe(100);
    expect(Number.isNaN(out[2])).toBe(true);
  });
});

describe('Wind', () => {
  it('Richtung «woher» → Vektor «wohin»: Westwind zieht nach Osten, Nordwind nach Süden', () => {
    const g = grid(new Array(12).fill(36), [270, 0, ...new Array(10).fill(270)]);
    const geom = gridGeom(g)!;
    const w = windField(geom, g)!;
    const west = geom.idx[0];
    const north = geom.idx[1];
    expect(w.u[0][west]).toBeCloseTo(36, 6);
    expect(w.v[0][west]).toBeCloseTo(0, 6);
    expect(w.u[0][north]).toBeCloseTo(0, 6);
    expect(w.v[0][north]).toBeCloseTo(-36, 6);
  });

  it('ohne Richtungen keine Bewegung (statt erfundener)', () => {
    const g = grid(new Array(12).fill(36));
    expect(windField(gridGeom(g)!, g)).toBeNull();
  });
});

describe('Graustufen-PNG', () => {
  /** PNG mit wählbarem Filter je Zeile – prüft die Dekodierung aller fünf Filter. */
  function png(width: number, rows: number[][], filters: number[]): ArrayBuffer {
    const raw: number[] = [];
    rows.forEach((row, y) => {
      const f = filters[y];
      raw.push(f);
      row.forEach((v, x) => {
        const a = x > 0 ? row[x - 1] : 0;
        const b = y > 0 ? rows[y - 1][x] : 0;
        const c = x > 0 && y > 0 ? rows[y - 1][x - 1] : 0;
        const p = a + b - c;
        const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
        const pred = [0, a, b, (a + b) >> 1, paeth][f];
        raw.push((v - pred) & 255);
      });
    });
    const chunk = (type: string, data: Uint8Array) => {
      const out = new Uint8Array(12 + data.length);
      const dv = new DataView(out.buffer);
      dv.setUint32(0, data.length);
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
      out.set(data, 8);
      return out; // Prüfsumme wird vom Dekoder nicht ausgewertet
    };
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, width);
    new DataView(ihdr.buffer).setUint32(4, rows.length);
    ihdr[8] = 8;
    ihdr[9] = 0;
    const parts = [
      Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', new Uint8Array(deflateSync(Uint8Array.from(raw)))),
      chunk('IEND', new Uint8Array(0)),
    ];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const buf = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      buf.set(p, o);
      o += p.length;
    }
    return buf.buffer;
  }

  it('liest Bytes exakt zurück (Filter 0–4)', async () => {
    const rows = [
      [0, 10, 250, 3],
      [7, 7, 255, 128],
      [1, 200, 30, 60],
      [90, 91, 92, 0],
      [255, 0, 255, 0],
    ];
    const img = await decodeGrayPng(png(4, rows, [0, 1, 2, 3, 4]));
    expect(img.width).toBe(4);
    expect(img.height).toBe(5);
    expect([...img.bytes]).toEqual(rows.flat());
  });

  it('weist Fremdes ab', async () => {
    await expect(decodeGrayPng(new TextEncoder().encode('<html>').buffer as ArrayBuffer)).rejects.toThrow();
  });
});
