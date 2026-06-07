import { z } from 'zod';

/** Art eines Ziels in der Datenbank. */
export const destinationTypeSchema = z.enum(['ski_resort', 'hike_route', 'hike_destination']);
export type DestinationType = z.infer<typeof destinationTypeSchema>;

/** SAC-Wanderskala T1 (einfach) … T6 (sehr schwierig). */
export const sacDifficultySchema = z.enum(['T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
export type SacDifficulty = z.infer<typeof sacDifficultySchema>;

/** Reihenfolge zum Vergleichen von SAC-Graden. */
export const SAC_ORDER: Record<SacDifficulty, number> = {
  T1: 1,
  T2: 2,
  T3: 3,
  T4: 4,
  T5: 5,
  T6: 6,
};

/** Such-Modus. */
export const modeSchema = z.enum(['ski', 'hike']);
export type Mode = z.infer<typeof modeSchema>;

/** Optionaler Wanderziel-Filter. */
export const hikeKindSchema = z.enum(['any', 'peak', 'lake', 'hut', 'viewpoint', 'route']);
export type HikeKind = z.infer<typeof hikeKindSchema>;

/** Benutzerrolle. */
export const userRoleSchema = z.enum(['user', 'admin']);
export type UserRole = z.infer<typeof userRoleSchema>;

/** Status eines Wanderwegs / einer Piste. */
export const trailStatusSchema = z.enum(['open', 'partial', 'closed', 'unknown']);
export type TrailStatus = z.infer<typeof trailStatusSchema>;
