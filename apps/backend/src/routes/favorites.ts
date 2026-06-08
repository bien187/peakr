import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { validate } from '../lib/errors';
import { requireUser } from '../plugins/auth';
import { addFavorite, listFavorites, removeFavorite } from '../repositories/favorites.repo';

const paramsSchema = z.object({ destinationId: z.string().uuid() });

export async function favoriteRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/favorites', { preHandler: app.authenticate }, async (request) => {
    const { id } = requireUser(request);
    return listFavorites(id);
  });

  app.post(
    '/api/favorites/:destinationId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = requireUser(request);
      const { destinationId } = validate(paramsSchema, request.params);
      await addFavorite(id, destinationId);
      return reply.code(201).send({ message: 'Favorit hinzugefügt.' });
    },
  );

  app.delete(
    '/api/favorites/:destinationId',
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = requireUser(request);
      const { destinationId } = validate(paramsSchema, request.params);
      await removeFavorite(id, destinationId);
      return { message: 'Favorit entfernt.' };
    },
  );
}
