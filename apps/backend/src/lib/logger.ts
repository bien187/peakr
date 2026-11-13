import { pino } from 'pino';
import { isProd } from '../config/env';

// Lesbare Ausgabe nur für Kommandozeilen-Läufe in der Entwicklung. Im Next.js-
// Server und in Produktion (CI, Vercel) werden JSON-Zeilen geschrieben.
const pretty = !isProd && !process.env.NEXT_RUNTIME && !process.env.VITEST;

export const logger = pino(
  pretty
    ? {
        level: process.env.LOG_LEVEL ?? 'info',
        transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
      }
    : { level: process.env.LOG_LEVEL ?? (process.env.VITEST ? 'silent' : 'info') },
);
