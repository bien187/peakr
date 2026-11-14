import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { encodeRate, scaleClass, WEATHER_SCALES } from '@ch-alpineroute/shared';
import { describe, expect, it } from 'vitest';
import {
  decodeRadar,
  encodePng,
  GRID,
  outputSize,
  parseStamp,
  radarAssetUrl,
  radarCoordinates,
  radarFileName,
  renderRadar,
  renderRadarBytes,
  sampleGrid,
  stampOf,
  timeFromFileName,
  type RadarGrid,
} from './radar.service';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, '__fixtures__/rzc263171625vl.001.h5');

describe('Radar: Zeitstempel und Dateien', () => {
  it('bildet Dateinamen mit Tag des Jahres und liest sie zurück', () => {
    const t = new Date('2026-11-13T16:25:00Z');
    expect(radarFileName(t)).toBe('rzc263171625vl.001.h5');
    expect(radarAssetUrl(t)).toBe('https://data.geo.admin.ch/ch.meteoschweiz.ogd-radar-precip/20261113-ch/rzc263171625vl.001.h5');
    expect(timeFromFileName('rzc263171625vl.001.h5')?.toISOString()).toBe('2026-11-13T16:25:00.000Z');
    expect(timeFromFileName('cpc2631716200_00060.001.h5')).toBeNull(); // anderes Produkt
    // Schaltjahr und Jahresanfang
    expect(radarFileName(new Date('2028-12-31T00:05:00Z'))).toBe('rzc283660005vl.001.h5');
    expect(timeFromFileName('rzc260010000vl.001.h5')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('akzeptiert nur 5-Minuten-Zeitstempel', () => {
    expect(stampOf(new Date('2026-11-13T16:25:00Z'))).toBe('202611131625');
    expect(parseStamp('202611131625')?.toISOString()).toBe('2026-11-13T16:25:00.000Z');
    expect(parseStamp('202611131623')).toBeNull();
    expect(parseStamp('2026111316')).toBeNull();
    expect(parseStamp('../etc/passwd')).toBeNull();
  });
});

describe('Radar: Dekodieren (echte Datei von MeteoSchweiz)', () => {
  it('liest das 710 × 640-Raster in mm/h mit Lücken ausserhalb der Abdeckung', async () => {
    const grid = await decodeRadar(new Uint8Array(readFileSync(FIXTURE)));
    expect(grid.rows).toBe(640);
    expect(grid.cols).toBe(710);
    let nan = 0;
    let max = 0;
    const data = grid.data as ArrayLike<number>;
    for (let i = 0; i < data.length; i++) {
      if (Number.isNaN(data[i])) nan++;
      else max = Math.max(max, data[i]);
    }
    expect(nan).toBe(101_914);
    expect(max).toBeCloseTo(1.64, 2);
    // Mitte der Schweiz liegt in der Abdeckung (Wert, nicht NaN)
    expect(Number.isNaN(sampleGrid(grid, 46.8, 8.2))).toBe(false);
  });

  it('weist alles ab, was keine HDF5-Datei ist', async () => {
    await expect(decodeRadar(new TextEncoder().encode('<html>404</html>'))).rejects.toThrow('Keine HDF5-Datei');
  });
});

describe('Radar: Lage und Darstellung', () => {
  /** Nördliche Hälfte 5 mm/h, südliche trocken. */
  const halves: RadarGrid = {
    rows: GRID.rows, cols: GRID.cols,
    data: Float64Array.from({ length: GRID.rows * GRID.cols }, (_, i) => (Math.floor(i / GRID.cols) < GRID.rows / 2 ? 5 : 0)),
  };

  it('Zeile 0 ist Norden: Basel (Nordhälfte des Rasters) nass, Lugano trocken', () => {
    // Rastermitte N 1'160'000 – Basel liegt nördlich davon, Lugano südlich.
    expect(sampleGrid(halves, 47.56, 7.59)).toBe(5);
    expect(sampleGrid(halves, 46.0, 8.95)).toBe(0);
    expect(Number.isNaN(sampleGrid(halves, 40, 8))).toBe(true); // ausserhalb
  });

  it('färbt nach denselben Klassen wie die Legende, trocken und NaN bleiben transparent', () => {
    const img = renderRadar(halves);
    const { width, height } = outputSize();
    expect(img.width).toBe(width);
    expect(img.height).toBe(height);
    const at = (lng: number, lat: number) => {
      const b = { west: 5, east: 11.5 };
      const px = Math.floor(((lng - b.west) / (b.east - b.west)) * width);
      const y = (l: number) => Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360));
      const py = Math.floor(((y(48.4) - y(lat)) / (y(48.4) - y(45.2))) * height);
      return Array.from(img.rgba.subarray((py * width + px) * 4, (py * width + px) * 4 + 4));
    };
    const expected = WEATHER_SCALES.precip.colors[scaleClass(WEATHER_SCALES.precip, 5)];
    const [r, g, b, a] = at(7.59, 47.56);
    expect('#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')).toBe(expected);
    expect(a).toBeGreaterThan(150);
    expect(at(8.95, 46.0)[3]).toBe(0);
  });

  it('liefert eine gültige PNG-Datei (Signatur, Kopf, Prüfsummen, Bilddaten)', () => {
    const rgba = new Uint8Array(4 * 3 * 2).fill(200);
    const png = encodePng(3, 2, rgba);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(3);
    expect(png.readUInt32BE(20)).toBe(2);
    // IDAT entpacken: 2 Zeilen × (1 Filterbyte + 3 × 4)
    const idatLen = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString('ascii')).toBe('IDAT');
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect(raw.length).toBe(2 * 13);
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
  });

  it('Bildecken für MapLibre im Uhrzeigersinn ab oben links', () => {
    expect(radarCoordinates()).toEqual([[5, 48.4], [11.5, 48.4], [11.5, 45.2], [5, 45.2]]);
  });
});

describe('Farbklassen der Wetterkarte', () => {
  it('Grössen: unter der ersten Stufe transparent, darüber Klassen von hell nach dunkel', () => {
    const s = WEATHER_SCALES.precip;
    expect(scaleClass(s, 0)).toBe(-1);
    expect(scaleClass(s, 0.1)).toBe(0);
    expect(scaleClass(s, 1.5)).toBe(1);
    expect(scaleClass(s, 500)).toBe(s.colors.length - 1);
    expect(scaleClass(s, null)).toBe(-1);
    expect(scaleClass(s, Number.NaN)).toBe(-1);
  });

  it('Temperatur divergierend mit neutraler Mitte um 0 °C', () => {
    const s = WEATHER_SCALES.temp;
    expect(scaleClass(s, -35)).toBe(0);
    expect(s.colors[scaleClass(s, 0)]).toBe('#f0efec');
    expect(scaleClass(s, 3)).toBeGreaterThan(scaleClass(s, 0));
    expect(scaleClass(s, -3)).toBeLessThan(scaleClass(s, 0));
    // gleich viele Stufen je Seite
    const mid = s.colors.indexOf('#f0efec');
    expect(mid).toBe(s.colors.length - 1 - mid);
  });

  it('jede Ebene hat so viele Beschriftungen wie Farben', () => {
    for (const s of Object.values(WEATHER_SCALES)) {
      expect(s.labels).toHaveLength(s.colors.length);
      expect(s.from).toHaveLength(s.colors.length);
    }
  });
});

describe('Radar: Datenbild für die fliessende Darstellung im Browser', () => {
  const halves: RadarGrid = {
    rows: GRID.rows, cols: GRID.cols,
    data: Float64Array.from({ length: GRID.rows * GRID.cols }, (_, i) => (Math.floor(i / GRID.cols) < GRID.rows / 2 ? 5 : 0)),
  };

  it('speichert je Pixel die Intensität als Byte (logarithmisch), trocken = 0', () => {
    const img = renderRadarBytes(halves);
    const { width, height } = outputSize();
    expect(img.width).toBe(width);
    expect(img.height).toBe(height);
    const at = (lng: number, lat: number) => {
      const px = Math.floor(((lng - 5) / 6.5) * width);
      const y = (l: number) => Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360));
      const py = Math.floor(((y(48.4) - y(lat)) / (y(48.4) - y(45.2))) * height);
      return img.bytes[py * width + px];
    };
    expect(at(7.59, 47.56)).toBe(encodeRate(5)); // Basel nass
    expect(at(8.95, 46.0)).toBe(0); // Lugano trocken
  });

  it('Graustufen-PNG: Farbtyp 0, ein Byte je Pixel', () => {
    const png = encodePng(3, 2, Uint8Array.from([0, 1, 2, 3, 4, 5]), 1);
    expect(png[24]).toBe(8); // Bittiefe
    expect(png[25]).toBe(0); // Graustufen
    const idatLen = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect([...raw]).toEqual([0, 0, 1, 2, 0, 3, 4, 5]);
  });
});
