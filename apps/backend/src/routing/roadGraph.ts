/**
 * Strassengraph für die Autofahrzeit – Laufzeitteil.
 *
 * Der Graph wird von der Datenpipeline aus OpenStreetMap gebaut und als eine
 * Binärdatei ausgeliefert. Eine Suche rechnet damit EINEN Dijkstra-Lauf ab dem
 * Startort und kennt danach die Fahrzeit zu jedem Knoten der Schweiz – ohne
 * externen Dienst, ohne Kontingent und ohne Obergrenze der Zielanzahl.
 *
 * Dieses Modul hat keine Abhängigkeiten (auch nicht auf Node), damit es
 * unverändert in der Serverless-Funktion läuft.
 */
import { MinHeap } from '../lib/heap';

const MAGIC = 0x47524b50; // "PKRG" little-endian
export const ROAD_GRAPH_FORMAT = 2;
const HEADER_BYTES = 64;
const COORD_SCALE = 1e7;
/** Gewichte liegen in Zehntelsekunden vor (Uint16 → max. 109 min je Kante). */
export const TIME_UNIT_S = 0.1;

export interface RoadGraphMeta {
  /** Unix-Sekunden des Graph-Builds. */
  builtAt: number;
  /** Zeitstempel des OSM-Auszugs (Unix-Sekunden), 0 = unbekannt. */
  osmTimestamp: number;
  nodeCount: number;
  edgeCount: number;
}

export interface RoadGraph extends RoadGraphMeta {
  lat: Int32Array;
  lng: Int32Array;
  /** CSR: Kanten des Knotens i liegen in [offsets[i], offsets[i+1]). */
  offsets: Uint32Array;
  targets: Uint32Array;
  timeDs: Uint16Array;
  lenM: Uint16Array;
  grid: SnapGrid;
}

interface SnapGrid {
  minLat: number;
  minLng: number;
  cellLat: number;
  cellLng: number;
  cols: number;
  rows: number;
  cellStart: Uint32Array;
  cellNodes: Uint32Array;
}

export interface RoadGraphParts extends RoadGraphMeta {
  lat: Int32Array;
  lng: Int32Array;
  offsets: Uint32Array;
  targets: Uint32Array;
  timeDs: Uint16Array;
  lenM: Uint16Array;
}

export function encodeRoadGraph(p: RoadGraphParts): Uint8Array {
  const n = p.nodeCount;
  const e = p.edgeCount;
  const size = HEADER_BYTES + n * 4 * 2 + (n + 1) * 4 + e * 4 + e * 2 * 2;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, ROAD_GRAPH_FORMAT, true);
  view.setUint32(8, n, true);
  view.setUint32(12, e, true);
  view.setUint32(16, p.builtAt, true);
  view.setUint32(20, p.osmTimestamp, true);
  let off = HEADER_BYTES;
  const put = (arr: Int32Array | Uint32Array | Uint16Array): void => {
    out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), off);
    off += arr.byteLength;
  };
  put(p.lat);
  put(p.lng);
  put(p.offsets);
  put(p.targets);
  put(p.timeDs);
  put(p.lenM);
  return out;
}

export function decodeRoadGraph(bytes: Uint8Array): RoadGraph {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < HEADER_BYTES || view.getUint32(0, true) !== MAGIC) {
    throw new Error('Strassengraph: ungültige Datei (Kennung fehlt).');
  }
  const format = view.getUint32(4, true);
  if (format !== ROAD_GRAPH_FORMAT) {
    throw new Error(`Strassengraph: Format ${format} wird nicht unterstützt (erwartet ${ROAD_GRAPH_FORMAT}).`);
  }
  const n = view.getUint32(8, true);
  const e = view.getUint32(12, true);
  let off = bytes.byteOffset + HEADER_BYTES;
  // Kopie in eigene, ausgerichtete Puffer (die Quelle kann an beliebigem Offset liegen).
  const take = <T>(ctor: { new (buf: ArrayBuffer): T }, byteLength: number): T => {
    const buf = bytes.buffer.slice(off, off + byteLength) as ArrayBuffer;
    off += byteLength;
    return new ctor(buf);
  };
  const lat = take(Int32Array, n * 4);
  const lng = take(Int32Array, n * 4);
  const offsets = take(Uint32Array, (n + 1) * 4);
  const targets = take(Uint32Array, e * 4);
  const timeDs = take(Uint16Array, e * 2);
  const lenM = take(Uint16Array, e * 2);
  if (offsets[n] !== e) throw new Error('Strassengraph: Datei beschädigt (Kantenzahl stimmt nicht).');

  return {
    builtAt: view.getUint32(16, true),
    osmTimestamp: view.getUint32(20, true),
    nodeCount: n,
    edgeCount: e,
    lat,
    lng,
    offsets,
    targets,
    timeDs,
    lenM,
    grid: buildGrid(lat, lng),
  };
}

function buildGrid(lat: Int32Array, lng: Int32Array): SnapGrid {
  const n = lat.length;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (let i = 0; i < n; i++) {
    if (lat[i] < minLat) minLat = lat[i];
    if (lat[i] > maxLat) maxLat = lat[i];
    if (lng[i] < minLng) minLng = lng[i];
    if (lng[i] > maxLng) maxLng = lng[i];
  }
  if (n === 0) {
    minLat = maxLat = minLng = maxLng = 0;
  }
  // ~550 m × ~570 m auf Schweizer Breite.
  const cellLat = 0.005 * COORD_SCALE;
  const cellLng = 0.0075 * COORD_SCALE;
  const cols = Math.floor((maxLng - minLng) / cellLng) + 1;
  const rows = Math.floor((maxLat - minLat) / cellLat) + 1;
  const cellOf = (i: number): number =>
    Math.floor((lat[i] - minLat) / cellLat) * cols + Math.floor((lng[i] - minLng) / cellLng);

  const cellStart = new Uint32Array(cols * rows + 1);
  for (let i = 0; i < n; i++) cellStart[cellOf(i) + 1]++;
  for (let c = 0; c < cols * rows; c++) cellStart[c + 1] += cellStart[c];
  const fill = cellStart.slice(0, cols * rows);
  const cellNodes = new Uint32Array(n);
  for (let i = 0; i < n; i++) cellNodes[fill[cellOf(i)]++] = i;

  return { minLat, minLng, cellLat, cellLng, cols, rows, cellStart, cellNodes };
}

export interface SnapResult {
  node: number;
  distM: number;
}

const M_PER_DEG_LAT = 111_320;

/** Nächster Graphknoten innerhalb `maxM` Metern, sonst null. */
export function snapToRoad(g: RoadGraph, lat: number, lng: number, maxM: number): SnapResult | null {
  const { grid } = g;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const latI = lat * COORD_SCALE;
  const lngI = lng * COORD_SCALE;
  const row0 = Math.floor((latI - grid.minLat) / grid.cellLat);
  const col0 = Math.floor((lngI - grid.minLng) / grid.cellLng);
  const cellM = Math.min(
    (grid.cellLat / COORD_SCALE) * M_PER_DEG_LAT,
    (grid.cellLng / COORD_SCALE) * M_PER_DEG_LAT * cosLat,
  );
  const maxRing = Math.ceil(maxM / cellM) + 1;

  let best = -1;
  let bestD2 = maxM * maxM;
  for (let ring = 0; ring <= maxRing; ring++) {
    // Sobald ein Treffer näher liegt als der innere Rand des nächsten Rings, ist er der nächste.
    if (best !== -1 && bestD2 <= ((ring - 1) * cellM) ** 2) break;
    for (let r = row0 - ring; r <= row0 + ring; r++) {
      if (r < 0 || r >= grid.rows) continue;
      const onEdgeRow = r === row0 - ring || r === row0 + ring;
      for (let c = col0 - ring; c <= col0 + ring; c += onEdgeRow ? 1 : 2 * ring || 1) {
        if (c < 0 || c >= grid.cols) continue;
        const cell = r * grid.cols + c;
        for (let k = grid.cellStart[cell]; k < grid.cellStart[cell + 1]; k++) {
          const node = grid.cellNodes[k];
          const dy = ((g.lat[node] - latI) / COORD_SCALE) * M_PER_DEG_LAT;
          const dx = ((g.lng[node] - lngI) / COORD_SCALE) * M_PER_DEG_LAT * cosLat;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = node;
          }
        }
      }
    }
  }
  return best === -1 ? null : { node: best, distM: Math.sqrt(bestD2) };
}

export interface DriveField {
  /** Fahrzeit in Sekunden je Knoten; Infinity = innerhalb der Grenze nicht erreicht. */
  timeS: Float32Array;
  /** Strassendistanz in Metern entlang des schnellsten Wegs. */
  distM: Float32Array;
  settled: number;
}

/**
 * Fahrzeiten ab `origin` zu allen Knoten, die innerhalb von `maxSeconds`
 * erreichbar sind (Dijkstra mit Abbruchgrenze).
 */
export function driveTimesFrom(g: RoadGraph, origin: number, maxSeconds: number): DriveField {
  const n = g.nodeCount;
  const timeS = new Float32Array(n).fill(Infinity);
  const distM = new Float32Array(n);
  const heap = new MinHeap(1 << 16);
  const { offsets, targets, timeDs, lenM } = g;
  let settled = 0;

  timeS[origin] = 0;
  heap.push(0, origin);
  while (heap.size > 0) {
    const u = heap.pop();
    const tu = heap.lastKey;
    if (tu > timeS[u]) continue; // veralteter Eintrag
    if (tu > maxSeconds) break;
    settled++;
    const du = distM[u];
    for (let k = offsets[u]; k < offsets[u + 1]; k++) {
      const v = targets[k];
      // fround: Schlüssel im Heap und Wert im Float32-Feld müssen bitgleich sein.
      const tv = Math.fround(tu + timeDs[k] * TIME_UNIT_S);
      if (tv < timeS[v]) {
        timeS[v] = tv;
        distM[v] = du + lenM[k];
        heap.push(tv, v);
      }
    }
  }
  return { timeS, distM, settled };
}

export function nodeLatLng(g: RoadGraph, node: number): { lat: number; lng: number } {
  return { lat: g.lat[node] / COORD_SCALE, lng: g.lng[node] / COORD_SCALE };
}
