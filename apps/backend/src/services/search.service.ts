import type { SearchInput, SearchResponse, SearchResult } from '@ch-alpineroute/shared';
import { logger } from '../lib/logger';
import { findCandidates, type Candidate } from '../repositories/destination.repo';
import { drivingMatrixMinutes, isOrsConfigured } from './ors.service';
import { computeScore } from './score.service';

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Fallback-Fahrzeit, wenn ORS keine Route findet (z.B. Gipfel ohne Straße in der Nähe)
 * oder kein Key gesetzt ist: Luftlinie × 1,4 bei ~50 km/h.
 */
export function estimateDriveMinutes(airKm: number): number {
  return round1(((airKm * 1.4) / 50) * 60);
}

export interface DriveInfo {
  minutes: number;
  estimated: boolean;
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
  drives: DriveInfo[],
  matrixUsed: boolean,
): SearchResponse {
  const results: SearchResult[] = [];
  const suggestions: SearchResult[] = [];

  candidates.forEach((c, i) => {
    const drive = drives[i];
    if (!drive) return;

    const within = drive.minutes <= input.maxMinutes;
    const withinTolerance = drive.minutes <= input.maxMinutes + input.toleranceMinutes;
    if (!within && !withinTolerance) return;

    const { score, breakdown } = computeScore({
      mode: input.mode,
      live: c.live,
      trend: c.trend,
      qualityScore: c.destination.qualityScore ?? null,
    });
    const level = c.live?.avalancheLevel ?? null;
    const blocked = input.mode === 'ski' && level != null && level >= 4;

    const result: SearchResult = {
      ...c.destination,
      driveMinutes: round1(drive.minutes),
      driveEstimated: drive.estimated,
      distanceAirKm: c.airKm,
      score,
      scoreBreakdown: breakdown,
      live: c.live,
      trend: c.trend,
      blocked,
      blockedReason: blocked ? `Lawinengefahr Stufe ${level} – nicht empfohlen` : null,
      overBudgetMinutes: within ? null : Math.round(drive.minutes - input.maxMinutes),
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

  let orsMinutes: (number | null)[] | null = null;
  if (isOrsConfigured()) {
    try {
      orsMinutes = await drivingMatrixMinutes(
        input.origin,
        candidates.map((c) => c.destination.location),
      );
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        'ORS-Matrix fehlgeschlagen – nutze Luftlinien-Schätzung',
      );
    }
  } else {
    logger.warn('ORS_API_KEY fehlt – Fahrzeiten sind nur Schätzungen.');
  }

  const matrixUsed = orsMinutes !== null;

  // Unroutbare Ziele (ORS liefert null, z.B. Gipfel ohne Straße) werden NICHT verworfen,
  // sondern bekommen eine Luftlinien-Schätzung → deutlich mehr Treffer (v.a. beim Wandern).
  const drives: DriveInfo[] = candidates.map((c, i) => {
    const m = orsMinutes ? orsMinutes[i] : null;
    return typeof m === 'number' && Number.isFinite(m)
      ? { minutes: m, estimated: false }
      : { minutes: estimateDriveMinutes(c.airKm), estimated: true };
  });

  return assembleResponse(input, candidates, drives, matrixUsed);
}
