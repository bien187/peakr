import cron from 'node-cron';
import { settle } from '../lib/http';
import { isMainModule } from '../lib/isMain';
import { logger } from '../lib/logger';
import { insertLiveStatus, listDestinationsForWorker } from '../repositories/status.repo';
import { getLiftStatus, UNKNOWN_LIFT_STATUS } from '../scrapers/adapters';
import { fetchWeather } from '../services/openMeteo.service';
import { fetchAvalancheLevels } from '../services/slf.service';

export interface WorkerResult {
  total: number;
  updated: number;
  failed: number;
}

/**
 * Holt für jedes Ziel Wetter/Schnee (Open-Meteo), ordnet die SLF-Gefahrenstufe
 * über die Region zu, fragt (best effort) den Skigebiet-Adapter und schreibt einen
 * neuen append-only `live_status`-Snapshot. Eine kaputte Quelle killt nie den Lauf.
 */
export async function runLiveStatusOnce(): Promise<WorkerResult> {
  const destinations = await listDestinationsForWorker();
  logger.info({ total: destinations.length }, '🌦️  liveStatus-Worker gestartet');

  const levelsResult = await settle(fetchAvalancheLevels());
  const levels = levelsResult.ok ? levelsResult.value : new Map<string, number>();
  if (!levelsResult.ok) {
    logger.warn({ error: levelsResult.error.message }, 'SLF-Bulletin nicht abrufbar (evtl. Sommer)');
  }

  let updated = 0;
  let failed = 0;

  for (const d of destinations) {
    const weatherResult = await settle(fetchWeather(d.lat, d.lng));
    if (!weatherResult.ok) {
      failed++;
      logger.warn({ dest: d.name, error: weatherResult.error.message }, 'Wetter fehlgeschlagen');
      continue;
    }
    const weather = weatherResult.value;
    const avalancheLevel = d.slfRegionId ? (levels.get(d.slfRegionId) ?? null) : null;

    const lift =
      d.type === 'ski_resort'
        ? await getLiftStatus({
            id: d.id,
            name: d.name,
            canton: d.canton,
            wikipediaTitle: d.wikipediaTitle,
          })
        : UNKNOWN_LIFT_STATUS('n/a (kein Skigebiet)');

    try {
      await insertLiveStatus({
        destinationId: d.id,
        temperatureC: weather.temperatureC,
        weatherCode: weather.weatherCode,
        visibilityM: weather.visibilityM,
        windKmh: weather.windKmh,
        snowDepthValleyCm: null,
        snowDepthTopCm: weather.snowDepthCm, // Open-Meteo liefert einen Punktwert am Ziel
        freshSnowCm: weather.freshSnowCm,
        avalancheLevel,
        liftsOpen: lift.liftsOpen,
        liftsTotal: lift.liftsTotal,
        slopesOpenKm: lift.slopesOpenKm,
        trailStatus: null,
        rawPayload: { weather: weather.raw, liftSource: lift.source },
      });
      updated++;
    } catch (err) {
      failed++;
      logger.error(
        { dest: d.name, error: err instanceof Error ? err.message : String(err) },
        'Insert live_status fehlgeschlagen',
      );
    }

    await new Promise((r) => setTimeout(r, 100)); // sanftes Throttling
  }

  logger.info({ updated, failed, total: destinations.length }, '✅ liveStatus-Worker fertig');
  return { total: destinations.length, updated, failed };
}

if (isMainModule(import.meta.url)) {
  runLiveStatusOnce().catch((e) => logger.error(e));
  cron.schedule('0 */3 * * *', () => {
    runLiveStatusOnce().catch((e) => logger.error(e));
  });
  logger.info('⏰ liveStatus-Worker als Cron (alle 3 Stunden) aktiv. Strg+C zum Beenden.');
}
