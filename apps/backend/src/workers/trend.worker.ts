import cron from 'node-cron';
import { env } from '../config/env';
import { settle } from '../lib/http';
import { isMainModule } from '../lib/isMain';
import { logger } from '../lib/logger';
import { listDestinationsForWorker, upsertTrend } from '../repositories/status.repo';
import { enrichTrendWithOpenAi, isOpenAiTrendEnabled } from '../services/openai.service';
import { fetchPageviewsSum, pageviewsToScore } from '../services/wikipedia.service';

export interface TrendWorkerResult {
  total: number;
  updated: number;
}

/**
 * Wikipedia-Pageviews → Bekanntheits-Score (Default). Optional, falls aktiviert
 * und ein OPENAI_API_KEY gesetzt ist, Anreicherung über die OpenAI Responses API.
 */
export async function runTrendOnce(): Promise<TrendWorkerResult> {
  const destinations = await listDestinationsForWorker();
  const useOpenAi = isOpenAiTrendEnabled() && env.OPENAI_API_KEY.trim().length > 0;
  logger.info({ total: destinations.length, useOpenAi }, '🔥 trend-Worker gestartet');

  let updated = 0;

  for (const d of destinations) {
    const title = d.wikipediaTitle ?? d.name;
    const viewsResult = await settle(fetchPageviewsSum(title, 30));
    const views = viewsResult.ok ? viewsResult.value : null;
    let { score } = pageviewsToScore(views);
    let source = 'wikipedia';
    let rationale = `Wikipedia-Pageviews (30 Tage): ${views ?? 'n/a'}`;

    if (useOpenAi) {
      const ai = await settle(enrichTrendWithOpenAi(title, env.OPENAI_API_KEY));
      if (ai.ok) {
        score = ai.value.score;
        rationale = ai.value.rationale;
        source = 'openai+wikipedia';
      } else {
        logger.warn(
          { dest: d.name, error: ai.error.message },
          'OpenAI-Anreicherung fehlgeschlagen',
        );
      }
    }

    try {
      await upsertTrend(d.id, { score, rationale, source, isEstimate: true });
      updated++;
    } catch (err) {
      logger.error(
        { dest: d.name, error: err instanceof Error ? err.message : String(err) },
        'Trend-Upsert fehlgeschlagen',
      );
    }

    await new Promise((r) => setTimeout(r, 150)); // Wikimedia/OpenAI schonen
  }

  logger.info({ updated, total: destinations.length }, '✅ trend-Worker fertig');
  return { total: destinations.length, updated };
}

if (isMainModule(import.meta.url)) {
  runTrendOnce().catch((e) => logger.error(e));
  cron.schedule('30 4 * * *', () => {
    runTrendOnce().catch((e) => logger.error(e));
  });
  logger.info('⏰ trend-Worker als Cron (täglich 04:30) aktiv. Strg+C zum Beenden.');
}
