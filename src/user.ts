import { z } from 'zod';
import { latLngSchema } from './geo';
import { userRoleSchema } from './enums';

/** Öffentliche Sicht auf einen Benutzer (niemals Passwort/Key-Bytes). */
export const publicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  homeLocation: latLngSchema.nullable(),
  homeLabel: z.string().nullable(),
  role: userRoleSchema,
  hasOpenAiKey: z.boolean(),
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const authResponseSchema = z.object({
  token: z.string(),
  user: publicUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** PATCH /api/me — alle Felder optional. */
export const updateMeSchema = z
  .object({
    displayName: z.string().min(1).max(80),
    homeLocation: latLngSchema,
    homeLabel: z.string().max(200),
  })
  .partial();
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

/** PUT /api/me/openai-key — optionaler, verschlüsselt gespeicherter Key. */
export const setOpenAiKeySchema = z.object({
  apiKey: z.string().min(20).max(300),
});
export type SetOpenAiKeyInput = z.infer<typeof setOpenAiKeySchema>;
