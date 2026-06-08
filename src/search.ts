import { z } from 'zod';
import { latLngSchema } from './geo';
import { hikeKindSchema, modeSchema, sacDifficultySchema } from './enums';
import { destinationSchema, liveStatusSchema, trendScoreSchema } from './destination';

/** Eingabe für die Kern-Suche POST /api/search. */
export const searchInputSchema = z.object({
  origin: latLngSchema,
  mode: modeSchema,
  maxMinutes: z.number().int().min(15).max(240),
  hikeKind: hikeKindSchema.optional(),
  maxSacDifficulty: sacDifficultySchema.optional(),
  toleranceMinutes: z.number().int().min(0).max(60).default(15),
});
export type SearchInput = z.infer<typeof searchInputSchema>;

/** Transparente Aufschlüsselung des Scores (alle Beiträge nachvollziehbar). */
export const scoreBreakdownSchema = z.object({
  base: z.number(),
  snow: z.number(),
  freshSnow: z.number(),
  liftsOpen: z.number(),
  conditions: z.number(),
  avalanchePenalty: z.number(),
  trendBonus: z.number(),
  total: z.number(),
});
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;

/** Ein einzelnes Suchergebnis mit Fahrzeit, Score und Live-/Trend-Daten. */
export const searchResultSchema = destinationSchema.extend({
  driveMinutes: z.number(),
  /** true, wenn die Fahrzeit eine Luftlinien-Schätzung ist (ORS fand keine Route, z.B. Gipfel ohne Straße). */
  driveEstimated: z.boolean(),
  distanceAirKm: z.number(),
  score: z.number().int().min(0).max(100),
  scoreBreakdown: scoreBreakdownSchema,
  live: liveStatusSchema.nullable(),
  trend: trendScoreSchema.nullable(),
  blocked: z.boolean(),
  blockedReason: z.string().nullable(),
  /** Nur bei Vorschlägen gesetzt: wie viele Minuten über dem Limit (für "+X Min"). */
  overBudgetMinutes: z.number().int().nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
  suggestions: z.array(searchResultSchema),
  meta: z.object({
    candidatesEvaluated: z.number().int(),
    matrixUsed: z.boolean(),
    generatedAt: z.string(),
  }),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
