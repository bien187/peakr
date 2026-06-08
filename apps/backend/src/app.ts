import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { env, isProd } from './config/env';
import { AppError } from './lib/errors';
import { installAuth } from './plugins/auth';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { destinationRoutes } from './routes/destinations';
import { favoriteRoutes } from './routes/favorites';
import { geocodeRoutes } from './routes/geocode';
import { healthRoutes } from './routes/health';
import { meRoutes } from './routes/me';
import { searchRoutes } from './routes/search';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isProd
      ? true
      : {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        },
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  });
  await app.register(cookie);

  installAuth(app);

  // Einheitliche Fehlerbehandlung
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (error instanceof ZodError) {
      return reply
        .code(400)
        .send({
          error: { code: 'VALIDATION', message: 'Ungültige Eingabe', details: error.flatten() },
        });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    const message = error instanceof Error ? error.message : 'Interner Serverfehler.';
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: { code: 'BAD_REQUEST', message } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Interner Serverfehler.' } });
  });

  // Routen
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(geocodeRoutes);
  await app.register(searchRoutes);
  await app.register(destinationRoutes);
  await app.register(favoriteRoutes);
  await app.register(adminRoutes);

  return app;
}
