/**
 * Rechnet Dichtemodelle im Web Worker; ohne Worker (oder wenn er ausfällt)
 * im Haupt-Thread. Liefert nur das Ergebnis der jeweils letzten Anfrage.
 */
import { buildDensityModel, type DensityModel, type DensityPoint } from './densityEngine';

interface Pending {
  points: DensityPoint[];
  bandZooms: number[];
  resolve: (m: DensityModel | null) => void;
}

export class DensityComputer {
  private worker: Worker | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();

  constructor() {
    if (typeof Worker === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./density.worker.ts', import.meta.url));
      this.worker.onmessage = (e: MessageEvent<{ id: number; model: DensityModel }>) => {
        const p = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        p?.resolve(e.data.id === this.seq ? e.data.model : null);
      };
      this.worker.onerror = (e) => {
        e.preventDefault();
        this.fallBack();
      };
    } catch {
      this.worker = null;
    }
  }

  /** Dichtemodell für die Punkte; null, wenn inzwischen eine neuere Anfrage läuft. */
  compute(points: DensityPoint[], bandZooms: number[]): Promise<DensityModel | null> {
    const id = ++this.seq;
    if (!this.worker) return Promise.resolve(buildDensityModel(points, { bandZooms }));
    return new Promise((resolve) => {
      this.pending.set(id, { points, bandZooms, resolve });
      this.worker!.postMessage({ id, points, bandZooms });
    });
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.resolve(null);
    this.pending.clear();
  }

  /** Worker nicht nutzbar: offene Anfragen im Haupt-Thread fertig rechnen. */
  private fallBack(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [id, p] of this.pending) p.resolve(id === this.seq ? buildDensityModel(p.points, { bandZooms: p.bandZooms }) : null);
    this.pending.clear();
  }
}
