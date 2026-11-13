/* Peakr — Helfer, Konstanten und Adapter zwischen API-Typen und Oberfläche.
 * Alles, was hier angezeigt wird, stammt aus der API. Fehlende Werte bleiben
 * null und werden als «–» bzw. «unbekannt» dargestellt. */

import type {
  DestinationDetail,
  DestinationWithStatus,
  DriveInfo,
  HikeKind,
  HikeRouteDetail,
  HikeRouteSummary,
  LatLng,
  LiveStatus,
  MapPoint,
  RoutingStatus,
  SearchItem,
  SearchSection,
  Trailhead,
} from '@ch-alpineroute/shared';

export type PType = 'ski' | 'hike';
export type DestKind = 'peak' | 'lake' | 'hut' | 'viewpoint' | 'pass' | 'ski';

export const KIND_META: Record<DestKind, { icon: string; label: string; plural: string }> = {
  peak: { icon: 'Mountain', label: 'Gipfel', plural: 'Gipfel' },
  lake: { icon: 'Waves', label: 'See', plural: 'Seen' },
  hut: { icon: 'House', label: 'Hütte', plural: 'Hütten' },
  viewpoint: { icon: 'Eye', label: 'Aussichtspunkt', plural: 'Aussicht' },
  pass: { icon: 'Milestone', label: 'Pass', plural: 'Pässe' },
  ski: { icon: 'Snowflake', label: 'Skigebiet', plural: 'Skigebiete' },
};

/** Objektart der Quelle in Anzeigeform (swissNAMES3D schreibt Umlaute aus). */
export function classLabel(objectClass: string | null | undefined): string | null {
  if (!objectClass) return null;
  // Reine OSM-Tag-Angaben («OSM natural=peak») sagen nicht mehr als die Zielart selbst.
  if (objectClass.startsWith('OSM ') && objectClass.includes('=')) return null;
  return objectClass.replace(/uegel/g, 'ügel').replace(/^OSM /, '').replace(/ \(OSM[^)]*\)$/, '');
}

export const PISTE_LABEL: Record<string, { label: string; color: string }> = {
  novice: { label: 'sehr leicht', color: '#4caf50' },
  easy: { label: 'leicht (blau)', color: '#2f7fd1' },
  intermediate: { label: 'mittel (rot)', color: '#d8362a' },
  advanced: { label: 'schwer (schwarz)', color: '#1f2933' },
  expert: { label: 'sehr schwer', color: '#1f2933' },
  extreme: { label: 'extrem', color: '#1f2933' },
  freeride: { label: 'Freeride / Skiroute', color: '#e0a100' },
  unknown: { label: 'ohne Angabe', color: '#9aa3ad' },
};
export const PISTE_ORDER = ['novice', 'easy', 'intermediate', 'advanced', 'expert', 'extreme', 'freeride', 'unknown'];

export function destKind(poiKind: string | null | undefined, type: PType): DestKind {
  if (type === 'ski') return 'ski';
  return poiKind === 'lake' || poiKind === 'hut' || poiKind === 'viewpoint' || poiKind === 'pass' ? poiKind : 'peak';
}

/** Kennzahlen einer Wanderroute in Anzeigeform. */
export interface PHike {
  routeId: number;
  km: number;
  up: number;
  down: number;
  minUp: number;
  minDown: number;
  sacLabel: string;
  sacKnown: boolean;
  officialShare: number;
  maxElev: number | null;
  variants: number;
}

/** Flache Karten-Form für Trefferliste, Favoriten und Detailkopf. */
export interface PCard {
  id: string;
  name: string;
  type: PType;
  kind: DestKind;
  objectClass: string | null;
  canton: string;
  lat: number;
  lng: number;
  score: number;
  topM: number | null;
  baseM: number | null;
  /** Autofahrzeit in Minuten; null = nicht berechenbar. */
  driveMin: number | null;
  driveKm: number | null;
  airKm: number;
  routingStatus: RoutingStatus;
  section: SearchSection;
  over: number;
  trailhead: Trailhead | null;
  hike: PHike | null;
  liftsTotal: number | null;
  liftsOpen: number | null;
  pisteKm: number | null;
  snowTop: number | null;
  snowValley: number | null;
  fresh: number | null;
  weather: number | null;
  temp: number | null;
  tempAdjusted: boolean;
  wind: number | null;
  avalanche: number | null;
  liveAt: string | null;
  quality: number | null;
  blockedReason: string | null;
}

/* ---- Farben / Labels ----------------------------------------------------- */
export function scoreColor(s: number): string {
  if (s >= 80) return 'oklch(0.62 0.12 150)';
  if (s >= 65) return 'oklch(0.66 0.12 128)';
  if (s >= 50) return 'oklch(0.72 0.13 92)';
  if (s >= 35) return 'oklch(0.68 0.14 55)';
  return 'oklch(0.60 0.16 28)';
}

export const AVALANCHE: Record<number, { label: string; color: string; text: string }> = {
  1: { label: 'gering', color: '#5cab2e', text: '#fff' },
  2: { label: 'mässig', color: '#ffcc00', text: '#1a1a1a' },
  3: { label: 'erheblich', color: '#ff8a00', text: '#1a1a1a' },
  4: { label: 'gross', color: '#e8392a', text: '#fff' },
  5: { label: 'sehr gross', color: '#9b1414', text: '#fff' },
};

/**
 * WMO-Wettercode → Lucide-Icon-Name + deutsches Label (kein Emoji).
 * `tempC`: Bei Frost am Ziel ist «Regen» der Rasterzelle (tiefer gelegen) irreführend.
 */
export function weatherInfo(code: number | null, tempC?: number | null): { icon: string; label: string } {
  if (code == null) return { icon: 'CircleHelp', label: 'Wetter unbekannt' };
  const rainy = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  if (rainy && tempC != null && tempC <= 0.5) return { icon: 'CloudSnow', label: 'Niederschlag' };
  if (code === 0) return { icon: 'Sun', label: 'Klar' };
  if (code <= 2) return { icon: 'CloudSun', label: 'Heiter' };
  if (code === 3) return { icon: 'Cloud', label: 'Bewölkt' };
  if (code <= 48) return { icon: 'CloudFog', label: 'Nebel' };
  if (code <= 57) return { icon: 'CloudDrizzle', label: 'Niesel' };
  if (code <= 67) return { icon: 'CloudRain', label: 'Regen' };
  if (code <= 77) return { icon: 'CloudSnow', label: 'Schneefall' };
  if (code <= 82) return { icon: 'CloudRain', label: 'Schauer' };
  if (code <= 86) return { icon: 'Snowflake', label: 'Schneeschauer' };
  return { icon: 'CloudLightning', label: 'Gewitter' };
}

/** Dauer in Minuten als «45 min» bzw. «2 h 05». */
export function fmtDuration(min: number | null | undefined): string {
  if (min == null) return '–';
  const t = Math.round(min);
  const h = Math.floor(t / 60);
  const m = t % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
export const fmtDrive = fmtDuration;

/**
 * SAC-Schwierigkeit einer Route als Text. Die amtliche Signalisation kennt nur
 * drei Klassen, deshalb kann ein Bereich («T2–T3») herauskommen.
 */
export function sacLabel(sacMin: string | null, sacMax: string | null): string {
  if (sacMax === null) return sacMin ? `unbekannt (mind. ${sacMin})` : 'unbekannt';
  if (!sacMin || sacMin === sacMax) return sacMax;
  return `${sacMin}–${sacMax}`;
}

export function trailheadLabel(t: Trailhead): string {
  if (t.name) return t.name;
  const base = t.kind === 'parking' ? 'Parkplatz' : t.kind === 'valley_station' ? 'Talstation' : 'Strassenzugang';
  // Unbenannte Ausgangspunkte über die Höhe unterscheidbar machen.
  return t.elevationM != null ? `${base} auf ${new Intl.NumberFormat('de-CH').format(t.elevationM)} m` : base;
}

/** Kurzer Hinweis zur Verlässlichkeit des Ausgangspunkts. */
export function trailheadHint(t: Trailhead): string {
  if (t.kind === 'valley_station') {
    return (t.roadGapM ?? 0) > 600
      ? `Strasse endet ${((t.roadGapM ?? 0) / 1000).toFixed(1)} km vor der Talstation`
      : 'Zufahrt bis Talstation';
  }
  if (t.kind === 'road_access') return 'Strassenzugang – Parkplatz nicht bestätigt';
  return t.quality >= 3 ? 'Öffentlicher Parkplatz' : 'Parkplatz (Zugang nicht angegeben)';
}

/** Relative Zeitangabe wie «vor 2 h». */
export function fmtAge(iso: string | null): string | null {
  if (!iso) return null;
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(min)) return null;
  if (min < 60) return `vor ${Math.max(1, min)} min`;
  if (min < 48 * 60) return `vor ${Math.round(min / 60)} h`;
  return `vor ${Math.round(min / 1440)} Tagen`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function airKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

export const DEFAULT_ORIGIN = { label: 'Zürich', lat: 47.3769, lng: 8.5417 };

export const HIKE_KINDS: HikeKind[] = ['peak', 'lake', 'hut', 'viewpoint', 'pass'];
export const SAC = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
export const SAC_HINT: Record<string, string> = {
  T1: 'Wandern',
  T2: 'Bergwandern',
  T3: 'anspruchsvolles Bergwandern',
  T4: 'Alpinwandern',
  T5: 'anspruchsvolles Alpinwandern',
  T6: 'schwieriges Alpinwandern',
};

export type SortKey = 'score' | 'drive' | 'hike' | 'elevation' | 'snow';
export const SORTS: Record<PType, { value: SortKey; label: string }[]> = {
  hike: [
    { value: 'score', label: 'Bewertung' },
    { value: 'drive', label: 'Fahrzeit' },
    { value: 'hike', label: 'Gehzeit' },
    { value: 'elevation', label: 'Höhe' },
  ],
  ski: [
    { value: 'score', label: 'Bewertung' },
    { value: 'drive', label: 'Fahrzeit' },
    { value: 'snow', label: 'Schnee' },
    { value: 'elevation', label: 'Höhe' },
  ],
};

/* ---- Adapter: API-Typen → Anzeigeform ------------------------------------ */
function hikeOf(h: HikeRouteSummary | null, variants: number): PHike | null {
  if (!h) return null;
  return {
    routeId: h.routeId,
    km: h.distanceKm,
    up: h.ascentM,
    down: h.descentM,
    minUp: h.durationUpMin,
    minDown: h.durationDownMin,
    sacLabel: sacLabel(h.sacMin, h.sacMax),
    sacKnown: h.sacMax !== null,
    officialShare: h.officialShare,
    maxElev: h.maxElevM,
    variants,
  };
}

function liveFields(live: LiveStatus | null) {
  return {
    liftsOpen: live?.liftsOpen ?? null,
    snowTop: live?.snowDepthTopCm ?? null,
    snowValley: live?.snowDepthValleyCm ?? null,
    fresh: live?.freshSnowCm != null ? Math.round(live.freshSnowCm) : null,
    weather: live?.weatherCode ?? null,
    temp: live?.temperatureC ?? null,
    tempAdjusted: live?.temperatureAdjusted ?? false,
    wind: live?.windKmh ?? null,
    avalanche: live?.avalancheLevel ?? null,
    liveAt: live?.capturedAt ?? null,
  };
}

export function adaptResult(r: SearchItem): PCard {
  const type: PType = r.type === 'ski_resort' ? 'ski' : 'hike';
  return {
    id: r.id,
    name: r.name,
    type,
    kind: destKind(r.poiKind, type),
    objectClass: r.objectClass ?? null,
    canton: r.canton ?? '',
    lat: r.location.lat,
    lng: r.location.lng,
    score: r.score,
    topM: r.elevationTopM,
    baseM: r.elevationBaseM,
    driveMin: r.driveMinutes,
    driveKm: r.routeDistanceKm,
    airKm: r.distanceAirKm,
    routingStatus: r.routingStatus,
    section: r.section,
    over: r.overBudgetMinutes ?? 0,
    trailhead: r.trailhead,
    hike: hikeOf(r.hike, r.hikeVariants),
    liftsTotal: r.ski?.liftsTotal ?? null,
    pisteKm: r.ski?.pisteKm ?? null,
    quality: r.qualityScore ?? null,
    blockedReason: r.blockedReason,
    ...liveFields(r.live),
  };
}

/** Kartenpunkt in Anzeigeform. */
export interface PPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: DestKind;
  type: PType;
  section: SearchSection;
  score: number;
  driveMin: number | null;
}

/** Auf der Karte hervorgehobenes Ziel samt Ausgangspunkt und Route. */
export interface MapSelection {
  id: string;
  lat: number;
  lng: number;
  trailhead: Trailhead | null;
  /** Linie [lng, lat] der gewählten Route; null = (noch) keine. */
  line: [number, number][] | null;
}

export function adaptPoint(p: MapPoint): PPoint {
  const kind = (p[4] in KIND_META ? p[4] : 'peak') as DestKind;
  return { id: p[0], name: p[1], lat: p[2], lng: p[3], kind, type: kind === 'ski' ? 'ski' : 'hike', section: p[5], score: p[6], driveMin: p[7] };
}

/** Favorit (ohne Suchkontext) → Karten-Form fürs Dashboard. */
export function adaptFavorite(d: DestinationWithStatus): PCard {
  const type: PType = d.type === 'ski_resort' ? 'ski' : 'hike';
  return {
    id: d.id,
    name: d.name,
    type,
    kind: destKind(d.poiKind, type),
    objectClass: d.objectClass ?? null,
    canton: d.canton ?? '',
    lat: d.location.lat,
    lng: d.location.lng,
    score: 0,
    topM: d.elevationTopM,
    baseM: d.elevationBaseM,
    driveMin: null,
    driveKm: null,
    airKm: 0,
    routingStatus: 'ok',
    section: 'result',
    over: 0,
    trailhead: null,
    hike:
      d.distanceKm != null && d.ascentM != null
        ? {
            routeId: 0, km: d.distanceKm, up: d.ascentM, down: 0, minUp: 0, minDown: 0,
            sacLabel: d.sacDifficulty ?? 'unbekannt', sacKnown: d.sacDifficulty != null, officialShare: 0, maxElev: null, variants: 0,
          }
        : null,
    liftsTotal: d.live?.liftsTotal ?? null,
    pisteKm: null,
    quality: d.qualityScore ?? null,
    blockedReason: null,
    ...liveFields(d.live),
  };
}

export interface PRoute extends PHike {
  rank: number;
  trailhead: Trailhead;
  /** Autofahrt vom Startort zu diesem Ausgangspunkt; null = ohne Startort geladen. */
  drive: DriveInfo | null;
  endGapM: number;
  line: [number, number][];
  source: string;
  computedAt: string;
}

export interface PDetail extends PCard {
  altNames: string[];
  routes: PRoute[];
  routeStatus: string;
  liftsByType: Record<string, number>;
  pisteKmByDifficulty: Record<string, number>;
  grouping: string | null;
  access: Trailhead | null;
  accessDrive: DriveInfo | null;
  /** Schneeverlauf am Berg (chronologisch) für Skigebiete. */
  history: { t: number; snow: number }[];
  sources: DestinationDetail['sources'];
  updatedAt: string | null;
  wikipedia: string | null;
}

function routeOf(r: HikeRouteDetail): PRoute {
  return {
    ...(hikeOf(r, 0) as PHike),
    rank: r.rank,
    trailhead: r.trailhead,
    drive: r.drive ?? null,
    endGapM: r.endGapM,
    line: r.line,
    source: r.source,
    computedAt: r.computedAt,
  };
}

export function adaptDetail(d: DestinationDetail): PDetail {
  const type: PType = d.type === 'ski_resort' ? 'ski' : 'hike';
  const kind = destKind(d.poiKind, type);
  const routes = d.routes.map(routeOf);
  const best = routes[0] ?? null;
  const drive = (type === 'ski' ? d.accessDrive : best?.drive) ?? null;
  return {
    id: d.id,
    name: d.name,
    type,
    kind,
    objectClass: d.objectClass ?? null,
    canton: d.canton ?? '',
    lat: d.location.lat,
    lng: d.location.lng,
    score: 0,
    topM: d.elevationTopM,
    baseM: d.elevationBaseM,
    driveMin: drive?.minutes ?? null,
    driveKm: drive?.distanceKm ?? null,
    airKm: 0,
    routingStatus: drive?.status ?? 'ok',
    section: 'result',
    over: 0,
    trailhead: best?.trailhead ?? d.access,
    hike: best,
    liftsTotal: d.ski?.liftsTotal ?? null,
    pisteKm: d.ski?.pisteKm ?? null,
    quality: d.qualityScore ?? null,
    blockedReason: null,
    ...liveFields(d.live),
    altNames: [...new Set([...Object.values(d.names ?? {}), ...(d.altNames ?? [])])].filter((n) => n && n !== d.name),
    routes,
    routeStatus: d.routeStatus ?? 'unrouted',
    liftsByType: d.ski?.liftsByType ?? {},
    pisteKmByDifficulty: d.ski?.pisteKmByDifficulty ?? {},
    grouping: d.ski?.grouping ?? null,
    access: d.access,
    accessDrive: d.accessDrive ?? null,
    history: [...d.history]
      .reverse()
      .filter((h) => h.snowDepthTopCm != null)
      .map((h) => ({ t: Date.parse(h.capturedAt), snow: h.snowDepthTopCm as number })),
    sources: d.sources,
    updatedAt: d.updatedAt,
    wikipedia: d.wikipediaTitle,
  };
}

/* ---- Wetterprognose direkt von Open-Meteo (Browser) ----------------------- */
export interface PDay {
  label: string;
  date: string;
  code: number | null;
  tmax: number | null;
  tmin: number | null;
  wind: number | null;
  pop: number | null;
}

export interface HourPt {
  t: number;
  hour: number;
  temp: number;
  day: string;
}

const DAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const roundOrNull = (v: number | null | undefined): number | null => (v == null ? null : Math.round(v));

/** Stündliche Temperatur ab jetzt für ~30 Stunden, auf der Zielhöhe. */
export async function fetchHourlyTemps(lat: number, lng: number, elevation: number | null): Promise<HourPt[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    (elevation != null ? `&elevation=${elevation}` : '') +
    `&hourly=temperature_2m&timezone=Europe%2FZurich&forecast_days=2`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const j = (await res.json()) as { hourly?: { time: string[]; temperature_2m: (number | null)[] } };
  const h = j.hourly;
  if (!h) return [];
  const cutoff = Date.now() - 3600_000;
  const out: HourPt[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const dt = new Date(h.time[i]);
    const v = h.temperature_2m[i];
    if (dt.getTime() < cutoff || v == null) continue;
    out.push({ t: dt.getTime(), hour: dt.getHours(), temp: Math.round(v), day: DAY_NAMES[dt.getDay()] });
    if (out.length >= 30) break;
  }
  return out;
}

/** 7-Tage-Prognose auf der Zielhöhe. Fehlende Werte bleiben null. */
export async function fetchForecast(lat: number, lng: number, elevation: number | null): Promise<PDay[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    (elevation != null ? `&elevation=${elevation}` : '') +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,precipitation_probability_max` +
    `&timezone=Europe%2FZurich&forecast_days=7`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const j = (await res.json()) as {
    daily?: {
      time: string[];
      weather_code: (number | null)[];
      temperature_2m_max: (number | null)[];
      temperature_2m_min: (number | null)[];
      wind_speed_10m_max: (number | null)[];
      precipitation_probability_max: (number | null)[];
    };
  };
  const dly = j.daily;
  if (!dly) return [];
  return dly.time.map((iso, i) => {
    const dt = new Date(iso + 'T00:00:00');
    return {
      label: i === 0 ? 'Heute' : i === 1 ? 'Morgen' : DAY_NAMES[dt.getDay()],
      date: `${dt.getDate()}.${dt.getMonth() + 1}.`,
      code: dly.weather_code[i] ?? null,
      tmax: roundOrNull(dly.temperature_2m_max[i]),
      tmin: roundOrNull(dly.temperature_2m_min[i]),
      wind: roundOrNull(dly.wind_speed_10m_max[i]),
      pop: roundOrNull(dly.precipitation_probability_max[i]),
    };
  });
}
