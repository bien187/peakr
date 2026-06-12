/**
 * Einmaliger Worker-Lauf für geplante Ausführung (z.B. GitHub Actions Cron).
 * Führt genau einen Job aus und beendet den Prozess — kein node-cron, kein
 * Dauerläufer nötig. Aufruf:
 *   tsx src/workers/run-once.ts live    # liveStatus (Wetter/Schnee/Lifte)
 *   tsx src/workers/run-once.ts trend   # Trend (Wikipedia-/OpenAI-Score)
 */
import { queryClient } from '../db';
import { logger } from '../lib/logger';
import { runLiveStatusOnce } from './liveStatus.worker';
import { runTrendOnce } from './trend.worker';

const which = process.argv[2];
const job =
  which === 'live' ? runLiveStatusOnce : which === 'trend' ? runTrendOnce : null;

if (!job) {
  logger.error(`Unbekannter Worker "${which ?? ''}" — erwartet: "live" oder "trend".`);
  process.exit(1);
}

job()
  .then(async (result) => {
    logger.info(result, `✅ ${which}-Worker (einmalig) fertig`);
    await queryClient.end({ timeout: 5 });
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error(err, `❌ ${which}-Worker (einmalig) fehlgeschlagen`);
    await queryClient.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
