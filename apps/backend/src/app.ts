import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { env, isProd } from './config/env';
import { healthRoutes } from './routes/health';

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

  // Routen (werden in späteren Phasen erweitert)
  await app.register(healthRoutes);

  return app;
}
