import type { GeocodeResult } from '@ch-alpineroute/shared';
import { fetchJson } from '../lib/http';

const SEARCH_URL = 'https://api3.geo.admin.ch/rest/services/api/SearchServer';
const HEIGHT_URL = 'https://api3.geo.admin.ch/rest/services/height';

interface SearchAttrs {
  label?: string;
  detail?: string;
  lat?: number;
  lon?: number;
  origin?: string;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim();
}

/** Kanton-Kürzel aus einem Label wie "Zermatt (VS)" extrahieren. */
export function extractCanton(label: string): string | null {
  const m = label.match(/\(([A-Z]{2})\)\s*$/);
  return m ? m[1] : null;
}

/** Ortssuche/Autocomplete über swisstopo GeoAdmin SearchServer. */
export async function geocode(query: string, limit = 8): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({
    searchText: query,
    type: 'locations',
    sr: '4326',
    limit: String(limit),
  });
  const data = await fetchJson<{ results?: { attrs: SearchAttrs }[] }>(
    `${SEARCH_URL}?${params.toString()}`,
    { timeoutMs: 8000, retries: 1 },
  );
  return (data.results ?? [])
    .map(({ attrs }) => {
      const label = stripHtml(attrs.label ?? '');
      return {
        label,
        lat: Number(attrs.lat),
        lng: Number(attrs.lon),
        canton: extractCanton(label),
        detail: attrs.detail ?? null,
      } satisfies GeocodeResult;
    })
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

/**
 * Höhe (m ü. M.) an einem Punkt über das swisstopo-Höhenmodell.
 * Best effort — gibt null zurück, wenn nicht ermittelbar.
 */
export async function fetchElevation(lat: number, lng: number): Promise<number | null> {
  const params = new URLSearchParams({
    easting: String(lng),
    northing: String(lat),
    sr: '4326',
  });
  try {
    const data = await fetchJson<{ height?: string | number }>(
      `${HEIGHT_URL}?${params.toString()}`,
      { timeoutMs: 8000, retries: 1 },
    );
    const h = Number(data.height);
    return Number.isFinite(h) ? Math.round(h) : null;
  } catch {
    return null;
  }
}
