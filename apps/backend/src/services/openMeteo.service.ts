import { describeError, fetchJson, HttpError } from '../lib/http';
import { logger } from '../lib/logger';

/**
 * Open-Meteo (kostenlos für nicht-kommerzielle Nutzung, CC BY 4.0).
 *
 * Kontingent des Gratiszugangs: 600 Abrufe/Minute, 5'000/Stunde, 10'000/Tag;
 * jeder Ort in einer Sammelanfrage zählt als ein Abruf. Der frühere Worker
 * fragte jedes Ziel einzeln ab (57'000 Abrufe/Tag) und lief ins Limit. Jetzt
 * werden nur Skigebiete und Rasterzellen abgefragt, gedrosselt auf ≤ 500/Minute.
 */

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const CHUNK = 100;
/** Pause zwischen Sammelanfragen: 100 Orte alle 12 s = 500 Abrufe/Minute. */
const CHUNK_PAUSE_MS = 12_000;

export interface WeatherPoint {
  lat: number;
  lng: number;
  /** Höhe in m, für die Open-Meteo die Temperatur herunterrechnet (optional). */
  elevation?: number | null;
}

export interface WeatherSnapshot {
  temperatureC: number | null;
  weatherCode: number | null;
  visibilityM: number | null;
  windKmh: number | null;
  /** Schneehöhe in cm (Open-Meteo liefert Meter). */
  snowDepthCm: number | null;
  /** Neuschnee heute (Tagessumme) in cm. */
  freshSnowCm: number | null;
  /** Höhe des Modellpunkts in m. */
  modelElevationM: number | null;
}

export interface OpenMeteoResponse {
  elevation?: number;
  current?: {
    temperature_2m?: number | null;
    weather_code?: number | null;
    visibility?: number | null;
    wind_speed_10m?: number | null;
    snow_depth?: number | null;
  };
  daily?: { snowfall_sum?: (number | null)[] };
}

const num = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v: number | null | undefined): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

export function parseWeather(data: OpenMeteoResponse): WeatherSnapshot {
  const c = data.current;
  const depthM = num(c?.snow_depth);
  return {
    temperatureC: num(c?.temperature_2m),
    weatherCode: int(c?.weather_code),
    visibilityM: int(c?.visibility),
    windKmh: num(c?.wind_speed_10m),
    snowDepthCm: depthM === null ? null : Math.round(depthM * 100),
    freshSnowCm: num(data.daily?.snowfall_sum?.[0]),
    modelElevationM: int(data.elevation),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface BatchOptions {
  /** Wird zwischen den Anfragen geprüft; true bricht sauber ab. */
  shouldStop?: () => boolean;
  /** Pause zwischen zwei Blöcken (Drosselung unter das Minutenlimit). */
  pauseMs?: number;
  /** Wartezeit vor einer Wiederholung nach einem Netzwerkfehler, je Versuch vervielfacht. */
  networkRetryMs?: number;
  /** Wartezeit nach HTTP 429. */
  rateLimitWaitMs?: number;
  /** Pause vor dem zweiten Durchgang über die fehlgeschlagenen Blöcke. */
  secondPassDelayMs?: number;
}

const MAX_ATTEMPTS = 4;

type ChunkOutcome = 'ok' | 'failed' | 'rate_limited';

/**
 * Wetter für viele Orte in gedrosselten Sammelanfragen. Liefert ein Array
 * gleicher Länge; fehlgeschlagene Blöcke ergeben null-Einträge.
 *
 * Fehlerbehandlung je Block:
 *  - Netzwerkfehler (z. B. Verbindungsaufbau-Zeitüberschreitung, wie sie von
 *    GitHub-Runnern zu Open-Meteo zeitweise auftreten) → bis zu 4 Versuche mit
 *    wachsender Pause; danach folgt am Ende des Laufs ein zweiter Durchgang.
 *  - HTTP 429 → eine Minute warten; hält das Limit an, endet der Lauf, statt
 *    weiter gegen das Kontingent zu laufen.
 *  - andere 4xx → endgültig (Anfrage fehlerhaft).
 */
export async function fetchWeatherBatch(points: WeatherPoint[], opts: BatchOptions = {}): Promise<(WeatherSnapshot | null)[]> {
  const out: (WeatherSnapshot | null)[] = new Array(points.length).fill(null);
  const pause = opts.pauseMs ?? CHUNK_PAUSE_MS;
  const networkRetry = opts.networkRetryMs ?? 15_000;
  const rateLimitWait = opts.rateLimitWaitMs ?? 65_000;
  const stop = (): boolean => opts.shouldStop?.() ?? false;

  const fetchChunk = async (start: number, pass: number): Promise<ChunkOutcome> => {
    const chunk = points.slice(start, start + CHUNK);
    const params = new URLSearchParams({
      latitude: chunk.map((c) => c.lat.toFixed(5)).join(','),
      longitude: chunk.map((c) => c.lng.toFixed(5)).join(','),
      current: 'temperature_2m,weather_code,visibility,wind_speed_10m,snow_depth',
      daily: 'snowfall_sum',
      timezone: 'Europe/Zurich',
      forecast_days: '1',
    });
    if (chunk.every((c) => typeof c.elevation === 'number')) {
      params.set('elevation', chunk.map((c) => Math.round(c.elevation as number)).join(','));
    }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const data = await fetchJson<OpenMeteoResponse | OpenMeteoResponse[]>(`${FORECAST_URL}?${params.toString()}`, {
          timeoutMs: 30_000,
          retries: 0,
        });
        const arr = Array.isArray(data) ? data : [data];
        for (let i = 0; i < chunk.length; i++) out[start + i] = arr[i] ? parseWeather(arr[i]) : null;
        return 'ok';
      } catch (err) {
        const status = err instanceof HttpError ? err.status : undefined;
        logger.warn(
          { chunkStart: start, pass, attempt, status, error: describeError(err).slice(0, 400) },
          'Open-Meteo-Anfrage fehlgeschlagen',
        );
        if (status !== undefined && status >= 400 && status < 500 && status !== 429) return 'failed';
        if (attempt === MAX_ATTEMPTS || stop()) return status === 429 ? 'rate_limited' : 'failed';
        await sleep(status === 429 ? rateLimitWait : networkRetry * attempt);
      }
    }
    return 'failed';
  };

  const failed: number[] = [];
  for (let start = 0; start < points.length; start += CHUNK) {
    if (stop()) break;
    const outcome = await fetchChunk(start, 1);
    if (outcome === 'rate_limited') {
      logger.error({ fetched: start }, 'Open-Meteo-Kontingent erschöpft – Lauf wird beendet');
      return out;
    }
    if (outcome === 'failed') failed.push(start);
    if (start + CHUNK < points.length) await sleep(pause);
  }

  // Zweiter Durchgang: Netzwerkstörungen sind oft nach einigen Minuten vorbei.
  if (failed.length > 0 && !stop()) {
    logger.info({ blocks: failed.length }, 'Open-Meteo: zweiter Durchgang für fehlgeschlagene Blöcke');
    await sleep(opts.secondPassDelayMs ?? 60_000);
    for (const start of failed) {
      if (stop()) break;
      const outcome = await fetchChunk(start, 2);
      if (outcome === 'rate_limited') break;
      await sleep(pause);
    }
  }
  return out;
}
