/**
 * Räumlicher Index über eine Teilmenge der Netz-Knoten (gleichmässiges Raster,
 * ~110 m Zellen). Dient dem Einrasten von Zielen und Parkplätzen auf den
 * nächsten Weg- bzw. Strassenpunkt.
 */
const SCALE = 1e7;
const M_PER_DEG = 111_320;

export class NodeGrid {
  private readonly minLat: number;
  private readonly minLng: number;
  private readonly cellLat = 0.001 * SCALE;
  private readonly cellLng = 0.0015 * SCALE;
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellStart: Uint32Array;
  private readonly cellNodes: Uint32Array;
  readonly count: number;

  constructor(
    private readonly lat: Int32Array,
    private readonly lng: Int32Array,
    mask: Uint8Array,
  ) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    let count = 0;
    for (let i = 0; i < lat.length; i++) {
      if (!mask[i]) continue;
      count++;
      if (lat[i] < minLat) minLat = lat[i];
      if (lat[i] > maxLat) maxLat = lat[i];
      if (lng[i] < minLng) minLng = lng[i];
      if (lng[i] > maxLng) maxLng = lng[i];
    }
    if (count === 0) minLat = maxLat = minLng = maxLng = 0;
    this.count = count;
    this.minLat = minLat;
    this.minLng = minLng;
    this.cols = Math.floor((maxLng - minLng) / this.cellLng) + 1;
    this.rows = Math.floor((maxLat - minLat) / this.cellLat) + 1;
    const cells = this.cols * this.rows;
    this.cellStart = new Uint32Array(cells + 1);
    for (let i = 0; i < lat.length; i++) if (mask[i]) this.cellStart[this.cellOf(i) + 1]++;
    for (let c = 0; c < cells; c++) this.cellStart[c + 1] += this.cellStart[c];
    const fill = this.cellStart.slice(0, cells);
    this.cellNodes = new Uint32Array(count);
    for (let i = 0; i < lat.length; i++) if (mask[i]) this.cellNodes[fill[this.cellOf(i)]++] = i;
  }

  private cellOf(i: number): number {
    return (
      Math.floor((this.lat[i] - this.minLat) / this.cellLat) * this.cols +
      Math.floor((this.lng[i] - this.minLng) / this.cellLng)
    );
  }

  /** Nächster Knoten innerhalb `maxM` Metern; −1, wenn keiner. Distanz steht danach in `lastDistM`. */
  lastDistM = 0;
  nearest(lat: number, lng: number, maxM: number): number {
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const latI = lat * SCALE;
    const lngI = lng * SCALE;
    const row0 = Math.floor((latI - this.minLat) / this.cellLat);
    const col0 = Math.floor((lngI - this.minLng) / this.cellLng);
    const cellM = 105;
    const maxRing = Math.ceil(maxM / cellM) + 1;
    let best = -1;
    let bestD2 = maxM * maxM;
    for (let ring = 0; ring <= maxRing; ring++) {
      if (best !== -1 && bestD2 <= ((ring - 1) * cellM) ** 2) break;
      for (let r = row0 - ring; r <= row0 + ring; r++) {
        if (r < 0 || r >= this.rows) continue;
        const edgeRow = r === row0 - ring || r === row0 + ring;
        for (let c = col0 - ring; c <= col0 + ring; c += edgeRow ? 1 : 2 * ring || 1) {
          if (c < 0 || c >= this.cols) continue;
          const cell = r * this.cols + c;
          for (let k = this.cellStart[cell]; k < this.cellStart[cell + 1]; k++) {
            const node = this.cellNodes[k];
            const dy = ((this.lat[node] - latI) / SCALE) * M_PER_DEG;
            const dx = ((this.lng[node] - lngI) / SCALE) * M_PER_DEG * cosLat;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
              bestD2 = d2;
              best = node;
            }
          }
        }
      }
    }
    this.lastDistM = Math.sqrt(bestD2);
    return best;
  }
}
