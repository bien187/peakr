/* Peakr — Helfer, Konstanten und Adapter (Prototyp-Logik → echte API-Typen).
 * Portiert aus reference/core.jsx + data.jsx, an die realen Schemas angebunden. */

import type {
  DestinationDetail,
  DestinationWithStatus,
  LatLng,
  LiveStatus,
  SearchResult,
} from '@ch-alpineroute/shared';

export type PType = 'ski' | 'hike';
export type TrendDir = 'up' | 'down' | 'flat';

/** Flache Karten-Form, die alle Prototyp-UI-Komponenten erwarten. */
export interface PCard {
  id: string;
  name: string;
  type: PType;
  canton: string;
  lat: number;
  lng: number;
  score: number;
  driveMin: number;
  km: number;
  snowTop: number | null;
  fresh: number | null;
  liftsOpen: number | null;
  liftsTotal: number | null;
  weather: number | null;
  temp: number | null;
  wind: number | null;
  avalanche: number | null;
  fame: number | null;
  trendDir: TrendDir;
  sac: string | null;
  ascent: number | null;
  distance: number | null;
  suggestion: boolean;
  over: number;
}

export interface PDetail extends PCard {
  baseM: number | null;
  topM: number | null;
  blurb: string;
  displayScore: number;
  history: number[];
}

export interface PDay {
  label: string;
  date: string;
  code: number | null;
  tmax: number;
  tmin: number;
  wind: number;
  pop: number;
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

/** WMO-Wettercode → Lucide-Icon-Name + deutsches Label (kein Emoji). */
export function weatherInfo(code: number | null): { icon: string; label: string } {
  if (code == null) return { icon: 'CircleHelp', label: 'unbekannt' };
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

export function fmtDrive(min: number): string {
  const t = Math.round(min);
  const h = Math.floor(t / 60);
  const m = t % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

export function airKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

/* ---- schematische Reliefkarte: Schweiz-Bounding-Box → Prozent ------------ */
const BOX = { w: 5.9, e: 10.5, n: 47.85, s: 45.78 };
export const mapX = (lng: number) => ((lng - BOX.w) / (BOX.e - BOX.w)) * 100;
export const mapY = (lat: number) => ((BOX.n - lat) / (BOX.n - BOX.s)) * 100;

export const ORIGINS: { id: string; label: string; lat: number; lng: number }[] = [
  { id: 'bern', label: 'Bern', lat: 46.948, lng: 7.447 },
  { id: 'zurich', label: 'Zürich', lat: 47.377, lng: 8.54 },
  { id: 'geneve', label: 'Genève', lat: 46.204, lng: 6.143 },
  { id: 'basel', label: 'Basel', lat: 47.56, lng: 7.588 },
  { id: 'luzern', label: 'Luzern', lat: 47.05, lng: 8.307 },
  { id: 'lugano', label: 'Lugano', lat: 46.005, lng: 8.951 },
];

export const LAKES: { name: string; lng: number; lat: number; w: number; h: number; r: number }[] = [
  { name: 'Genfersee', lng: 6.55, lat: 46.45, w: 13, h: 4.5, r: -18 },
  { name: 'Bodensee', lng: 9.35, lat: 47.55, w: 11, h: 4, r: -8 },
  { name: 'Vierwaldst.', lng: 8.45, lat: 47.0, w: 6, h: 3.5, r: 20 },
  { name: 'Zürichsee', lng: 8.72, lat: 47.22, w: 6, h: 2.6, r: -32 },
  { name: 'Neuenburg.', lng: 6.9, lat: 46.92, w: 7, h: 3, r: -34 },
  { name: 'Lago Magg.', lng: 8.78, lat: 46.1, w: 3.5, h: 6, r: 6 },
];

export const HIKE_KINDS: { value: string; label: string }[] = [
  { value: 'any', label: 'Alle' },
  { value: 'peak', label: 'Gipfel' },
  { value: 'lake', label: 'Bergsee' },
  { value: 'hut', label: 'Hütte' },
  { value: 'viewpoint', label: 'Aussicht' },
];
export const SAC = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

export const SORTS: { value: string; label: string }[] = [
  { value: 'score', label: 'Grösse' },
  { value: 'drive', label: 'Fahrzeit' },
  { value: 'snow', label: 'Schnee' },
];

/** Wanderziel-Typ aus dem Namen ableiten (die API kennt keine kind-Kategorie). */
export function inferHikeKind(name: string): 'lake' | 'hut' | 'peak' | 'viewpoint' {
  const n = name.toLowerCase();
  if (/see\b|seen\b|lac\b|lago|\blai\b|weiher|stausee|lej\b/.test(n)) return 'lake';
  if (/hütte|huette|cabane|capanna|\bhut\b|berghaus|clubhütte/.test(n)) return 'hut';
  if (/horn|spitz|gipfel|\bpiz\b|pizzo|\bmont\b|\bpic\b|kulm|stock|fluh|grat|rothorn|turm|säntis|titlis|matterhorn/.test(n))
    return 'peak';
  return 'viewpoint';
}

export function sortCards(list: PCard[], sort: string): PCard[] {
  const a = [...list];
  if (sort === 'drive') a.sort((x, y) => x.driveMin - y.driveMin);
  else if (sort === 'snow') a.sort((x, y) => (y.snowTop ?? 0) - (x.snowTop ?? 0));
  else a.sort((x, y) => y.score - x.score); // default: Grösse/Infrastruktur
  return a;
}

/* ---- Adapter: echte API-Typen → Prototyp-Form ---------------------------- */
const isSkiType = (t: string) => t === 'ski_resort';

export function adaptResult(r: SearchResult, suggestion: boolean): PCard {
  const live = r.live;
  return {
    id: r.id,
    name: r.name,
    type: isSkiType(r.type) ? 'ski' : 'hike',
    canton: r.canton ?? '',
    lat: r.location.lat,
    lng: r.location.lng,
    score: displayScore(r.type, live?.liftsTotal, live?.snowDepthTopCm, r.ascentM, r.distanceKm, r.elevationTopM, r.qualityScore),
    driveMin: Math.round(r.driveMinutes),
    km: r.distanceAirKm,
    snowTop: live?.snowDepthTopCm ?? null,
    fresh: live?.freshSnowCm != null ? Math.round(live.freshSnowCm) : null,
    liftsOpen: live?.liftsOpen ?? null,
    liftsTotal: live?.liftsTotal ?? null,
    weather: live?.weatherCode ?? null,
    temp: live?.temperatureC ?? null,
    wind: live?.windKmh ?? null,
    avalanche: live?.avalancheLevel ?? null,
    fame: r.trend?.score ?? null,
    trendDir: 'flat',
    sac: r.sacDifficulty ?? null,
    ascent: r.ascentM ?? null,
    distance: r.distanceKm ?? null,
    suggestion,
    over: r.overBudgetMinutes ?? 0,
  };
}

/** 14-Punkt-Serie aus dem echten Verlauf (Schnee für Ski, Temperatur sonst). */
function historyToSeries(d: DestinationDetail, ski: boolean): number[] {
  const src = [...d.history].reverse(); // API: neueste zuerst → chronologisch
  const vals = src
    .map((h: LiveStatus) => (ski ? h.snowDepthTopCm : h.temperatureC))
    .filter((v): v is number => v != null);
  return vals.map((v) => Math.round(v));
}

/** Grössen-/Infrastruktur-Score: Lifte/Pisteninfra statt Wikipedia-Bekanntheit. */
export function displayScore(
  type: string,
  liftsTotal: number | null | undefined,
  snowTop: number | null | undefined,
  ascentM: number | null | undefined,
  distanceKm: number | null | undefined,
  elevationTopM?: number | null,
  qualityScore?: number | null,
): number {
  if (isSkiType(type)) {
    // Ski: Pisteninfrastruktur (Lifte als Proxy) + Schneebonus
    const lifts = Math.min(65, (liftsTotal ?? 0) * 1.8);
    const snow = Math.min(30, (snowTop ?? 0) / 5);
    return Math.max(5, Math.round(lifts + snow));
  } else {
    // Wandern: Routen haben Höhenmeter/Distanz; Gipfel/Seen/Hütten nur Höhe + Qualität.
    // Wir nehmen das stärkere der beiden Signale, damit Gipfel nach Höhe differenziert werden.
    const ascent = Math.min(35, (ascentM ?? 0) / 28);
    const dist = Math.min(20, (distanceKm ?? 0) * 2);
    const routeScore = ascent + dist; // > 0 nur bei echten Routen mit Metriken
    const elev = Math.min(75, Math.max(0, ((elevationTopM ?? 0) - 600) / 50)); // 600m→0, 4350m→75
    const qual = Math.min(25, (qualityScore ?? 0) / 4); // 100→25
    const peakScore = elev + qual;
    return Math.max(5, Math.round(Math.max(routeScore, peakScore)));
  }
}

export function adaptDetail(d: DestinationDetail): PDetail {
  const ski = isSkiType(d.type);
  const live = d.live;
  const fame = d.trend?.score ?? null;
  const snowTop = live?.snowDepthTopCm ?? null;
  const score = displayScore(d.type, live?.liftsTotal, snowTop, d.ascentM, d.distanceKm, d.elevationTopM, d.qualityScore);
  return {
    id: d.id,
    name: d.name,
    type: ski ? 'ski' : 'hike',
    canton: d.canton ?? '',
    lat: d.location.lat,
    lng: d.location.lng,
    score,
    driveMin: 0,
    km: 0,
    snowTop,
    fresh: live?.freshSnowCm != null ? Math.round(live.freshSnowCm) : null,
    liftsOpen: live?.liftsOpen ?? null,
    liftsTotal: live?.liftsTotal ?? null,
    weather: live?.weatherCode ?? null,
    temp: live?.temperatureC ?? null,
    wind: live?.windKmh ?? null,
    avalanche: live?.avalancheLevel ?? null,
    fame,
    trendDir: 'flat',
    sac: d.sacDifficulty ?? null,
    ascent: d.ascentM ?? null,
    distance: d.distanceKm ?? null,
    suggestion: false,
    over: 0,
    baseM: d.elevationBaseM,
    topM: d.elevationTopM,
    blurb:
      (ski ? 'Skigebiet' : 'Wanderziel') +
      (d.canton ? ` im Kanton ${d.canton}` : '') +
      '. Live-Bedingungen aus offenen Datenquellen (Wetter, Schnee, Lawinenlage).',
    displayScore: score,
    history: historyToSeries(d, ski),
  };
}

/** Favorit (DestinationWithStatus) → schlanke Karten-Form fürs Dashboard. */
export function adaptFavorite(d: DestinationWithStatus): PCard {
  const ski = isSkiType(d.type);
  const live = d.live;
  const fame = d.trend?.score ?? null;
  const snowTop = live?.snowDepthTopCm ?? null;
  return {
    id: d.id,
    name: d.name,
    type: ski ? 'ski' : 'hike',
    canton: d.canton ?? '',
    lat: d.location.lat,
    lng: d.location.lng,
    score: displayScore(d.type, live?.liftsTotal, snowTop, d.ascentM, d.distanceKm, d.elevationTopM, d.qualityScore),
    driveMin: 0,
    km: 0,
    snowTop,
    fresh: live?.freshSnowCm != null ? Math.round(live.freshSnowCm) : null,
    liftsOpen: live?.liftsOpen ?? null,
    liftsTotal: live?.liftsTotal ?? null,
    weather: live?.weatherCode ?? null,
    temp: live?.temperatureC ?? null,
    wind: live?.windKmh ?? null,
    avalanche: live?.avalancheLevel ?? null,
    fame,
    trendDir: 'flat',
    sac: d.sacDifficulty ?? null,
    ascent: d.ascentM ?? null,
    distance: d.distanceKm ?? null,
    suggestion: false,
    over: 0,
  };
}

/* ---- 3D-Route: Park-/Zielpunkte + Polyline ------------------------------- */
export interface RouteGeo {
  park: [number, number];
  peak: [number, number];
  line: [number, number][];
  parkLabel: string;
  peakLabel: string;
}

/** Plausible, deterministische Route Parkplatz→Ziel. Ohne echte Parkdaten wird
 *  der Startpunkt synthetisch leicht unterhalb des Ziels abgeleitet. */
export function routeGeo(d: { id: string; name: string; lat: number; lng: number }): RouteGeo {
  const park: [number, number] = [d.lng - 0.012, d.lat - 0.009];
  const peak: [number, number] = [d.lng, d.lat];
  const seed = d.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const N = 16;
  const dx = peak[0] - park[0];
  const dy = peak[1] - park[1];
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const line: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const env = Math.sin(t * Math.PI);
    const wob = Math.sin(seed + t * 6.3) * 0.6 + Math.sin(seed * 0.7 + t * 13) * 0.25;
    const off = env * wob * len * 0.16;
    line.push([park[0] + dx * t + px * off, park[1] + dy * t + py * off]);
  }
  return {
    park,
    peak,
    line,
    parkLabel: 'Parkplatz',
    peakLabel: d.name.split(' – ')[0].split(' (')[0],
  };
}

/** Echte 7-Tage-Prognose von Open-Meteo (kostenlos, kein Key). */
export async function fetchForecast(lat: number, lng: number): Promise<PDay[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
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
  const names = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  return dly.time.map((iso, i) => {
    const dt = new Date(iso + 'T00:00:00');
    return {
      label: i === 0 ? 'Heute' : i === 1 ? 'Morgen' : names[dt.getDay()],
      date: `${dt.getDate()}.${dt.getMonth() + 1}.`,
      code: dly.weather_code[i] ?? null,
      tmax: Math.round(dly.temperature_2m_max[i] ?? 0),
      tmin: Math.round(dly.temperature_2m_min[i] ?? 0),
      wind: Math.round(dly.wind_speed_10m_max[i] ?? 0),
      pop: Math.round(dly.precipitation_probability_max[i] ?? 0),
    };
  });
}
