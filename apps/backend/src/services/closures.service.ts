/**
 * Sperrungen und Umleitungen auf Wanderwegen (geo.admin.ch, Ebene
 * «Sperrungen Wanderwege», ch.astra.wanderland-sperrungen_umleitungen).
 * Herausgeber: ASTRA mit Schweizer Wanderwege und den kantonalen Fachstellen.
 * Bundesgeodaten, frei nutzbar mit Quellenangabe; Abruf über die offizielle
 * Identify-Schnittstelle der GeoAdmin-API, seitenweise.
 */
import type { Geometry } from 'geojson';
import { fetchJson } from '../lib/http';

const IDENTIFY = 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify';
export const CLOSURES_LAYER = 'ch.astra.wanderland-sperrungen_umleitungen';
const PAGE = 200;
/** Sicherheitsgrenze: 30 Seiten = 6000 Meldungen (heute ~1100). */
const MAX_PAGES = 30;
/** Ausdehnung der Schweiz in WGS84 (mit Rand). */
const CH_BOX = '5.9,45.8,10.5,47.9';

export interface TrailClosure {
  id: string;
  kind: 'closed_way' | 'detour';
  title: string | null;
  reason: string | null;
  duration: string | null;
  description: string | null;
  url: string | null;
  provider: string | null;
  validated: boolean;
  geometry: Geometry;
}

interface IdentifyFeature {
  id?: string | number;
  featureId?: string | number;
  geometry?: Geometry | null;
  properties?: Record<string, unknown>;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Eine Meldung der Identify-Antwort; unbekannte Arten und Meldungen ohne Linie fallen weg. */
export function parseClosureFeature(f: IdentifyFeature): TrailClosure | null {
  const p = f.properties ?? {};
  const kind = p.sperrungen_type;
  if (kind !== 'closed_way' && kind !== 'detour') return null;
  const g = f.geometry;
  if (!g || (g.type !== 'LineString' && g.type !== 'MultiLineString')) return null;
  const id = f.featureId ?? f.id;
  if (id === undefined || id === null) return null;
  const url = text(p.url1_link_de);
  return {
    id: String(id),
    kind,
    title: text(p.title_de),
    reason: text(p.reason_de),
    duration: text(p.duration_de),
    description: text(p.abstract_de),
    url: url && /^https?:\/\//.test(url) ? url : null,
    provider: text(p.content_provider_de),
    validated: p.state_validate_de === 'validiert',
    geometry: g,
  };
}

export async function fetchTrailClosures(): Promise<TrailClosure[]> {
  const out: TrailClosure[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      geometryType: 'esriGeometryEnvelope',
      geometry: CH_BOX,
      imageDisplay: '1000,800,96',
      mapExtent: CH_BOX,
      tolerance: '0',
      layers: `all:${CLOSURES_LAYER}`,
      returnGeometry: 'true',
      geometryFormat: 'geojson',
      sr: '4326',
      lang: 'de',
      limit: String(PAGE),
      offset: String(page * PAGE),
    });
    const data = await fetchJson<{ results?: IdentifyFeature[] }>(`${IDENTIFY}?${params.toString()}`, { timeoutMs: 30_000, retries: 2 });
    const results = data.results ?? [];
    for (const f of results) {
      const c = parseClosureFeature(f);
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }
    if (results.length < PAGE) return out;
  }
  throw new Error(`Mehr als ${MAX_PAGES * PAGE} Sperrungsmeldungen – Abruf unvollständig, nichts übernommen.`);
}
