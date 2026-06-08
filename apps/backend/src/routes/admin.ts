import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { requireUser } from '../plugins/auth';
import { runLiveStatusOnce } from '../workers/liveStatus.worker';
import { runTrendOnce } from '../workers/trend.worker';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/admin/refresh', { preHandler: app.authenticate }, async (request, reply) => {
    const user = requireUser(request);
    if (user.role !== 'admin') {
      throw new AppError(403, 'FORBIDDEN', 'Nur für Administratoren.');
    }
    // Im Hintergrund starten, damit der Request nicht blockiert.
    void runLiveStatusOnce().catch((e) => logger.error(e, 'liveStatus-Refresh fehlgeschlagen'));
    void runTrendOnce().catch((e) => logger.error(e, 'trend-Refresh fehlgeschlagen'));
    return reply.code(202).send({ message: 'Aktualisierung im Hintergrund gestartet.' });
  });
}
