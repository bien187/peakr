import type { SearchInput, SearchResponse, SearchResult } from '@ch-alpineroute/shared';
import { logger } from '../lib/logger';
import { findCandidates, type Candidate } from '../repositories/destination.repo';
import { drivingMatrixMinutes, isOrsConfigured } from './ors.service';
import { computeScore } from './score.service';

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Fallback-Fahrzeit, wenn ORS nicht verfügbar ist: Luftlinie × 1,4 bei ~50 km/h. */
export function estimateDriveMinutes(airKm: number): number {
  return round1(((airKm * 1.4) / 50) * 60);
}

/**
 * Reine Funktion: baut aus Kandidaten + Fahrzeiten die finale Antwort.
 * - Aufteilung results (≤ maxMinutes) / suggestions (≤ maxMinutes + Toleranz)
 * - Sicherheits-Gate: Ski-Ziele mit Lawinenstufe ≥4 → blocked
 * - Sortierung: nicht-blockiert zuerst, dann nach Score
 */
export function assembleResponse(
  input: SearchInput,
  candidates: Candidate[],
  driveMinutes: (number | null)[],
  matrixUsed: boolean,
): SearchResponse {
  const results: SearchResult[] = [];
  const suggestions: SearchResult[] = [];

  candidates.forEach((c, i) => {
    const drive = driveMinutes[i];
    if (drive == null) return; // unerreichbar

    const within = drive <= input.maxMinutes;
    const withinTolerance = drive <= input.maxMinutes + input.toleranceMinutes;
    if (!within && !withinTolerance) return;

    const { score, breakdown } = computeScore({ mode: input.mode, live: c.live, trend: c.trend });
    const level = c.live?.avalancheLevel ?? null;
    const blocked = input.mode === 'ski' && level != null && level >= 4;

    const result: SearchResult = {
      ...c.destination,
      driveMinutes: round1(drive),
      distanceAirKm: c.airKm,
      score,
      scoreBreakdown: breakdown,
      live: c.live,
      trend: c.trend,
      blocked,
      blockedReason: blocked ? `Lawinengefahr Stufe ${level} – nicht empfohlen` : null,
      overBudgetMinutes: within ? null : Math.round(drive - input.maxMinutes),
    };

    (within ? results : suggestions).push(result);
  });

  results.sort(
    (a, b) =>
      Number(a.blocked) - Number(b.blocked) || b.score - a.score || a.driveMinutes - b.driveMinutes,
  );
  suggestions.sort(
    (a, b) =>
      Number(a.blocked) - Number(b.blocked) ||
      (a.overBudgetMinutes ?? 0) - (b.overBudgetMinutes ?? 0) ||
      b.score - a.score,
  );

  return {
    results,
    suggestions,
    meta: {
      candidatesEvaluated: candidates.length,
      matrixUsed,
      generatedAt: new Date().toISOString(),
    },
  };
}

/** Kern-Suche: Grobfilter → ORS-Matrix → Join → Gate → Scoring → Vorschläge. */
export async function search(input: SearchInput): Promise<SearchResponse> {
  const radiusM = (input.maxMinutes + input.toleranceMinutes) * 1500;
  const candidates = await findCandidates(input, radiusM);

  if (candidates.length === 0) {
    return {
      results: [],
      suggestions: [],
      meta: { candidatesEvaluated: 0, matrixUsed: false, generatedAt: new Date().toISOString() },
    };
  }

  let driveMinutes: (number | null)[];
  let matrixUsed = false;

  if (isOrsConfigured()) {
    try {
      driveMinutes = await drivingMatrixMinutes(
        input.origin,
        candidates.map((c) => c.destination.location),
      );
      matrixUsed = true;
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        'ORS-Matrix fehlgeschlagen – nutze Luftlinien-Schätzung',
      );
      driveMinutes = candidates.map((c) => estimateDriveMinutes(c.airKm));
    }
  } else {
    logger.warn('ORS_API_KEY fehlt – Fahrzeiten sind nur Schätzungen.');
    driveMinutes = candidates.map((c) => estimateDriveMinutes(c.airKm));
  }

  return assembleResponse(input, candidates, driveMinutes, matrixUsed);
}
