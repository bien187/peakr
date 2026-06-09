/**
 * swisstopo / GeoAdmin Datendienste
 *
 * 1. swissNAMES3D WFS  — Gipfel, Seen, Hütten, Aussichtspunkte als POI-Backbone
 * 2. MapServer query   — prüft Nähe zu swisstopo-Wanderwegen (ch.swisstopo.swisstlm3d-wanderwege)
 */

import { fetchJson } from '../lib/http';

const GEO_WFS = 'https://wfs.geo.admin.ch/';
const GEO_REST = 'https://api3.geo.admin.ch/rest/services/api/MapServer';

// OBJEKTART-Werte aus swissNAMES3D (de.wikipedia.org/wiki/SwissNAMES3D)
export const NAMES3D_PEAKS    = ['Berg', 'Gipfel', 'Bergkuppe', 'Felskuppe'];
export const NAMES3D_LAKES    = ['See', 'Bergsee', 'Weiher', 'Teich'];
export const NAMES3D_HUTS     = ['Hütte', 'Berghaus', 'Alphütte', 'Unterkunft'];
export const NAMES3D_VIEWS    = ['Aussichtspunkt'];

export type Names3dKind = 'peak' | 'lake' | 'hut' | 'viewpoint';

export interface Names3dFeature {
  name: string;
  objektart: string;
  kind: Names3dKind;
  elevation: number | null;
  lat: number;
  lng: number;
  wikidata: string | null;
  wikipedia: string | null;
}

interface WfsResponse {
  totalFeatures?: number;
  numberMatched?: number;
  features: Array<{
    geometry?: { type: string; coordinates: number[] | number[][] | number[][][] };
    properties: Record<string, unknown>;
  }>;
}

function parseElevation(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  return null;
}

function objToKind(o: string): Names3dKind | null {
  if (NAMES3D_PEAKS.includes(o)) return 'peak';
  if (NAMES3D_LAKES.includes(o)) return 'lake';
  if (NAMES3D_HUTS.includes(o)) return 'hut';
  if (NAMES3D_VIEWS.includes(o)) return 'viewpoint';
  return null;
}

/**
 * Lädt eine Seite (5000 Features) aus dem swissNAMES3D WFS.
 * Filtert serverseitig nach OBJEKTART via CQL_FILTER.
 * Gibt [] zurück wenn der Layer nicht antwortet oder leer ist.
 */
async function fetchNames3dPage(
  kinds: string[],
  startIndex: number,
): Promise<{ features: Names3dFeature[]; total: number }> {
  const filter = `OBJEKTART IN (${kinds.map((k) => `'${k}'`).join(',')})`;
  const url =
    `${GEO_WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=ch.swisstopo.swissnames3d` +
    `&COUNT=5000&STARTINDEX=${startIndex}` +
    `&outputFormat=application/json&SRSNAME=EPSG:4326` +
    `&CQL_FILTER=${encodeURIComponent(filter)}`;

  const res = await fetchJson<WfsResponse>(url, { timeoutMs: 30000, retries: 1 });
  const total = res.totalFeatures ?? res.numberMatched ?? 0;

  const features: Names3dFeature[] = [];
  for (const f of res.features ?? []) {
    const p = f.properties;
    const name = (p.name ?? p.NAME ?? p.bezeichnung ?? '') as string;
    if (!name) continue;

    // Koordinaten: GeoJSON Point [lng, lat] oder [lng, lat, elev]
    let lat: number | null = null;
    let lng: number | null = null;
    if (f.geometry?.type === 'Point') {
      const c = f.geometry.coordinates as number[];
      lng = c[0] ?? null;
      lat = c[1] ?? null;
    }
    if (lat == null || lng == null) continue;

    const objektart = (p.objektart ?? p.OBJEKTART ?? '') as string;
    const kind = objToKind(objektart);
    if (!kind) continue;

    // Höhe: aus Geometrie-Z oder Attribut 'hoehe'
    const elev =
      parseElevation(
        (f.geometry?.coordinates as number[])?.[2],
      ) ??
      parseElevation(p.hoehe ?? p.HOEHE ?? p.elevation);

    features.push({
      name: String(name).trim(),
      objektart,
      kind,
      elevation: elev,
      lat,
      lng,
      wikidata: (p.wikidata_id ?? p.wikidata ?? null) as string | null,
      wikipedia: (p.wikipedia ?? null) as string | null,
    });
  }

  return { features, total };
}

/**
 * Lädt alle passenden Features aus swissNAMES3D (automatische Pagination).
 * Max. 50 Seiten (250.000 Features) als Sicherheitsdeckel.
 */
export async function fetchAllNames3d(kinds: string[]): Promise<Names3dFeature[]> {
  const all: Names3dFeature[] = [];
  let startIndex = 0;
  const pageSize = 5000;
  const maxPages = 50;

  for (let page = 0; page < maxPages; page++) {
    const { features, total } = await fetchNames3dPage(kinds, startIndex);
    all.push(...features);
    startIndex += pageSize;
    if (startIndex >= total || features.length < pageSize) break;
    await new Promise((r) => setTimeout(r, 300)); // sanftes Rate-Limiting
  }

  return all;
}

/**
 * Prüft über den GeoAdmin MapServer, ob ein Punkt innerhalb `radiusM` Meter
 * eines swisstopo-Wanderwegs liegt.
 * → count > 0 = Wanderweg in der Nähe.
 * Fallback (API nicht erreichbar): true (Punkt wird nicht gefiltert).
 */
export async function isNearSwissHikingRoute(
  lat: number,
  lng: number,
  radiusM = 800,
): Promise<boolean> {
  // Grad-Toleranz: 1° Breitengrad ≈ 111 km, 1° Längengrad ≈ 74 km in CH
  const dLat = radiusM / 111000;
  const dLng = radiusM / 74000;
  const bbox = `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`;

  const url =
    `${GEO_REST}/ch.swisstopo.swisstlm3d-wanderwege/query` +
    `?geometryType=esriGeometryEnvelope&geometry=${encodeURIComponent(bbox)}` +
    `&spatialRel=esriSpatialRelIntersects&where=1%3D1` +
    `&returnCountOnly=true&f=json&sr=4326`;

  try {
    const res = await fetchJson<{ count?: number; error?: unknown }>(url, {
      timeoutMs: 8000,
      retries: 0,
    });
    if (res.error) return true; // Fehler → nicht filtern
    return (res.count ?? 0) > 0;
  } catch {
    return true; // API nicht erreichbar → Punkt behalten
  }
}

/**
 * Overpass-QL für sac_scale Wanderwege in einem Bounding-Box-Quadranten der Schweiz.
 * Die Antwort enthält way-Geometrien (Knotenkoordinaten).
 */
export function hikingWaysOverpassQL(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): string {
  const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;
  return (
    `[out:json][timeout:240];` +
    `(` +
    `  way[sac_scale](${bbox});` +
    `  way["highway"="path"]["designation"="hiking"](${bbox});` +
    `);` +
    `out geom qt;`
  );
}
