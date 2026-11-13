import { logger } from '../lib/logger';
import { readTrailSegments } from './io/gpkg';
import { TRAIL_ALPINWANDERWEG, TRAIL_BERGWANDERWEG, TRAIL_WANDERWEG } from './trailCategories';

/**
 * Raster der amtlichen Wanderwege (swisstopo swissTLM3D).
 *
 * Jede 10-m-Zelle, durch die ein signalisierter Weg führt, kennt dessen
 * Kategorie und die vermessene Höhe. Damit erhalten OSM-Wege, die auf einem
 * amtlichen Wanderweg liegen, die offizielle Schwierigkeitsklasse und exakte
 * Höhen – ohne dass zwei Wegnetze topologisch verschmolzen werden müssen.
 */

export { TRAIL_ALPINWANDERWEG, TRAIL_BERGWANDERWEG, TRAIL_NONE, TRAIL_WANDERWEG } from './trailCategories';

const CATEGORY: Record<string, number> = {
  Wanderweg: TRAIL_WANDERWEG,
  Bergwanderweg: TRAIL_BERGWANDERWEG,
  Alpinwanderweg: TRAIL_ALPINWANDERWEG,
};

const CELL_M = 10;
const ORIGIN_E = 2_480_000;
const ORIGIN_N = 1_070_000;
const STEP_M = 5;

export class OfficialTrailGrid {
  private keys: Uint32Array;
  private zDm: Uint16Array;
  private cls: Uint8Array;
  private mask: number;
  private used = 0;
  segments = 0;
  lengthKm = 0;
  byCategoryKm: Record<string, number> = {};

  constructor(capacityPow2 = 24) {
    const size = 1 << capacityPow2;
    this.keys = new Uint32Array(size);
    this.zDm = new Uint16Array(size);
    this.cls = new Uint8Array(size);
    this.mask = size - 1;
  }

  private static key(e: number, n: number): number {
    const cx = Math.floor((e - ORIGIN_E) / CELL_M);
    const cy = Math.floor((n - ORIGIN_N) / CELL_M);
    if (cx < 0 || cx > 0xffff || cy < 0 || cy > 0x7ffe) return 0;
    return ((cy << 16) | cx) + 1;
  }

  private slot(key: number): number {
    let i = (Math.imul(key, 0x9e3779b1) >>> 0) & this.mask;
    while (this.keys[i] !== 0 && this.keys[i] !== key) i = (i + 1) & this.mask;
    return i;
  }

  private stamp(e: number, n: number, z: number, cls: number): void {
    const key = OfficialTrailGrid.key(e, n);
    if (key === 0) return;
    const i = this.slot(key);
    if (this.keys[i] === 0) {
      if (this.used > this.mask * 0.7) throw new Error('OfficialTrailGrid: Tabelle zu klein');
      this.keys[i] = key;
      this.used++;
      this.cls[i] = cls;
      this.zDm[i] = Math.max(0, Math.min(65_535, Math.round(z * 10)));
    } else if (cls > this.cls[i]) {
      // Verlaufen zwei Kategorien durch dieselbe Zelle, zählt die anspruchsvollere.
      this.cls[i] = cls;
    }
  }

  addLine(coords: Float64Array, cls: number, category: string): void {
    const n = coords.length / 3;
    for (let i = 0; i < n - 1; i++) {
      const e1 = coords[i * 3];
      const n1 = coords[i * 3 + 1];
      const z1 = coords[i * 3 + 2];
      const e2 = coords[i * 3 + 3];
      const n2 = coords[i * 3 + 4];
      const z2 = coords[i * 3 + 5];
      const len = Math.hypot(e2 - e1, n2 - n1);
      this.lengthKm += len / 1000;
      this.byCategoryKm[category] = (this.byCategoryKm[category] ?? 0) + len / 1000;
      const steps = Math.max(1, Math.ceil(len / STEP_M));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        this.stamp(e1 + (e2 - e1) * t, n1 + (n2 - n1) * t, z1 + (z2 - z1) * t, cls);
      }
    }
    this.segments++;
  }

  /**
   * Kategorie und Höhe am Punkt (LV95), wenn im Umkreis von einer Zelle
   * (≈ 10–15 m) ein amtlicher Wanderweg liegt; sonst null.
   */
  lookup(e: number, n: number): { cls: number; z: number } | null {
    let best: { cls: number; z: number } | null = null;
    let bestD = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = OfficialTrailGrid.key(e + dx * CELL_M, n + dy * CELL_M);
        if (key === 0) continue;
        const i = this.slot(key);
        if (this.keys[i] !== key) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { cls: this.cls[i], z: this.zDm[i] / 10 };
        }
      }
    }
    return best;
  }

  get cells(): number {
    return this.used;
  }
}

export function loadOfficialTrails(gpkgPath: string): OfficialTrailGrid {
  const grid = new OfficialTrailGrid();
  let unknownCategory = 0;
  for (const row of readTrailSegments(gpkgPath)) {
    const cls = row.category ? CATEGORY[row.category] : undefined;
    if (!cls) {
      unknownCategory++;
      continue;
    }
    for (const line of row.lines) grid.addLine(line.coords, cls, row.category!);
  }
  logger.info(
    {
      segments: grid.segments,
      km: Math.round(grid.lengthKm),
      byCategoryKm: Object.fromEntries(Object.entries(grid.byCategoryKm).map(([k, v]) => [k, Math.round(v)])),
      cells: grid.cells,
      unknownCategory,
    },
    'Amtliche Wanderwege geladen',
  );
  return grid;
}
