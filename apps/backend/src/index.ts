import { buildApp } from './app';
import { env } from './config/env';

async function main(): Promise<void> {
  const app = await buildApp();

  try {
    await app.listen({ port: env.BACKEND_PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} empfangen — fahre herunter ...`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
