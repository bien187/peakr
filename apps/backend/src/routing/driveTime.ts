import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LatLng } from '@ch-alpineroute/shared';
import { ROAD_GRAPH_PATH } from '../config/env';
import { logger } from '../lib/logger';
import { decodeRoadGraph, driveTimesFrom, snapToRoad, type DriveField, type RoadGraph } from './roadGraph';

/**
 * Fahrzeit-Dienst: lädt den Strassengraphen einmal je Prozess und rechnet pro
 * Startort ein Fahrzeitfeld. Es gibt KEINE Schätzung aus der Luftlinie – fehlt
 * der Graph, meldet der Dienst «unavailable» und die Suche liefert keine Treffer.
 */

export const ROUTING_PROVIDER = 'peakr-osm-graph';
/** Der Startort darf höchstens so weit von der nächsten Strasse entfernt liegen. */
const ORIGIN_SNAP_M = 3000;
/** Zielpunkte sind beim Graph-Build als Knoten gesetzt; Toleranz für Rundung. */
const TARGET_SNAP_M = 250;

declare global {
  var __peakrRoadGraph: { graph: RoadGraph | null; path: string | null } | undefined;
  var __peakrDriveFields: CachedField[] | undefined;
}

interface CachedField {
  origin: number;
  maxSeconds: number;
  field: DriveField;
  usedAt: number;
}

function candidatePaths(): string[] {
  return [
    ROAD_GRAPH_PATH,
    // Vercel/Next: Datei liegt im Funktions-Bundle neben der App.
    resolve(process.cwd(), 'data/road-graph.bin'),
    resolve(process.cwd(), 'apps/frontend/data/road-graph.bin'),
    resolve(process.cwd(), '../../.data/artifacts/road-graph.bin'),
  ];
}

export function getRoadGraph(): RoadGraph | null {
  const holder = globalThis.__peakrRoadGraph;
  if (holder) return holder.graph;
  for (const path of candidatePaths()) {
    if (!existsSync(path)) continue;
    try {
      const started = Date.now();
      const graph = decodeRoadGraph(new Uint8Array(readFileSync(path)));
      globalThis.__peakrRoadGraph = { graph, path };
      logger.info({ path, nodes: graph.nodeCount, ms: Date.now() - started }, 'Strassengraph geladen');
      return graph;
    } catch (err) {
      logger.error({ path, error: err instanceof Error ? err.message : String(err) }, 'Strassengraph nicht lesbar');
    }
  }
  globalThis.__peakrRoadGraph = { graph: null, path: null };
  logger.error({ tried: candidatePaths() }, 'Strassengraph fehlt – Fahrzeiten nicht verfügbar');
  return null;
}

/** Nur für Tests: Graph direkt setzen bzw. Zwischenspeicher leeren. */
export function setRoadGraphForTests(graph: RoadGraph | null): void {
  globalThis.__peakrRoadGraph = graph ? { graph, path: 'test' } : undefined;
  globalThis.__peakrDriveFields = [];
}

export interface DriveContext {
  graph: RoadGraph;
  field: DriveField;
  originSnapM: number;
  /** Zuschlag in Sekunden für den Weg vom Startpunkt zur nächsten Strasse. */
  accessSeconds: number;
  /** Rechteck aller innerhalb der Grenze erreichten Knoten (Vorfilter für die Datenbank). */
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
}

export type DriveResult =
  | { status: 'ok'; ctx: DriveContext }
  | { status: 'unavailable' }
  | { status: 'origin_off_road' };

export function computeDriveContext(origin: LatLng, maxMinutes: number): DriveResult {
  const graph = getRoadGraph();
  if (!graph) return { status: 'unavailable' };
  const snap = snapToRoad(graph, origin.lat, origin.lng, ORIGIN_SNAP_M);
  if (!snap) return { status: 'origin_off_road' };

  // Vom Startpunkt zur Strasse mit 20 km/h (Quartier-/Zufahrtsweg).
  const accessSeconds = snap.distM / (20 / 3.6);
  const maxSeconds = Math.max(60, maxMinutes * 60 - accessSeconds);

  const cache = (globalThis.__peakrDriveFields ??= []);
  let hit = cache.find((c) => c.origin === snap.node && c.maxSeconds >= maxSeconds);
  if (!hit) {
    // Auf 10 Minuten aufrunden: Schieberegler-Bewegungen treffen denselben Eintrag.
    const bucket = Math.ceil(maxSeconds / 600) * 600;
    hit = { origin: snap.node, maxSeconds: bucket, field: driveTimesFrom(graph, snap.node, bucket), usedAt: 0 };
    cache.push(hit);
    if (cache.length > 4) cache.sort((a, b) => b.usedAt - a.usedAt).length = 4;
  }
  hit.usedAt = Date.now();

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  const { timeS } = hit.field;
  for (let i = 0; i < graph.nodeCount; i++) {
    if (timeS[i] > maxSeconds) continue;
    const la = graph.lat[i];
    const ln = graph.lng[i];
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (ln < minLng) minLng = ln;
    if (ln > maxLng) maxLng = ln;
  }
  const bounds = Number.isFinite(minLat)
    ? { minLat: minLat / 1e7, maxLat: maxLat / 1e7, minLng: minLng / 1e7, maxLng: maxLng / 1e7 }
    : null;

  return { status: 'ok', ctx: { graph, field: hit.field, originSnapM: snap.distM, accessSeconds, bounds } };
}

export interface DriveTime {
  minutes: number;
  distanceKm: number;
}

/** Fahrzeit vom Start zum Punkt; null, wenn innerhalb der Suchgrenze nicht erreichbar. */
export function driveTimeTo(ctx: DriveContext, lat: number, lng: number): DriveTime | null {
  const snap = snapToRoad(ctx.graph, lat, lng, TARGET_SNAP_M);
  if (!snap) return null;
  const t = ctx.field.timeS[snap.node];
  if (!Number.isFinite(t)) return null;
  return {
    minutes: (t + ctx.accessSeconds) / 60,
    distanceKm: (ctx.field.distM[snap.node] + ctx.originSnapM + snap.distM) / 1000,
  };
}

export function graphInfo(): { available: boolean; graphBuiltAt: string | null; osmTimestamp: string | null } {
  const g = getRoadGraph();
  if (!g) return { available: false, graphBuiltAt: null, osmTimestamp: null };
  return {
    available: true,
    graphBuiltAt: new Date(g.builtAt * 1000).toISOString(),
    osmTimestamp: g.osmTimestamp ? new Date(g.osmTimestamp * 1000).toISOString() : null,
  };
}
