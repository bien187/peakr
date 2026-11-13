/**
 * Grundlagen der Verfügbarkeitsprüfung in der Datenbank: Wegsperrungen (samt
 * Zuordnung zu den Routen), Schneemessungen, stündliche Prognosen je Wetterzelle
 * und Lawinenbulletin. Schreiben tun nur Worker und Pipeline; Suche und
 * Detailseite lesen über `getConditions()` (zwischengespeichert).
 */
import type { ForecastGridResponse, WeatherLayerKey } from '@ch-alpineroute/shared';
import type postgres from 'postgres';
import { StationIndex, type AvalancheRegion, type CellForecast, type ModelSnow, type SnowStation } from '../availability/checks';
import { emptyConditions, type ConditionsContext } from '../availability/engine';
import { queryClient as sql } from '../db';
import { toIso, toIsoOrNull } from '../lib/dates';
import { logger } from '../lib/logger';
import { chunks, setMeta } from '../pipeline/runs';
import type { TrailClosure } from '../services/closures.service';
import type { HourlyForecast } from '../services/openMeteo.service';

type Sql = postgres.Sql | postgres.TransactionSql;

// ── Schreiben ────────────────────────────────────────────────────────────────

/** Abstand Route ↔ Sperrung, ab dem ein Abschnitt als «auf der Route» gilt. */
const CLOSURE_BUFFER_M = 25;

/**
 * Ordnet gesperrte Abschnitte den Routen zu. Eine Route ist betroffen, wenn sie
 * dem gesperrten Abschnitt folgt – nicht schon, wenn sie ihn kreuzt: Mindestens
 * die Hälfte der Sperrung (höchstens 150 m, mindestens 15 m) muss innerhalb von
 * 25 m der Route liegen. Umleitung = Meldung «detour» mit gleichem Titel in 3 km.
 */
export async function matchRouteClosures(db: Sql = sql): Promise<number> {
  await db`DELETE FROM route_closures`;
  const rows = await db<{ n: number }[]>`
    WITH pairs AS (
      SELECT hr.id AS route_id, c.id AS closure_id,
             ST_Length(ST_Intersection(c.geom, ST_Buffer(hr.geom::geography, ${CLOSURE_BUFFER_M})::geometry)::geography) AS overlap,
             ST_Length(c.geom::geography) AS closure_len,
             EXISTS (
               SELECT 1 FROM trail_closures d
               WHERE d.kind = 'detour' AND d.title = c.title
                 AND ST_DWithin(d.geom::geography, c.geom::geography, 3000)
             ) AS has_detour
      FROM trail_closures c
      JOIN hike_routes hr
        ON hr.geom && ST_Expand(c.geom, 0.0005)
       AND ST_DWithin(hr.geom::geography, c.geom::geography, ${CLOSURE_BUFFER_M})
      WHERE c.kind = 'closed_way'
    ), ins AS (
      INSERT INTO route_closures (route_id, closure_id, overlap_m, has_detour)
      SELECT route_id, closure_id, round(overlap)::int, has_detour FROM pairs
      WHERE overlap >= LEAST(150, GREATEST(15, 0.5 * closure_len))
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM ins
  `;
  return rows[0]?.n ?? 0;
}

/** Ersetzt alle Sperrungsmeldungen und ordnet sie neu den Routen zu (eine Transaktion). */
export async function storeTrailClosures(list: TrailClosure[]): Promise<{ closures: number; affectedRoutes: number }> {
  let affectedRoutes = 0;
  await sql.begin(async (tx) => {
    await tx`DELETE FROM trail_closures`;
    for (const batch of chunks(list, 300)) {
      const payload = batch.map((c) => ({ ...c, geometry: JSON.stringify(c.geometry) }));
      await tx`
        INSERT INTO trail_closures (id, kind, title, reason, duration, description, url, provider, validated, geom, fetched_at)
        SELECT x.id, x.kind, x.title, x.reason, x.duration, x.description, x.url, x.provider, x.validated,
               ST_SetSRID(ST_GeomFromGeoJSON(x.geometry), 4326), now()
        FROM jsonb_to_recordset(${tx.json(payload as never)}) AS x(
          id text, kind text, title text, reason text, duration text, description text, url text, provider text,
          validated boolean, geometry text
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }
    affectedRoutes = await matchRouteClosures(tx);
  });
  await setMeta('trail_closures', { fetchedAt: new Date().toISOString(), count: list.length, affectedRoutes });
  return { closures: list.length, affectedRoutes };
}

/** Letzte Messung je Station; Stationen ohne Meldung seit 7 Tagen entfallen. */
export async function storeSnowStations(list: SnowStation[]): Promise<number> {
  for (const batch of chunks(list, 500)) {
    await sql`
      INSERT INTO snow_observations (station_id, source, name, lat, lng, elevation_m, snow_cm, new_snow_cm, measured_at, updated_at)
      SELECT x.id, x.source, x.name, x.lat, x.lng, x."elevationM", x."snowCm", x."newSnowCm", x."measuredAt"::timestamptz, now()
      FROM jsonb_to_recordset(${sql.json(batch as never)}) AS x(
        id text, source text, name text, lat float8, lng float8, "elevationM" int, "snowCm" real, "newSnowCm" real, "measuredAt" text
      )
      ON CONFLICT (station_id) DO UPDATE SET
        name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng, elevation_m = EXCLUDED.elevation_m,
        snow_cm = EXCLUDED.snow_cm, new_snow_cm = EXCLUDED.new_snow_cm, measured_at = EXCLUDED.measured_at, updated_at = now()
      WHERE EXCLUDED.measured_at >= snow_observations.measured_at
    `;
  }
  await sql`DELETE FROM snow_observations WHERE updated_at < now() - interval '7 days'`;
  if (list.length > 0) await setMeta('snow_observations', { fetchedAt: new Date().toISOString(), count: list.length });
  return list.length;
}

// ── Lesen (für Suche und Detailseite) ────────────────────────────────────────

interface Cached {
  at: number;
  value: ConditionsLoad;
}
declare global {
  var __peakrConditions: Cached | undefined;
}
const TTL_MS = 5 * 60_000;

export interface ConditionsLoad {
  conditions: ConditionsContext;
  /** false, wenn mindestens ein Teil nicht geladen werden konnte (z. B. Migration noch nicht gelaufen). */
  ok: boolean;
}

export function clearConditionsCache(): void {
  globalThis.__peakrConditions = undefined;
}

type MetaRow = { value: { fetchedAt?: string; levels?: Record<string, AvalancheRegion> } | null };

/**
 * Lädt alle Prüfgrundlagen. Fehler einzelner Teile werden abgefangen: dann fehlen
 * diese Daten, und die Prüfung meldet «unsicher» statt «verfügbar».
 */
export async function getConditions(): Promise<ConditionsLoad> {
  const hit = globalThis.__peakrConditions;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let ok = true;
  const safe = async <T>(name: string, load: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await load();
    } catch (err) {
      ok = false;
      logger.warn({ source: name, error: err instanceof Error ? err.message : String(err) }, 'Prüfgrundlage nicht verfügbar');
      return fallback;
    }
  };
  const c = emptyConditions();

  await Promise.all([
    safe('route_closures', async () => {
      const rows = await sql<{ destination_id: string; rank: number; id: string; title: string | null; reason: string | null; duration: string | null; url: string | null; has_detour: boolean }[]>`
        SELECT hr.destination_id, hr.rank, c.id, c.title, c.reason, c.duration, c.url, rc.has_detour
        FROM route_closures rc
        JOIN hike_routes hr ON hr.id = rc.route_id
        JOIN trail_closures c ON c.id = rc.closure_id
        ORDER BY rc.overlap_m DESC
      `;
      for (const r of rows) {
        const key = `${r.destination_id}:${r.rank}`;
        const list = c.closures.get(key) ?? [];
        list.push({ id: r.id, title: r.title, reason: r.reason, duration: r.duration, url: r.url, hasDetour: r.has_detour });
        c.closures.set(key, list);
      }
      const meta = await sql<MetaRow[]>`SELECT value FROM app_meta WHERE key = 'trail_closures'`;
      c.closuresAt = meta[0]?.value?.fetchedAt ?? null;
    }, undefined),
    safe('snow_observations', async () => {
      const rows = await sql<{ station_id: string; source: SnowStation['source']; name: string; lat: number; lng: number; elevation_m: number; snow_cm: number | null; new_snow_cm: number | null; measured_at: Date | string }[]>`
        SELECT station_id, source, name, lat, lng, elevation_m, snow_cm, new_snow_cm, measured_at
        FROM snow_observations WHERE measured_at > now() - interval '48 hours'
      `;
      c.stations = new StationIndex(
        rows.map((r) => ({
          id: r.station_id, source: r.source, name: r.name, lat: r.lat, lng: r.lng, elevationM: r.elevation_m,
          snowCm: r.snow_cm, newSnowCm: r.new_snow_cm, measuredAt: toIso(r.measured_at),
        })),
      );
      const meta = await sql<MetaRow[]>`SELECT value FROM app_meta WHERE key = 'snow_observations'`;
      c.snowAt = meta[0]?.value?.fetchedAt ?? null;
    }, undefined),
    safe('weather_cells', async () => {
      const rows = await sql<{ cell: string; model_elev_m: number | null; captured_at: Date | string; snow_depth_cm: number | null; forecast: HourlyForecast | null; forecast_at: Date | string | null }[]>`
        SELECT cell, model_elev_m, captured_at, snow_depth_cm, forecast, forecast_at FROM weather_cells
      `;
      let newest: string | null = null;
      for (const r of rows) {
        c.modelSnow.set(r.cell, { snowCm: r.snow_depth_cm, elevationM: r.model_elev_m, at: toIso(r.captured_at) } satisfies ModelSnow);
        const at = toIsoOrNull(r.forecast_at);
        if (r.forecast && at) {
          c.forecasts.set(r.cell, { ...r.forecast, fetchedAt: at, elevationM: r.model_elev_m } satisfies CellForecast);
          if (!newest || at > newest) newest = at;
        }
      }
      c.forecastAt = newest;
    }, undefined),
    safe('avalanche', async () => {
      const rows = await sql<MetaRow[]>`SELECT value FROM app_meta WHERE key = 'avalanche_levels'`;
      const v = rows[0]?.value;
      c.avalancheAt = v?.fetchedAt ?? null;
      for (const [region, info] of Object.entries(v?.levels ?? {})) c.avalanche.set(region, info);
    }, undefined),
  ]);

  const value = { conditions: c, ok };
  globalThis.__peakrConditions = { at: Date.now(), value };
  return value;
}

/** Stand der Prüfgrundlagen für die Antwort der Suche. */
export function conditionsMeta(c: ConditionsContext): { closuresAt: string | null; snowAt: string | null; forecastAt: string | null; avalancheAt: string | null } {
  return { closuresAt: c.closuresAt, snowAt: c.snowAt, forecastAt: c.forecastAt, avalancheAt: c.avalancheAt };
}

// ── Wetterkarte: Prognoseraster ──────────────────────────────────────────────

const FIELD: Record<WeatherLayerKey, keyof HourlyForecast> = {
  precip: 'precip', snowfall: 'snowfall', gust: 'gust', temp: 'temp', cloud: 'cloud',
};

/**
 * Prognose einer Grösse für alle Wetterzellen ab der laufenden Stunde (höchstens
 * 48 Stunden). Liest nur die Datenbank – die Karte löst keine Abrufe bei
 * Open-Meteo aus.
 */
export async function getForecastGrid(variable: WeatherLayerKey, now: Date, maxHours = 48): Promise<ForecastGridResponse> {
  const rows = await sql<{ cell: string; model_elev_m: number | null; forecast: HourlyForecast | null; forecast_at: Date | string | null }[]>`
    SELECT cell, model_elev_m, forecast, forecast_at FROM weather_cells
    WHERE forecast IS NOT NULL AND forecast_at > now() - interval '36 hours'
    ORDER BY cell
  `;
  const start = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
  let hours = 0;
  let fetchedAt: string | null = null;
  for (const r of rows) {
    const series = r.forecast?.[FIELD[variable]];
    if (!r.forecast || !Array.isArray(series)) continue;
    const offset = Math.round((start - Date.parse(r.forecast.start)) / 3_600_000);
    hours = Math.max(hours, Math.min(maxHours, series.length - offset));
    const at = toIsoOrNull(r.forecast_at);
    if (at && (!fetchedAt || at > fetchedAt)) fetchedAt = at;
  }
  hours = Math.max(0, hours);
  const cells: [number, number][] = [];
  const elevations: (number | null)[] = [];
  const values: (number | null)[][] = Array.from({ length: hours }, () => []);
  for (const r of rows) {
    const [a, b] = r.cell.split('_').map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    cells.push([Math.round(a) / 10, Math.round(b) / 10]);
    elevations.push(r.model_elev_m);
    const series = r.forecast?.[FIELD[variable]];
    const offset = r.forecast ? Math.round((start - Date.parse(r.forecast.start)) / 3_600_000) : 0;
    for (let h = 0; h < hours; h++) {
      const v = Array.isArray(series) ? series[offset + h] : null;
      values[h].push(typeof v === 'number' ? v : null);
    }
  }
  return {
    variable, evidence: 'forecast', source: 'Open-Meteo (Modellprognose)', fetchedAt,
    start: new Date(start).toISOString(), hours, cellDeg: 0.1, cells, elevations, values,
  };
}
