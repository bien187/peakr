import { fetchJson, HttpError } from '../lib/http';
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
  pauseMs?: number;
}

/**
 * Wetter für viele Orte in gedrosselten Sammelanfragen. Liefert ein Array
 * gleicher Länge; fehlgeschlagene Blöcke ergeben null-Einträge. Bei HTTP 429
 * wird bis zu dreimal nach einer Minute wiederholt; hält das Limit an, bricht
 * der Lauf ab, statt weiter gegen das Kontingent zu laufen.
 */
export async function fetchWeatherBatch(points: WeatherPoint[], opts: BatchOptions = {}): Promise<(WeatherSnapshot | null)[]> {
  const out: (WeatherSnapshot | null)[] = new Array(points.length).fill(null);
  const pause = opts.pauseMs ?? CHUNK_PAUSE_MS;

  for (let start = 0; start < points.length; start += CHUNK) {
    if (opts.shouldStop?.()) break;
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

    let rateLimited = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const data = await fetchJson<OpenMeteoResponse | OpenMeteoResponse[]>(`${FORECAST_URL}?${params.toString()}`, {
          timeoutMs: 20_000,
          retries: 1,
          retryDelayMs: 2000,
        });
        const arr = Array.isArray(data) ? data : [data];
        for (let i = 0; i < chunk.length; i++) out[start + i] = arr[i] ? parseWeather(arr[i]) : null;
        rateLimited = false;
        break;
      } catch (err) {
        rateLimited = err instanceof HttpError && err.status === 429;
        logger.warn(
          { chunkStart: start, attempt, status: err instanceof HttpError ? err.status : undefined, error: err instanceof Error ? err.message.slice(0, 120) : String(err) },
          'Open-Meteo-Anfrage fehlgeschlagen',
        );
        if (!rateLimited || attempt === 3) break;
        await sleep(65_000);
      }
    }
    if (rateLimited) {
      logger.error({ fetched: start }, 'Open-Meteo-Kontingent erschöpft – Lauf wird beendet');
      break;
    }
    if (start + CHUNK < points.length) await sleep(pause);
  }
  return out;
}
