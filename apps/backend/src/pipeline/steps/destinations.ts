import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { queryClient as sql } from '../../db';
import { haversineM, lv95ToWgs84, weatherCell } from '../../geo/lv95';
import { logger } from '../../lib/logger';
import { readGeoJsonSeq, readSemicolonCsv } from '../io/files';
import { bestNameSimilarity } from '../names';
import { PATHS } from '../paths';
import { chunks } from '../runs';

/**
 * Schritt «destinations»: Wanderziele aus swissNAMES3D (amtlich, führend) und
 * OpenStreetMap (Ergänzung) zusammenführen.
 *
 * Grundsatz: Ein Ziel wird aufgenommen, wenn es real existiert und einen Namen
 * hat. Es gibt KEINE Mindesthöhe, KEINE Obergrenze der Anzahl, KEINEN Ausschluss
 * wegen fehlender Höhe, fehlendem Wanderweg oder tiefer Metadaten-Qualität.
 * Ob ein Ziel wanderbar und mit dem Auto erreichbar ist, entscheiden spätere
 * Schritte und speichern es getrennt (route_status, hike_routes, trailheads).
 */

export type PoiKind = 'peak' | 'pass' | 'viewpoint' | 'lake' | 'hut';

export interface SourceRef {
  source: 'swissnames3d' | 'osm';
  ref: string;
}

export interface Candidate {
  kind: PoiKind;
  name: string;
  /** Sprachvarianten: de, fr, it, rm. */
  names: Record<string, string>;
  altNames: string[];
  lat: number;
  lng: number;
  elevation: number | null;
  objectClass: string;
  importance: number;
  refs: SourceRef[];
  wikidata: string | null;
  wikipedia: string | null;
  extentM: number | null;
  official: boolean;
}

// ── swissNAMES3D ──────────────────────────────────────────────────────────────

/** Objektarten der Punkt-Tabelle, die Wanderziele sind, mit Zielart und Rang. */
const NAMES3D_POINT_CLASSES: Record<string, { kind: PoiKind; importance: number }> = {
  'Alpiner Gipfel': { kind: 'peak', importance: 5 },
  Hauptgipfel: { kind: 'peak', importance: 4 },
  Gipfel: { kind: 'peak', importance: 3 },
  Haupthuegel: { kind: 'peak', importance: 2 },
  Huegel: { kind: 'peak', importance: 1 },
  Pass: { kind: 'pass', importance: 2 },
  Strassenpass: { kind: 'pass', importance: 3 },
  Aussichtspunkt: { kind: 'viewpoint', importance: 2 },
};
/** Gebäudenutzungen, die als Hütte bzw. Berggasthaus gelten. */
const NAMES3D_HUT_USES = new Set(['Schutzhuette', 'Gasthof abgelegen']);

const LANGUAGE: Record<string, string> = {
  'Hochdeutsch inkl. Lokalsprachen': 'de',
  'Franzoesisch inkl. Lokalsprachen': 'fr',
  'Italienisch inkl. Lokalsprachen': 'it',
  'Rumantsch Grischun inkl. Lokalsprachen': 'rm',
};
const STATUS_RANK: Record<string, number> = { offiziell: 0, ueblich: 1, informell: 2 };

interface NameRow {
  name: string;
  lang: string | null;
  status: number;
  exonym: boolean;
}

function pickNames(rows: NameRow[]): { name: string; names: Record<string, string>; altNames: string[] } {
  // Offizielle Endonyme zuerst; unter gleichrangigen gewinnt Deutsch (App-Sprache).
  const sorted = [...rows].sort(
    (a, b) =>
      Number(a.exonym) - Number(b.exonym) ||
      a.status - b.status ||
      Number(b.lang === 'de') - Number(a.lang === 'de'),
  );
  const names: Record<string, string> = {};
  for (const r of sorted) if (r.lang && !(r.lang in names)) names[r.lang] = r.name;
  const primary = sorted[0].name;
  const altNames = [...new Set(sorted.map((r) => r.name))].filter((n) => n !== primary);
  return { name: primary, names, altNames };
}

function intOrNull(raw: string | undefined): number | null {
  if (!raw || raw === 'k_W') return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export async function readSwissNames(dir: string): Promise<{ candidates: Candidate[]; stats: Record<string, number> }> {
  interface Group {
    kind: PoiKind;
    objectClass: string;
    importance: number;
    e: number;
    n: number;
    elevation: number | null;
    rows: NameRow[];
  }
  const groups = new Map<string, Group>();
  const stats: Record<string, number> = { rows: 0 };

  const add = (row: Record<string, string>, kind: PoiKind, objectClass: string, importance: number): void => {
    const name = row.NAME?.trim();
    const e = Number(row.E);
    const n = Number(row.N);
    if (!name || !Number.isFinite(e) || !Number.isFinite(n)) {
      stats.invalid = (stats.invalid ?? 0) + 1;
      return;
    }
    let g = groups.get(row.UUID);
    if (!g) {
      g = { kind, objectClass, importance, e, n, elevation: intOrNull(row.HOEHE) ?? intOrNull(row.Z), rows: [] };
      groups.set(row.UUID, g);
    }
    g.rows.push({
      name,
      lang: LANGUAGE[row.SPRACHCODE] ?? null,
      status: STATUS_RANK[row.STATUS] ?? 3,
      exonym: row.NAMEN_TYP === 'Exonym',
    });
  };

  for await (const row of readSemicolonCsv(resolve(dir, 'swissNAMES3D_PKT.csv'))) {
    stats.rows++;
    const cls = NAMES3D_POINT_CLASSES[row.OBJEKTART];
    if (cls) add(row, cls.kind, row.OBJEKTART, cls.importance);
    else if ((row.OBJEKTART === 'Gebaeude' || row.OBJEKTART === 'Offenes Gebaeude') && NAMES3D_HUT_USES.has(row.GEBAEUDENUTZUNG)) {
      add(row, 'hut', row.GEBAEUDENUTZUNG === 'Schutzhuette' ? 'Schutzhütte' : 'Berggasthaus', row.GEBAEUDENUTZUNG === 'Schutzhuette' ? 3 : 2);
    }
  }
  for await (const row of readSemicolonCsv(resolve(dir, 'swissNAMES3D_PLY.csv'))) {
    stats.rows++;
    if (row.OBJEKTART === 'See') add(row, 'lake', 'See', 2);
  }

  const candidates: Candidate[] = [];
  for (const [uuid, g] of groups) {
    const { lat, lng } = lv95ToWgs84(g.e, g.n);
    const picked = pickNames(g.rows);
    candidates.push({
      kind: g.kind,
      ...picked,
      lat,
      lng,
      elevation: g.elevation,
      objectClass: g.objectClass,
      importance: g.importance,
      refs: [{ source: 'swissnames3d', ref: uuid.replace(/[{}]/g, '').toLowerCase() }],
      wikidata: null,
      wikipedia: null,
      extentM: null,
      official: true,
    });
    stats[g.kind] = (stats[g.kind] ?? 0) + 1;
  }
  return { candidates, stats };
}

// ── OpenStreetMap ─────────────────────────────────────────────────────────────

interface OsmFeature {
  id?: string;
  properties: Record<string, string>;
  geometry: { type: string; coordinates: unknown };
}

/** osmium-Export-ID → kanonische OSM-Referenz («node/1», «way/2», «relation/3»). */
export function osmRef(id: string | undefined): string | null {
  if (!id) return null;
  const num = Number(id.slice(1));
  if (!Number.isFinite(num)) return null;
  switch (id[0]) {
    case 'n':
      return `node/${num}`;
    case 'w':
      return `way/${num}`;
    case 'r':
      return `relation/${num}`;
    case 'a':
      return num % 2 === 0 ? `way/${num / 2}` : `relation/${(num - 1) / 2}`;
    default:
      return null;
  }
}

type Ring = [number, number][];

/** Schwerpunkt und Fläche (m²) eines Rings über eine lokale ebene Näherung. */
function ringCentroid(ring: Ring): { lat: number; lng: number; areaM2: number } {
  const lat0 = ring[0][1];
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 111_320;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = (ring[i][0] - ring[0][0]) * kx;
    const y1 = (ring[i][1] - ring[0][1]) * ky;
    const x2 = (ring[i + 1][0] - ring[0][0]) * kx;
    const y2 = (ring[i + 1][1] - ring[0][1]) * ky;
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(a) < 1e-6) {
    return { lat: ring[0][1], lng: ring[0][0], areaM2: 0 };
  }
  return { lng: ring[0][0] + cx / (3 * a) / kx, lat: ring[0][1] + cy / (3 * a) / ky, areaM2: Math.abs(a) / 2 };
}

/** Repräsentativer Punkt und Fläche einer beliebigen GeoJSON-Geometrie. */
export function representativePoint(geometry: OsmFeature['geometry']): { lat: number; lng: number; areaM2: number } | null {
  const c = geometry.coordinates;
  switch (geometry.type) {
    case 'Point': {
      const p = c as [number, number];
      return { lng: p[0], lat: p[1], areaM2: 0 };
    }
    case 'LineString': {
      const line = c as Ring;
      const mid = line[Math.floor(line.length / 2)];
      return { lng: mid[0], lat: mid[1], areaM2: 0 };
    }
    case 'Polygon':
      return ringCentroid((c as Ring[])[0]);
    case 'MultiPolygon': {
      let best: { lat: number; lng: number; areaM2: number } | null = null;
      let total = 0;
      for (const poly of c as Ring[][]) {
        const r = ringCentroid(poly[0]);
        total += r.areaM2;
        if (!best || r.areaM2 > best.areaM2) best = r;
      }
      return best ? { ...best, areaM2: total } : null;
    }
    default:
      return null;
  }
}

function parseEle(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseFloat(raw.replace(',', '.'));
  // Tiefster Punkt der Schweiz 193 m (Lago Maggiore), höchster 4'634 m: alles andere ist ein Erfassungsfehler.
  return Number.isFinite(n) && n >= 190 && n <= 4640 ? Math.round(n) : null;
}

function parseWikipedia(tags: Record<string, string>): string | null {
  if (tags['wikipedia:de']) return tags['wikipedia:de'];
  const w = tags.wikipedia;
  if (!w) return null;
  const de = /^de:(.+)$/.exec(w);
  return de ? de[1] : null;
}

const STILL_WATER = new Set(['lake', 'reservoir', 'pond', 'lagoon', 'oxbow']);
/** Benannte Stillgewässer unter dieser Fläche gelten als Teich, nicht als See. */
const MIN_LAKE_AREA_M2 = 2500;

function classifyOsm(tags: Record<string, string>, areaM2: number): { kind: PoiKind; objectClass: string; importance: number } | null {
  if (tags.natural === 'peak') return { kind: 'peak', objectClass: 'OSM natural=peak', importance: 2 };
  if (tags.natural === 'saddle' || tags.mountain_pass === 'yes') return { kind: 'pass', objectClass: 'OSM Sattel/Pass', importance: 1 };
  if (tags.tourism === 'alpine_hut') return { kind: 'hut', objectClass: 'Berghütte (OSM alpine_hut)', importance: 3 };
  if (tags.tourism === 'wilderness_hut') return { kind: 'hut', objectClass: 'Selbstversorgerhütte (OSM wilderness_hut)', importance: 2 };
  if (tags.tourism === 'viewpoint') return { kind: 'viewpoint', objectClass: 'OSM tourism=viewpoint', importance: 1 };
  if (tags.natural === 'water') {
    const water = tags.water;
    if (water !== undefined && !STILL_WATER.has(water)) return null;
    if (areaM2 < MIN_LAKE_AREA_M2) return null;
    return { kind: 'lake', objectClass: water === 'reservoir' ? 'Stausee (OSM)' : 'See (OSM)', importance: 1 };
  }
  return null;
}

export async function readOsmDestinations(path: string): Promise<{ candidates: Candidate[]; stats: Record<string, number> }> {
  const byRef = new Map<string, Candidate>();
  const isArea = new Map<string, boolean>();
  const stats: Record<string, number> = { features: 0, unnamed: 0, tooSmallWater: 0 };

  for await (const f of readGeoJsonSeq<OsmFeature>(path)) {
    const tags = f.properties;
    const relevant =
      tags.natural === 'peak' || tags.natural === 'saddle' || tags.natural === 'water' ||
      tags.mountain_pass === 'yes' || tags.tourism === 'alpine_hut' || tags.tourism === 'wilderness_hut' ||
      tags.tourism === 'viewpoint';
    if (!relevant) continue;
    stats.features++;
    const ref = osmRef(f.id);
    if (!ref) continue;
    const name = tags.name?.trim();
    if (!name) {
      // Ohne Namen ist ein Ziel weder auffindbar noch darstellbar.
      if (tags.natural !== 'water') stats.unnamed++;
      continue;
    }
    const point = representativePoint(f.geometry);
    if (!point) continue;
    const area = f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon';
    // Geschlossene Wege exportiert osmium doppelt (Linie + Fläche): die Fläche gewinnt.
    if (byRef.has(ref) && (isArea.get(ref) || !area)) continue;

    const cls = classifyOsm(tags, point.areaM2);
    if (!cls) {
      if (tags.natural === 'water' && area) stats.tooSmallWater++;
      continue;
    }
    const names: Record<string, string> = {};
    for (const lang of ['de', 'fr', 'it', 'rm']) {
      const v = tags[`name:${lang}`];
      if (v) names[lang] = v;
    }
    const altNames = [tags.alt_name, tags.loc_name, tags.official_name, ...Object.values(names)]
      .flatMap((v) => (v ? v.split(';') : []))
      .map((v) => v.trim())
      .filter((v) => v && v !== name);

    byRef.set(ref, {
      kind: cls.kind,
      name,
      names,
      altNames: [...new Set(altNames)],
      lat: point.lat,
      lng: point.lng,
      elevation: parseEle(tags.ele),
      objectClass: cls.objectClass,
      importance: cls.importance + (tags.wikidata ? 1 : 0),
      refs: [{ source: 'osm', ref }],
      wikidata: /^Q\d+$/.test(tags.wikidata ?? '') ? tags.wikidata : null,
      wikipedia: parseWikipedia(tags),
      extentM: point.areaM2 > 0 ? Math.round(Math.sqrt(point.areaM2 / Math.PI)) : null,
      official: false,
    });
    isArea.set(ref, area);
  }

  const candidates = [...byRef.values()];
  for (const c of candidates) stats[c.kind] = (stats[c.kind] ?? 0) + 1;
  return { candidates, stats };
}

// ── Zusammenführen & Duplikate ────────────────────────────────────────────────

/** Suchradius in Metern, innerhalb dessen zwei Einträge dasselbe Objekt sein können. */
function matchRadius(a: Candidate, b: Candidate): number {
  switch (a.kind) {
    case 'lake':
      return Math.max(350, (a.extentM ?? 0) + 150, (b.extentM ?? 0) + 150);
    case 'pass':
      return 250;
    case 'peak':
      return 200;
    default:
      return 150;
  }
}

function allNames(c: Candidate): string[] {
  return [c.name, ...c.altNames, ...Object.values(c.names)];
}

/** Entscheidet, ob zwei Kandidaten dasselbe reale Objekt beschreiben. */
export function isSameObject(a: Candidate, b: Candidate): boolean {
  const sameKind = a.kind === b.kind;
  // Ein Aussichtspunkt auf einem gleichnamigen Gipfel ist kein zweites Ziel.
  const viewOnPeak =
    (a.kind === 'peak' && b.kind === 'viewpoint') || (a.kind === 'viewpoint' && b.kind === 'peak');
  if (!sameKind && !viewOnPeak) return false;

  const dist = haversineM(a.lat, a.lng, b.lat, b.lng);
  const sim = bestNameSimilarity(allNames(a), allNames(b));
  if (viewOnPeak) return dist <= 120 && sim >= 0.9;
  // OSM setzt Gipfel und Pässe gelegentlich 200–350 m neben den amtlichen Punkt. Bei
  // identischem Namen und (soweit bekannt) gleicher Höhe ist es dasselbe Objekt.
  if ((a.kind === 'peak' || a.kind === 'pass') && sim === 1 && dist <= 350) {
    const dEle = a.elevation !== null && b.elevation !== null ? Math.abs(a.elevation - b.elevation) : 0;
    if (dEle <= 30) return true;
  }
  if (dist > matchRadius(a, b)) return false;
  if (sim >= 0.78) return true;

  // Am selben Fleck kann nur ein Gebäude, ein See oder ein Aussichtspunkt liegen –
  // abweichende Schreibweisen oder Sprachen ändern daran nichts.
  if (a.kind === 'hut' && dist <= 40) return true;
  if (a.kind === 'viewpoint' && dist <= 15) return true;
  if (a.kind === 'lake' && dist <= Math.max(60, Math.min(a.extentM ?? 0, b.extentM ?? 0) * 0.5)) return true;

  // Gleicher Punkt, anderer Name (andere Sprache): nur bei sehr kleinem Abstand
  // und passender Höhe – sonst würden benachbarte Gipfel verschmolzen.
  if (a.kind === 'peak' || a.kind === 'pass') {
    const both = a.elevation !== null && b.elevation !== null;
    const dEle = both ? Math.abs(a.elevation! - b.elevation!) : Infinity;
    if (dist <= 45) return both ? dEle <= 25 : dist <= 20;
    // Mundart- und Schriftform («Grüeniberg»/«Grüenihora») bei praktisch gleicher Höhe.
    if (dist <= 60 && dEle <= 3 && sim >= 0.5) return true;
  }
  return false;
}

function mergeInto(target: Candidate, other: Candidate): void {
  for (const r of other.refs) {
    if (!target.refs.some((t) => t.source === r.source && t.ref === r.ref)) target.refs.push(r);
  }
  for (const [lang, v] of Object.entries(other.names)) if (!(lang in target.names)) target.names[lang] = v;
  const known = new Set([target.name, ...target.altNames]);
  for (const n of [other.name, ...other.altNames]) {
    if (!known.has(n)) {
      target.altNames.push(n);
      known.add(n);
    }
  }
  target.elevation ??= other.elevation;
  target.wikidata ??= other.wikidata;
  target.wikipedia ??= other.wikipedia;
  target.extentM ??= other.extentM;
  target.importance = Math.max(target.importance, other.importance);
}

/**
 * Führt Kandidaten zusammen. Amtliche Einträge sind führend (Name, Lage, Höhe);
 * OSM ergänzt Wikidata/Wikipedia, Sprachvarianten und Flächen.
 */
export function mergeCandidates(input: Candidate[]): { merged: Candidate[]; duplicates: number } {
  // Reihenfolge bestimmt, wer «gewinnt»: amtlich vor OSM, wichtig vor unwichtig,
  // Gipfel vor Aussichtspunkt (damit der Aussichtspunkt im Gipfel aufgeht).
  const order = [...input].sort(
    (a, b) =>
      Number(b.official) - Number(a.official) ||
      Number(a.kind === 'viewpoint') - Number(b.kind === 'viewpoint') ||
      b.importance - a.importance,
  );
  const CELL = 0.005; // ~550 m
  const grid = new Map<string, Candidate[]>();
  const merged: Candidate[] = [];
  let duplicates = 0;

  for (const c of order) {
    const gx = Math.floor(c.lng / CELL);
    const gy = Math.floor(c.lat / CELL);
    const reach = c.kind === 'lake' ? Math.ceil(((c.extentM ?? 0) + 500) / 380) : 1;
    let match: Candidate | null = null;
    search: for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        for (const other of grid.get(`${gx + dx}:${gy + dy}`) ?? []) {
          if (isSameObject(other, c)) {
            match = other;
            break search;
          }
        }
      }
    }
    if (match) {
      mergeInto(match, c);
      duplicates++;
      continue;
    }
    merged.push(c);
    const key = `${gx}:${gy}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(c);
    else grid.set(key, [c]);
  }
  return { merged, duplicates };
}

/** Metadaten-Qualität 0–100: sagt nichts über die Existenz oder Wanderbarkeit aus. */
export function metadataQuality(c: Candidate): number {
  const twoSources = new Set(c.refs.map((r) => r.source)).size > 1;
  return (
    10 +
    (c.official ? 30 : 0) +
    (twoSources ? 15 : 0) +
    (c.elevation !== null ? 15 : 0) +
    (c.wikidata ? 15 : 0) +
    (c.wikipedia ? 15 : 0)
  );
}

// ── Datenbank ─────────────────────────────────────────────────────────────────

async function importCantons(): Promise<number> {
  interface CantonFeature {
    properties: Record<string, string>;
    geometry: unknown;
  }
  let n = 0;
  for await (const f of readGeoJsonSeq<CantonFeature>(PATHS.cantonsGeoJson)) {
    const iso = f.properties['ISO3166-2'];
    if (f.properties.boundary !== 'administrative' || !iso?.startsWith('CH-')) continue;
    await sql`
      INSERT INTO cantons (code, name, geom, updated_at)
      VALUES (${iso.slice(3)}, ${f.properties.name ?? iso}, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)}), 4326)), now())
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, geom = EXCLUDED.geom, updated_at = now()
    `;
    n++;
  }
  return n;
}

export async function importDestinations(): Promise<Record<string, unknown>> {
  const names = await readSwissNames(PATHS.namesDir);
  const osm = await readOsmDestinations(PATHS.poisGeoJson);
  logger.info({ swissnames3d: names.stats, osm: osm.stats }, 'Kandidaten gelesen');

  const { merged, duplicates } = mergeCandidates([...names.candidates, ...osm.candidates]);

  // Sicherung gegen einen kaputten Download: nie mehr als die Hälfte verlieren.
  const [{ active }] = await sql<{ active: number }[]>`
    SELECT count(*)::int AS active FROM destinations
    WHERE type = 'hike_destination' AND retired_at IS NULL AND source_layer IN ('swissnames3d', 'osm')
  `;
  if (active > 1000 && merged.length < active * 0.5) {
    throw new Error(`Import abgebrochen: nur ${merged.length} Kandidaten bei ${active} aktiven Zielen – Quelldaten prüfen.`);
  }

  const cantons = await importCantons();

  // Bestehende Zuordnung Quelle → Ziel laden, damit Ziel-IDs (und Favoriten) stabil bleiben.
  const existing = new Map<string, string>();
  for (const r of await sql<{ source: string; source_ref: string; destination_id: string }[]>`
    SELECT source, source_ref, destination_id FROM destination_sources
  `) {
    existing.set(`${r.source}|${r.source_ref}`, r.destination_id);
  }

  const startedAt = new Date();
  const rows: Record<string, unknown>[] = [];
  const sourceRows: { source: string; source_ref: string; destination_id: string }[] = [];
  const absorbed: { loser: string; winner: string }[] = [];
  const claimed = new Set<string>();
  let inserted = 0;
  let updated = 0;

  for (const c of merged) {
    const ids = [...new Set(c.refs.map((r) => existing.get(`${r.source}|${r.ref}`)).filter((v): v is string => !!v))]
      .filter((id) => !claimed.has(id));
    const id = ids[0] ?? randomUUID();
    if (ids.length === 0) inserted++;
    else updated++;
    claimed.add(id);
    for (const loser of ids.slice(1)) {
      claimed.add(loser);
      absorbed.push({ loser, winner: id });
    }
    rows.push({
      id,
      name: c.name,
      lat: Number(c.lat.toFixed(6)),
      lng: Number(c.lng.toFixed(6)),
      elevation_top_m: c.elevation,
      wikipedia_title: c.wikipedia,
      wikidata_id: c.wikidata,
      poi_kind: c.kind,
      source_layer: c.official ? 'swissnames3d' : 'osm',
      quality_score: metadataQuality(c),
      object_class: c.objectClass,
      names: { ...c.names, alt: c.altNames },
      importance: c.importance,
      extent_m: c.extentM,
      weather_cell: weatherCell(c.lat, c.lng),
      source_ref: { refs: c.refs },
    });
    for (const r of c.refs) sourceRows.push({ source: r.source, source_ref: r.ref, destination_id: id });
  }

  await sql.begin(async (tx) => {
    for (const batch of chunks(rows, 2000)) {
      await tx`
        INSERT INTO destinations (
          id, name, type, lat, lng, elevation_top_m, wikipedia_title, wikidata_id, poi_kind,
          source_layer, quality_score, object_class, names, importance, extent_m, weather_cell,
          source_ref, updated_at, retired_at
        )
        SELECT x.id, x.name, 'hike_destination', x.lat, x.lng, x.elevation_top_m, x.wikipedia_title,
               x.wikidata_id, x.poi_kind, x.source_layer, x.quality_score, x.object_class, x.names,
               x.importance, x.extent_m, x.weather_cell, x.source_ref, now(), NULL
        FROM jsonb_to_recordset(${tx.json(batch as never)}) AS x(
          id uuid, name text, lat numeric, lng numeric, elevation_top_m int, wikipedia_title text,
          wikidata_id text, poi_kind text, source_layer text, quality_score smallint, object_class text,
          names jsonb, importance smallint, extent_m int, weather_cell text, source_ref jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, type = 'hike_destination', lat = EXCLUDED.lat, lng = EXCLUDED.lng,
          elevation_top_m = EXCLUDED.elevation_top_m,
          wikipedia_title = EXCLUDED.wikipedia_title, wikidata_id = EXCLUDED.wikidata_id,
          poi_kind = EXCLUDED.poi_kind, source_layer = EXCLUDED.source_layer,
          quality_score = EXCLUDED.quality_score, object_class = EXCLUDED.object_class,
          names = EXCLUDED.names, importance = EXCLUDED.importance, extent_m = EXCLUDED.extent_m,
          weather_cell = EXCLUDED.weather_cell, source_ref = EXCLUDED.source_ref,
          updated_at = now(), retired_at = NULL
      `;
    }

    // Zusammengeführte Altziele: Favoriten zum verbleibenden Ziel umhängen.
    for (const { loser, winner } of absorbed) {
      await tx`
        INSERT INTO favorites (user_id, destination_id, created_at)
        SELECT user_id, ${winner}, created_at FROM favorites WHERE destination_id = ${loser}
        ON CONFLICT DO NOTHING
      `;
      await tx`DELETE FROM favorites WHERE destination_id = ${loser}`;
    }

    for (const batch of chunks(sourceRows, 5000)) {
      await tx`
        INSERT INTO destination_sources (source, source_ref, destination_id, last_seen_at)
        SELECT x.source, x.source_ref, x.destination_id, now()
        FROM jsonb_to_recordset(${tx.json(batch as never)}) AS x(source text, source_ref text, destination_id uuid)
        ON CONFLICT (source, source_ref) DO UPDATE SET destination_id = EXCLUDED.destination_id, last_seen_at = now()
      `;
    }

    // Ziele, die in den Quellen nicht mehr vorkommen, werden stillgelegt – nicht gelöscht.
    await tx`
      UPDATE destinations SET retired_at = now()
      WHERE type IN ('hike_destination', 'hike_route') AND retired_at IS NULL AND updated_at < ${startedAt}
    `;
    await tx`DELETE FROM destination_sources WHERE source IN ('swissnames3d', 'osm') AND last_seen_at < ${startedAt}
      AND destination_id IN (SELECT id FROM destinations WHERE type IN ('hike_destination', 'hike_route'))`;

    await tx`
      UPDATE destinations d SET canton = c.code
      FROM cantons c
      WHERE d.retired_at IS NULL AND ST_Contains(c.geom, d.geom) AND d.canton IS DISTINCT FROM c.code
    `;
    // Grenzgipfel liegen exakt auf der Kantonsgrenze: nächster Kanton innerhalb ~300 m.
    await tx`
      UPDATE destinations d SET canton = (
        SELECT c.code FROM cantons c WHERE ST_DWithin(c.geom, d.geom, 0.004) ORDER BY ST_Distance(c.geom, d.geom) LIMIT 1
      )
      WHERE d.retired_at IS NULL AND d.canton IS NULL
    `;
    // Randbereich der Quellen (Liechtenstein, Grenzregionen der Nachbarländer): ohne Kanton kein Schweizer Ziel.
    // Stillgelegt statt gelöscht, damit Favoriten und IDs bei einer Grenzkorrektur erhalten bleiben.
    await tx`
      UPDATE destinations SET retired_at = now()
      WHERE type IN ('hike_destination', 'hike_route') AND retired_at IS NULL AND canton IS NULL
    `;
    await tx`
      UPDATE destinations d SET slf_region_id = r.id
      FROM avalanche_regions r
      WHERE d.retired_at IS NULL AND ST_Contains(r.geom, d.geom) AND d.slf_region_id IS DISTINCT FROM r.id
    `;
  });

  const [{ retired, outsideSwitzerland }] = await sql<{ retired: number; outsideSwitzerland: number }[]>`
    SELECT count(*)::int AS retired,
           count(*) FILTER (WHERE canton IS NULL)::int AS "outsideSwitzerland"
    FROM destinations
    WHERE type IN ('hike_destination', 'hike_route') AND retired_at >= ${startedAt}
  `;
  const byKind: Record<string, number> = {};
  for (const c of merged) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;

  return {
    swissnames3d: names.stats,
    osm: osm.stats,
    candidates: names.candidates.length + osm.candidates.length,
    duplicatesMerged: duplicates,
    destinations: merged.length - outsideSwitzerland,
    byKind,
    fromBothSources: merged.filter((c) => new Set(c.refs.map((r) => r.source)).size > 1).length,
    withoutElevation: merged.filter((c) => c.elevation === null).length,
    inserted,
    updated,
    absorbedOldRows: absorbed.length,
    retired,
    outsideSwitzerland,
    cantons,
  };
}
