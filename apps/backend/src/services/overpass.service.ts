import { fetchJson } from '../lib/http';

// Endpoint konfigurierbar (Mirror bei Überlastung): OVERPASS_URL in .env setzen.
const OVERPASS_URL = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Führt eine Overpass-QL-Abfrage aus. Overpass ist rate-limited und kann langsam
 * sein → großzügiger Timeout, ein Retry mit Verzögerung. Ergebnisse cachen!
 */
export async function overpassQuery(ql: string): Promise<OverpassElement[]> {
  const data = await fetchJson<{ elements?: OverpassElement[] }>(OVERPASS_URL, {
    method: 'POST',
    // Overpass lehnt den Default-UA "node" mit 406 ab → aussagekräftigen User-Agent senden.
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: '*/*',
      'User-Agent': 'CH-AlpineRoute/0.1 (privates Tool)',
    },
    body: `data=${encodeURIComponent(ql)}`,
    timeoutMs: 60000,
    retries: 1,
    retryDelayMs: 3000,
  });
  return data.elements ?? [];
}

/** Liefert die Koordinate eines Elements (Node direkt, Way/Relation via center). */
export function elementLatLng(el: OverpassElement): { lat: number; lng: number } | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (typeof lat === 'number' && typeof lon === 'number') {
    return { lat, lng: lon };
  }
  return null;
}
