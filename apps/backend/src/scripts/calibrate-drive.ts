/**
 * Vergleicht die Fahrzeiten des eigenen Strassengraphen mit OpenRouteService.
 *
 *   pnpm --filter @ch-alpineroute/backend calibrate:drive
 *
 * Braucht ORS_API_KEY (kostenloser Schlüssel) und verbraucht genau EINE
 * Matrix-Anfrage. Dient nur der Qualitätskontrolle; im Betrieb wird ORS nicht
 * verwendet.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env, ROAD_GRAPH_PATH } from '../config/env';
import { queryClient as sql } from '../db';
import { PATHS } from '../pipeline/paths';
import { decodeRoadGraph, driveTimesFrom, snapToRoad } from '../routing/roadGraph';

const ORIGINS: [string, number, number][] = [
  ['Zürich', 47.3779, 8.5403],
  ['Bern', 46.948, 7.4474],
  ['Luzern', 47.0502, 8.3093],
  ['Chur', 46.8535, 9.5295],
  ['Sion', 46.2331, 7.3606],
  ['Lugano', 46.0037, 8.9511],
  ['Lausanne', 46.5197, 6.6323],
  ['St. Gallen', 47.4245, 9.3767],
];

async function main(): Promise<void> {
  if (!env.ORS_API_KEY) throw new Error('ORS_API_KEY fehlt – Vergleich nicht möglich.');
  const graph = decodeRoadGraph(new Uint8Array(readFileSync(ROAD_GRAPH_PATH)));

  // Zufällige, aber reproduzierbare Stichprobe von Ausgangspunkten quer durch die Schweiz.
  const targets = await sql<{ ref: string; kind: string; lat: number; lng: number }[]>`
    SELECT ref, kind, drive_lat::float8 AS lat, drive_lng::float8 AS lng
    FROM trailheads WHERE drive_lat IS NOT NULL AND (kind <> 'valley_station' OR road_snap_m <= 600)
    ORDER BY md5(ref) LIMIT 60
  `;
  const locations = [...ORIGINS.map((o) => [o[2], o[1]]), ...targets.map((t) => [t.lng, t.lat])];
  const res = await fetch('https://api.openrouteservice.org/v2/matrix/driving-car', {
    method: 'POST',
    headers: { Authorization: env.ORS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      locations,
      sources: ORIGINS.map((_, i) => i),
      destinations: targets.map((_, i) => ORIGINS.length + i),
      metrics: ['duration', 'distance'],
    }),
  });
  if (!res.ok) throw new Error(`ORS HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { durations: (number | null)[][]; distances: (number | null)[][] };

  const rows: { origin: string; ref: string; kind: string; ownMin: number; orsMin: number; ownKm: number; orsKm: number }[] = [];
  let unreachedOwn = 0;
  let unreachedOrs = 0;
  ORIGINS.forEach(([name, lat, lng], oi) => {
    const snap = snapToRoad(graph, lat, lng, 2000);
    if (!snap) return;
    const field = driveTimesFrom(graph, snap.node, 8 * 3600);
    targets.forEach((t, ti) => {
      const node = snapToRoad(graph, t.lat, t.lng, 100);
      const ors = body.durations[oi][ti];
      const own = node ? field.timeS[node.node] : Infinity;
      if (!Number.isFinite(own)) unreachedOwn++;
      if (ors === null) unreachedOrs++;
      if (!Number.isFinite(own) || ors === null || ors < 600) return;
      rows.push({
        origin: name, ref: t.ref, kind: t.kind,
        ownMin: own / 60, orsMin: ors / 60,
        ownKm: field.distM[node!.node] / 1000, orsKm: (body.distances[oi][ti] ?? 0) / 1000,
      });
    });
  });

  const ratios = rows.map((r) => r.ownMin / r.orsMin).sort((a, b) => a - b);
  const q = (p: number): number => ratios[Math.min(ratios.length - 1, Math.floor(p * ratios.length))];
  const absPct = rows.map((r) => Math.abs(r.ownMin / r.orsMin - 1) * 100).sort((a, b) => a - b);
  const absMin = rows.map((r) => Math.abs(r.ownMin - r.orsMin)).sort((a, b) => a - b);
  const pick = (arr: number[], p: number): number => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  const summary = {
    pairs: rows.length,
    unreachedOwn,
    unreachedOrs,
    ratioOwnToOrs: { p10: +q(0.1).toFixed(3), median: +q(0.5).toFixed(3), p90: +q(0.9).toFixed(3) },
    absoluteDeviationPercent: { median: +pick(absPct, 0.5).toFixed(1), p90: +pick(absPct, 0.9).toFixed(1), max: +absPct[absPct.length - 1].toFixed(1) },
    absoluteDeviationMinutes: { median: +pick(absMin, 0.5).toFixed(1), p90: +pick(absMin, 0.9).toFixed(1) },
    within10Percent: +((absPct.filter((v) => v <= 10).length / absPct.length) * 100).toFixed(1),
    distanceRatioMedian: +[...rows.map((r) => r.ownKm / r.orsKm)].sort((a, b) => a - b)[Math.floor(rows.length / 2)].toFixed(3),
    graphBuiltAt: new Date(graph.builtAt * 1000).toISOString(),
  };
  console.log(JSON.stringify(summary, null, 2));
  const worst = [...rows].sort((a, b) => Math.abs(b.ownMin / b.orsMin - 1) - Math.abs(a.ownMin / a.orsMin - 1)).slice(0, 8);
  console.table(worst.map((r) => ({ ...r, ownMin: +r.ownMin.toFixed(1), orsMin: +r.orsMin.toFixed(1), ownKm: +r.ownKm.toFixed(1), orsKm: +r.orsKm.toFixed(1) })));

  mkdirSync(PATHS.reports, { recursive: true });
  writeFileSync(resolve(PATHS.reports, 'drive-calibration.json'), JSON.stringify({ summary, rows }, null, 2));
}

main()
  .then(async () => {
    await sql.end({ timeout: 5 });
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await sql.end({ timeout: 5 }).catch(() => undefined);
    process.exit(1);
  });
