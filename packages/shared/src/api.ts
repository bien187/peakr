import { z } from 'zod';
import { dataSourceSchema } from './destination';

/** Einheitliches Fehlerformat der API. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const messageResponseSchema = z.object({
  message: z.string(),
});
export type MessageResponse = z.infer<typeof messageResponseSchema>;

/** GET /api/health – Betriebszustand inkl. Aktualität der Daten. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  timestamp: z.string(),
  database: z.boolean(),
  routing: z.object({
    available: z.boolean(),
    graphBuiltAt: z.string().nullable(),
    osmTimestamp: z.string().nullable(),
  }),
  /** Anmeldung betriebsbereit (Signatur-Geheimnis gesetzt und lang genug). */
  auth: z.object({ configured: z.boolean() }),
  /** Suchindex (statische Ziele, Ausgangspunkte, Routen) im Funktions-Bundle. */
  searchIndex: z.object({
    available: z.boolean(),
    builtAt: z.string().nullable(),
    destinations: z.number().int(),
    routes: z.number().int(),
  }),
  data: z.object({
    destinations: z.number().int(),
    skiResorts: z.number().int(),
    hikeRoutes: z.number().int(),
    dataVersion: z.string().nullable(),
  }),
  jobs: z.array(
    z.object({
      job: z.string(),
      status: z.string(),
      finishedAt: z.string().nullable(),
      ageHours: z.number().nullable(),
      stale: z.boolean(),
    }),
  ),
  sources: z.array(dataSourceSchema),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
