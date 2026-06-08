import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, validate } from '../lib/errors';
import { getDestinationDetail } from '../repositories/destination.repo';

const paramsSchema = z.object({ id: z.string().uuid() });

export async function destinationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/destinations/:id', async (request) => {
    const { id } = validate(paramsSchema, request.params);
    const detail = await getDestinationDetail(id);
    if (!detail) throw new AppError(404, 'NOT_FOUND', 'Ziel nicht gefunden.');
    return detail;
  });
}
