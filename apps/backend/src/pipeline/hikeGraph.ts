import { wgs84ToLv95 } from '../geo/lv95';
import { MinHeap } from '../lib/heap';
import { logger } from '../lib/logger';
import type { TerrainModel } from './dem';
import type { Network } from './network';
import type { OfficialTrailGrid } from './officialTrails';
import { TRAIL_NONE } from './trailCategories';
import { hikingMinutes, SAC_COST } from './profiles/hike';

/**
 * Wandergraph: OSM-Wegnetz (vollständig, mit sac_scale) als Topologie, ergänzt
 * um die amtliche Wanderweg-Kategorie und vermessene Höhen aus swissTLM3D.
 * Nur dieses Netz wird für Routen verwendet – es entsteht keine Linie, die
 * nicht als Weg in den Quelldaten existiert.
 */

const SCALE = 1e7;
const M_PER_DEG = 111_320;

export interface NodeAttributes {
  /** Höhe in m je Netz-Knoten (NaN = unbekannt). */
  elev: Float32Array;
  /** Amtliche Kategorie am Knoten (0 = kein amtlicher Wanderweg). */
  official: Uint8Array;
}

/** Höhe und amtliche Kategorie für alle Knoten, die zu begehbaren Wegen gehören. */
export function computeNodeAttributes(
  net: Network,
  hikeMask: Uint8Array,
  trails: OfficialTrailGrid,
  dem: TerrainModel,
): NodeAttributes & { stats: Record<string, number> } {
  const n = net.nodeLat.length;
  const elev = new Float32Array(n).fill(NaN);
  const official = new Uint8Array(n);
  let fromTrails = 0;
  let fromDem = 0;
  let unknown = 0;
  for (let i = 0; i < n; i++) {
    if (!hikeMask[i]) continue;
    const lat = net.nodeLat[i] / SCALE;
    const lng = net.nodeLng[i] / SCALE;
    const p = wgs84ToLv95(lat, lng);
    const hit = trails.lookup(p.e, p.n);
    if (hit) {
      official[i] = hit.cls;
      elev[i] = hit.z;
      fromTrails++;
      continue;
    }
    const z = dem.elevation(lat, lng);
    if (z === null) unknown++;
    else {
      elev[i] = z;
      fromDem++;
    }
  }
  return { elev, official, stats: { elevFromOfficialTrails: fromTrails, elevFromTerrainModel: fromDem, elevUnknown: unknown } };
}

export interface HikeGraph {
  nodeCount: number;
  /** Graphknoten → Netz-Knoten. */
  netNode: Int32Array;
  /** Netz-Knoten → Graphknoten (−1 = keiner). */
  graphNodeOf: Int32Array;
  offsets: Uint32Array;
  targets: Uint32Array;
  /** Halbkante → Kante. */
  halfEdge: Uint32Array;
  /** 1 = Halbkante läuft in Wegrichtung (from → to). */
  halfForward: Uint8Array;
  edgeCount: number;
  eWay: Uint32Array;
  eFrom: Uint32Array;
  eTo: Uint32Array;
  eLen: Float32Array;
  eAsc: Float32Array;
  eDesc: Float32Array;
  eFactor: Float32Array;
  eSacMin: Uint8Array;
  eSacMax: Uint8Array;
  eOfficialLen: Float32Array;
  stats: Record<string, number>;
}

/** Zeitfaktor für Pfade ohne sac_scale, deren Schwierigkeit aus der amtlichen Kategorie folgt. */
const OFFICIAL_COST = [SAC_COST[0], 1, 1.05, 1.9];
const OFFICIAL_SAC: [number, number][] = [
  [0, 0],
  [1, 1],
  [2, 3],
  [4, 6],
];

export function buildHikeGraph(net: Network, attrs: NodeAttributes, forced: Uint8Array): HikeGraph {
  const { ways, refNode, nodeLat, nodeLng, nodeUse, footBarrier } = net;
  const netCount = nodeLat.length;
  const graphNodeOf = new Int32Array(netCount).fill(-1);
  const netNode: number[] = [];
  const nodeFor = (idx: number): number => {
    if (footBarrier[idx] === 1) {
      netNode.push(idx); // eigener Knoten je Wegstück: keine Verbindung über die Sperre
      return netNode.length - 1;
    }
    if (graphNodeOf[idx] === -1) {
      graphNodeOf[idx] = netNode.length;
      netNode.push(idx);
    }
    return graphNodeOf[idx];
  };

  const a: number[] = [];
  const b: number[] = [];
  const eWay: number[] = [];
  const eFrom: number[] = [];
  const eTo: number[] = [];
  const eLen: number[] = [];
  const eAsc: number[] = [];
  const eDesc: number[] = [];
  const eFactor: number[] = [];
  const eSacMin: number[] = [];
  const eSacMax: number[] = [];
  const eOfficialLen: number[] = [];
  let totalKm = 0;
  let officialKm = 0;
  let unknownSacKm = 0;

  const segLen = (i: number, j: number): number => {
    const p = refNode[i];
    const q = refNode[j];
    const latMid = ((nodeLat[p] + nodeLat[q]) / 2 / SCALE) * (Math.PI / 180);
    const dy = ((nodeLat[q] - nodeLat[p]) / SCALE) * M_PER_DEG;
    const dx = ((nodeLng[q] - nodeLng[p]) / SCALE) * M_PER_DEG * Math.cos(latMid);
    return Math.sqrt(dx * dx + dy * dy);
  };

  const addPiece = (w: number, from: number, to: number): void => {
    const hike = ways[w].hike!;
    let len = 0;
    let offLen = 0;
    let asc = 0;
    let desc = 0;
    let offVotes = 0;
    let maxCls = TRAIL_NONE;
    // Auf-/Abstieg mit 3 m Hysterese, damit Rauschen des Höhenmodells nicht aufsummiert wird.
    let ref = attrs.elev[refNode[from]];
    for (let i = from; i < to; i++) {
      const l = segLen(i, i + 1);
      len += l;
      const c1 = attrs.official[refNode[i]];
      const c2 = attrs.official[refNode[i + 1]];
      if (c1 !== TRAIL_NONE && c2 !== TRAIL_NONE) {
        offLen += l;
        maxCls = Math.max(maxCls, c1, c2);
      }
      const z = attrs.elev[refNode[i + 1]];
      if (Number.isNaN(ref)) ref = z;
      else if (!Number.isNaN(z)) {
        if (z - ref > 3) {
          asc += z - ref;
          ref = z;
        } else if (ref - z > 3) {
          desc += ref - z;
          ref = z;
        }
      }
    }
    for (let i = from; i <= to; i++) if (attrs.official[refNode[i]] !== TRAIL_NONE) offVotes++;
    if (len < 0.5) return;
    const onOfficial = offLen >= len * 0.6 || offVotes >= (to - from + 1) * 0.7;

    let sacMin = hike.sac;
    let sacMax = hike.sac;
    let factor = hike.costFactor;
    if (hike.sac === 0) {
      const cls = onOfficial ? maxCls : TRAIL_NONE;
      [sacMin, sacMax] = OFFICIAL_SAC[cls];
      factor = (hike.costFactor / SAC_COST[0]) * OFFICIAL_COST[cls];
    }

    a.push(nodeFor(refNode[from]));
    b.push(nodeFor(refNode[to]));
    eWay.push(w);
    eFrom.push(from);
    eTo.push(to);
    eLen.push(len);
    eAsc.push(asc);
    eDesc.push(desc);
    eFactor.push(factor);
    eSacMin.push(sacMin);
    eSacMax.push(sacMax);
    eOfficialLen.push(onOfficial ? len : 0);
    totalKm += len / 1000;
    if (onOfficial) officialKm += len / 1000;
    if (sacMax === 0) unknownSacKm += len / 1000;
  };

  for (let w = 0; w < ways.length; w++) {
    const way = ways[w];
    if (!way.hike) continue;
    let from = way.start;
    for (let i = way.start + 1; i < way.end; i++) {
      const idx = refNode[i];
      if (i === way.end - 1 || nodeUse[idx] >= 2 || forced[idx] === 1 || footBarrier[idx] === 1) {
        addPiece(w, from, i);
        from = i;
      }
    }
  }

  const n = netNode.length;
  const e = a.length;
  const offsets = new Uint32Array(n + 1);
  for (let k = 0; k < e; k++) {
    offsets[a[k] + 1]++;
    offsets[b[k] + 1]++;
  }
  for (let i = 0; i < n; i++) offsets[i + 1] += offsets[i];
  const fill = offsets.slice(0, n);
  const targets = new Uint32Array(e * 2);
  const halfEdge = new Uint32Array(e * 2);
  const halfForward = new Uint8Array(e * 2);
  for (let k = 0; k < e; k++) {
    let pos = fill[a[k]]++;
    targets[pos] = b[k];
    halfEdge[pos] = k;
    halfForward[pos] = 1;
    pos = fill[b[k]]++;
    targets[pos] = a[k];
    halfEdge[pos] = k;
    halfForward[pos] = 0;
  }

  const stats = {
    hikeNodes: n,
    hikeEdges: e,
    hikeNetworkKm: Math.round(totalKm),
    onOfficialTrailsKm: Math.round(officialKm),
    unknownDifficultyKm: Math.round(unknownSacKm),
  };
  logger.info(stats, 'Wandergraph gebaut');

  return {
    nodeCount: n,
    netNode: Int32Array.from(netNode),
    graphNodeOf,
    offsets,
    targets,
    halfEdge,
    halfForward,
    edgeCount: e,
    eWay: Uint32Array.from(eWay),
    eFrom: Uint32Array.from(eFrom),
    eTo: Uint32Array.from(eTo),
    eLen: Float32Array.from(eLen),
    eAsc: Float32Array.from(eAsc),
    eDesc: Float32Array.from(eDesc),
    eFactor: Float32Array.from(eFactor),
    eSacMin: Uint8Array.from(eSacMin),
    eSacMax: Uint8Array.from(eSacMax),
    eOfficialLen: Float32Array.from(eOfficialLen),
    stats,
  };
}

// ── Routensuche ───────────────────────────────────────────────────────────────

export interface RouteMetrics {
  distanceM: number;
  ascentM: number;
  descentM: number;
  durationUpMin: number;
  durationDownMin: number;
  minElevM: number | null;
  maxElevM: number | null;
  /** 0 = unbekannt. */
  sacMin: number;
  sacMax: number;
  sacKnownShare: number;
  officialShare: number;
  /** Stützpunkte Ausgangspunkt → Ziel als [lng, lat]. */
  line: [number, number][];
  /** Höhe je Stützpunkt in m (gleiche Länge wie `line`); null = unbekannt. */
  lineElev: (number | null)[];
}

export interface FoundStart {
  kind: 'parking' | 'road_access';
  /** Graphknoten des Ausgangspunkts. */
  node: number;
  /** Index des Parkplatzes (nur bei kind = parking). */
  parking: number;
  /** Routenkosten in Minuten (inkl. Komfortfaktoren). */
  cost: number;
}

export interface RouterOptions {
  /** Obergrenze der Suche in Kostenminuten (Gehzeit × Faktor), eine Richtung. */
  maxCostMin: number;
  maxVariants: number;
  /** Mindestabstand zwischen zwei Ausgangspunkten derselben Zielroute. */
  minSeparationM: number;
}

export const DEFAULT_ROUTER_OPTIONS: RouterOptions = { maxCostMin: 540, maxVariants: 3, minSeparationM: 1200 };

export class HikeRouter {
  private readonly cost: Float32Array;
  private readonly pred: Int32Array;
  private readonly predNode: Int32Array;
  private readonly touched: Int32Array;
  private touchedCount = 0;
  private readonly heap = new MinHeap(1 << 14);

  constructor(
    private readonly g: HikeGraph,
    private readonly net: Network,
    private readonly attrs: NodeAttributes,
    /** Graphknoten → Parkplatz-Index (−1 = kein Parkplatz). */
    private readonly parkingAt: Int32Array,
    /** Graphknoten liegt an einer öffentlichen, mit dem Auto erreichbaren Strasse. */
    private readonly roadAccess: Uint8Array,
    private readonly parkingLat: Float64Array,
    private readonly parkingLng: Float64Array,
  ) {
    this.cost = new Float32Array(g.nodeCount).fill(Infinity);
    this.pred = new Int32Array(g.nodeCount).fill(-1);
    this.predNode = new Int32Array(g.nodeCount).fill(-1);
    this.touched = new Int32Array(g.nodeCount);
  }

  private reset(): void {
    for (let i = 0; i < this.touchedCount; i++) {
      const node = this.touched[i];
      this.cost[node] = Infinity;
      this.pred[node] = -1;
    }
    this.touchedCount = 0;
    this.heap.clear();
  }

  /**
   * Sucht vom Ziel rückwärts die günstigsten Ausgangspunkte. Die Kosten einer
   * Kante entsprechen der Gehzeit in Richtung Ziel (bergauf zählt bergauf).
   */
  findStarts(dest: number, opts: RouterOptions = DEFAULT_ROUTER_OPTIONS): FoundStart[] {
    this.reset();
    const { g, cost, pred, heap } = this;
    const parkings: FoundStart[] = [];
    let road: FoundStart | null = null;
    let horizon = opts.maxCostMin;

    cost[dest] = 0;
    this.touched[this.touchedCount++] = dest;
    heap.push(0, dest);
    while (heap.size > 0) {
      const u = heap.pop();
      const cu = heap.lastKey;
      if (cu > cost[u]) continue;
      if (cu > horizon) break;

      const p = this.parkingAt[u];
      if (p >= 0) {
        parkings.push({ kind: 'parking', node: u, parking: p, cost: cu });
        if (parkings.length === 1) horizon = Math.min(horizon, cu * 1.6 + 30);
      } else if (road === null && this.roadAccess[u] === 1) {
        road = { kind: 'road_access', node: u, parking: -1, cost: cu };
        // Kommt innert 45 Gehminuten ab Strasse kein Parkplatz, gilt der Strassenzugang.
        if (parkings.length === 0) horizon = Math.min(horizon, cu + 45);
      }

      for (let k = g.offsets[u]; k < g.offsets[u + 1]; k++) {
        const v = g.targets[k];
        const e = g.halfEdge[k];
        // Der Wanderer geht v → u. Läuft die Halbkante u → v in Wegrichtung, geht er gegen die Wegrichtung.
        const againstWay = g.halfForward[k] === 1;
        const asc = againstWay ? g.eDesc[e] : g.eAsc[e];
        const desc = againstWay ? g.eAsc[e] : g.eDesc[e];
        const cv = Math.fround(cu + hikingMinutes(g.eLen[e], asc, desc) * g.eFactor[e]);
        if (cv < cost[v]) {
          if (cost[v] === Infinity) this.touched[this.touchedCount++] = v;
          cost[v] = cv;
          pred[v] = k;
          this.predNode[v] = u;
          heap.push(cv, v);
        }
      }
    }

    const picked: FoundStart[] = [];
    for (const cand of parkings) {
      if (picked.length >= opts.maxVariants) break;
      const far = picked.every((o) => {
        const dy = (this.parkingLat[o.parking] - this.parkingLat[cand.parking]) * M_PER_DEG;
        const dx = (this.parkingLng[o.parking] - this.parkingLng[cand.parking]) * M_PER_DEG * 0.69;
        return dx * dx + dy * dy >= opts.minSeparationM ** 2;
      });
      if (far) picked.push(cand);
    }
    // Strassenzugang nur, wenn kein Parkplatz gefunden wurde oder der nächste deutlich weiter weg liegt.
    if (road && (picked.length === 0 || picked[0].cost - road.cost > 45)) picked.push(road);
    return picked;
  }

  /** Baut die Route Ausgangspunkt → Ziel aus dem letzten `findStarts`-Lauf. */
  buildRoute(start: number, destElevation: number | null): RouteMetrics | null {
    const { g, net, attrs, pred } = this;
    const lats: number[] = [];
    const lngs: number[] = [];
    const elevs: number[] = [];
    const surveyed: boolean[] = [];
    let distance = 0;
    let knownLen = 0;
    let unknownLen = 0;
    let officialLen = 0;
    let sacMin = 0;
    let sacMax = 0;
    let unknownPresent = false;

    const push = (netIdx: number): void => {
      lats.push(net.nodeLat[netIdx] / SCALE);
      lngs.push(net.nodeLng[netIdx] / SCALE);
      elevs.push(attrs.elev[netIdx]);
      surveyed.push(attrs.official[netIdx] !== 0);
    };

    let node = start;
    let guard = 0;
    while (pred[node] !== -1) {
      if (++guard > 200_000) return null;
      const k = pred[node];
      const e = g.halfEdge[k];
      // pred[node] ist die Halbkante u → node; der Wanderer geht node → u.
      const walkWithWay = g.halfForward[k] === 0;
      const from = g.eFrom[e];
      const to = g.eTo[e];
      if (walkWithWay) for (let i = from; i <= to; i++) { if (i > from || lats.length === 0) push(net.refNode[i]); }
      else for (let i = to; i >= from; i--) { if (i < to || lats.length === 0) push(net.refNode[i]); }
      distance += g.eLen[e];
      officialLen += g.eOfficialLen[e];
      if (g.eSacMax[e] > 0) {
        knownLen += g.eLen[e];
        sacMin = Math.max(sacMin, g.eSacMin[e]);
        sacMax = Math.max(sacMax, g.eSacMax[e]);
      } else {
        unknownPresent = true;
        unknownLen += g.eLen[e];
      }
      node = this.predNode[node];
    }
    if (lats.length < 2) return null;

    // Höhen aus dem Geländemodell (26 m Raster) rauschen in steilem Gelände; über
    // ±50 m Wegstrecke mitteln. Vermessene Höhen amtlicher Wege bleiben unverändert.
    const cum = new Float64Array(lats.length);
    for (let i = 1; i < lats.length; i++) {
      const dy = (lats[i] - lats[i - 1]) * M_PER_DEG;
      const dx = (lngs[i] - lngs[i - 1]) * M_PER_DEG * Math.cos((lats[i] * Math.PI) / 180);
      cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy);
    }
    const raw = elevs.slice();
    for (let i = 0; i < raw.length; i++) {
      if (surveyed[i] || Number.isNaN(raw[i])) continue;
      let sum = 0;
      let count = 0;
      for (let j = i; j >= 0 && cum[i] - cum[j] <= 50; j--) if (!Number.isNaN(raw[j])) { sum += raw[j]; count++; }
      for (let j = i + 1; j < raw.length && cum[j] - cum[i] <= 50; j++) if (!Number.isNaN(raw[j])) { sum += raw[j]; count++; }
      if (count > 0) elevs[i] = sum / count;
    }

    // Amtliche Gipfelhöhe am Routenende übernehmen: das Höhenmodell glättet Gipfel.
    const last = elevs.length - 1;
    if (destElevation !== null && (Number.isNaN(elevs[last]) || Math.abs(destElevation - elevs[last]) <= 200)) {
      elevs[last] = destElevation;
    }

    let asc = 0;
    let desc = 0;
    let minE = Infinity;
    let maxE = -Infinity;
    let ref = NaN;
    for (const z of elevs) {
      if (Number.isNaN(z)) continue;
      if (z < minE) minE = z;
      if (z > maxE) maxE = z;
      if (Number.isNaN(ref)) ref = z;
      else if (z - ref >= 6) {
        asc += z - ref;
        ref = z;
      } else if (ref - z >= 6) {
        desc += ref - z;
        ref = z;
      }
    }
    // Rest bis zum Endpunkt verbuchen, damit Aufstieg − Abstieg der Höhendifferenz entspricht.
    const endZ = elevs[last];
    if (!Number.isNaN(endZ) && !Number.isNaN(ref)) {
      if (endZ > ref) asc += endZ - ref;
      else desc += ref - endZ;
    }

    const knownShare = distance > 0 ? knownLen / distance : 0;
    // Ein unbekanntes Teilstück macht die Gesamtschwierigkeit unbekannt (kurze Lücken bis 3 % toleriert).
    const sacKnown = !unknownPresent || knownShare >= 0.97 || unknownLen <= 100;
    // 10 m Lage- und 5 m Höhentoleranz: das gespeicherte Profil behält Kuppen und Senken.
    const kept = simplifyIndices(lngs, lats, 10, elevs, 5);

    return {
      distanceM: Math.round(distance),
      ascentM: Math.round(asc),
      descentM: Math.round(desc),
      durationUpMin: Math.round(hikingMinutes(distance, asc, desc)),
      durationDownMin: Math.round(hikingMinutes(distance, desc, asc)),
      minElevM: Number.isFinite(minE) ? Math.round(minE) : null,
      maxElevM: Number.isFinite(maxE) ? Math.round(maxE) : null,
      sacMin,
      sacMax: sacKnown ? sacMax : 0,
      sacKnownShare: Math.round(knownShare * 1000) / 1000,
      officialShare: distance > 0 ? Math.round((officialLen / distance) * 1000) / 1000 : 0,
      line: kept.map((i): [number, number] => [round6(lngs[i]), round6(lats[i])]),
      lineElev: kept.map((i) => (Number.isNaN(elevs[i]) ? null : Math.round(elevs[i]))),
    };
  }
}

/**
 * Douglas-Peucker in lokaler Meter-Näherung; liefert die Indizes der behaltenen
 * Punkte. Mit `elevs` bleibt zusätzlich jeder Punkt erhalten, dessen Höhe um mehr
 * als `elevToleranceM` von der Geraden (nach Wegstrecke interpoliert) abweicht –
 * sonst gingen Kuppen und Senken im Höhenprofil verloren. NaN-Höhen zählen nicht.
 */
export function simplifyIndices(
  lngs: number[],
  lats: number[],
  toleranceM: number,
  elevs?: ArrayLike<number>,
  elevToleranceM = 5,
): number[] {
  const n = lngs.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const kx = M_PER_DEG * Math.cos((lats[0] * Math.PI) / 180);
  let cum: Float64Array | null = null;
  if (elevs) {
    cum = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const ddx = (lngs[i] - lngs[i - 1]) * kx;
      const ddy = (lats[i] - lats[i - 1]) * M_PER_DEG;
      cum[i] = cum[i - 1] + Math.sqrt(ddx * ddx + ddy * ddy);
    }
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tol2 = toleranceM * toleranceM;
  const ztol2 = elevToleranceM * elevToleranceM;
  while (stack.length > 0) {
    const [i0, i1] = stack.pop()!;
    const x0 = lngs[i0] * kx;
    const y0 = lats[i0] * M_PER_DEG;
    const dx = lngs[i1] * kx - x0;
    const dy = lats[i1] * M_PER_DEG - y0;
    const len2 = dx * dx + dy * dy;
    const z0 = elevs ? elevs[i0] : NaN;
    const z1 = elevs ? elevs[i1] : NaN;
    const span = cum ? cum[i1] - cum[i0] : 0;
    let worst = -1;
    // Abweichung relativ zur Toleranz (quadriert); > 1 = Punkt muss bleiben.
    let worstScore = 1;
    for (let i = i0 + 1; i < i1; i++) {
      const px = lngs[i] * kx - x0;
      const py = lats[i] * M_PER_DEG - y0;
      let d2: number;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        d2 = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      }
      let score = d2 / tol2;
      if (cum && elevs && !Number.isNaN(z0) && !Number.isNaN(z1) && !Number.isNaN(elevs[i])) {
        const t = span > 0 ? (cum[i] - cum[i0]) / span : 0;
        const dz = elevs[i] - (z0 + t * (z1 - z0));
        score = Math.max(score, (dz * dz) / ztol2);
      }
      if (score > worstScore) {
        worstScore = score;
        worst = i;
      }
    }
    if (worst !== -1) {
      keep[worst] = 1;
      stack.push([i0, worst], [worst, i1]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/** Douglas-Peucker ohne Höhen; liefert [lng, lat] mit 6 Nachkommastellen. */
export function simplifyLine(lngs: number[], lats: number[], toleranceM: number): [number, number][] {
  return simplifyIndices(lngs, lats, toleranceM).map((i): [number, number] => [round6(lngs[i]), round6(lats[i])]);
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;
