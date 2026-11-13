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

type ElevationBound = number | string | null | undefined;

export interface CaamlBulletin {
  validTime?: { startTime?: string; endTime?: string };
  regions?: { regionID?: string }[];
  dangerRatings?: { mainValue?: string | number; elevation?: { lowerBound?: ElevationBound; upperBound?: ElevationBound }; aspects?: string[] }[];
  /** Im Schweizer Bulletin tragen die Lawinenprobleme Höhenlage und Expositionen der Kernzone. */
  avalancheProblems?: {
    problemType?: string;
    dangerRatingValue?: string | number;
    elevation?: { lowerBound?: ElevationBound; upperBound?: ElevationBound };
    aspects?: string[];
  }[];
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

/** Stufe in einem Höhenband (Kernzone) samt Expositionen. */
export interface AvalancheRating {
  level: number;
  /** Untergrenze in m; null = alle Höhen. */
  lowerM: number | null;
  upperM: number | null;
  aspects: string[];
}

export interface AvalancheInfo {
  /** Höchste Stufe der Region (wie bisher). */
  level: number;
  validUntil: string | null;
  /** Stufen je Höhenband; ausserhalb der Kernzone gilt in der Regel eine Stufe tiefer. */
  ratings: AvalancheRating[];
}

/**
 * Höhengrenze in Metern. «treeline» (Waldgrenze) ist nicht in Metern angegeben:
 * als Untergrenze vorsichtig 1800 m, als Obergrenze 2200 m.
 */
export function parseBound(v: ElevationBound, kind: 'lower' | 'upper'): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    if (/^\d+$/.test(v.trim())) return Number(v);
    if (v.trim().toLowerCase() === 'treeline') return kind === 'lower' ? 1800 : 2200;
  }
  return null;
}

const ASPECTS = new Set(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);

/** Höhenbänder eines Bulletins aus Gefahrenstufen und Lawinenproblemen. */
export function bulletinRatings(bulletin: CaamlBulletin, mainLevel: number): AvalancheRating[] {
  const bands: AvalancheRating[] = [];
  const add = (level: number | null, el: { lowerBound?: ElevationBound; upperBound?: ElevationBound } | undefined, aspects: string[] | undefined) => {
    if (level === null) return;
    bands.push({
      level,
      lowerM: parseBound(el?.lowerBound, 'lower'),
      upperM: parseBound(el?.upperBound, 'upper'),
      aspects: (aspects ?? []).filter((a) => ASPECTS.has(a)),
    });
  };
  for (const r of bulletin.dangerRatings ?? []) {
    if (r.elevation) add(parseDangerLevel(r.mainValue), r.elevation, r.aspects);
  }
  for (const p of bulletin.avalancheProblems ?? []) {
    add(parseDangerLevel(p.dangerRatingValue) ?? mainLevel, p.elevation, p.aspects);
  }
  const unbounded = bands.some((b) => b.lowerM === null && b.upperM === null);
  if (bands.length === 0 || unbounded) {
    // Ohne Höhenangabe gilt die Hauptstufe überall.
    if (!unbounded) bands.push({ level: mainLevel, lowerM: null, upperM: null, aspects: [] });
  } else {
    // Ausserhalb der Kernzone ist die Gefahr laut Bulletin in der Regel eine Stufe tiefer.
    bands.push({ level: Math.max(1, mainLevel - 1), lowerM: null, upperM: null, aspects: [] });
  }
  return bands;
}

/** Reine Auswertung der Bulletins: sector_id → höchste Gefahrenstufe des Tages und Höhenbänder. */
export function parseBulletins(bulletins: CaamlBulletin[]): Map<string, AvalancheInfo> {
  const levels = new Map<string, AvalancheInfo>();
  for (const bulletin of bulletins) {
    const main = (bulletin.dangerRatings ?? [])
      .map((r) => parseDangerLevel(r.mainValue))
      .filter((n): n is number => n !== null);
    if (main.length === 0) continue;
    const max = Math.max(...main);
    const validUntil = bulletin.validTime?.endTime ?? null;
    const ratings = bulletinRatings(bulletin, max);
    for (const region of bulletin.regions ?? []) {
      const id = normalizeRegionId(region.regionID);
      if (!id) continue;
      const prev = levels.get(id);
      if (!prev) levels.set(id, { level: max, validUntil, ratings: [...ratings] });
      else {
        // Mehrere Bulletins je Region (z. B. vor-/nachmittags): höchste Stufe, alle Bänder.
        levels.set(id, { level: Math.max(prev.level, max), validUntil: prev.validUntil ?? validUntil, ratings: [...prev.ratings, ...ratings] });
      }
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
