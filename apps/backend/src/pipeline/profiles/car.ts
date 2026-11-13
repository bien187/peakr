/**
 * Auto-Profil: Welche OSM-Wege sind mit dem Privatauto befahrbar und wie schnell?
 *
 * Die Geschwindigkeiten sind freie Fahrt ohne Stau. Sie wurden gegen
 * OpenRouteService kalibriert (siehe docs/DATENQUALITAET.md); Kurven bremsen
 * zusätzlich über den Kurvenradius (siehe roadGraphBuilder).
 */

export interface CarAttrs {
  forward: boolean;
  backward: boolean;
  /** Geschwindigkeit in km/h vor der Kurvenkorrektur. */
  speedKmh: number;
  /** Feste Dauer in Sekunden (Fähre, Autoverlad) – ersetzt die Geschwindigkeit. */
  fixedSeconds: number | null;
  /** Autobahn/Autostrasse: keine Kurvenkorrektur, kein Wanderzugang. */
  motorway: boolean;
  /** Öffentliche Strasse, an der ein Ausgangspunkt liegen darf. */
  publicRoad: boolean;
}

interface ClassSpeed {
  /** Ohne maxspeed-Angabe. */
  fallback: number;
  /** Anteil der signalisierten Höchstgeschwindigkeit, der im Mittel gefahren wird. */
  factor: number;
  publicRoad: boolean;
}

const CLASSES: Record<string, ClassSpeed> = {
  motorway: { fallback: 108, factor: 0.9, publicRoad: false },
  motorway_link: { fallback: 55, factor: 0.75, publicRoad: false },
  trunk: { fallback: 88, factor: 0.88, publicRoad: false },
  trunk_link: { fallback: 50, factor: 0.75, publicRoad: false },
  primary: { fallback: 60, factor: 0.82, publicRoad: true },
  primary_link: { fallback: 45, factor: 0.75, publicRoad: true },
  secondary: { fallback: 53, factor: 0.79, publicRoad: true },
  secondary_link: { fallback: 40, factor: 0.75, publicRoad: true },
  tertiary: { fallback: 45, factor: 0.76, publicRoad: true },
  tertiary_link: { fallback: 35, factor: 0.75, publicRoad: true },
  unclassified: { fallback: 35, factor: 0.68, publicRoad: true },
  residential: { fallback: 24, factor: 0.58, publicRoad: true },
  living_street: { fallback: 10, factor: 0.5, publicRoad: true },
  service: { fallback: 14, factor: 0.5, publicRoad: true },
  road: { fallback: 25, factor: 0.6, publicRoad: true },
  track: { fallback: 14, factor: 0.5, publicRoad: true },
};

const ALLOW = new Set(['yes', 'permissive', 'designated', 'destination', 'public']);
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Prüft saisonale Sperren wie `motor_vehicle:conditional = no @ (Nov-May)`.
 * Ausgewertet wird das Datum des Graph-Builds; der Graph wird wöchentlich neu
 * gebaut, Wintersperren von Passstrassen greifen damit zeitnah.
 */
export function closedByCondition(value: string | undefined, date: Date): boolean {
  if (!value) return false;
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const today = month * 100 + day;
  for (const part of value.split(';')) {
    const m = /^\s*(no|private)\s*@\s*\(?([^)]*)\)?\s*$/i.exec(part);
    if (!m) continue;
    const cond = m[2].toLowerCase();
    // Sperren nur an einzelnen Wochentagen («Sun May-Sept») gelten nicht durchgehend.
    if (/\b(mo|tu|we|th|fr|sa|su|sun|sat|ph)\b/.test(cond.replace(/mo\s*-\s*su/g, ''))) continue;
    // Sperren mit Jahreszahl sind Baustellen mit festem Datum, keine Saisonregel.
    if (/\b20\d\d\b/.test(cond)) continue;
    if (/\b(winter|snow|ice)\b/.test(cond)) {
      if (month >= 10 || month <= 3) return true;
      continue;
    }
    const range = /([a-z]{3})[a-z]*\.?\s*(\d{1,2})?\s*-\s*([a-z]{3})[a-z]*\.?\s*(\d{1,2})?/.exec(cond);
    if (!range) continue;
    const from = MONTHS.indexOf(range[1]);
    const to = MONTHS.indexOf(range[3]);
    if (from === -1 || to === -1) continue;
    const start = from * 100 + (range[2] ? Number(range[2]) : 1);
    const end = to * 100 + (range[4] ? Number(range[4]) : 31);
    const inside = start <= end ? today >= start && today <= end : today >= start || today <= end;
    if (inside) return true;
  }
  return false;
}

function parseMaxspeed(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === 'ch:urban') return 50;
  if (v === 'ch:rural') return 80;
  if (v === 'ch:trunk') return 100;
  if (v === 'ch:motorway') return 120;
  if (v === 'walk') return 7;
  if (v === 'none' || v === 'signals' || v === 'variable') return null;
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return v.includes('mph') ? n * 1.609 : n;
}

/** Dauer-Tag («00:15», «15», «1:05:00») in Sekunden. */
export function parseDuration(raw: string | undefined): number | null {
  if (!raw) return null;
  const parts = raw.trim().split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 1) return parts[0] * 60;
  if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

/** Wartezeit beim Verladen (Fähre, Autozug), im Mittel. */
export const BOARDING_PENALTY_S = 600;

function explicitAccess(tags: Record<string, string>): boolean | null {
  for (const key of ['motorcar', 'motor_vehicle', 'vehicle', 'access']) {
    const v = tags[key];
    if (v !== undefined) return ALLOW.has(v);
  }
  return null;
}

export function carProfile(tags: Record<string, string>, date: Date): CarAttrs | null {
  // Autoverlad (Lötschberg, Furka, Vereina …) und Autofähren.
  const route = tags.route;
  if (route === 'shuttle_train' || route === 'ferry') {
    if (explicitAccess(tags) === false) return null;
    if (route === 'ferry' && tags.motor_vehicle === undefined && tags.motorcar === undefined) return null;
    const duration = parseDuration(tags.duration);
    return {
      forward: true,
      backward: true,
      speedKmh: route === 'ferry' ? 12 : 45,
      fixedSeconds: duration === null ? null : duration + BOARDING_PENALTY_S,
      motorway: false,
      publicRoad: false,
    };
  }

  const highway = tags.highway;
  const cls = highway ? CLASSES[highway] : undefined;
  if (!cls) return null;
  if (tags.area === 'yes') return null;

  const explicit = explicitAccess(tags);
  if (explicit === false) return null;
  // Feld- und Waldwege sind in der Schweiz in der Regel mit Fahrverbot belegt.
  if (highway === 'track' && explicit !== true) return null;
  if (highway === 'service' && (tags.service === 'driveway' || tags.service === 'emergency_access') && explicit !== true) {
    return null;
  }
  for (const key of ['motorcar:conditional', 'motor_vehicle:conditional', 'vehicle:conditional', 'access:conditional']) {
    if (closedByCondition(tags[key], date)) return null;
  }

  const maxspeed = parseMaxspeed(tags.maxspeed);
  let speed = maxspeed === null ? cls.fallback : Math.min(maxspeed * cls.factor, maxspeed);
  if (tags.motorroad === 'yes' && maxspeed === null) speed = Math.max(speed, 85);
  const surface = tags.surface;
  if (surface && /^(unpaved|gravel|fine_gravel|compacted|dirt|ground|earth|grass|pebblestone|sand|mud)$/.test(surface)) {
    speed = Math.min(speed, 25);
  } else if (surface === 'sett' || surface === 'cobblestone') {
    speed = Math.min(speed, 30);
  }
  // Einspurige Bergstrassen: Ausweichen bremst.
  const width = Number.parseFloat(tags.width ?? '');
  if (tags.lanes === '1' && tags.oneway !== 'yes' && highway !== 'service') speed = Math.min(speed, 38);
  else if (Number.isFinite(width) && width > 0 && width < 3.6 && tags.oneway !== 'yes') speed = Math.min(speed, 38);

  const oneway = tags.oneway;
  const impliedOneway =
    highway === 'motorway' || highway === 'motorway_link' || tags.junction === 'roundabout' || tags.junction === 'circular';
  let forward = true;
  let backward = true;
  if (oneway === '-1' || oneway === 'reverse') forward = false;
  else if (oneway === 'yes' || oneway === '1' || oneway === 'true' || (impliedOneway && oneway !== 'no')) backward = false;

  const motorway = highway === 'motorway' || highway === 'motorway_link' || highway === 'trunk' || highway === 'trunk_link';
  return {
    forward,
    backward,
    speedKmh: Math.max(5, speed),
    fixedSeconds: null,
    motorway,
    publicRoad: cls.publicRoad && tags.tunnel !== 'yes' && tags.foot !== 'no',
  };
}
