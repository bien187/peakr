import type { DataFreshness } from '@ch-alpineroute/shared';
import { zurichParts } from '../availability/time';

/**
 * Aktualität von Statusberichten und Saisonlogik – zentral an einem Ort.
 *
 * LiftRadar liest die Berichte der Gebiete etwa um 08:40 und 13:40 MEZ. Ein
 * Bericht vom Morgen ist am Abend also noch der neueste; über Nacht entsteht
 * eine Lücke von rund 19 Stunden. Daraus die Grenzen:
 *  - fresh    ≤ 12 h  – Bericht vom selben Tag (gilt auch für die Verfügbarkeit)
 *  - stale    ≤ 36 h  – Bericht von gestern: «älter», für heute nicht verlässlich
 *  - outdated > 36 h  – veraltet
 *  - unknown          – kein Zeitpunkt bekannt
 */
export const FRESHNESS_HOURS = { fresh: 12, stale: 36 } as const;

export function freshnessOf(
  dataAt: string | null,
  now: Date,
): { freshness: DataFreshness; ageHours: number | null } {
  if (!dataAt) return { freshness: 'unknown', ageHours: null };
  const t = Date.parse(dataAt);
  if (Number.isNaN(t)) return { freshness: 'unknown', ageHours: null };
  // Leicht in der Zukunft liegende Zeitpunkte (Uhrenabweichung) zählen als jetzt.
  const ageHours = Math.max(0, (now.getTime() - t) / 3_600_000);
  const rounded = Math.round(ageHours * 10) / 10;
  if (ageHours <= FRESHNESS_HOURS.fresh) return { freshness: 'fresh', ageHours: rounded };
  if (ageHours <= FRESHNESS_HOURS.stale) return { freshness: 'stale', ageHours: rounded };
  return { freshness: 'outdated', ageHours: rounded };
}

/**
 * Zeitplan des Abgleichs. Der Job selbst entscheidet anhand dieser Werte, ob er
 * etwas tun muss; GitHub Actions bzw. `pnpm worker schedule` starten ihn nur.
 * Alle Werte lassen sich über Umgebungsvariablen anpassen (siehe readLiftSchedule).
 */
export interface LiftSchedule {
  /** Monate der Skisaison (1–12). */
  seasonMonths: number[];
  /** In der Saison: frühestens so viele Minuten nach dem letzten erfolgreichen Abgleich. */
  seasonMinIntervalMin: number;
  /** Ausserhalb der Saison: höchstens ein Abgleich je so viele Stunden. */
  offSeasonIntervalH: number;
  /** Gleichzeitige Abrufe bei der Quelle. */
  concurrency: number;
}

export const DEFAULT_LIFT_SCHEDULE: LiftSchedule = {
  seasonMonths: [11, 12, 1, 2, 3, 4],
  seasonMinIntervalMin: 40,
  offSeasonIntervalH: 20,
  concurrency: 4,
};

function intList(raw: string | undefined): number[] | null {
  if (!raw) return null;
  const list = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
  return list.length > 0 ? list : null;
}

function positive(raw: string | undefined, max: number): number | null {
  const n = Number(raw);
  return raw !== undefined && Number.isFinite(n) && n > 0 && n <= max ? n : null;
}

/** LIFTS_SEASON_MONTHS="11,12,1,2,3,4", LIFTS_SEASON_MIN_INTERVAL_MIN, LIFTS_OFFSEASON_INTERVAL_H, LIFTS_CONCURRENCY. */
export function readLiftSchedule(
  env: Record<string, string | undefined> = process.env,
): LiftSchedule {
  return {
    seasonMonths: intList(env.LIFTS_SEASON_MONTHS) ?? DEFAULT_LIFT_SCHEDULE.seasonMonths,
    seasonMinIntervalMin:
      positive(env.LIFTS_SEASON_MIN_INTERVAL_MIN, 24 * 60) ??
      DEFAULT_LIFT_SCHEDULE.seasonMinIntervalMin,
    offSeasonIntervalH:
      positive(env.LIFTS_OFFSEASON_INTERVAL_H, 24 * 30) ?? DEFAULT_LIFT_SCHEDULE.offSeasonIntervalH,
    concurrency: Math.round(
      positive(env.LIFTS_CONCURRENCY, 8) ?? DEFAULT_LIFT_SCHEDULE.concurrency,
    ),
  };
}

export function inSeason(now: Date, schedule: LiftSchedule): boolean {
  const month = Number(zurichParts(now).date.slice(5, 7));
  return schedule.seasonMonths.includes(month);
}

/** Muss der Abgleich jetzt laufen? Liefert den Grund, wenn nicht. `force` (manueller Lauf) übergeht alles. */
export function shouldSync(
  now: Date,
  lastSuccessAt: Date | null,
  schedule: LiftSchedule,
  force: boolean,
): { run: true } | { run: false; reason: string } {
  if (force || !lastSuccessAt) return { run: true };
  const minutes = (now.getTime() - lastSuccessAt.getTime()) / 60_000;
  if (inSeason(now, schedule)) {
    return minutes >= schedule.seasonMinIntervalMin
      ? { run: true }
      : { run: false, reason: `letzter Abgleich vor ${Math.round(minutes)} min` };
  }
  return minutes >= schedule.offSeasonIntervalH * 60
    ? { run: true }
    : {
        run: false,
        reason: `ausserhalb der Saison, letzter Abgleich vor ${Math.round(minutes / 60)} h`,
      };
}
