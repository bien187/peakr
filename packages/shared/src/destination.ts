import { z } from 'zod';
import { latLngSchema } from './geo';
import { destinationTypeSchema, sacDifficultySchema } from './enums';

/** Ein Live-Snapshot (Wetter/Schnee/Lawine/Lift) zu einem Ziel. */
export const liveStatusSchema = z.object({
  capturedAt: z.string(),
  temperatureC: z.number().nullable(),
  weatherCode: z.number().int().nullable(),
  visibilityM: z.number().int().nullable(),
  windKmh: z.number().nullable(),
  snowDepthValleyCm: z.number().int().nullable(),
  snowDepthTopCm: z.number().int().nullable(),
  freshSnowCm: z.number().nullable(),
  avalancheLevel: z.number().int().min(1).max(5).nullable(),
  liftsOpen: z.number().int().nullable(),
  liftsTotal: z.number().int().nullable(),
  slopesOpenKm: z.number().nullable(),
  trailStatus: z.string().nullable(),
});
export type LiveStatus = z.infer<typeof liveStatusSchema>;

/** Bekanntheits-/Trend-Score eines Ziels. */
export const trendScoreSchema = z.object({
  score: z.number().int().min(1).max(100),
  rationale: z.string().nullable(),
  source: z.string().nullable(),
  isEstimate: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type TrendScore = z.infer<typeof trendScoreSchema>;

/** Stammdaten eines Ziels (ohne Live-/Trend-Daten). */
export const destinationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: destinationTypeSchema,
  canton: z.string().nullable(),
  location: latLngSchema,
  elevationBaseM: z.number().int().nullable(),
  elevationTopM: z.number().int().nullable(),
  sacDifficulty: sacDifficultySchema.nullable(),
  ascentM: z.number().int().nullable(),
  distanceKm: z.number().nullable(),
  wikipediaTitle: z.string().nullable(),
  slfRegionId: z.string().nullable(),
});
export type Destination = z.infer<typeof destinationSchema>;

/** Detailansicht inkl. aktuellem Status, Trend und Verlauf für Charts. */
export const destinationDetailSchema = destinationSchema.extend({
  live: liveStatusSchema.nullable(),
  trend: trendScoreSchema.nullable(),
  history: z.array(liveStatusSchema),
});
export type DestinationDetail = z.infer<typeof destinationDetailSchema>;
