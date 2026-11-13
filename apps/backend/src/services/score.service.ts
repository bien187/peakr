import type { LiveStatus, Mode, ScoreBreakdown, TrendScore } from '@ch-alpineroute/shared';

/**
 * Transparente Bewertung 0–100. Jeder Beitrag steht im Breakdown.
 *
 * Ski:     Basis 20 + Schnee 30 + Neuschnee 15 + Lifte offen 10 + Bedingungen 10
 *          + Grösse 10 + Trend 5 − Lawinen-Abzug
 * Wandern: Basis 30 + Bedingungen 30 + Bedeutung 20 + Datenlage 15 + Trend 5
 *
 * Fehlende Messwerte geben keine Punkte (Schnee, Lifte) bzw. einen neutralen
 * Mittelwert (Bedingungen) – sie werden nie durch Annahmen ersetzt.
 */
export interface ScoreContext {
  mode: Mode;
  live: LiveStatus | null;
  trend: TrendScore | null;
  /** Bedeutung 1–5 (Objektklasse bzw. Anzahl Anlagen). */
  importance?: number | null;
  /** Metadaten-Qualität 0–100. */
  qualityScore?: number | null;
  /** Anzahl Anlagen eines Skigebiets. */
  liftsTotal?: number | null;
  /** Wanderroute: Anteil amtlicher Wege und ob die Schwierigkeit bekannt ist. */
  officialShare?: number | null;
  sacKnown?: boolean;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Lawinen-Abzug nach SLF-Stufe (Stufe ≥4 wird separat als blocked behandelt). */
export function avalanchePenalty(level: number | null): number {
  switch (level) {
    case 2:
      return 3;
    case 3:
      return 12;
    case 4:
      return 30;
    case 5:
      return 50;
    default:
      return 0; // Stufe 1 oder unbekannt
  }
}

/**
 * Bewertet Bedingungen (Sicht + Wetter) als 0..maxPoints.
 * Schneefall (WMO 71–77) zählt für Ski positiv, für Wandern negativ.
 */
export function conditionsScore(live: LiveStatus | null, mode: Mode, maxPoints: number): number {
  if (!live) return Math.round(maxPoints * 0.5); // neutral bei fehlenden Daten

  let visGood = 0.5;
  if (live.visibilityM != null) {
    visGood = live.visibilityM >= 10000 ? 1 : live.visibilityM >= 4000 ? 0.7 : live.visibilityM >= 1500 ? 0.4 : 0.1;
  }

  let weatherGood = 0.6;
  const wc = live.weatherCode;
  if (wc != null) {
    if (wc <= 1) weatherGood = 1;
    else if (wc <= 3) weatherGood = 0.8;
    else if (wc <= 48) weatherGood = 0.45;
    else if (mode === 'ski' && wc >= 71 && wc <= 77) weatherGood = 0.85;
    else weatherGood = 0.3;
  }

  return Math.round((visGood * 0.5 + weatherGood * 0.5) * maxPoints);
}

export function computeScore(ctx: ScoreContext): { score: number; breakdown: ScoreBreakdown } {
  const { mode, live, trend } = ctx;
  const trendBonus = Math.round(((trend?.score ?? 0) / 100) * 5);

  if (mode === 'ski') {
    const base = 20;
    const snowCm = live?.snowDepthTopCm ?? live?.snowDepthValleyCm ?? 0;
    const snow = Math.round(Math.min(30, snowCm / 5));
    const freshSnow = Math.round(Math.min(15, (live?.freshSnowCm ?? 0) * 1.5));
    const liftsOpen =
      live && live.liftsOpen != null && live.liftsTotal && live.liftsTotal > 0
        ? Math.round((Math.min(live.liftsOpen, live.liftsTotal) / live.liftsTotal) * 10)
        : 0;
    const conditions = conditionsScore(live, mode, 10);
    const size = Math.round(Math.min(10, (ctx.liftsTotal ?? 0) / 4));
    const penalty = avalanchePenalty(live?.avalancheLevel ?? null);
    const total = clamp(base + snow + freshSnow + liftsOpen + conditions + size + trendBonus - penalty, 0, 100);
    return {
      score: total,
      breakdown: { base, snow, freshSnow, liftsOpen, conditions, avalanchePenalty: penalty, trendBonus, size, data: 0, total },
    };
  }

  const base = 30;
  const conditions = conditionsScore(live, mode, 30);
  const size = Math.round(clamp(ctx.importance ?? 1, 1, 5) * 4);
  const data = Math.round(
    ((ctx.qualityScore ?? 0) / 100) * 7 + (ctx.officialShare ?? 0) * 5 + (ctx.sacKnown ? 3 : 0),
  );
  const total = clamp(base + conditions + size + data + trendBonus, 0, 100);
  return {
    score: total,
    breakdown: { base, snow: 0, freshSnow: 0, liftsOpen: 0, conditions, avalanchePenalty: 0, trendBonus, size, data, total },
  };
}
