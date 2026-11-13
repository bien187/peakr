import { logger } from '../../lib/logger';
import { type RoadGraphParts } from '../../routing/roadGraph';
import type { Network } from '../network';

/**
 * Baut aus dem OSM-Netz den Strassengraphen für die Autofahrzeit.
 *
 * 1. Befahrbare Wege werden an Kreuzungen in Stücke zerlegt.
 * 2. Nur die grösste stark zusammenhängende Komponente bleibt übrig – ein
 *    Parkplatz an einer abgeschnittenen oder gesperrten Strasse gilt damit nicht
 *    als mit dem Auto erreichbar.
 * 3. Lange Stücke werden unterteilt, damit Start- und Zielpunkte höchstens
 *    ~150 m neben dem nächsten Knoten liegen.
 */

const M_PER_DEG = 111_320;
const SCALE = 1e7;
/** Querbeschleunigung, mit der Kurven im Mittel gefahren werden (m/s²). */
const LATERAL_ACCEL = 2.4;
const MIN_CURVE_KMH = 14;
const SUBDIVIDE_M = 300;
/** Bezugspunkt für die Hauptkomponente: Bern-Wankdorf (Autobahnkreuz). */
const SEED = { lat: 46.9655, lng: 7.4655 };

export interface RoadBuildResult {
  graph: RoadGraphParts;
  /** Netz-Knotennummer → Graphknoten (−1 = kein Graphknoten). */
  graphNodeOf: Int32Array;
  /** 1 = Knoten liegt auf einer mit dem Auto erreichbaren Strasse. */
  carReachable: Uint8Array;
  /** 1 = zusätzlich öffentliche Strasse, an der ein Ausgangspunkt liegen darf. */
  carPublic: Uint8Array;
  stats: Record<string, number>;
}

interface Piece {
  way: number;
  /** Bereich in refNode (inklusive Endpunkte). */
  from: number;
  to: number;
  a: number;
  b: number;
}

export function buildRoadGraph(
  net: Network,
  forced: Uint8Array | null,
  meta: { builtAt: number; osmTimestamp: number },
): RoadBuildResult {
  const { ways, refNode, nodeLat, nodeLng, nodeUse, carBarrier, carDelayS } = net;
  const nodeCountNet = nodeLat.length;

  // Barrieren trennen: beide Seiten enden dort, ohne verbunden zu sein. Dafür
  // bekommt jedes Wegstück an einer Barriere einen eigenen, virtuellen Endknoten.
  let virtualNodes = 0;
  const pieces: Piece[] = [];
  const isSplit = (idx: number): boolean => nodeUse[idx] >= 2 || carBarrier[idx] === 1;

  for (let w = 0; w < ways.length; w++) {
    const way = ways[w];
    if (!way.car) continue;
    let from = way.start;
    for (let i = way.start + 1; i < way.end; i++) {
      const idx = refNode[i];
      if (i === way.end - 1 || isSplit(idx)) {
        pieces.push({ way: w, from, to: i, a: -1, b: -1 });
        from = i;
      }
    }
  }

  // Vorläufige Knotennummern für die Komponentensuche (nur Stück-Endpunkte).
  const tmpOf = new Int32Array(nodeCountNet).fill(-1);
  let tmpCount = 0;
  const endpoint = (ref: number): number => {
    const idx = refNode[ref];
    if (carBarrier[idx] === 1) {
      virtualNodes++;
      return tmpCount++; // eigener Knoten je Stückende
    }
    if (tmpOf[idx] === -1) tmpOf[idx] = tmpCount++;
    return tmpOf[idx];
  };
  for (const p of pieces) {
    p.a = endpoint(p.from);
    p.b = endpoint(p.to);
  }

  // Adjazenz vorwärts/rückwärts für die Komponentensuche.
  const degF = new Uint32Array(tmpCount + 1);
  const degB = new Uint32Array(tmpCount + 1);
  for (const p of pieces) {
    const car = ways[p.way].car!;
    if (car.forward) {
      degF[p.a + 1]++;
      degB[p.b + 1]++;
    }
    if (car.backward) {
      degF[p.b + 1]++;
      degB[p.a + 1]++;
    }
  }
  for (let i = 0; i < tmpCount; i++) {
    degF[i + 1] += degF[i];
    degB[i + 1] += degB[i];
  }
  const adjF = new Uint32Array(degF[tmpCount]);
  const adjB = new Uint32Array(degB[tmpCount]);
  const fillF = degF.slice(0, tmpCount);
  const fillB = degB.slice(0, tmpCount);
  for (const p of pieces) {
    const car = ways[p.way].car!;
    if (car.forward) {
      adjF[fillF[p.a]++] = p.b;
      adjB[fillB[p.b]++] = p.a;
    }
    if (car.backward) {
      adjF[fillF[p.b]++] = p.a;
      adjB[fillB[p.a]++] = p.b;
    }
  }

  // Startknoten: nächster Stück-Endpunkt zum Bezugspunkt.
  let seed = -1;
  let seedD = Infinity;
  for (let idx = 0; idx < nodeCountNet; idx++) {
    if (tmpOf[idx] === -1) continue;
    const dy = nodeLat[idx] / SCALE - SEED.lat;
    const dx = (nodeLng[idx] / SCALE - SEED.lng) * 0.68;
    const d = dx * dx + dy * dy;
    if (d < seedD) {
      seedD = d;
      seed = tmpOf[idx];
    }
  }
  if (seed === -1) throw new Error('Strassengraph: keine befahrbaren Wege gefunden.');

  const reach = (offsets: Uint32Array, adj: Uint32Array): Uint8Array => {
    const seen = new Uint8Array(tmpCount);
    const stack = new Int32Array(tmpCount);
    let top = 0;
    stack[top++] = seed;
    seen[seed] = 1;
    while (top > 0) {
      const u = stack[--top];
      for (let k = offsets[u]; k < offsets[u + 1]; k++) {
        const v = adj[k];
        if (!seen[v]) {
          seen[v] = 1;
          stack[top++] = v;
        }
      }
    }
    return seen;
  };
  const fromSeed = reach(degF, adjF);
  const toSeed = reach(degB, adjB);
  const inMain = (t: number): boolean => fromSeed[t] === 1 && toSeed[t] === 1;

  // Erreichbare Netz-Knoten markieren (alle Stützpunkte erreichbarer Stücke).
  const carReachable = new Uint8Array(nodeCountNet);
  const carPublic = new Uint8Array(nodeCountNet);
  const kept: Piece[] = [];
  for (const p of pieces) {
    if (!inMain(p.a) || !inMain(p.b)) continue;
    kept.push(p);
    const car = ways[p.way].car!;
    for (let i = p.from; i <= p.to; i++) {
      const idx = refNode[i];
      if (carBarrier[idx] === 1) continue;
      carReachable[idx] = 1;
      if (car.publicRoad) carPublic[idx] = 1;
    }
  }

  // Endgültige Knoten: Stück-Endpunkte, erzwungene Punkte, Unterteilung langer Stücke.
  const graphNodeOf = new Int32Array(nodeCountNet).fill(-1);
  const lat: number[] = [];
  const lng: number[] = [];
  const nodeFor = (idx: number): number => {
    if (graphNodeOf[idx] === -1) {
      graphNodeOf[idx] = lat.length;
      lat.push(nodeLat[idx]);
      lng.push(nodeLng[idx]);
    }
    return graphNodeOf[idx];
  };
  const virtualNode = (idx: number): number => {
    lat.push(nodeLat[idx]);
    lng.push(nodeLng[idx]);
    return lat.length - 1;
  };

  const eFrom: number[] = [];
  const eTo: number[] = [];
  const eTime: number[] = [];
  const eLen: number[] = [];
  let clampedTime = 0;
  let totalKm = 0;

  const segLen = (i: number, j: number): number => {
    const a = refNode[i];
    const b = refNode[j];
    const latMid = ((nodeLat[a] + nodeLat[b]) / 2 / SCALE) * (Math.PI / 180);
    const dy = ((nodeLat[b] - nodeLat[a]) / SCALE) * M_PER_DEG;
    const dx = ((nodeLng[b] - nodeLng[a]) / SCALE) * M_PER_DEG * Math.cos(latMid);
    return Math.sqrt(dx * dx + dy * dy);
  };

  /** Kurvengeschwindigkeit am Stützpunkt i aus dem Umkreisradius der drei Nachbarpunkte. */
  const curveCap = (way: { start: number; end: number }, i: number): number => {
    if (i <= way.start || i >= way.end - 1) return Infinity;
    const a = segLen(i - 1, i);
    const b = segLen(i, i + 1);
    const c = segLen(i - 1, i + 1);
    if (a < 1 || b < 1) return Infinity;
    const s = (a + b + c) / 2;
    const area2 = s * (s - a) * (s - b) * (s - c);
    if (area2 <= 0) return Infinity;
    const radius = (a * b * c) / (4 * Math.sqrt(area2));
    // Sehr flache Knicke bei kurzen Abständen sind Kartierrauschen, keine Kurve.
    const sagitta = (c * c) / (8 * radius);
    if (sagitta < 0.6) return Infinity;
    return Math.max(MIN_CURVE_KMH, 3.6 * Math.sqrt(LATERAL_ACCEL * radius));
  };

  const emit = (a: number, b: number, seconds: number, metres: number, fwd: boolean, back: boolean): void => {
    let ds = Math.round(seconds * 10);
    if (ds > 65_535) {
      ds = 65_535;
      clampedTime++;
    }
    if (ds < 1) ds = 1;
    const m = Math.min(65_535, Math.max(1, Math.round(metres)));
    if (fwd) {
      eFrom.push(a);
      eTo.push(b);
      eTime.push(ds);
      eLen.push(m);
    }
    if (back) {
      eFrom.push(b);
      eTo.push(a);
      eTime.push(ds);
      eLen.push(m);
    }
  };

  for (const p of kept) {
    const way = ways[p.way];
    const car = way.car!;
    const pieceLen = (() => {
      let l = 0;
      for (let i = p.from; i < p.to; i++) l += segLen(i, i + 1);
      return l;
    })();
    totalKm += pieceLen / 1000;

    const endNode = (ref: number): number => {
      const idx = refNode[ref];
      return carBarrier[idx] === 1 ? virtualNode(idx) : nodeFor(idx);
    };

    if (car.fixedSeconds !== null) {
      emit(endNode(p.from), endNode(p.to), car.fixedSeconds, pieceLen, car.forward, car.backward);
      continue;
    }

    let prevNode = endNode(p.from);
    let accT = 0;
    let accL = 0;
    let sinceNode = 0;
    for (let i = p.from; i < p.to; i++) {
      const len = segLen(i, i + 1);
      let v = car.speedKmh;
      if (!car.motorway) v = Math.min(v, curveCap(way, i), curveCap(way, i + 1));
      accT += len / (v / 3.6);
      accL += len;
      sinceNode += len;
      const idx = refNode[i + 1];
      accT += carDelayS[idx];
      const isLast = i + 1 === p.to;
      const split = isLast || (forced !== null && forced[idx] === 1) || sinceNode >= SUBDIVIDE_M;
      if (split) {
        const node = isLast ? endNode(p.to) : nodeFor(idx);
        emit(prevNode, node, accT, accL, car.forward, car.backward);
        prevNode = node;
        accT = 0;
        accL = 0;
        sinceNode = 0;
      }
    }
  }

  // CSR aufbauen.
  const n = lat.length;
  const e = eFrom.length;
  const offsets = new Uint32Array(n + 1);
  for (let k = 0; k < e; k++) offsets[eFrom[k] + 1]++;
  for (let i = 0; i < n; i++) offsets[i + 1] += offsets[i];
  const fill = offsets.slice(0, n);
  const targets = new Uint32Array(e);
  const timeDs = new Uint16Array(e);
  const lenM = new Uint16Array(e);
  for (let k = 0; k < e; k++) {
    const pos = fill[eFrom[k]]++;
    targets[pos] = eTo[k];
    timeDs[pos] = eTime[k];
    lenM[pos] = eLen[k];
  }

  const stats = {
    carPieces: pieces.length,
    keptPieces: kept.length,
    droppedPieces: pieces.length - kept.length,
    barrierEnds: virtualNodes,
    nodes: n,
    edges: e,
    roadKm: Math.round(totalKm),
    clampedEdges: clampedTime,
  };
  logger.info(stats, 'Strassengraph gebaut');

  return {
    graph: {
      builtAt: meta.builtAt,
      osmTimestamp: meta.osmTimestamp,
      nodeCount: n,
      edgeCount: e,
      lat: Int32Array.from(lat),
      lng: Int32Array.from(lng),
      offsets,
      targets,
      timeDs,
      lenM,
    },
    graphNodeOf,
    carReachable,
    carPublic,
    stats,
  };
}
