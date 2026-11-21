/**
 * Web Worker der PeakrDensityEngine: rechnet Dichtemodell und Hotspots ausserhalb
 * des Haupt-Threads – Karte und Liste bleiben auch auf schwachen Handys flüssig.
 */
import { buildDensityModel, type DensityPoint } from './densityEngine';

interface Request {
  id: number;
  points: DensityPoint[];
  bandZooms: number[];
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const { id, points, bandZooms } = e.data;
  const model = buildDensityModel(points, { bandZooms });
  // Die Nachschlage-Raster werden übergeben statt kopiert.
  ctx.postMessage({ id, model }, model.bands.map((b) => b.lookup.index.buffer));
};
