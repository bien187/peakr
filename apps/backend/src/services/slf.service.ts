import type { Feature, Geometry } from 'geojson';
import { fetchJson } from '../lib/http';

// SLF-API (kostenlos, kein Schlüssel, CC BY 4.0). Sicherheitskritisch — im Frontend
// immer auf das offizielle Bulletin (whiterisk.ch) verweisen.
const SLF_BULLETIN_URL = 'https://aws.slf.ch/api/bulletin/caaml/de/json';
const SLF_REGIONS_URL = 'https://aws.slf.ch/api/warningregion/warnregionDefinition/current/geojson';

export interface WarningRegion {
  /** sector_id, z.B. "1111". */
  id: string;
  name: string | null;
  geometry: Geometry;
}

interface RegionFeatureProps {
  sector_id?: string | number;
  sector_name?: string;
}

/** Lädt die offiziellen SLF-Warnregionen als GeoJSON-Features. */
export async function fetchWarningRegions(): Promise<WarningRegion[]> {
  const fc = await fetchJson<{ features: Feature<Geometry, RegionFeatureProps>[] }>(SLF_REGIONS_URL, {
    timeoutMs: 20000,
    retries: 2,
  });
  return (fc.features ?? [])
    .map((f) => ({
      id: f.properties?.sector_id != null ? String(f.properties.sector_id) : '',
      name: f.properties?.sector_name ?? null,
      geometry: f.geometry,
    }))
    .filter((r): r is WarningRegion => Boolean(r.id) && Boolean(r.geometry));
}

export interface CaamlBulletin {
  validTime?: { startTime?: string; endTime?: string };
  regions?: { regionID?: string }[];
  dangerRatings?: { mainValue?: string | number }[];
}

/** CAAML v6 nennt die Gefahrenstufe als Wort; ältere Antworten als Zahl. */
const DANGER_LEVELS: Record<string, number> = {
  low: 1,
  moderate: 2,
  considerable: 3,
  high: 4,
  very_high: 5,
};

export function parseDangerLevel(value: string | number | undefined): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
  if (typeof value !== 'string') return null;
  const named = DANGER_LEVELS[value.trim().toLowerCase()];
  if (named) return named;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/**
 * Normalisiert eine Bulletin-Region-ID (z.B. "CH-1111") auf die sector_id ("1111"),
 * damit sie zur warnregionDefinition passt.
 */
export function normalizeRegionId(raw: string | undefined): string {
  return String(raw ?? '')
    .replace(/^CH-?/i, '')
    .trim();
}

export interface AvalancheInfo {
  level: number;
  validUntil: string | null;
}

/** Reine Auswertung der Bulletins: sector_id → höchste Gefahrenstufe des Tages. */
export function parseBulletins(bulletins: CaamlBulletin[]): Map<string, AvalancheInfo> {
  const levels = new Map<string, AvalancheInfo>();
  for (const bulletin of bulletins) {
    const ratings = (bulletin.dangerRatings ?? [])
      .map((r) => parseDangerLevel(r.mainValue))
      .filter((n): n is number => n !== null);
    if (ratings.length === 0) continue;
    const max = Math.max(...ratings);
    const validUntil = bulletin.validTime?.endTime ?? null;
    for (const region of bulletin.regions ?? []) {
      const id = normalizeRegionId(region.regionID);
      if (!id) continue;
      const prev = levels.get(id);
      if (!prev || max > prev.level) levels.set(id, { level: max, validUntil });
    }
  }
  return levels;
}

/**
 * Liefert sector_id → Gefahrenstufe (1–5). Ausserhalb der Saison erscheint kein
 * Bulletin; dann ist die Map leer (kein Fehler).
 */
export async function fetchAvalancheLevels(): Promise<Map<string, AvalancheInfo>> {
  const data = await fetchJson<{ bulletins?: CaamlBulletin[] }>(SLF_BULLETIN_URL, {
    timeoutMs: 15000,
    retries: 2,
  });
  return parseBulletins(data.bulletins ?? []);
}
