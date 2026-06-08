import type { LatLng } from '@ch-alpineroute/shared';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import { env } from '../config/env';
import { fetchJson } from '../lib/http';

const ORS_BASE = 'https://api.openrouteservice.org';
// Pro Matrix-Request begrenzen, damit auch viele Kandidaten zuverlässig durchlaufen.
const MATRIX_CHUNK = 50;

export class OrsUnavailableError extends Error {
  constructor() {
    super('ORS_API_KEY fehlt — Fahrzeiten nicht verfügbar.');
    this.name = 'OrsUnavailableError';
  }
}

export function isOrsConfigured(): boolean {
  return env.ORS_API_KEY.trim().length > 0;
}

async function matrixChunk(origin: LatLng, destinations: LatLng[]): Promise<(number | null)[]> {
  const locations = [[origin.lng, origin.lat], ...destinations.map((d) => [d.lng, d.lat])];
  const body = {
    locations,
    sources: [0],
    destinations: destinations.map((_, i) => i + 1),
    metrics: ['duration'],
  };

  const data = await fetchJson<{ durations?: (number | null)[][] }>(
    `${ORS_BASE}/v2/matrix/driving-car`,
    {
      method: 'POST',
      headers: { Authorization: env.ORS_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 15000,
      retries: 1,
    },
  );

  const row = data.durations?.[0] ?? [];
  return destinations.map((_, i) => {
    const seconds = row[i];
    return typeof seconds === 'number' && Number.isFinite(seconds)
      ? Math.round((seconds / 60) * 10) / 10
      : null;
  });
}

/**
 * Echte Fahrzeiten via ORS-Matrix-Endpoint, in Minuten (null = unerreichbar),
 * in derselben Reihenfolge wie `destinations`. Große Kandidatenlisten werden in
 * Blöcke à {@link MATRIX_CHUNK} aufgeteilt (mehrere Requests).
 */
export async function drivingMatrixMinutes(
  origin: LatLng,
  destinations: LatLng[],
): Promise<(number | null)[]> {
  if (!isOrsConfigured()) throw new OrsUnavailableError();
  if (destinations.length === 0) return [];

  const out: (number | null)[] = [];
  for (let i = 0; i < destinations.length; i += MATRIX_CHUNK) {
    const chunk = destinations.slice(i, i + MATRIX_CHUNK);
    out.push(...(await matrixChunk(origin, chunk)));
  }
  return out;
}

/**
 * Optionales Isochrone-Polygon (Deko-Overlay). Gratis bis max. 60 Min.
 * Gibt null zurück, wenn ORS nicht konfiguriert ist.
 */
export async function isochrone(origin: LatLng, minutes: number): Promise<Feature<Polygon> | null> {
  if (!isOrsConfigured()) return null;
  const range = Math.min(Math.max(minutes, 1), 60) * 60;
  const data = await fetchJson<FeatureCollection<Polygon>>(
    `${ORS_BASE}/v2/isochrones/driving-car`,
    {
      method: 'POST',
      headers: { Authorization: env.ORS_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        locations: [[origin.lng, origin.lat]],
        range: [range],
        range_type: 'time',
      }),
      timeoutMs: 12000,
      retries: 1,
    },
  );
  return data.features?.[0] ?? null;
}
