/**
 * Wander-Profil: Welche OSM-Wege sind zu Fuss begehbar und wie schwierig?
 *
 * SAC-Skala: Der OSM-Tag `sac_scale` wird direkt übernommen. Fehlt er, gilt
 *  - für gebaute Wege (Strasse, Fahrweg, Fussweg, Treppe): T1,
 *  - für `highway=path`: unbekannt – wird später durch die amtliche
 *    Wanderweg-Kategorie von swisstopo ergänzt, sonst bleibt es «unbekannt».
 * Es wird nie eine Schwierigkeit geraten.
 */

export interface HikeAttrs {
  /** 0 = unbekannt, 1–6 = T1–T6 (aus OSM `sac_scale` oder Wegtyp). */
  sac: number;
  /** Zeitfaktor für die Routenwahl (Komfort/Sicherheit), nicht für die ausgewiesene Gehzeit. */
  costFactor: number;
  /** true = unbefestigter Pfad, dessen Schwierigkeit ohne Angabe offen ist. */
  isPath: boolean;
}

const SAC_SCALE: Record<string, number> = {
  hiking: 1,
  mountain_hiking: 2,
  demanding_mountain_hiking: 3,
  alpine_hiking: 4,
  demanding_alpine_hiking: 5,
  difficult_alpine_hiking: 6,
};

export function parseSacScale(raw: string | undefined): number {
  if (!raw) return 0;
  let max = 0;
  for (const part of raw.split(';')) max = Math.max(max, SAC_SCALE[part.trim()] ?? 0);
  return max;
}

/** Zeitfaktor je Schwierigkeit: anspruchsvolle Passagen werden nur gewählt, wenn sie deutlich kürzer sind. */
export const SAC_COST = [1.25, 1, 1, 1.1, 1.6, 2.4, 3.5];

interface WayClass {
  factor: number;
  path: boolean;
}

const WALKABLE: Record<string, WayClass> = {
  path: { factor: 1, path: true },
  footway: { factor: 1, path: false },
  track: { factor: 1, path: false },
  steps: { factor: 1.1, path: false },
  pedestrian: { factor: 1, path: false },
  bridleway: { factor: 1, path: true },
  cycleway: { factor: 1.1, path: false },
  living_street: { factor: 1.05, path: false },
  residential: { factor: 1.1, path: false },
  service: { factor: 1.1, path: false },
  unclassified: { factor: 1.15, path: false },
  road: { factor: 1.15, path: false },
  tertiary: { factor: 1.35, path: false },
  tertiary_link: { factor: 1.35, path: false },
  secondary: { factor: 1.7, path: false },
  secondary_link: { factor: 1.7, path: false },
  primary: { factor: 2.2, path: false },
  primary_link: { factor: 2.2, path: false },
};

const FOOT_ALLOW = new Set(['yes', 'designated', 'permissive', 'official', 'destination', 'public']);
const FOOT_DENY = new Set(['no', 'private', 'military', 'customers', 'permit', 'delivery', 'agricultural', 'forestry']);

export function hikeProfile(tags: Record<string, string>): HikeAttrs | null {
  const highway = tags.highway;
  const cls = highway ? WALKABLE[highway] : undefined;
  if (!cls) return null;
  if (tags.area === 'yes') return null;

  const foot = tags.foot;
  if (foot !== undefined) {
    if (FOOT_DENY.has(foot)) return null;
  } else if (tags.access !== undefined && FOOT_DENY.has(tags.access)) {
    return null;
  }
  // Klettersteige und Kletterrouten sind keine Wanderwege.
  if (tags.via_ferrata_scale !== undefined || tags.climbing !== undefined || tags.sport === 'climbing') return null;
  // Strassentunnel ohne ausdrückliche Freigabe für Fussgänger.
  if (tags.tunnel === 'yes' && !cls.path && highway !== 'footway' && highway !== 'steps' && highway !== 'track') {
    if (!foot || !FOOT_ALLOW.has(foot)) return null;
  }
  if (tags.indoor === 'yes') return null;

  const tagged = parseSacScale(tags.sac_scale);
  const sac = tagged > 0 ? tagged : cls.path ? 0 : 1;

  let factor = cls.factor * SAC_COST[sac];
  switch (tags.trail_visibility) {
    case 'bad':
      factor *= 1.25;
      break;
    case 'horrible':
      factor *= 1.5;
      break;
    case 'no':
      factor *= 2;
      break;
    default:
  }
  if (tags.informal === 'yes') factor *= 1.1;

  return { sac, costFactor: factor, isPath: cls.path };
}

/**
 * Gehzeit in Minuten nach DIN 33466: Horizontal 4 km/h, Aufstieg 300 Hm/h,
 * Abstieg 500 Hm/h; der kleinere der beiden Werte (horizontal, vertikal) zählt halb.
 */
export function hikingMinutes(distanceM: number, ascentM: number, descentM: number): number {
  const horizontal = distanceM / 1000 / 4;
  const vertical = ascentM / 300 + descentM / 500;
  return (Math.max(horizontal, vertical) + Math.min(horizontal, vertical) / 2) * 60;
}
