/**
 * Schweizer Ortszeit (Europe/Zurich, mit Sommerzeit) und Tourplanung.
 * Die Rechnung läuft über die Zeitzonendaten von Intl, nicht über feste Offsets.
 */
import type { TourPlan } from '@ch-alpineroute/shared';

const ZONE = 'Europe/Zurich';
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export interface ZurichParts {
  date: string;
  hour: number;
  minute: number;
}

// Intl ist langsam (~2 µs je Aufruf) und eine Suche braucht pro Route mehrere
// Umrechnungen: Ergebnisse je Minute zwischenspeichern.
const partsCache = new Map<number, ZurichParts>();

/** Datum (YYYY-MM-DD), Stunde und Minute eines Zeitpunkts in Schweizer Zeit. */
export function zurichParts(at: Date): ZurichParts {
  const minute = Math.floor(at.getTime() / 60_000);
  const hit = partsCache.get(minute);
  if (hit) return hit;
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  const parts = { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
  if (partsCache.size > 20_000) partsCache.clear();
  partsCache.set(minute, parts);
  return parts;
}

/** Offset der Schweizer Zeit gegenüber UTC in Minuten (60 im Winter, 120 im Sommer). */
function offsetMinutes(at: Date): number {
  const z = zurichParts(at);
  const asUtc = Date.parse(`${z.date}T${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}:00Z`);
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

const utcCache = new Map<string, number>();

/** Zeitpunkt (UTC) einer Schweizer Ortszeit. */
export function zurichToUtc(date: string, hour: number, minute = 0): Date {
  const key = `${date}|${hour}|${minute}`;
  const hit = utcCache.get(key);
  if (hit !== undefined) return new Date(hit);
  const local = Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  // Zweimal annähern: der Offset hängt vom Ergebnis ab (Umstellung Sommer-/Winterzeit).
  let guess = local - offsetMinutes(new Date(local)) * 60_000;
  guess = local - offsetMinutes(new Date(guess)) * 60_000;
  if (utcCache.size > 5_000) utcCache.clear();
  utcCache.set(key, guess);
  return new Date(guess);
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T12:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Zulässige Planungstage: heute bis übermorgen (Reichweite der gespeicherten Prognose). */
export function planDates(now: Date): string[] {
  const today = zurichParts(now).date;
  return [today, addDays(today, 1), addDays(today, 2)];
}

/** Ab dieser Stunde schlägt Peakr den nächsten Tag vor. */
const LATE_HOUR = 14;
const DEFAULT_START = 8;

/**
 * Wirksame Planung: ohne Angabe heute ab der nächsten vollen Stunde (frühestens
 * 7 Uhr), am Nachmittag morgen ab 8 Uhr. Ein Start in der Vergangenheit wird auf
 * die nächste volle Stunde gesetzt; Tage ausserhalb der Prognose auf den Standard.
 */
export function resolvePlan(plan: TourPlan | undefined, now: Date): TourPlan {
  const z = zurichParts(now);
  const days = planDates(now);
  const nextHour = Math.min(23, z.hour + 1);
  if (!plan || !days.includes(plan.date)) {
    return z.hour < LATE_HOUR ? { date: z.date, startHour: Math.max(7, nextHour) } : { date: days[1], startHour: DEFAULT_START };
  }
  if (plan.date === z.date && plan.startHour <= z.hour) return { date: plan.date, startHour: nextHour };
  return plan;
}

/** Uhrzeit «HH:MM» in Schweizer Zeit. */
export function hhmm(at: Date): string {
  const z = zurichParts(at);
  return `${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}`;
}
