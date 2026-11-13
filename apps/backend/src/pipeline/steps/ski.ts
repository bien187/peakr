import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { queryClient as sql } from '../../db';
import { haversineM, weatherCell } from '../../geo/lv95';
import { logger } from '../../lib/logger';
import { TerrainModel } from '../dem';
import { readGeoJsonSeq } from '../io/files';
import { isOplWay, parseOplLine, type OplWay } from '../io/opl';
import { nameSimilarity } from '../names';
import { PATHS } from '../paths';
import { chunks } from '../runs';
import { osmRef } from './destinations';

/**
 * Schritt «ski»: Skigebiete aus OpenStreetMap ableiten.
 *
 * Einzelne Lifte und Pisten sind keine Skigebiete. Sie werden räumlich zu
 * zusammenhängenden Gebieten gruppiert (Lift und Piste liegen näher als 150 m
 * beieinander) und über die Flächen `landuse=winter_sports` benannt. Gebiete mit
 * demselben Namen werden zusammengelegt. Eine Seilbahn ohne Piste in der Nähe ist
 * kein Skigebiet.
 */

const LIFT_TYPES: Record<string, string> = {
  cable_car: 'Luftseilbahn',
  gondola: 'Gondelbahn',
  mixed_lift: 'Kombibahn',
  chair_lift: 'Sesselbahn',
  drag_lift: 'Schlepplift',
  't-bar': 'Schlepplift',
  'j-bar': 'Schlepplift',
  platter: 'Schlepplift',
  rope_tow: 'Seillift',
  magic_carpet: 'Förderband',
};
/** Übungsanlagen: zählen als Lift, begründen allein aber kein Skigebiet mit Talstation. */
const PRACTICE = new Set(['rope_tow', 'magic_carpet']);
const LINK_M = 150;

type Pt = [number, number]; // [lng, lat]

interface Element {
  kind: 'lift' | 'piste';
  ref: string;
  name: string | null;
  type: string;
  coords: Pt[];
  lengthM: number;
}

function lineLength(coords: Pt[]): number {
  let l = 0;
  for (let i = 1; i < coords.length; i++) l += haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  return l;
}

/** Liest nur die Seilbahn- und Pistenwege aus dem Netzauszug. */
async function readSkiWays(path: string): Promise<OplWay[]> {
  const out: OplWay[] = [];
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.charCodeAt(0) !== 119) continue;
    if (!line.includes('aerialway=') && !line.includes('piste:type=')) continue;
    const parsed = parseOplLine(line);
    if (parsed && isOplWay(parsed) && parsed.nodeIds.length >= 2) out.push(parsed);
  }
  return out;
}

export function toElements(ways: OplWay[]): Element[] {
  const out: Element[] = [];
  for (const w of ways) {
    const t = w.tags;
    const coords: Pt[] = w.lngs.map((lng, i) => [lng, w.lats[i]]);
    if (t.aerialway && LIFT_TYPES[t.aerialway]) {
      if (t.access === 'private' || t.access === 'no' || t.usage === 'freight' || t.disused === 'yes' || t.abandoned === 'yes') continue;
      out.push({ kind: 'lift', ref: `way/${w.id}`, name: t.name?.trim() || null, type: t.aerialway, coords, lengthM: lineLength(coords) });
    } else if (t['piste:type'] === 'downhill') {
      if (t.abandoned === 'yes' || t['piste:abandoned'] === 'yes') continue;
      const closed = w.nodeIds[0] === w.nodeIds[w.nodeIds.length - 1] && t.area === 'yes';
      out.push({
        kind: 'piste',
        ref: `way/${w.id}`,
        name: t.name?.trim() || t['piste:name']?.trim() || null,
        type: t['piste:difficulty'] ?? 'unknown',
        coords,
        // Flächig erfasste Pisten: halber Umfang als Näherung der Länge.
        lengthM: closed ? lineLength(coords) / 2 : lineLength(coords),
      });
    }
  }
  return out;
}

/** Zwischenpunkte höchstens alle 80 m – für die Nachbarschaftssuche. */
function samples(coords: Pt[]): Pt[] {
  const out: Pt[] = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const d = haversineM(a[1], a[0], b[1], b[0]);
    const steps = Math.max(1, Math.ceil(d / 80));
    for (let s = 1; s <= steps; s++) out.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
  }
  return out;
}

class UnionFind {
  private parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/** Gruppiert Elemente, die näher als LINK_M beieinanderliegen. Liefert Gruppen von Element-Indizes. */
export function clusterElements(elements: Element[]): number[][] {
  const uf = new UnionFind(elements.length);
  const CELL_LAT = 0.0015;
  const CELL_LNG = 0.0022;
  const grid = new Map<string, { el: number; p: Pt }[]>();
  elements.forEach((el, idx) => {
    for (const p of samples(el.coords)) {
      const gx = Math.floor(p[0] / CELL_LNG);
      const gy = Math.floor(p[1] / CELL_LAT);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const other of grid.get(`${gx + dx}:${gy + dy}`) ?? []) {
            if (other.el === idx || uf.find(other.el) === uf.find(idx)) continue;
            if (haversineM(p[1], p[0], other.p[1], other.p[0]) <= LINK_M) uf.union(other.el, idx);
          }
        }
      }
      const key = `${gx}:${gy}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push({ el: idx, p });
      else grid.set(key, [{ el: idx, p }]);
    }
  });
  const groups = new Map<number, number[]>();
  elements.forEach((_, idx) => {
    const root = uf.find(idx);
    const g = groups.get(root);
    if (g) g.push(idx);
    else groups.set(root, [idx]);
  });
  return [...groups.values()];
}

interface Area {
  ref: string;
  name: string;
  rings: Pt[][];
  bbox: [number, number, number, number];
  wikidata: string | null;
  wikipedia: string | null;
}

function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inArea(p: Pt, a: Area): boolean {
  if (p[0] < a.bbox[0] || p[0] > a.bbox[2] || p[1] < a.bbox[1] || p[1] > a.bbox[3]) return false;
  return a.rings.some((r) => pointInRing(p, r));
}

interface Place {
  name: string;
  lat: number;
  lng: number;
  weight: number;
}

interface GeoFeature {
  id?: string;
  properties: Record<string, string>;
  geometry: { type: string; coordinates: unknown };
}

async function readAreasAndPlaces(path: string): Promise<{ areas: Area[]; places: Place[] }> {
  const areas: Area[] = [];
  const places: Place[] = [];
  for await (const f of readGeoJsonSeq<GeoFeature>(path)) {
    const t = f.properties;
    if (t.landuse === 'winter_sports' && t.name && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates as Pt[][]] : (f.geometry.coordinates as Pt[][][]);
      const rings = polys.map((poly) => poly[0]);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const r of rings) for (const [x, y] of r) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const ref = osmRef(f.id);
      if (ref) {
        areas.push({
          ref, name: t.name.trim(), rings, bbox: [minX, minY, maxX, maxY],
          wikidata: /^Q\d+$/.test(t.wikidata ?? '') ? t.wikidata : null,
          wikipedia: t['wikipedia:de'] ?? (/^de:(.+)$/.exec(t.wikipedia ?? '')?.[1] ?? null),
        });
      }
    } else if (t.place && t.name && f.geometry.type === 'Point') {
      const weight = t.place === 'city' || t.place === 'town' ? 0.6 : t.place === 'village' ? 0.8 : 1.3;
      const [lng, lat] = f.geometry.coordinates as Pt;
      places.push({ name: t.name.trim(), lat, lng, weight });
    }
  }
  return { areas, places };
}

export interface Resort {
  ref: string;
  name: string;
  grouping: string;
  lat: number;
  lng: number;
  base: { lat: number; lng: number; elev: number | null };
  top: { lat: number; lng: number; elev: number | null };
  lifts: Element[];
  liftsByType: Record<string, number>;
  pisteKm: number;
  pisteKmByDifficulty: Record<string, number>;
  wikidata: string | null;
  wikipedia: string | null;
}

function nearestPlace(places: Place[], lat: number, lng: number, maxM: number): Place | null {
  let best: Place | null = null;
  let bestScore = Infinity;
  for (const p of places) {
    if (Math.abs(p.lat - lat) > 0.06 || Math.abs(p.lng - lng) > 0.09) continue;
    const d = haversineM(lat, lng, p.lat, p.lng);
    if (d > maxM) continue;
    const score = d * p.weight;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

export function buildResorts(
  elements: Element[],
  areas: Area[],
  places: Place[],
  elevation: (lat: number, lng: number) => number | null,
): { resorts: Resort[]; stats: Record<string, number> } {
  const groups = clusterElements(elements);
  const stats = { lifts: 0, pistes: 0, clusters: groups.length, liftOnlyClustersDropped: 0, pisteOnlyClustersDropped: 0, mergedByName: 0 };
  for (const e of elements) stats[e.kind === 'lift' ? 'lifts' : 'pistes']++;

  interface Draft {
    name: string;
    grouping: string;
    area: Area | null;
    members: Element[];
  }
  const drafts: Draft[] = [];

  for (const group of groups) {
    const members = group.map((i) => elements[i]);
    const lifts = members.filter((m) => m.kind === 'lift');
    const pistes = members.filter((m) => m.kind === 'piste');
    if (lifts.length === 0) {
      stats.pisteOnlyClustersDropped++;
      continue;
    }
    // Benennende Fläche: die winter_sports-Fläche mit den meisten Lift-Endpunkten.
    const votes = new Map<Area, number>();
    for (const l of lifts) {
      for (const p of [l.coords[0], l.coords[l.coords.length - 1]]) {
        for (const a of areas) if (inArea(p, a)) votes.set(a, (votes.get(a) ?? 0) + 1);
      }
    }
    const area = [...votes].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    if (pistes.length === 0 && !area) {
      // Seilbahn ohne Piste und ausserhalb jeder Wintersportfläche: Zubringer oder Sommerbahn.
      stats.liftOnlyClustersDropped++;
      continue;
    }
    if (area) {
      drafts.push({ name: area.name, grouping: 'winter_sports-Fläche', area, members });
      continue;
    }
    let lowest = lifts[0].coords[0];
    let lowestZ = Infinity;
    for (const l of lifts) {
      for (const p of [l.coords[0], l.coords[l.coords.length - 1]]) {
        const z = elevation(p[1], p[0]) ?? Infinity;
        if (z < lowestZ) {
          lowestZ = z;
          lowest = p;
        }
      }
    }
    const place = nearestPlace(places, lowest[1], lowest[0], 4000);
    const named = lifts.find((l) => l.name);
    const name = place?.name ?? named?.name ?? null;
    if (!name) continue;
    drafts.push({ name, grouping: place ? 'räumlich, benannt nach nächstem Ort' : 'räumlich, benannt nach Anlage', area: null, members });
  }

  // Gleichnamige Teilgebiete zusammenlegen (gleiche Fläche, oder gleicher Ortsname in der Nähe).
  const merged: Draft[] = [];
  for (const d of drafts) {
    const c0 = d.members[0].coords[0];
    const twin = merged.find((m) => {
      if (d.area && m.area) return d.area.ref === m.area.ref || (d.area.name === m.area.name && haversineM(c0[1], c0[0], m.members[0].coords[0][1], m.members[0].coords[0][0]) < 15_000);
      if (!d.area && !m.area && m.name === d.name) return haversineM(c0[1], c0[0], m.members[0].coords[0][1], m.members[0].coords[0][0]) < 6000;
      return false;
    });
    if (twin) {
      twin.members.push(...d.members);
      stats.mergedByName++;
    } else {
      merged.push({ ...d, members: [...d.members] });
    }
  }

  const resorts: Resort[] = [];
  for (const d of merged) {
    const lifts = d.members.filter((m) => m.kind === 'lift');
    const pistes = d.members.filter((m) => m.kind === 'piste');
    const real = lifts.filter((l) => !PRACTICE.has(l.type));
    const forStations = real.length > 0 ? real : lifts;

    let base = { lat: 0, lng: 0, elev: null as number | null };
    let top = { lat: 0, lng: 0, elev: null as number | null };
    let minZ = Infinity;
    let maxZ = -Infinity;
    let sumLat = 0;
    let sumLng = 0;
    let count = 0;
    for (const l of forStations) {
      for (const p of [l.coords[0], l.coords[l.coords.length - 1]]) {
        const z = elevation(p[1], p[0]);
        sumLat += p[1];
        sumLng += p[0];
        count++;
        if (z === null) continue;
        if (z < minZ) {
          minZ = z;
          base = { lat: p[1], lng: p[0], elev: Math.round(z) };
        }
        if (z > maxZ) {
          maxZ = z;
          top = { lat: p[1], lng: p[0], elev: Math.round(z) };
        }
      }
    }
    if (count === 0) continue;
    if (base.elev === null) {
      const p = forStations[0].coords[0];
      base = { lat: p[1], lng: p[0], elev: null };
      top = base;
    }

    const liftsByType: Record<string, number> = {};
    for (const l of lifts) liftsByType[LIFT_TYPES[l.type]] = (liftsByType[LIFT_TYPES[l.type]] ?? 0) + 1;
    const pisteKmByDifficulty: Record<string, number> = {};
    let pisteKm = 0;
    for (const p of pistes) {
      pisteKm += p.lengthM / 1000;
      pisteKmByDifficulty[p.type] = (pisteKmByDifficulty[p.type] ?? 0) + p.lengthM / 1000;
    }
    for (const k of Object.keys(pisteKmByDifficulty)) pisteKmByDifficulty[k] = Math.round(pisteKmByDifficulty[k] * 10) / 10;

    const minLift = lifts.map((l) => Number(l.ref.slice(4))).sort((x, y) => x - y)[0];
    resorts.push({
      ref: d.area ? `ski:${d.area.ref}` : `ski:lift/${minLift}`,
      name: d.name,
      grouping: d.grouping,
      lat: sumLat / count,
      lng: sumLng / count,
      base,
      top,
      lifts,
      liftsByType,
      pisteKm: Math.round(pisteKm * 10) / 10,
      pisteKmByDifficulty,
      wikidata: d.area?.wikidata ?? null,
      wikipedia: d.area?.wikipedia ?? null,
    });
  }
  return { resorts, stats };
}

export async function importSkiResorts(): Promise<Record<string, unknown>> {
  const elements = toElements(await readSkiWays(PATHS.networkOpl));
  const { areas, places } = await readAreasAndPlaces(PATHS.poisGeoJson);

  // Höhen der Stationen aus dem Geländemodell.
  const dem = new TerrainModel(PATHS.demDir);
  const lats: number[] = [];
  const lngs: number[] = [];
  for (const e of elements) {
    if (e.kind !== 'lift') continue;
    for (const p of [e.coords[0], e.coords[e.coords.length - 1]]) {
      lats.push(Math.round(p[1] * 1e7));
      lngs.push(Math.round(p[0] * 1e7));
    }
  }
  await dem.ensureTiles(Int32Array.from(lats), Int32Array.from(lngs), null);

  const { resorts, stats } = buildResorts(elements, areas, places, (lat, lng) => dem.elevation(lat, lng));
  logger.info({ ...stats, areas: areas.length, resorts: resorts.length }, 'Skigebiete gruppiert');
  if (resorts.length < 50) throw new Error(`Nur ${resorts.length} Skigebiete erkannt – Quelldaten prüfen.`);

  // Bestehende IDs weiterverwenden: über die Quellenreferenz, sonst über Name + Nähe (alte kuratierte Einträge).
  const existingByRef = new Map<string, string>();
  for (const r of await sql<{ source_ref: string; destination_id: string }[]>`
    SELECT s.source_ref, s.destination_id FROM destination_sources s
    JOIN destinations d ON d.id = s.destination_id WHERE d.type = 'ski_resort'
  `) {
    existingByRef.set(r.source_ref, r.destination_id);
  }
  const legacy = await sql<{ id: string; name: string; lat: number; lng: number }[]>`
    SELECT id, name, lat::float8 AS lat, lng::float8 AS lng FROM destinations WHERE type = 'ski_resort'
  `;
  const startedAt = new Date();
  const claimed = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  const details: Record<string, unknown>[] = [];
  const liftRows: Record<string, unknown>[] = [];
  const stationRows: Record<string, unknown>[] = [];
  const sourceRows: { source_ref: string; destination_id: string }[] = [];

  for (const r of resorts) {
    const plainRef = r.ref.replace(/^ski:/, '');
    let id = existingByRef.get(r.ref) ?? existingByRef.get(plainRef);
    if (!id || claimed.has(id)) {
      const match = legacy
        .filter((l) => !claimed.has(l.id) && haversineM(l.lat, l.lng, r.lat, r.lng) < 6000)
        .map((l) => ({ l, sim: Math.max(nameSimilarity(l.name, r.name), l.name.toLowerCase().includes(r.name.toLowerCase()) ? 0.9 : 0) }))
        .filter((m) => m.sim >= 0.6)
        .sort((x, y) => y.sim - x.sim)[0];
      id = match?.l.id ?? randomUUID();
    }
    claimed.add(id);
    const liftsTotal = r.lifts.length;
    rows.push({
      id,
      name: r.name,
      lat: Number(r.lat.toFixed(6)),
      lng: Number(r.lng.toFixed(6)),
      elevation_base_m: r.base.elev,
      elevation_top_m: r.top.elev,
      wikipedia_title: r.wikipedia,
      wikidata_id: r.wikidata,
      object_class: liftsTotal <= 2 ? 'Kleinskigebiet' : 'Skigebiet',
      importance: Math.min(5, 1 + Math.floor(liftsTotal / 6)),
      quality_score: 40 + (r.grouping === 'winter_sports-Fläche' ? 25 : 0) + (r.pisteKm > 0 ? 15 : 0) + (r.wikidata ? 10 : 0) + (r.wikipedia ? 10 : 0),
      weather_cell: weatherCell(r.lat, r.lng),
      source_ref: { refs: [{ source: 'osm', ref: r.ref }], lifts: liftsTotal },
    });
    details.push({
      destination_id: id,
      station_ref: `station:${r.ref}`,
      lifts_total: liftsTotal,
      lifts_by_type: r.liftsByType,
      piste_km: r.pisteKm > 0 ? r.pisteKm : null,
      piste_km_by_difficulty: r.pisteKmByDifficulty,
      base_lat: r.base.lat, base_lng: r.base.lng, top_lat: r.top.lat, top_lng: r.top.lng,
      grouping: r.grouping,
    });
    stationRows.push({
      ref: `station:${r.ref}`,
      name: `Talstation ${r.name}`,
      lat: Number(r.base.lat.toFixed(6)),
      lng: Number(r.base.lng.toFixed(6)),
      elevation_m: r.base.elev,
    });
    sourceRows.push({ source_ref: r.ref, destination_id: id });
    for (const l of r.lifts) {
      const a = l.coords[0];
      const b = l.coords[l.coords.length - 1];
      const za = dem.elevation(a[1], a[0]);
      const zb = dem.elevation(b[1], b[0]);
      const [bottom, top, zBottom, zTop] = (za ?? 0) <= (zb ?? 0) ? [a, b, za, zb] : [b, a, zb, za];
      liftRows.push({
        destination_id: id, ref: l.ref, name: l.name, lift_type: LIFT_TYPES[l.type], length_m: Math.round(l.lengthM),
        bottom_lat: bottom[1], bottom_lng: bottom[0], bottom_elev_m: zBottom === null ? null : Math.round(zBottom),
        top_lat: top[1], top_lng: top[0], top_elev_m: zTop === null ? null : Math.round(zTop),
      });
    }
  }

  await sql.begin(async (tx) => {
    for (const batch of chunks(rows, 1000)) {
      await tx`
        INSERT INTO destinations (
          id, name, type, lat, lng, elevation_base_m, elevation_top_m, wikipedia_title, wikidata_id,
          source_layer, quality_score, object_class, importance, weather_cell, source_ref, route_status, updated_at, retired_at
        )
        SELECT x.id, x.name, 'ski_resort', x.lat, x.lng, x.elevation_base_m, x.elevation_top_m, x.wikipedia_title, x.wikidata_id,
               'osm', x.quality_score, x.object_class, x.importance, x.weather_cell, x.source_ref, 'not_applicable', now(), NULL
        FROM jsonb_to_recordset(${tx.json(batch as never)}) AS x(
          id uuid, name text, lat numeric, lng numeric, elevation_base_m int, elevation_top_m int, wikipedia_title text,
          wikidata_id text, quality_score smallint, object_class text, importance smallint, weather_cell text, source_ref jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, type = 'ski_resort', lat = EXCLUDED.lat, lng = EXCLUDED.lng,
          elevation_base_m = EXCLUDED.elevation_base_m, elevation_top_m = EXCLUDED.elevation_top_m,
          wikipedia_title = COALESCE(EXCLUDED.wikipedia_title, destinations.wikipedia_title),
          wikidata_id = EXCLUDED.wikidata_id, source_layer = 'osm', poi_kind = NULL,
          quality_score = EXCLUDED.quality_score, object_class = EXCLUDED.object_class, importance = EXCLUDED.importance,
          weather_cell = EXCLUDED.weather_cell, source_ref = EXCLUDED.source_ref, route_status = 'not_applicable',
          updated_at = now(), retired_at = NULL
      `;
    }
    await tx`UPDATE destinations SET retired_at = now() WHERE type = 'ski_resort' AND retired_at IS NULL AND updated_at < ${startedAt}`;

    await tx`
      INSERT INTO destination_sources (source, source_ref, destination_id, last_seen_at)
      SELECT 'osm', x.source_ref, x.destination_id, now()
      FROM jsonb_to_recordset(${tx.json(sourceRows as never)}) AS x(source_ref text, destination_id uuid)
      ON CONFLICT (source, source_ref) DO UPDATE SET destination_id = EXCLUDED.destination_id, last_seen_at = now()
    `;

    // Talstation als Zufahrtspunkt; der Strassenanschluss wird im Schritt «network» bestimmt.
    await tx`
      INSERT INTO trailheads (kind, ref, name, lat, lng, elevation_m, quality, source, updated_at)
      SELECT 'valley_station', x.ref, x.name, x.lat, x.lng, x.elevation_m, 1, 'osm', now()
      FROM jsonb_to_recordset(${tx.json(stationRows as never)}) AS x(ref text, name text, lat numeric, lng numeric, elevation_m int)
      ON CONFLICT (ref) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
        elevation_m = EXCLUDED.elevation_m, updated_at = now()
    `;
    await tx`
      INSERT INTO ski_resort_details (
        destination_id, trailhead_id, lifts_total, lifts_by_type, piste_km, piste_km_by_difficulty,
        base_lat, base_lng, top_lat, top_lng, grouping, updated_at
      )
      SELECT x.destination_id, t.id, x.lifts_total, x.lifts_by_type, x.piste_km, x.piste_km_by_difficulty,
             x.base_lat, x.base_lng, x.top_lat, x.top_lng, x.grouping, now()
      FROM jsonb_to_recordset(${tx.json(details as never)}) AS x(
        destination_id uuid, station_ref text, lifts_total int, lifts_by_type jsonb, piste_km real,
        piste_km_by_difficulty jsonb, base_lat numeric, base_lng numeric, top_lat numeric, top_lng numeric, grouping text
      )
      JOIN trailheads t ON t.ref = x.station_ref
      ON CONFLICT (destination_id) DO UPDATE SET
        trailhead_id = EXCLUDED.trailhead_id, lifts_total = EXCLUDED.lifts_total, lifts_by_type = EXCLUDED.lifts_by_type,
        piste_km = EXCLUDED.piste_km, piste_km_by_difficulty = EXCLUDED.piste_km_by_difficulty,
        base_lat = EXCLUDED.base_lat, base_lng = EXCLUDED.base_lng, top_lat = EXCLUDED.top_lat, top_lng = EXCLUDED.top_lng,
        grouping = EXCLUDED.grouping, updated_at = now()
    `;
    await tx`DELETE FROM ski_resort_details WHERE updated_at < ${startedAt}`;
    await tx`DELETE FROM trailheads WHERE kind = 'valley_station' AND updated_at < ${startedAt}`;

    await tx`DELETE FROM ski_lifts`;
    for (const batch of chunks(liftRows, 2000)) {
      await tx`
        INSERT INTO ski_lifts (destination_id, ref, name, lift_type, length_m, bottom_lat, bottom_lng, bottom_elev_m, top_lat, top_lng, top_elev_m)
        SELECT x.destination_id, x.ref, x.name, x.lift_type, x.length_m, x.bottom_lat, x.bottom_lng, x.bottom_elev_m, x.top_lat, x.top_lng, x.top_elev_m
        FROM jsonb_to_recordset(${tx.json(batch as never)}) AS x(
          destination_id uuid, ref text, name text, lift_type text, length_m int, bottom_lat numeric, bottom_lng numeric,
          bottom_elev_m int, top_lat numeric, top_lng numeric, top_elev_m int
        )
        ON CONFLICT (ref) DO NOTHING
      `;
    }
    await tx`
      UPDATE destinations d SET canton = c.code FROM cantons c
      WHERE d.type = 'ski_resort' AND d.retired_at IS NULL AND ST_Contains(c.geom, d.geom) AND d.canton IS DISTINCT FROM c.code
    `;
    await tx`
      UPDATE destinations d SET slf_region_id = r.id FROM avalanche_regions r
      WHERE d.type = 'ski_resort' AND d.retired_at IS NULL AND ST_Contains(r.geom, d.geom) AND d.slf_region_id IS DISTINCT FROM r.id
    `;
  });

  const [{ retired }] = await sql<{ retired: number }[]>`
    SELECT count(*)::int AS retired FROM destinations WHERE type = 'ski_resort' AND retired_at >= ${startedAt}
  `;
  return {
    ...stats,
    winterSportsAreas: areas.length,
    resorts: resorts.length,
    namedByArea: resorts.filter((r) => r.grouping === 'winter_sports-Fläche').length,
    liftsAssigned: liftRows.length,
    pisteKm: Math.round(resorts.reduce((s, r) => s + r.pisteKm, 0)),
    retired,
  };
}
