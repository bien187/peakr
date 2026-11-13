/**
 * Worker von Peakr – jeder Aufruf führt einen Job genau einmal aus und endet.
 *
 *   pnpm worker ski           Wetter, Schnee, Lawinenstufe, Liftstatus der Skigebiete
 *   pnpm worker weather       Wetterraster für Wanderziele
 *   pnpm worker trend         Bekanntheit (Wikipedia-Seitenaufrufe)
 *   pnpm worker maintenance   Aufräumen
 *   pnpm worker schedule      Dauerbetrieb mit eingebautem Zeitplan (Docker/Self-Hosting)
 *
 * Im gehosteten Betrieb startet GitHub Actions die Jobs nach Zeitplan.
 */
import cron from 'node-cron';
import { queryClient } from '../db';
import { logger } from '../lib/logger';
import { JOBS } from './jobs';
import { runJob } from './runner';

async function once(names: string[]): Promise<number> {
  let failed = 0;
  for (const name of names) {
    const spec = JOBS[name];
    if (!spec) {
      logger.error(`Unbekannter Job «${name}». Verfügbar: ${Object.keys(JOBS).join(', ')}, schedule`);
      return 2;
    }
    if ((await runJob(spec)) === 'failed') failed++;
  }
  return failed > 0 ? 1 : 0;
}

function schedule(): void {
  const plan: [string, string][] = [
    ['5 */3 * * *', 'ski'],
    ['35 */6 * * *', 'weather'],
    ['20 4 * * 1', 'trend'],
    ['50 3 * * *', 'maintenance'],
  ];
  for (const [expr, name] of plan) {
    cron.schedule(expr, () => void runJob(JOBS[name]), { timezone: 'Europe/Zurich' });
  }
  logger.info({ plan }, 'Zeitplan aktiv. Beenden mit Strg+C.');
  // Beim Start einmal alles füllen.
  void once(['ski', 'weather', 'maintenance']);
  const stop = async (): Promise<void> => {
    await queryClient.end({ timeout: 10 }).catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGTERM', () => setTimeout(() => void stop(), 15_000));
  process.once('SIGINT', () => setTimeout(() => void stop(), 15_000));
}

const args = process.argv.slice(2);
if (args[0] === 'schedule') {
  schedule();
} else if (args.length === 0) {
  logger.error(`Aufruf: pnpm worker <${Object.keys(JOBS).join('|')}|schedule>`);
  process.exit(2);
} else {
  once(args)
    .then(async (code) => {
      await queryClient.end({ timeout: 5 }).catch(() => undefined);
      process.exit(code);
    })
    .catch(async (err) => {
      logger.error(err, 'Worker fehlgeschlagen');
      await queryClient.end({ timeout: 5 }).catch(() => undefined);
      process.exit(1);
    });
}
