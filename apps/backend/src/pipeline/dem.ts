import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { logger } from '../lib/logger';

/**
 * Höhenmodell aus den offenen «Terrain Tiles» (Terrarium-Kodierung, AWS Open
 * Data). Zoom 12 entspricht in der Schweiz rund 26 m Rasterweite. Wird nur für
 * Wegpunkte gebraucht, die NICHT auf einem amtlichen Wanderweg liegen – dort
 * liefert swissTLM3D vermessene Höhen.
 */

const ZOOM = 12;
const TILE_PX = 256;
const BASE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const USER_AGENT = 'peakr-data-pipeline/1.0 (+https://github.com/bien187/peakr)';

function tileX(lng: number): number {
  return ((lng + 180) / 360) * (1 << ZOOM);
}
function tileY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * (1 << ZOOM);
}

export class TerrainModel {
  private tiles = new Map<number, Int16Array | null>();
  missing = 0;

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private static key(x: number, y: number): number {
    return x * 8192 + y;
  }

  private path(x: number, y: number): string {
    return resolve(this.dir, `${ZOOM}_${x}_${y}.png`);
  }

  /** Lädt fehlende Kacheln für die angegebenen Punkte (Koordinaten in 1e-7 Grad). */
  async ensureTiles(lat: Int32Array, lng: Int32Array, mask: Uint8Array | null): Promise<{ tiles: number; downloaded: number }> {
    const needed = new Set<number>();
    for (let i = 0; i < lat.length; i++) {
      if (mask && !mask[i]) continue;
      const x = Math.floor(tileX(lng[i] / 1e7));
      const y = Math.floor(tileY(lat[i] / 1e7));
      // Bilineare Interpolation greift am Kachelrand auf die Nachbarkachel zu.
      needed.add(TerrainModel.key(x, y));
      needed.add(TerrainModel.key(x + 1, y));
      needed.add(TerrainModel.key(x, y + 1));
      needed.add(TerrainModel.key(x + 1, y + 1));
    }
    const todo = [...needed].filter((k) => !existsSync(this.path(Math.floor(k / 8192), k % 8192)));
    let downloaded = 0;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < todo.length) {
        const k = todo[cursor++];
        const x = Math.floor(k / 8192);
        const y = k % 8192;
        for (let attempt = 1; attempt <= 4; attempt++) {
          try {
            const res = await fetch(`${BASE_URL}/${ZOOM}/${x}/${y}.png`, { headers: { 'user-agent': USER_AGENT } });
            if (res.status === 404) break; // ausserhalb der Abdeckung
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            writeFileSync(this.path(x, y), Buffer.from(await res.arrayBuffer()));
            downloaded++;
            break;
          } catch (err) {
            if (attempt === 4) {
              logger.warn({ x, y, error: err instanceof Error ? err.message : String(err) }, 'Höhenkachel nicht ladbar');
            } else {
              await new Promise((r) => setTimeout(r, attempt * 1500));
            }
          }
        }
        if (downloaded > 0 && downloaded % 250 === 0) logger.info({ downloaded, of: todo.length }, 'Höhenkacheln …');
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    return { tiles: needed.size, downloaded };
  }

  private tile(x: number, y: number): Int16Array | null {
    const key = TerrainModel.key(x, y);
    const cached = this.tiles.get(key);
    if (cached !== undefined) return cached;
    let data: Int16Array | null = null;
    const file = this.path(x, y);
    if (existsSync(file)) {
      try {
        const png = PNG.sync.read(readFileSync(file));
        if (png.width === TILE_PX && png.height === TILE_PX) {
          data = new Int16Array(TILE_PX * TILE_PX);
          for (let i = 0; i < TILE_PX * TILE_PX; i++) {
            const r = png.data[i * 4];
            const g = png.data[i * 4 + 1];
            const b = png.data[i * 4 + 2];
            data[i] = Math.round(r * 256 + g + b / 256 - 32768);
          }
        }
      } catch {
        data = null;
      }
    }
    this.tiles.set(key, data);
    return data;
  }

  private pixel(px: number, py: number): number | null {
    const tx = Math.floor(px / TILE_PX);
    const ty = Math.floor(py / TILE_PX);
    const t = this.tile(tx, ty);
    if (!t) return null;
    return t[(py - ty * TILE_PX) * TILE_PX + (px - tx * TILE_PX)];
  }

  /** Höhe in Metern (bilinear interpoliert) oder null, wenn keine Kachel vorliegt. */
  elevation(lat: number, lng: number): number | null {
    const fx = tileX(lng) * TILE_PX - 0.5;
    const fy = tileY(lat) * TILE_PX - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const a = this.pixel(x0, y0);
    const b = this.pixel(x0 + 1, y0);
    const c = this.pixel(x0, y0 + 1);
    const d = this.pixel(x0 + 1, y0 + 1);
    if (a === null || b === null || c === null || d === null) {
      this.missing++;
      return a ?? b ?? c ?? d;
    }
    const u = fx - x0;
    const v = fy - y0;
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
}
