import { isInSwitzerland, searchInputSchema } from '@ch-alpineroute/shared';
import type { FastifyInstance } from 'fastify';
import { AppError, validate } from '../lib/errors';
import { search } from '../services/search.service';

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/search', async (request) => {
    const input = validate(searchInputSchema, request.body);
    if (!isInSwitzerland(input.origin)) {
      throw new AppError(
        400,
        'OUT_OF_BOUNDS',
        'Der Startort liegt außerhalb der Schweiz (inkl. Puffer).',
      );
    }
    return search(input);
  });
}
