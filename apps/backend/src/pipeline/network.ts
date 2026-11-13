import { logger } from '../lib/logger';
import { isOplWay, readOpl, type OplWay } from './io/opl';
import { carProfile, type CarAttrs } from './profiles/car';
import { hikeProfile, type HikeAttrs } from './profiles/hike';

/**
 * Liest den OSM-Netzauszug (alle highway-, aerialway-, piste- und Fährwege)
 * einmal ein und hält ihn kompakt in typisierten Arrays. Strassen- und
 * Wandergraph werden beide daraus gebaut und teilen sich die Knotennummern,
 * damit «hier trifft der Wanderweg auf die Strasse» exakt bestimmbar ist.
 */

class GrowF64 {
  data = new Float64Array(1 << 20);
  length = 0;
  push(v: number): void {
    if (this.length === this.data.length) {
      const next = new Float64Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
}
class GrowI32 {
  data = new Int32Array(1 << 20);
  length = 0;
  push(v: number): void {
    if (this.length === this.data.length) {
      const next = new Int32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
}

export interface NetworkWay {
  osmId: number;
  /** Bereich [start, end) in `Network.refNode`. */
  start: number;
  end: number;
  car: CarAttrs | null;
  hike: HikeAttrs | null;
}

export interface Network {
  /** Koordinaten je eindeutigem OSM-Knoten (1e-7 Grad). */
  nodeLat: Int32Array;
  nodeLng: Int32Array;
  /** Sortierte OSM-IDs; Index = interne Knotennummer. */
  nodeOsmId: Float64Array;
  /** Wie viele Wege einen Knoten berühren (Endpunkte zählen doppelt) – Kreuzungserkennung. */
  nodeUse: Uint8Array;
  /** Knoten, an denen Autos nicht durchkommen (Poller, Schranke mit Verbot …). */
  carBarrier: Uint8Array;
  /** Zusatzzeit für Autos am Knoten in Sekunden (Ampel, Stopp). */
  carDelayS: Uint8Array;
  /** Knoten, an denen Fussgänger nicht durchkommen. */
  footBarrier: Uint8Array;
  ways: NetworkWay[];
  refNode: Uint32Array;
  /** Seilbahnen und Pisten mit vollen Tags (für die Skigebiets-Gruppierung). */
  skiWays: OplWay[];
}

const SCALE = 1e7;

function lowerBound(arr: Float64Array, n: number, value: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const CAR_BLOCKING_BARRIERS = new Set([
  'bollard', 'block', 'chain', 'jersey_barrier', 'cycle_barrier', 'debris', 'log', 'turnstile',
  'stile', 'kissing_gate', 'full-height_turnstile', 'planter', 'rope', 'sump_buster', 'bus_trap',
  'motorcycle_barrier', 'horse_stile', 'wicket_gate', 'yes',
]);
const DENY = new Set(['no', 'private', 'agricultural', 'forestry', 'delivery', 'customers', 'permit', 'military', 'emergency']);

function nodeBlocksCar(tags: Record<string, string>): boolean {
  const barrier = tags.barrier;
  if (!barrier) return false;
  for (const key of ['motorcar', 'motor_vehicle', 'vehicle', 'access']) {
    const v = tags[key];
    if (v !== undefined) return DENY.has(v);
  }
  if (tags.locked === 'yes') return true;
  return CAR_BLOCKING_BARRIERS.has(barrier);
}

function nodeBlocksFoot(tags: Record<string, string>): boolean {
  if (!tags.barrier) return false;
  const foot = tags.foot ?? tags.access;
  if (foot === undefined) return tags.locked === 'yes' && tags.barrier === 'gate' ? false : false;
  return foot === 'no' || foot === 'private';
}

export async function loadNetwork(oplPath: string, buildDate = new Date()): Promise<Network> {
  const refIds = new GrowF64();
  const refLat = new GrowI32();
  const refLng = new GrowI32();
  const ways: NetworkWay[] = [];
  const skiWays: OplWay[] = [];
  const taggedNodes: { id: number; blocksCar: boolean; blocksFoot: boolean; delay: number }[] = [];

  let lines = 0;
  for await (const obj of readOpl(oplPath)) {
    lines++;
    if (!isOplWay(obj)) {
      const t = obj.tags;
      const blocksCar = nodeBlocksCar(t);
      const blocksFoot = nodeBlocksFoot(t);
      const delay = t.highway === 'traffic_signals' ? 12 : t.highway === 'stop' ? 4 : 0;
      if (blocksCar || blocksFoot || delay) taggedNodes.push({ id: obj.id, blocksCar, blocksFoot, delay });
      continue;
    }
    if (obj.nodeIds.length < 2) continue;
    if (obj.tags.aerialway || obj.tags['piste:type']) skiWays.push(obj);

    const car = carProfile(obj.tags, buildDate);
    const hike = hikeProfile(obj.tags);
    if (!car && !hike) continue;

    const start = refIds.length;
    for (let i = 0; i < obj.nodeIds.length; i++) {
      refIds.push(obj.nodeIds[i]);
      refLat.push(Math.round(obj.lats[i] * SCALE));
      refLng.push(Math.round(obj.lngs[i] * SCALE));
    }
    ways.push({ osmId: obj.id, start, end: refIds.length, car, hike });
    if (ways.length % 500_000 === 0) logger.info({ ways: ways.length }, 'Netz wird gelesen …');
  }

  // Eindeutige Knoten bestimmen: IDs sortieren, Duplikate entfernen.
  const refs = refIds.length;
  const sorted = refIds.data.slice(0, refs).sort();
  let uniq = 0;
  for (let i = 0; i < refs; i++) {
    if (i === 0 || sorted[i] !== sorted[i - 1]) sorted[uniq++] = sorted[i];
  }
  const nodeOsmId = sorted.slice(0, uniq);
  const nodeLat = new Int32Array(uniq);
  const nodeLng = new Int32Array(uniq);
  const nodeUse = new Uint8Array(uniq);
  const refNode = new Uint32Array(refs);
  for (let i = 0; i < refs; i++) {
    const idx = lowerBound(nodeOsmId, uniq, refIds.data[i]);
    refNode[i] = idx;
    nodeLat[idx] = refLat.data[i];
    nodeLng[idx] = refLng.data[i];
  }
  for (const w of ways) {
    for (let i = w.start; i < w.end; i++) {
      const idx = refNode[i];
      const inc = i === w.start || i === w.end - 1 ? 2 : 1;
      nodeUse[idx] = Math.min(250, nodeUse[idx] + inc);
    }
  }

  const carBarrier = new Uint8Array(uniq);
  const footBarrier = new Uint8Array(uniq);
  const carDelayS = new Uint8Array(uniq);
  for (const t of taggedNodes) {
    const idx = lowerBound(nodeOsmId, uniq, t.id);
    if (idx >= uniq || nodeOsmId[idx] !== t.id) continue;
    if (t.blocksCar) carBarrier[idx] = 1;
    if (t.blocksFoot) footBarrier[idx] = 1;
    carDelayS[idx] = t.delay;
  }

  logger.info(
    { lines, ways: ways.length, nodeRefs: refs, nodes: uniq, skiWays: skiWays.length },
    'Netz geladen',
  );
  return { nodeLat, nodeLng, nodeOsmId, nodeUse, carBarrier, carDelayS, footBarrier, ways, refNode, skiWays };
}

export function networkNodeIndex(net: Network, osmId: number): number {
  const idx = lowerBound(net.nodeOsmId, net.nodeOsmId.length, osmId);
  return idx < net.nodeOsmId.length && net.nodeOsmId[idx] === osmId ? idx : -1;
}
