/**
 * Einzelprüfungen der Verfügbarkeit. Reine Funktionen: alle Daten kommen als
 * Argument, «jetzt» ebenfalls – damit sind die Regeln vollständig testbar.
 *
 * Grundsätze
 *  - Ein fehlender Bericht ist kein Nachweis für «offen»: fehlen Daten, ist das
 *    Ergebnis höchstens «uncertain».
 *  - Prognosen und Modellwerte sind als solche gekennzeichnet (evidence).
 *  - Schwellen stehen als Konstanten oben und sind in docs/VERFUEGBARKEIT_UND_WETTER.md beschrieben.
 */
import type { AvailabilityCheck, AvailabilityStatus } from '@ch-alpineroute/shared';
import { haversineM } from '../geo/lv95';
import { sunTimes } from './sun';
import { hhmm, zurichParts, zurichToUtc } from './time';

// ── Schwellen ────────────────────────────────────────────────────────────────

/** Sperrungsmeldungen älter als das gelten als nicht verfügbar. */
export const CLOSURES_MAX_AGE_H = 48;
/** Unter diesem Anteil amtlicher Wanderwege fehlen für den Rest der Route Sperrungsmeldungen. */
export const MIN_OFFICIAL_SHARE = 0.5;

/** Stationen in diesem Umkreis um das Ziel zählen für die Schneelage. */
export const SNOW_RADIUS_KM = 25;
/** Messungen älter als das werden nicht verwendet. */
export const SNOW_MAX_AGE_H = 36;
/** Ab dieser Schneehöhe gilt eine Station als eingeschneit. */
export const SNOW_PRESENT_CM = 5;
/** Ab dieser Schneehöhe ist eine Sommerroute nicht begehbar. */
export const SNOW_BLOCK_CM = 20;
/** Darunter gilt eine Station als schneefrei. */
export const SNOW_FREE_CM = 2;

/** Prognosen älter als das gelten als nicht aktuell. */
export const FORECAST_MAX_AGE_H = 18;
export const GUST_WARN_KMH = 60;
export const GUST_BLOCK_KMH = 90;
export const SNOWFALL_BLOCK_CM = 10;
export const PRECIP_WARN_MM = 15;
export const PRECIP_WARN_HOURLY_MM = 5;
const LAPSE_RATE = 0.0065;

/** Lawinenbulletin älter als das (Abruf) gilt als nicht aktuell. */
export const AVALANCHE_MAX_AGE_H = 30;
/** Unterhalb dieser Höhe spielt die Lawinengefahr für Wanderrouten kaum eine Rolle. */
export const AVALANCHE_MIN_ELEV_M = 1500;

/** Live-Liftstatus älter als das gilt nicht mehr. */
export const LIFTS_MAX_AGE_H = 12;
/** Unter dieser Schneehöhe am Berg reicht Naturschnee kaum für den Betrieb. */
export const SKI_MIN_SNOW_CM = 10;

// ── Hilfen ───────────────────────────────────────────────────────────────────

const hoursSince = (iso: string | null | undefined, now: Date): number =>
  iso ? (now.getTime() - Date.parse(iso)) / 3_600_000 : Infinity;

/** «13.11. 07:00» in Schweizer Zeit. */
export function when(iso: string): string {
  const d = new Date(iso);
  const z = zurichParts(d);
  return `${z.date.slice(8, 10)}.${z.date.slice(5, 7)}. ${hhmm(d)}`;
}

const nf = new Intl.NumberFormat('de-CH');
const m = (v: number): string => `${nf.format(Math.round(v))} m`;

function check(
  kind: AvailabilityCheck['kind'],
  status: AvailabilityStatus,
  text: string,
  evidence: AvailabilityCheck['evidence'],
  source: string | null,
  observedAt: string | null,
  url: string | null = null,
): AvailabilityCheck {
  return { kind, status, text, evidence, source, observedAt, url };
}

// ── Sperrungen ───────────────────────────────────────────────────────────────

export interface RouteClosure {
  id: string;
  title: string | null;
  reason: string | null;
  duration: string | null;
  url: string | null;
  /** Für diese Sperrung ist eine Umleitung signalisiert. */
  hasDetour: boolean;
}

const CLOSURE_SOURCE = 'ASTRA / Schweizer Wanderwege (geo.admin.ch)';

export function assessClosures(
  closures: readonly RouteClosure[] | undefined,
  officialShare: number,
  fetchedAt: string | null,
  now: Date,
): AvailabilityCheck {
  if (hoursSince(fetchedAt, now) > CLOSURES_MAX_AGE_H) {
    return check('closure', 'uncertain', 'Sperrungsmeldungen sind zurzeit nicht abrufbar – Wegzustand ungeprüft.', 'none', CLOSURE_SOURCE, fetchedAt);
  }
  const describe = (c: RouteClosure): string =>
    [c.title, [c.reason, c.duration].filter(Boolean).join(', ')].filter(Boolean).join(' – ');
  const blocking = (closures ?? []).filter((c) => !c.hasDetour);
  if (blocking.length > 0) {
    const c = blocking[0];
    return check('closure', 'unavailable', `Weg gesperrt: ${describe(c)}.`, 'official', CLOSURE_SOURCE, fetchedAt, c.url);
  }
  if (closures && closures.length > 0) {
    const c = closures[0];
    return check(
      'closure', 'uncertain',
      `Gesperrter Abschnitt mit signalisierter Umleitung: ${describe(c)}. Gehzeit und Route weichen ab.`,
      'official', CLOSURE_SOURCE, fetchedAt, c.url,
    );
  }
  const pct = Math.round(officialShare * 100);
  if (officialShare < MIN_OFFICIAL_SHARE) {
    return check(
      'closure', 'uncertain',
      `Nur ${pct} % der Route liegen auf amtlichen Wanderwegen. Für die übrigen Wege gibt es keine Sperrungsmeldungen.`,
      'official', CLOSURE_SOURCE, fetchedAt,
    );
  }
  return check(
    'closure', 'available',
    pct >= 90
      ? 'Keine Sperrung auf der Route gemeldet.'
      : `Keine Sperrung gemeldet. ${pct} % der Route liegen auf amtlichen Wanderwegen; nur für diese gibt es Meldungen.`,
    'official', CLOSURE_SOURCE, fetchedAt,
  );
}

// ── Schnee (Sommerrouten) ────────────────────────────────────────────────────

export interface SnowStation {
  id: string;
  source: 'slf_imis' | 'meteoswiss';
  name: string;
  lat: number;
  lng: number;
  elevationM: number;
  snowCm: number | null;
  newSnowCm: number | null;
  measuredAt: string;
}

const SOURCE_LABEL: Record<SnowStation['source'], string> = { slf_imis: 'SLF (IMIS)', meteoswiss: 'MeteoSchweiz' };

/** Stationen nach 0,25°-Raster, damit die Umkreissuche je Route billig bleibt. */
export class StationIndex {
  private readonly grid = new Map<string, SnowStation[]>();
  /** Varianten eines Ziels fragen denselben Ort ab. */
  private readonly memo = new Map<string, { station: SnowStation; km: number }[]>();
  constructor(readonly stations: readonly SnowStation[]) {
    for (const s of stations) {
      const key = `${Math.floor(s.lat * 4)}_${Math.floor(s.lng * 4)}`;
      const list = this.grid.get(key);
      if (list) list.push(s);
      else this.grid.set(key, [s]);
    }
  }

  near(lat: number, lng: number, radiusKm: number): { station: SnowStation; km: number }[] {
    const key = `${lat}|${lng}|${radiusKm}`;
    const hit = this.memo.get(key);
    if (hit) return hit;
    const out: { station: SnowStation; km: number }[] = [];
    const la = Math.floor(lat * 4);
    const lo = Math.floor(lng * 4);
    const span = Math.ceil(radiusKm / 18) + 1; // 0,25° Länge ≈ 19 km in der Schweiz
    for (let a = la - span; a <= la + span; a++) {
      for (let b = lo - span; b <= lo + span; b++) {
        for (const s of this.grid.get(`${a}_${b}`) ?? []) {
          const km = haversineM(lat, lng, s.lat, s.lng) / 1000;
          if (km <= radiusKm) out.push({ station: s, km });
        }
      }
    }
    out.sort((x, y) => x.km - y.km);
    if (this.memo.size > 50_000) this.memo.clear();
    this.memo.set(key, out);
    return out;
  }
}

export interface ModelSnow {
  snowCm: number | null;
  elevationM: number | null;
  at: string | null;
}

/** IMIS liefert Tageswerte ohne Uhrzeit – dann nur das Datum nennen. */
const measuredWhen = (s: SnowStation): string =>
  s.source === 'slf_imis' ? `Tageswert vom ${when(s.measuredAt).slice(0, 6)}` : `gemessen ${when(s.measuredAt)}`;

const stationText = (s: SnowStation, km: number): string =>
  `${nf.format(Math.round(s.snowCm ?? 0))} cm an der Station ${s.name} (${m(s.elevationM)}, ${km.toFixed(0)} km entfernt, ${measuredWhen(s)})`;

/**
 * Schneelage auf einer Sommerroute aus Stationsmessungen in Routenhöhe, sonst
 * aus dem Modell. Schnee an einer Station unterhalb des höchsten Routenpunkts
 * zählt als Schnee auf der Route; schneefrei nur, wenn eine Station auf ähnlicher
 * oder grösserer Höhe schneefrei misst. Die Exposition der Hänge kennt Peakr
 * nicht – an Nordhängen kann Schnee länger liegen.
 */
export function assessSnow(
  dest: { lat: number; lng: number },
  maxElevM: number | null,
  stations: StationIndex,
  model: ModelSnow | null,
  now: Date,
): AvailabilityCheck {
  if (maxElevM === null) {
    return check('snow', 'uncertain', 'Höhe der Route unbekannt – Schneelage nicht beurteilbar.', 'none', null, null);
  }
  const fresh = stations
    .near(dest.lat, dest.lng, SNOW_RADIUS_KM)
    .filter(({ station: s }) => s.snowCm !== null && hoursSince(s.measuredAt, now) <= SNOW_MAX_AGE_H);

  const snowy = fresh
    .filter(({ station: s }) => s.elevationM <= maxElevM + 100 && (s.snowCm ?? 0) >= SNOW_PRESENT_CM)
    .sort((a, b) => a.station.elevationM - b.station.elevationM);
  if (snowy.length > 0) {
    // Tiefste eingeschneite Station: der deutlichste Beleg.
    const { station: s, km } = snowy[0];
    const deep = snowy.some(({ station: x }) => (x.snowCm ?? 0) >= SNOW_BLOCK_CM);
    const wellBelow = s.elevationM <= maxElevM - 300;
    return check(
      'snow',
      deep || wellBelow ? 'unavailable' : 'uncertain',
      `Schnee: ${stationText(s, km)}. Die Route führt bis ${m(maxElevM)}.`,
      'measured', SOURCE_LABEL[s.source], s.measuredAt,
    );
  }

  const free = fresh
    .filter(({ station: s }) => s.elevationM >= maxElevM - 150 && (s.snowCm ?? 0) < SNOW_FREE_CM)
    .sort((a, b) => a.km - b.km);
  if (free.length > 0) {
    const { station: s, km } = free[0];
    return check(
      'snow', 'available',
      `Schneefrei gemessen an der Station ${s.name} (${m(s.elevationM)}, ${km.toFixed(0)} km entfernt, ${measuredWhen(s)}). An Nordhängen kann Altschnee liegen.`,
      'measured', SOURCE_LABEL[s.source], s.measuredAt,
    );
  }

  if (model && model.snowCm !== null && model.elevationM !== null && hoursSince(model.at, now) <= FORECAST_MAX_AGE_H) {
    const near = model.elevationM >= maxElevM - 300;
    if (model.snowCm >= SNOW_PRESENT_CM) {
      return check(
        'snow', near ? 'uncertain' : 'unavailable',
        `Modell: ${model.snowCm} cm Schnee auf ${m(model.elevationM)}${near ? '' : ` – die Route führt höher, bis ${m(maxElevM)}`}. Keine Messstation in Routenhöhe.`,
        'model', 'Open-Meteo (Modell)', model.at,
      );
    }
    if (near) {
      return check(
        'snow', 'available',
        `Modell: schneefrei auf ${m(model.elevationM)}. Keine Messstation in Routenhöhe.`,
        'model', 'Open-Meteo (Modell)', model.at,
      );
    }
  }
  return check(
    'snow', 'uncertain',
    `Keine aktuelle Schneemessung in Routenhöhe (${m(maxElevM)}) in der Nähe – Schneelage unbekannt.`,
    'none', null, null,
  );
}

// ── Wetter zur Tourzeit ──────────────────────────────────────────────────────

/** Stündliche Prognose einer Rasterzelle (UTC, ab `start`). */
export interface CellForecast {
  start: string;
  precip: (number | null)[];
  snowfall: (number | null)[];
  code: (number | null)[];
  gust: (number | null)[];
  temp: (number | null)[];
  cloud: (number | null)[];
  fetchedAt: string;
  /** Höhe, für die das Modell rechnet. */
  elevationM: number | null;
}

const maxOf = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.max(...v) : null;
};
const sumOf = (xs: (number | null)[]): number => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

export function assessWeather(
  fc: CellForecast | undefined,
  window: { from: Date; to: Date },
  maxElevM: number | null,
  now: Date,
  source = 'Open-Meteo (Modell)',
): AvailabilityCheck {
  if (!fc || hoursSince(fc.fetchedAt, now) > FORECAST_MAX_AGE_H) {
    return check('weather', 'uncertain', 'Keine aktuelle Wetterprognose für die Tourzeit.', 'none', null, fc?.fetchedAt ?? null);
  }
  const start = Date.parse(fc.start);
  const i0 = Math.floor((window.from.getTime() - start) / 3_600_000);
  const i1 = Math.ceil((window.to.getTime() - start) / 3_600_000);
  if (i0 < 0 || i1 > fc.code.length) {
    return check('weather', 'uncertain', 'Die Prognose reicht nicht bis zum Ende der Tour.', 'none', source, fc.fetchedAt);
  }
  const slice = <T>(xs: T[]): T[] => xs.slice(i0, Math.max(i0 + 1, i1));
  const precip = slice(fc.precip);
  const snowfall = sumOf(slice(fc.snowfall));
  const gust = maxOf(slice(fc.gust));
  const codes = slice(fc.code);
  const temps = slice(fc.temp).filter((t): t is number => t !== null);
  const tempTop =
    temps.length && maxElevM !== null && fc.elevationM !== null
      ? Math.min(...temps) - (maxElevM - fc.elevationM) * LAPSE_RATE
      : temps.length ? Math.min(...temps) : null;
  const precipSum = sumOf(precip);
  const precipMax = maxOf(precip) ?? 0;
  const thunderAt = codes.findIndex((c) => c !== null && c >= 95);
  const span = `${hhmm(window.from)}–${hhmm(window.to)} Uhr`;
  const at = (i: number) => hhmm(new Date(start + (i0 + i) * 3_600_000));
  const top = maxElevM !== null ? ` auf ${m(maxElevM)}` : '';

  const say = (status: AvailabilityStatus, text: string) => check('weather', status, `Prognose ${span}: ${text}`, 'forecast', source, fc.fetchedAt);

  if (gust !== null && gust >= GUST_BLOCK_KMH) return say('unavailable', `Sturmböen bis ${Math.round(gust)} km/h.`);
  if (snowfall >= SNOWFALL_BLOCK_CM) return say('unavailable', `${Math.round(snowfall)} cm Neuschnee erwartet.`);
  if (thunderAt >= 0) return say('uncertain', `Gewitter möglich ab etwa ${at(thunderAt)} Uhr.`);
  if (gust !== null && gust >= GUST_WARN_KMH) return say('uncertain', `Böen bis ${Math.round(gust)} km/h, in exponierten Lagen stärker.`);
  if (snowfall >= 1 || (precipSum >= 1 && tempTop !== null && tempTop <= 0.5)) {
    return say('uncertain', `Schneefall möglich${top}${snowfall >= 1 ? ` (${snowfall.toFixed(0)} cm)` : ''}.`);
  }
  if (precipSum >= PRECIP_WARN_MM || precipMax >= PRECIP_WARN_HOURLY_MM) {
    return say('uncertain', `Starker Niederschlag (${precipSum.toFixed(0)} mm).`);
  }
  const parts = [
    precipSum >= 0.5 ? `Regen möglich (${precipSum.toFixed(1)} mm)` : 'trocken',
    gust !== null ? `Böen bis ${Math.round(gust)} km/h` : null,
    tempTop !== null ? `tiefste Temperatur${top} etwa ${Math.round(tempTop)} °C` : null,
  ].filter(Boolean);
  return say('available', `${parts.join(', ')}.`);
}

// ── Lawinengefahr ────────────────────────────────────────────────────────────

export interface AvalancheRating {
  level: number;
  /** Untergrenze in m; null = alle Höhen. */
  lowerM: number | null;
  upperM: number | null;
  aspects: string[];
}

export interface AvalancheRegion {
  level: number;
  validUntil: string | null;
  ratings?: AvalancheRating[];
}

const AVALANCHE_SOURCE = 'SLF Lawinenbulletin';
const ASPECT_DE: Record<string, string> = { N: 'N', NE: 'NO', E: 'O', SE: 'SO', S: 'S', SW: 'SW', W: 'W', NW: 'NW' };

/** Massgebende Stufe für eine Route: höchste Stufe, deren Höhenband die Route berührt. */
export function relevantRating(region: AvalancheRegion, minElevM: number | null, maxElevM: number | null): AvalancheRating | null {
  const ratings = region.ratings && region.ratings.length > 0 ? region.ratings : [{ level: region.level, lowerM: null, upperM: null, aspects: [] }];
  let best: AvalancheRating | null = null;
  for (const r of ratings) {
    const reachesUp = r.lowerM === null || maxElevM === null || maxElevM >= r.lowerM;
    const reachesDown = r.upperM === null || minElevM === null || minElevM <= r.upperM;
    if (reachesUp && reachesDown && (!best || r.level > best.level)) best = r;
  }
  return best;
}

export function assessAvalanche(
  region: AvalancheRegion | undefined,
  route: { minElevM: number | null; maxElevM: number | null },
  fetchedAt: string | null,
  now: Date,
  mode: 'hike' | 'ski' = 'hike',
): AvailabilityCheck {
  const high = route.maxElevM === null || route.maxElevM >= AVALANCHE_MIN_ELEV_M;
  if (hoursSince(fetchedAt, now) > AVALANCHE_MAX_AGE_H) {
    return high
      ? check('avalanche', 'uncertain', 'Lawinenbulletin zurzeit nicht abrufbar.', 'none', AVALANCHE_SOURCE, fetchedAt)
      : check('avalanche', 'available', `Route unterhalb ${m(AVALANCHE_MIN_ELEV_M)} – Lawinengefahr nicht massgebend.`, 'computed', null, null);
  }
  if (!region || (region.validUntil && Date.parse(region.validUntil) < now.getTime())) {
    return check('avalanche', 'available', 'Kein gültiges Lawinenbulletin für diese Region (ausserhalb der Saison).', 'official', AVALANCHE_SOURCE, fetchedAt);
  }
  const r = relevantRating(region, route.minElevM, route.maxElevM);
  if (!r) {
    return check('avalanche', 'available', 'Die Route liegt ausserhalb der Höhenlagen mit erhöhter Lawinengefahr.', 'official', AVALANCHE_SOURCE, fetchedAt);
  }
  const band = r.lowerM !== null ? ` oberhalb ${m(r.lowerM)}` : r.upperM !== null ? ` unterhalb ${m(r.upperM)}` : '';
  const aspects = r.aspects.length > 0 && r.aspects.length < 8 ? `, Expositionen ${r.aspects.map((a) => ASPECT_DE[a] ?? a).join(', ')}` : '';
  const text = `Gefahrenstufe ${r.level}${band}${aspects}.`;
  let status: AvailabilityStatus;
  if (mode === 'ski') status = r.level >= 4 ? 'uncertain' : 'available';
  else status = r.level >= 3 ? 'unavailable' : r.level === 2 ? 'uncertain' : 'available';
  const suffix = mode === 'ski' && r.level >= 4 ? ' Anlagen und Pisten können gesperrt sein.' : '';
  return check('avalanche', status, `${text}${suffix} Massgebend ist das Bulletin auf whiterisk.ch.`, 'official', AVALANCHE_SOURCE, fetchedAt, 'https://whiterisk.ch');
}

// ── Tageslicht ───────────────────────────────────────────────────────────────

export interface DaylightResult {
  check: AvailabilityCheck;
  endsAt: Date | null;
}

/**
 * Hin- und Rückweg (DIN 33466, ohne Pausen) müssen vor dem Ende der bürgerlichen
 * Dämmerung abgeschlossen sein. Beginnt die Tour vor der Morgendämmerung, zählt
 * der Start ab Dämmerungsbeginn.
 */
export function assessDaylight(
  dest: { lat: number; lng: number },
  plan: { date: string; startHour: number },
  totalMinutes: number,
): DaylightResult {
  const sun = sunTimes(plan.date, dest.lat, dest.lng);
  if (!sun.sunset || !sun.dusk || !sun.dawn) {
    return { check: check('daylight', 'uncertain', 'Sonnenzeiten nicht berechenbar.', 'none', null, null), endsAt: null };
  }
  const planned = zurichToUtc(plan.date, plan.startHour);
  const start = new Date(Math.max(planned.getTime(), sun.dawn.getTime()));
  const endsAt = new Date(start.getTime() + totalMinutes * 60_000);
  const daylightMin = (sun.dusk.getTime() - sun.dawn.getTime()) / 60_000;
  const info = `Sonnenuntergang ${hhmm(sun.sunset)} Uhr`;
  const say = (status: AvailabilityStatus, text: string): DaylightResult => ({
    check: check('daylight', status, text, 'computed', 'Sonnenstand (berechnet)', null),
    endsAt,
  });
  if (totalMinutes > daylightMin) {
    return say('unavailable', `Hin- und Rückweg (${Math.round(totalMinutes / 60)} h) dauern länger als das Tageslicht (${Math.round(daylightMin / 60)} h).`);
  }
  if (endsAt > sun.dusk) {
    return say('unavailable', `Rückkehr erst gegen ${hhmm(endsAt)} Uhr – nach Einbruch der Dunkelheit (${info}). Früher starten.`);
  }
  if (endsAt > sun.sunset) {
    return say('uncertain', `Rückkehr gegen ${hhmm(endsAt)} Uhr, in der Dämmerung (${info}).`);
  }
  return say('available', `Rückkehr gegen ${hhmm(endsAt)} Uhr (ohne Pausen), ${info}.`);
}

// ── Skigebiet: Betrieb und Schnee ────────────────────────────────────────────

export interface LiftLive {
  liftsOpen: number | null;
  liftsTotal: number | null;
  source: string | null;
  capturedAt: string | null;
}

export function assessOperation(live: LiftLive, planDate: string, now: Date): AvailabilityCheck {
  const today = zurichParts(now).date;
  if (!live.source || live.liftsOpen === null || hoursSince(live.capturedAt, now) > LIFTS_MAX_AGE_H) {
    return check(
      'operation', 'uncertain',
      'Betriebsstatus unbekannt: Für dieses Skigebiet gibt es keine frei nutzbare Live-Quelle. Peakr zeigt es deshalb nie als geöffnet an.',
      'none', null, null,
    );
  }
  if (live.liftsOpen === 0) {
    return check('operation', 'unavailable', `Alle Anlagen geschlossen (Stand ${when(live.capturedAt!)}).`, 'official', live.source, live.capturedAt);
  }
  const text = `${live.liftsOpen}${live.liftsTotal ? ` von ${live.liftsTotal}` : ''} Anlagen offen (Stand ${when(live.capturedAt!)}).`;
  if (planDate !== today) {
    return check('operation', 'uncertain', `${text} Für den geplanten Tag gibt es noch keinen Betriebsstatus.`, 'official', live.source, live.capturedAt);
  }
  return check('operation', 'available', text, 'official', live.source, live.capturedAt);
}

export function assessSkiSnow(
  model: { topCm: number | null; valleyCm: number | null; at: string | null; topElevM: number | null },
  station: { station: SnowStation; km: number } | null,
  now: Date,
): AvailabilityCheck {
  const measured = station && station.station.snowCm !== null ? station : null;
  const modelOk = model.topCm !== null && hoursSince(model.at, now) <= FORECAST_MAX_AGE_H;
  if (!measured && !modelOk) {
    return check('snow', 'uncertain', 'Keine aktuelle Schneehöhe für das Gebiet.', 'none', null, null);
  }
  const parts: string[] = [];
  if (modelOk) {
    parts.push(
      `Modell: Berg ${model.topCm} cm${model.valleyCm !== null ? `, Tal ${model.valleyCm} cm` : ''} (Stand ${when(model.at!)})`,
    );
  }
  if (measured) parts.push(`gemessen: ${stationText(measured.station, measured.km)}`);
  const top = measured ? (measured.station.snowCm ?? 0) : (model.topCm ?? 0);
  const low = top < SKI_MIN_SNOW_CM;
  const text = `${parts.join(' · ')}.${low ? ' Wenig Naturschnee – ob technisch beschneit wird, ist nicht bekannt.' : ' Technische Beschneiung ist nicht erfasst.'}`;
  return check(
    'snow', low ? 'uncertain' : 'available', text,
    measured ? 'measured' : 'model',
    measured ? SOURCE_LABEL[measured.station.source] : 'Open-Meteo (Modell)',
    measured ? measured.station.measuredAt : model.at,
  );
}

/** Stationsmessung für ein Skigebiet: nächste Station im Umkreis von 15 km, höchstens 400 m unter/über der Bergstation. */
export function skiStation(
  stations: StationIndex,
  dest: { lat: number; lng: number },
  topElevM: number | null,
  now: Date,
): { station: SnowStation; km: number } | null {
  if (topElevM === null) return null;
  return (
    stations
      .near(dest.lat, dest.lng, 15)
      .filter(({ station: s }) => s.snowCm !== null && Math.abs(s.elevationM - topElevM) <= 400 && hoursSince(s.measuredAt, now) <= SNOW_MAX_AGE_H)[0] ?? null
  );
}
