/**
 * Verfügbarkeit einer Wanderroute bzw. eines Skigebiets aus den Einzelprüfungen.
 *
 * Gesamtstatus = schlechteste Einzelprüfung. Grund = Text der schlechtesten
 * Prüfung (Reihenfolge bei Gleichstand: Sperrung, Lawine, Schnee, Wetter,
 * Tageslicht, Betrieb). Vertrauen: «high» nur mit amtlichen Meldungen,
 * Messungen und Berechnungen; «medium», sobald Prognose oder Modell beteiligt
 * sind; «low», wenn für eine Prüfung Daten fehlen.
 */
import { worstStatus, type Availability, type AvailabilityCheck, type TourPlan } from '@ch-alpineroute/shared';
import {
  assessAvalanche,
  assessClosures,
  assessDaylight,
  assessOperation,
  assessSkiSnow,
  assessSnow,
  assessWeather,
  skiStation,
  type AvalancheRegion,
  type CellForecast,
  type LiftLive,
  type ModelSnow,
  type RouteClosure,
  StationIndex,
} from './checks';
import { zurichToUtc } from './time';

/** Alle zeitabhängigen Grundlagen der Prüfung (aus der Datenbank geladen). */
export interface ConditionsContext {
  /** Schlüssel `${destinationId}:${rank}`. */
  closures: Map<string, RouteClosure[]>;
  closuresAt: string | null;
  stations: StationIndex;
  snowAt: string | null;
  forecasts: Map<string, CellForecast>;
  forecastAt: string | null;
  /** Modellierte Schneehöhe je Wetterzelle (Gegenwart). */
  modelSnow: Map<string, ModelSnow>;
  avalanche: Map<string, AvalancheRegion>;
  avalancheAt: string | null;
}

export function emptyConditions(): ConditionsContext {
  return {
    closures: new Map(), closuresAt: null, stations: new StationIndex([]), snowAt: null,
    forecasts: new Map(), forecastAt: null, modelSnow: new Map(), avalanche: new Map(), avalancheAt: null,
  };
}

/** Reihenfolge bei Gleichstand (Wandern): Sperrung zuerst. */
export const HIKE_ORDER: AvailabilityCheck['kind'][] = ['closure', 'avalanche', 'snow', 'weather', 'daylight', 'operation'];
/** Skigebiet: der Betrieb ist die erste Frage. */
export const SKI_ORDER: AvailabilityCheck['kind'][] = ['operation', 'avalanche', 'snow', 'weather', 'closure', 'daylight'];

export function combine(
  checks: AvailabilityCheck[],
  plan: TourPlan | null,
  endsAt: Date | null,
  now: Date,
  order: AvailabilityCheck['kind'][] = HIKE_ORDER,
): Availability {
  const status = worstStatus(checks.map((c) => c.status));
  const worst = checks
    .filter((c) => c.status === status && status !== 'available')
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0];
  const confidence = checks.some((c) => c.evidence === 'none')
    ? 'low'
    : checks.some((c) => c.evidence === 'forecast' || c.evidence === 'model')
      ? 'medium'
      : 'high';
  return {
    status,
    reason: worst?.text ?? null,
    confidence,
    checkedAt: now.toISOString(),
    plan: plan ? { ...plan, endsAt: endsAt ? endsAt.toISOString() : null } : null,
    checks: [...checks].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)),
  };
}

/** Prüfung, die den Grund liefert (für Zählungen und Hervorhebung). */
export function reasonKind(a: Availability): AvailabilityCheck['kind'] | null {
  return a.checks.find((c) => c.status === a.status && c.text === a.reason)?.kind ?? null;
}

export interface HikeRouteFacts {
  destinationId: string;
  rank: number;
  lat: number;
  lng: number;
  minElevM: number | null;
  maxElevM: number | null;
  durationUpMin: number;
  durationDownMin: number;
  officialShare: number;
  weatherCell: string | null;
  slfRegionId: string | null;
}

/** Sommerroute: Sperrungen, Schnee, Wetter zur Tourzeit, Lawinen, Tageslicht. */
export function evaluateHikeRoute(r: HikeRouteFacts, c: ConditionsContext, plan: TourPlan, now: Date): Availability {
  const total = r.durationUpMin + r.durationDownMin;
  const daylight = assessDaylight({ lat: r.lat, lng: r.lng }, plan, total);
  const from = new Date(Math.max(zurichToUtc(plan.date, plan.startHour).getTime(), now.getTime()));
  const to = daylight.endsAt && daylight.endsAt > from ? daylight.endsAt : new Date(from.getTime() + total * 60_000);
  const checks = [
    assessClosures(c.closures.get(`${r.destinationId}:${r.rank}`), r.officialShare, c.closuresAt, now),
    assessSnow({ lat: r.lat, lng: r.lng }, r.maxElevM, c.stations, r.weatherCell ? (c.modelSnow.get(r.weatherCell) ?? null) : null, now),
    assessWeather(r.weatherCell ? c.forecasts.get(r.weatherCell) : undefined, { from, to }, r.maxElevM, now),
    assessAvalanche(r.slfRegionId ? c.avalanche.get(r.slfRegionId) : undefined, r, c.avalancheAt, now, 'hike'),
    daylight.check,
  ];
  return combine(checks, plan, daylight.endsAt, now);
}

export interface SkiResortFacts {
  lat: number;
  lng: number;
  topElevM: number | null;
  baseElevM: number | null;
  slfRegionId: string | null;
  lifts: LiftLive;
  snowTopCm: number | null;
  snowValleyCm: number | null;
  snowAt: string | null;
  /** Tagesprognose an der Bergstation (Zeitreihe stündlich oder als Tageswerte, siehe CellForecast). */
  forecast: CellForecast | undefined;
}

/** Skitag 9–16 Uhr Schweizer Zeit. */
export const SKI_DAY = { from: 9, to: 16 } as const;

/** Skigebiet: Betrieb, Schnee, Wetter am Skitag, Lawinen. Ohne Live-Betriebsstatus höchstens «uncertain». */
export function evaluateSkiResort(s: SkiResortFacts, c: ConditionsContext, plan: TourPlan, now: Date): Availability {
  const from = new Date(Math.max(zurichToUtc(plan.date, SKI_DAY.from).getTime(), now.getTime()));
  const to = zurichToUtc(plan.date, SKI_DAY.to);
  const checks = [
    assessOperation(s.lifts, plan.date, now),
    assessSkiSnow(
      { topCm: s.snowTopCm, valleyCm: s.snowValleyCm, at: s.snowAt, topElevM: s.topElevM },
      skiStation(c.stations, { lat: s.lat, lng: s.lng }, s.topElevM, now),
      now,
    ),
    to > from
      ? assessWeather(s.forecast, { from, to }, s.topElevM, now)
      : { kind: 'weather' as const, status: 'available' as const, text: 'Skitag bereits vorbei – Wetter nicht geprüft.', evidence: 'computed' as const, source: null, observedAt: null },
    assessAvalanche(s.slfRegionId ? c.avalanche.get(s.slfRegionId) : undefined, { minElevM: s.baseElevM, maxElevM: s.topElevM }, c.avalancheAt, now, 'ski'),
  ];
  return combine(checks, { date: plan.date, startHour: SKI_DAY.from }, to, now, SKI_ORDER);
}
