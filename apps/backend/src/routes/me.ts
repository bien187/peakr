import { setOpenAiKeySchema, updateMeSchema } from '@ch-alpineroute/shared';
import type { FastifyInstance } from 'fastify';
import { AppError, validate } from '../lib/errors';
import { requireUser } from '../plugins/auth';
import {
  clearOpenAiKey,
  getPublicUser,
  setOpenAiKey,
  updateProfile,
} from '../repositories/user.repo';
import { encryptSecret } from '../services/crypto.service';

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/me', { preHandler: app.authenticate }, async (request) => {
    const { id } = requireUser(request);
    const user = await getPublicUser(id);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'Benutzer nicht gefunden.');
    return user;
  });

  app.patch('/api/me', { preHandler: app.authenticate }, async (request) => {
    const { id } = requireUser(request);
    const patch = validate(updateMeSchema, request.body);
    await updateProfile(id, patch);
    const user = await getPublicUser(id);
    if (!user) throw new AppError(404, 'NOT_FOUND', 'Benutzer nicht gefunden.');
    return user;
  });

  // Optionaler OpenAI-Key — verschlüsselt speichern, nie zurückgeben.
  app.put('/api/me/openai-key', { preHandler: app.authenticate }, async (request) => {
    const { id } = requireUser(request);
    const { apiKey } = validate(setOpenAiKeySchema, request.body);
    const { ciphertext, iv } = encryptSecret(apiKey);
    await setOpenAiKey(id, ciphertext, iv);
    return { message: 'OpenAI-Key verschlüsselt gespeichert.' };
  });

  app.delete('/api/me/openai-key', { preHandler: app.authenticate }, async (request) => {
    const { id } = requireUser(request);
    await clearOpenAiKey(id);
    return { message: 'OpenAI-Key entfernt.' };
  });
}
