import { z } from 'zod';

export const registerInputSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8, 'Mindestens 8 Zeichen').max(200),
  displayName: z.string().min(1).max(80).optional(),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginInputSchema>;
