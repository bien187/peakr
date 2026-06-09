import type { LiveStatus, Mode, ScoreBreakdown, TrendScore } from '@ch-alpineroute/shared';

export interface ScoreContext {
  mode: Mode;
  live: LiveStatus | null;
  trend: TrendScore | null;
  qualityScore?: number | null; // 0–100, aus destinations.quality_score
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
    visGood =
      live.visibilityM >= 10000
        ? 1
        : live.visibilityM >= 4000
          ? 0.7
          : live.visibilityM >= 1500
            ? 0.4
            : 0.1;
  }

  let weatherGood = 0.6;
  const wc = live.weatherCode;
  if (wc != null) {
    if (wc <= 1)
      weatherGood = 1; // klar/überw. klar
    else if (wc <= 3)
      weatherGood = 0.8; // bewölkt
    else if (wc <= 48)
      weatherGood = 0.45; // Nebel
    else if (mode === 'ski' && wc >= 71 && wc <= 77)
      weatherGood = 0.85; // Schneefall = gut für Ski
    else weatherGood = 0.3; // Regen/Schauer/Gewitter
  }

  return Math.round((visGood * 0.5 + weatherGood * 0.5) * maxPoints);
}

/**
 * Transparente Score-Formel (0–100). Jeder Beitrag ist im Breakdown nachvollziehbar.
 * Ski:     Basis 25 + Schnee 30 + Neuschnee 15 + Lifte 10 + Bedingungen 10 + Qualität 5 + Trend 5 − Lawine
 * Wandern: Basis 50 + Bedingungen 25 + Qualität 5 + Trend 5 (trendBonus auf max 5 reduziert)
 */
export function computeScore(ctx: ScoreContext): { score: number; breakdown: ScoreBreakdown } {
  const { mode, live, trend, qualityScore } = ctx;
  // quality_score (0–100) → max 5 Zusatzpunkte im Such-Score
  const qualityBonus = qualityScore != null ? Math.round((qualityScore / 100) * 5) : 2;

  if (mode === 'ski') {
    const base = 25;
    const snowCm = live?.snowDepthTopCm ?? live?.snowDepthValleyCm ?? 0;
    const snow = Math.round(Math.min(30, snowCm / 10));
    const freshSnow = Math.round(Math.min(15, (live?.freshSnowCm ?? 0) * 1.5));
    const liftsOpen =
      live && live.liftsTotal && live.liftsTotal > 0
        ? Math.round((Math.min(live.liftsOpen ?? 0, live.liftsTotal) / live.liftsTotal) * 10)
        : 0;
    const conditions = conditionsScore(live, mode, 10);
    const trendBonus = Math.round(((trend?.score ?? 0) / 100) * 5); // max 5 (vorher 10)
    const penalty = avalanchePenalty(live?.avalancheLevel ?? null);
    const total = clamp(
      base + snow + freshSnow + liftsOpen + conditions + qualityBonus + trendBonus - penalty,
      0,
      100,
    );
    return {
      score: total,
      breakdown: {
        base,
        snow,
        freshSnow,
        liftsOpen,
        conditions,
        avalanchePenalty: penalty,
        trendBonus,
        total,
      },
    };
  }

  // Wandern
  const base = 50;
  const conditions = conditionsScore(live, mode, 25);
  const trendBonus = Math.round(((trend?.score ?? 0) / 100) * 5); // max 5 (vorher 20)
  const total = clamp(base + conditions + qualityBonus + trendBonus, 0, 100);
  return {
    score: total,
    breakdown: {
      base,
      snow: 0,
      freshSnow: 0,
      liftsOpen: 0,
      conditions,
      avalanchePenalty: 0,
      trendBonus,
      total,
    },
  };
}
