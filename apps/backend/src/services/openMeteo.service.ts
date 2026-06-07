import { fetchJson } from '../lib/http';

export interface WeatherSnapshot {
  temperatureC: number | null;
  weatherCode: number | null;
  visibilityM: number | null;
  windKmh: number | null;
  /** Aktuelle Schneehöhe in cm (Open-Meteo liefert m). */
  snowDepthCm: number | null;
  /** Neuschnee heute (Tagessumme) in cm. */
  freshSnowCm: number | null;
  fetchedAt: string;
  raw: unknown;
}

export interface OpenMeteoResponse {
  hourly?: {
    time: string[];
    temperature_2m?: (number | null)[];
    snow_depth?: (number | null)[];
    snowfall?: (number | null)[];
    visibility?: (number | null)[];
    wind_speed_10m?: (number | null)[];
    weather_code?: (number | null)[];
  };
  daily?: {
    time: string[];
    snowfall_sum?: (number | null)[];
    weather_code?: (number | null)[];
  };
}

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const int = (v: number | null | undefined): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

/** Index der Stunde, die "jetzt" am nächsten ist. */
export function currentHourIndex(times: string[] | undefined): number {
  if (!times || times.length === 0) return 0;
  const now = Date.now();
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(new Date(times[i]).getTime() - now);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

export function parseWeather(data: OpenMeteoResponse): WeatherSnapshot {
  const h = data.hourly;
  const i = currentHourIndex(h?.time);
  const depthM = num(h?.snow_depth?.[i]);
  return {
    temperatureC: num(h?.temperature_2m?.[i]),
    weatherCode: int(h?.weather_code?.[i] ?? data.daily?.weather_code?.[0]),
    visibilityM: int(h?.visibility?.[i]),
    windKmh: num(h?.wind_speed_10m?.[i]),
    snowDepthCm: depthM === null ? null : Math.round(depthM * 100),
    freshSnowCm: num(data.daily?.snowfall_sum?.[0]),
    fetchedAt: new Date().toISOString(),
    raw: data,
  };
}

export async function fetchWeather(lat: number, lng: number): Promise<WeatherSnapshot> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: 'temperature_2m,snow_depth,snowfall,visibility,wind_speed_10m,weather_code',
    daily: 'snowfall_sum,weather_code',
    timezone: 'Europe/Zurich',
    forecast_days: '1',
  });
  const data = await fetchJson<OpenMeteoResponse>(
    `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
    { timeoutMs: 8000, retries: 1 },
  );
  return parseWeather(data);
}
