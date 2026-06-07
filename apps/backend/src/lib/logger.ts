import { pino } from 'pino';
import { isProd } from '../config/env';

export const logger = pino(
  isProd
    ? { level: process.env.LOG_LEVEL ?? 'info' }
    : {
        level: process.env.LOG_LEVEL ?? 'debug',
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      },
);
