import type { Feature, Geometry } from 'geojson';
import { fetchJson } from '../lib/http';

// SLF AWS API (kostenlos, kein Key). Sicherheitskritisch — im Frontend immer auf
// das offizielle Bulletin (whiterisk.ch) verlinken.
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
  warnregion_def_id?: number;
}

/** Lädt die offiziellen SLF-Warnregionen als GeoJSON-Features. */
export async function fetchWarningRegions(): Promise<WarningRegion[]> {
  const fc = await fetchJson<{ features: Feature<Geometry, RegionFeatureProps>[] }>(
    SLF_REGIONS_URL,
    { timeoutMs: 15000, retries: 1 },
  );
  return (fc.features ?? [])
    .map((f) => ({
      id: f.properties?.sector_id != null ? String(f.properties.sector_id) : '',
      name: f.properties?.sector_name ?? null,
      geometry: f.geometry,
    }))
    .filter((r): r is WarningRegion => Boolean(r.id) && Boolean(r.geometry));
}

interface CaamlBulletin {
  regions?: { regionID?: string }[];
  dangerRatings?: { mainValue?: string | number }[];
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

/**
 * Liefert eine Map sector_id → höchste Gefahrenstufe (1–5).
 * Im Sommer ist das Bulletin leer → leere Map (kein Fehler).
 */
export async function fetchAvalancheLevels(): Promise<Map<string, number>> {
  const data = await fetchJson<{ bulletins?: CaamlBulletin[] }>(SLF_BULLETIN_URL, {
    timeoutMs: 12000,
    retries: 1,
  });
  const levels = new Map<string, number>();
  for (const bulletin of data.bulletins ?? []) {
    const ratings = (bulletin.dangerRatings ?? [])
      .map((r) => Number(r.mainValue))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
    if (ratings.length === 0) continue;
    const max = Math.max(...ratings);
    for (const region of bulletin.regions ?? []) {
      const id = normalizeRegionId(region.regionID);
      if (!id) continue;
      levels.set(id, Math.max(max, levels.get(id) ?? 0));
    }
  }
  return levels;
}
