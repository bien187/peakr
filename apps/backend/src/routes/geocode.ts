import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { validate } from '../lib/errors';
import { geocode } from '../services/swisstopo.service';

const querySchema = z.object({
  q: z.string().min(2, 'Mindestens 2 Zeichen').max(120),
});

export async function geocodeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/geocode', async (request) => {
    const { q } = validate(querySchema, request.query);
    const results = await geocode(q);
    return { results };
  });
}
