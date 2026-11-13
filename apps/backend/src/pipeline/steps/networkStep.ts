import { writeFileSync } from 'node:fs';
import { queryClient as sql } from '../../db';
import { logger } from '../../lib/logger';
import { encodeRoadGraph } from '../../routing/roadGraph';
import { TerrainModel } from '../dem';
import { buildHikeGraph, computeNodeAttributes, HikeRouter, type RouteMetrics } from '../hikeGraph';
import { readGeoJsonSeq } from '../io/files';
import { loadNetwork } from '../network';
import { NodeGrid } from '../nodeGrid';
import { loadOfficialTrails } from '../officialTrails';
import { PATHS } from '../paths';
import { chunks, setMeta } from '../runs';
import { osmRef, representativePoint } from './destinations';
import { readSourcesMeta, trailGeoPackage } from './prepare';
import { matchRouteClosures } from '../../repositories/conditions.repo';
import { buildRoadGraph } from './roadGraphBuilder';

/**
 * Schritt «network»: Strassengraph bauen, Ausgangspunkte bestimmen und für jedes
 * Wanderziel die Route(n) ab Parkplatz berechnen.
 *
 * Ergebnis in der Datenbank: trailheads, hike_routes, destinations.route_status.
 * Ergebnis als Datei: der Strassengraph für die Fahrzeitberechnung.
 */

const SCALE = 1e7;
const SAC = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

interface Parking {
  ref: string;
  name: string | null;
  lat: number;
  lng: number;
  areaM2: number;
  quality: number;
  tags: Record<string, string>;
  roadNet: number;
  roadSnapM: number;
  hikeNet: number;
}

const PRIVATE_ACCESS = new Set(['private', 'no', 'customers', 'permit', 'delivery', 'employees', 'residents', 'military', 'staff']);
const KEEP_TAGS = ['fee', 'capacity', 'access', 'parking', 'surface', 'opening_hours', 'maxstay', 'operator', 'website'];

interface PoiFeature {
  id?: string;
  properties: Record<string, string>;
  geometry: { type: string; coordinates: unknown };
}

/** Öffentlich nutzbare Parkplätze aus OSM. Private und Kundenparkplätze zählen nicht. */
export async function readParkings(path: string): Promise<{ parkings: Parking[]; stats: Record<string, number> }> {
  const byRef = new Map<string, Parking>();
  const isArea = new Set<string>();
  const stats = { features: 0, privateOrCustomers: 0, tooSmall: 0 };
  for await (const f of readGeoJsonSeq<PoiFeature>(path)) {
    const tags = f.properties;
    if (tags.amenity !== 'parking') continue;
    stats.features++;
    const ref = osmRef(f.id);
    if (!ref) continue;
    if (tags.access !== undefined && PRIVATE_ACCESS.has(tags.access)) {
      stats.privateOrCustomers++;
      continue;
    }
    const area = f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon';
    if (byRef.has(ref) && (isArea.has(ref) || !area)) continue;
    const point = representativePoint(f.geometry);
    if (!point) continue;
    // Flächen unter 60 m² (rund drei Autos) sind fast immer private Abstellplätze.
    if (area && point.areaM2 < 60 && !tags.name && !tags.capacity) {
      stats.tooSmall++;
      byRef.delete(ref);
      continue;
    }
    const kept: Record<string, string> = {};
    for (const k of KEEP_TAGS) if (tags[k]) kept[k] = tags[k];
    const explicitPublic = tags.access === 'yes' || tags.access === 'public' || tags.access === 'permissive';
    byRef.set(ref, {
      ref: `osm:${ref}`,
      name: tags.name?.trim() || null,
      lat: point.lat,
      lng: point.lng,
      areaM2: point.areaM2,
      quality: explicitPublic ? 3 : 2,
      tags: kept,
      roadNet: -1,
      roadSnapM: 0,
      hikeNet: -1,
    });
    if (area) isArea.add(ref);
  }
  return { parkings: [...byRef.values()], stats };
}

interface DestRow {
  id: string;
  poi_kind: string;
  lat: number;
  lng: number;
  elevation_top_m: number | null;
  extent_m: number | null;
}

function snapRadius(d: DestRow): number {
  switch (d.poi_kind) {
    case 'lake':
      return (d.extent_m ?? 0) + 150;
    case 'peak':
    case 'pass':
      return 150;
    case 'hut':
      return 120;
    default:
      return 100;
  }
}

interface RouteRow extends RouteMetrics {
  destinationId: string;
  rank: number;
  trailheadRef: string;
  endGapM: number;
}

export async function buildNetwork(): Promise<Record<string, unknown>> {
  const sources = readSourcesMeta();
  const builtAt = Math.floor(Date.now() / 1000);
  const osmTimestamp = sources.osm.timestamp ? Math.floor(Date.parse(sources.osm.timestamp) / 1000) : 0;

  const net = await loadNetwork(PATHS.networkOpl);
  const netCount = net.nodeLat.length;

  // 1) Vorläufiger Strassengraph: welche Punkte sind mit dem Auto erreichbar?
  const prelim = buildRoadGraph(net, null, { builtAt, osmTimestamp });
  const carGrid = new NodeGrid(net.nodeLat, net.nodeLng, prelim.carReachable);
  const publicGrid = new NodeGrid(net.nodeLat, net.nodeLng, prelim.carPublic);

  const hikeMask = new Uint8Array(netCount);
  for (const w of net.ways) {
    if (!w.hike) continue;
    for (let i = w.start; i < w.end; i++) hikeMask[net.refNode[i]] = 1;
  }
  const hikeGrid = new NodeGrid(net.nodeLat, net.nodeLng, hikeMask);

  // 2) Parkplätze: brauchen Anschluss ans Strassen- UND ans Wegnetz.
  const { parkings: allParkings, stats: parkingStats } = await readParkings(PATHS.poisGeoJson);
  const parkings: Parking[] = [];
  for (const p of allParkings) {
    const reach = 60 + Math.min(120, Math.sqrt(p.areaM2));
    const road = carGrid.nearest(p.lat, p.lng, reach);
    if (road === -1) continue;
    p.roadNet = road;
    p.roadSnapM = carGrid.lastDistM;
    const hike = hikeGrid.nearest(p.lat, p.lng, reach + 40);
    if (hike === -1) continue;
    p.hikeNet = hike;
    parkings.push(p);
  }

  // 3) Ziele und Talstationen einrasten.
  const dests = await sql<DestRow[]>`
    SELECT id, poi_kind, lat::float8 AS lat, lng::float8 AS lng, elevation_top_m, extent_m
    FROM destinations WHERE type = 'hike_destination' AND retired_at IS NULL
  `;
  const destNet = new Int32Array(dests.length).fill(-1);
  const destGap = new Float32Array(dests.length);
  for (let i = 0; i < dests.length; i++) {
    const d = dests[i];
    destNet[i] = hikeGrid.nearest(d.lat, d.lng, snapRadius(d));
    destGap[i] = hikeGrid.lastDistM;
  }
  const stations = await sql<{ id: string; lat: number; lng: number }[]>`
    SELECT id, lat::float8 AS lat, lng::float8 AS lng FROM trailheads WHERE kind = 'valley_station'
  `;
  const stationNet = stations.map((s) => {
    const near = publicGrid.nearest(s.lat, s.lng, 10_000);
    return { id: s.id, net: near, snapM: publicGrid.lastDistM };
  });

  // 4) Endgültiger Strassengraph mit allen Ausgangspunkten als Knoten.
  const forcedRoad = new Uint8Array(netCount);
  for (const p of parkings) forcedRoad[p.roadNet] = 1;
  for (const s of stationNet) if (s.net !== -1) forcedRoad[s.net] = 1;
  const road = buildRoadGraph(net, forcedRoad, { builtAt, osmTimestamp });
  const graphBytes = encodeRoadGraph(road.graph);
  writeFileSync(PATHS.roadGraph, graphBytes);
  logger.info({ file: PATHS.roadGraph, mb: Math.round(graphBytes.length / 1e5) / 10 }, 'Strassengraph geschrieben');

  // 5) Höhen und amtliche Kategorien, dann der Wandergraph.
  const trails = loadOfficialTrails(trailGeoPackage()!);
  const dem = new TerrainModel(PATHS.demDir);
  const demInfo = await dem.ensureTiles(net.nodeLat, net.nodeLng, hikeMask);
  const attrs = computeNodeAttributes(net, hikeMask, trails, dem);
  logger.info({ ...attrs.stats, ...demInfo }, 'Höhen bestimmt');

  const forcedHike = new Uint8Array(netCount);
  for (const p of parkings) forcedHike[p.hikeNet] = 1;
  for (let i = 0; i < dests.length; i++) if (destNet[i] !== -1) forcedHike[destNet[i]] = 1;
  const hike = buildHikeGraph(net, attrs, forcedHike);

  const parkingAt = new Int32Array(hike.nodeCount).fill(-1);
  parkings.forEach((p, idx) => {
    const node = hike.graphNodeOf[p.hikeNet];
    if (node === -1) return;
    // Liegen mehrere Parkplätze am selben Wegpunkt, gewinnt der bessere bzw. grössere.
    const cur = parkingAt[node];
    if (cur === -1 || p.quality > parkings[cur].quality || (p.quality === parkings[cur].quality && p.areaM2 > parkings[cur].areaM2)) {
      parkingAt[node] = idx;
    }
  });
  const roadAccess = new Uint8Array(hike.nodeCount);
  for (let node = 0; node < hike.nodeCount; node++) {
    if (road.carPublic[hike.netNode[node]] === 1) roadAccess[node] = 1;
  }

  const router = new HikeRouter(
    hike,
    net,
    attrs,
    parkingAt,
    roadAccess,
    Float64Array.from(parkings.map((p) => p.lat)),
    Float64Array.from(parkings.map((p) => p.lng)),
  );

  // 6) Routen je Ziel.
  const routes: RouteRow[] = [];
  const trailheads = new Map<string, Record<string, unknown>>();
  const status = new Map<string, 'routed' | 'no_route'>();
  const counters = { routed: 0, noTrailNearby: 0, noStartFound: 0, routes: 0, parkingStarts: 0, roadAccessStarts: 0 };

  for (let i = 0; i < dests.length; i++) {
    const d = dests[i];
    const destNode = destNet[i] === -1 ? -1 : hike.graphNodeOf[destNet[i]];
    if (destNode === -1) {
      status.set(d.id, 'no_route');
      counters.noTrailNearby++;
      continue;
    }
    const starts = router.findStarts(destNode);
    let rank = 0;
    for (const s of starts) {
      const metrics = router.buildRoute(s.node, d.poi_kind === 'peak' || d.poi_kind === 'pass' ? d.elevation_top_m : null);
      if (!metrics) continue;
      let ref: string;
      if (s.kind === 'parking') {
        const p = parkings[s.parking];
        ref = p.ref;
        if (!trailheads.has(ref)) {
          trailheads.set(ref, {
            kind: 'parking', ref, name: p.name, lat: round6(p.lat), lng: round6(p.lng),
            drive_lat: net.nodeLat[p.roadNet] / SCALE, drive_lng: net.nodeLng[p.roadNet] / SCALE,
            road_snap_m: Math.round(p.roadSnapM), elevation_m: elevOrNull(attrs.elev[p.hikeNet]),
            quality: p.quality, tags: p.tags,
          });
        }
        counters.parkingStarts++;
      } else {
        const netIdx = hike.netNode[s.node];
        ref = `road:${net.nodeOsmId[netIdx]}`;
        if (!trailheads.has(ref)) {
          trailheads.set(ref, {
            kind: 'road_access', ref, name: null, lat: net.nodeLat[netIdx] / SCALE, lng: net.nodeLng[netIdx] / SCALE,
            drive_lat: net.nodeLat[netIdx] / SCALE, drive_lng: net.nodeLng[netIdx] / SCALE,
            road_snap_m: 0, elevation_m: elevOrNull(attrs.elev[netIdx]), quality: 1, tags: {},
          });
        }
        counters.roadAccessStarts++;
      }
      rank++;
      // Bei Seen zählt der Abstand zum Ufer, nicht zum Mittelpunkt.
      const gap = d.poi_kind === 'lake' ? Math.max(0, destGap[i] - (d.extent_m ?? 0)) : destGap[i];
      routes.push({ ...metrics, destinationId: d.id, rank, trailheadRef: ref, endGapM: Math.round(gap) });
    }
    if (rank > 0) {
      status.set(d.id, 'routed');
      counters.routed++;
      counters.routes += rank;
    } else {
      status.set(d.id, 'no_route');
      counters.noStartFound++;
    }
    if ((i + 1) % 4000 === 0) logger.info({ done: i + 1, of: dests.length, routed: counters.routed }, 'Routen …');
  }

  // 7) Speichern: alles in einer Transaktion, damit die Suche nie einen halben Stand sieht.
  let closedRoutes: number | null = null;
  await sql.begin(async (tx) => {
    for (const batch of chunks([...trailheads.values()], 2000)) {
      await tx`
        INSERT INTO trailheads (kind, ref, name, lat, lng, drive_lat, drive_lng, road_snap_m, elevation_m, quality, tags, source, updated_at)
        SELECT x.kind, x.ref, x.name, x.lat, x.lng, x.drive_lat, x.drive_lng, x.road_snap_m, x.elevation_m, x.quality, x.tags, 'osm', now()
        FROM jsonb_to_recordset(${tx.json(batch as never)}) AS x(
          kind text, ref text, name text, lat numeric, lng numeric, drive_lat numeric, drive_lng numeric,
          road_snap_m real, elevation_m int, quality smallint, tags jsonb
        )
        ON CONFLICT (ref) DO UPDATE SET
          kind = EXCLUDED.kind, name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
          drive_lat = EXCLUDED.drive_lat, drive_lng = EXCLUDED.drive_lng, road_snap_m = EXCLUDED.road_snap_m,
          elevation_m = EXCLUDED.elevation_m, quality = EXCLUDED.quality, tags = EXCLUDED.tags, updated_at = now()
      `;
    }
    for (const s of stationNet) {
      if (s.net === -1) {
        await tx`UPDATE trailheads SET drive_lat = NULL, drive_lng = NULL, road_snap_m = NULL, quality = 1, updated_at = now() WHERE id = ${s.id}`;
      } else {
        await tx`
          UPDATE trailheads SET drive_lat = ${net.nodeLat[s.net] / SCALE}, drive_lng = ${net.nodeLng[s.net] / SCALE},
            road_snap_m = ${Math.round(s.snapM)}, quality = ${s.snapM <= 600 ? 3 : 1}, updated_at = now()
          WHERE id = ${s.id}
        `;
      }
    }

    await tx`DELETE FROM hike_routes`;
    const payload = routes.map((r) => ({
      destination_id: r.destinationId,
      trailhead_ref: r.trailheadRef,
      rank: r.rank,
      distance_m: r.distanceM,
      ascent_m: r.ascentM,
      descent_m: r.descentM,
      duration_up_min: r.durationUpMin,
      duration_down_min: r.durationDownMin,
      min_elev_m: r.minElevM,
      max_elev_m: r.maxElevM,
      sac_min: r.sacMin > 0 ? SAC[r.sacMin - 1] : null,
      sac_max: r.sacMax > 0 ? SAC[r.sacMax - 1] : null,
      sac_known_share: r.sacKnownShare,
      official_share: r.officialShare,
      end_gap_m: r.endGapM,
      geom: JSON.stringify({ type: 'LineString', coordinates: r.line }),
      // Höhe je Stützpunkt; ganz ohne Höhen bleibt die Spalte leer statt voller NULLs.
      elevations: r.lineElev.length === r.line.length && r.lineElev.some((z) => z !== null) ? r.lineElev : null,
    }));
    for (const batch of chunks(payload, 1000)) {
      await tx`
        INSERT INTO hike_routes (
          destination_id, trailhead_id, rank, distance_m, ascent_m, descent_m, duration_up_min, duration_down_min,
          min_elev_m, max_elev_m, sac_min, sac_max, sac_known_share, official_share, end_gap_m, geom, elevations,
          source, computed_at
        )
        SELECT x.destination_id, t.id, x.rank, x.distance_m, x.ascent_m, x.descent_m, x.duration_up_min, x.duration_down_min,
               x.min_elev_m, x.max_elev_m, x.sac_min::sac_difficulty, x.sac_max::sac_difficulty, x.sac_known_share,
               x.official_share, x.end_gap_m, ST_SetSRID(ST_GeomFromGeoJSON(x.geom), 4326),
               CASE WHEN jsonb_typeof(x.elevations) = 'array' THEN
                 ARRAY(SELECT e.v::smallint FROM jsonb_array_elements_text(x.elevations) WITH ORDINALITY AS e(v, i) ORDER BY e.i)
               END,
               'osm+swisstlm3d', now()
        FROM jsonb_to_recordset(${tx.json(batch as never)}) AS x(
          destination_id uuid, trailhead_ref text, rank smallint, distance_m int, ascent_m int, descent_m int,
          duration_up_min int, duration_down_min int, min_elev_m int, max_elev_m int, sac_min text, sac_max text,
          sac_known_share real, official_share real, end_gap_m int, geom text, elevations jsonb
        )
        JOIN trailheads t ON t.ref = x.trailhead_ref
      `;
    }

    // Nicht mehr verwendete Ausgangspunkte entfernen.
    await tx`
      DELETE FROM trailheads t
      WHERE t.kind IN ('parking', 'road_access')
        AND NOT EXISTS (SELECT 1 FROM hike_routes r WHERE r.trailhead_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM ski_resort_details s WHERE s.trailhead_id = t.id)
    `;

    // Neue Routen-IDs: gemeldete Sperrungen sofort wieder zuordnen (sonst erst beim nächsten Wetterlauf).
    const [{ exists }] = await tx<{ exists: boolean }[]>`SELECT to_regclass('public.trail_closures') IS NOT NULL AS exists`;
    if (exists) closedRoutes = await matchRouteClosures(tx);

    const statusRows = [...status].map(([id, route_status]) => ({ id, route_status }));
    for (const batch of chunks(statusRows, 5000)) {
      await tx`
        UPDATE destinations d SET route_status = x.route_status
        FROM jsonb_to_recordset(${tx.json(batch as never)}) AS x(id uuid, route_status text)
        WHERE d.id = x.id
      `;
    }
    // Kennzahlen der besten Route am Ziel spiegeln (Favoriten, Detailkopf).
    await tx`
      UPDATE destinations d SET sac_difficulty = r.sac_max, ascent_m = r.ascent_m, distance_km = round((r.distance_m / 1000.0)::numeric, 1)
      FROM hike_routes r WHERE r.destination_id = d.id AND r.rank = 1
    `;
    await tx`
      UPDATE destinations SET sac_difficulty = NULL, ascent_m = NULL, distance_km = NULL
      WHERE type = 'hike_destination' AND route_status <> 'routed'
    `;
  });

  await setMeta('road_graph', {
    builtAt: new Date(builtAt * 1000).toISOString(),
    osmTimestamp: sources.osm.timestamp,
    nodes: road.graph.nodeCount,
    edges: road.graph.edgeCount,
    bytes: graphBytes.length,
  });

  return {
    road: road.stats,
    roadGraphMb: Math.round(graphBytes.length / 1e5) / 10,
    parkings: { ...parkingStats, usable: allParkings.length, connected: parkings.length },
    officialTrailsKm: Math.round(trails.lengthKm),
    hike: hike.stats,
    elevation: attrs.stats,
    destinations: dests.length,
    ...counters,
    trailheads: trailheads.size,
    valleyStations: { total: stationNet.length, withRoadAccess: stationNet.filter((s) => s.net !== -1 && s.snapM <= 600).length },
    routesOnClosedTrails: closedRoutes,
  };
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;
const elevOrNull = (z: number): number | null => (Number.isNaN(z) ? null : Math.round(z));
