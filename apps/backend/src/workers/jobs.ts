import { queryClient as sql } from '../db';
import { weatherCellCenter } from '../geo/lv95';
import { settle } from '../lib/http';
import { logger } from '../lib/logger';
import { getLiftStatus } from '../lifts';
import { chunks, setMeta, upsertDataSource } from '../pipeline/runs';
import { env } from '../config/env';
import { enrichTrendWithOpenAi, isOpenAiTrendEnabled } from '../services/openai.service';
import { fetchWeatherBatch, type WeatherPoint } from '../services/openMeteo.service';
import { fetchAvalancheLevels, type AvalancheInfo } from '../services/slf.service';
import { HttpError } from '../lib/http';
import { fetchPageviewsSum, pageviewsToScore } from '../services/wikipedia.service';
import type { JobContext, JobResult, JobSpec } from './runner';

/** Lawinenbulletin holen und für alle Regionen ablegen (auch für Wanderziele nutzbar). */
async function refreshAvalanche(): Promise<Map<string, AvalancheInfo>> {
  const result = await settle(fetchAvalancheLevels());
  if (!result.ok) {
    logger.warn({ error: result.error.message }, 'SLF-Bulletin nicht abrufbar – Lawinenstufen bleiben unverändert');
    return new Map();
  }
  await setMeta('avalanche_levels', {
    fetchedAt: new Date().toISOString(),
    levels: Object.fromEntries(result.value),
  });
  return result.value;
}

interface SkiRow {
  id: string;
  name: string;
  ref: string | null;
  slf_region_id: string | null;
  elevation_base_m: number | null;
  elevation_top_m: number | null;
  base_lat: number | null;
  base_lng: number | null;
  top_lat: number | null;
  top_lng: number | null;
  lifts_total: number;
}

/**
 * Skigebiete: Wetter und Schnee an Tal- und Bergstation (Open-Meteo), Lawinenstufe
 * der Region (SLF) und – wo eine zugelassene Quelle registriert ist – Liftstatus.
 * Je Gebiet entsteht ein Verlaufseintrag in live_status.
 */
async function runSki(ctx: JobContext): Promise<JobResult> {
  // Herkunft und Stand der Live-Quellen festhalten (Detailseite, /api/health, Attribution).
  await upsertDataSource('open_meteo');
  await upsertDataSource('slf');
  const resorts = await sql<SkiRow[]>`
    SELECT d.id, d.name, d.slf_region_id, d.elevation_base_m, d.elevation_top_m,
           s.base_lat::float8 AS base_lat, s.base_lng::float8 AS base_lng,
           s.top_lat::float8 AS top_lat, s.top_lng::float8 AS top_lng, s.lifts_total,
           (SELECT source_ref FROM destination_sources ds WHERE ds.destination_id = d.id AND ds.source_ref LIKE 'ski:%' LIMIT 1) AS ref
    FROM destinations d JOIN ski_resort_details s ON s.destination_id = d.id
    WHERE d.type = 'ski_resort' AND d.retired_at IS NULL AND s.base_lat IS NOT NULL AND s.top_lat IS NOT NULL
    ORDER BY d.name
  `;
  const levels = await refreshAvalanche();

  // Zwei Punkte je Gebiet: Talstation und Bergstation, jeweils auf ihrer Höhe.
  const points: WeatherPoint[] = [];
  for (const r of resorts) {
    points.push({ lat: r.base_lat!, lng: r.base_lng!, elevation: r.elevation_base_m });
    points.push({ lat: r.top_lat!, lng: r.top_lng!, elevation: r.elevation_top_m });
  }
  const weather = await fetchWeatherBatch(points, { shouldStop: ctx.shouldStop });

  const rows: Record<string, unknown>[] = [];
  let failed = 0;
  for (let i = 0; i < resorts.length; i++) {
    const r = resorts[i];
    const base = weather[i * 2];
    const top = weather[i * 2 + 1];
    if (!base && !top) {
      failed++;
      continue;
    }
    const lift = r.ref ? await getLiftStatus({ id: r.id, name: r.name, ref: r.ref }) : null;
    const avalanche = r.slf_region_id ? levels.get(r.slf_region_id) : undefined;
    const ref = top ?? base!;
    rows.push({
      destination_id: r.id,
      temperature_c: ref.temperatureC,
      weather_code: ref.weatherCode,
      visibility_m: ref.visibilityM,
      wind_kmh: ref.windKmh,
      snow_depth_valley_cm: base?.snowDepthCm ?? null,
      snow_depth_top_cm: top?.snowDepthCm ?? null,
      fresh_snow_cm: top?.freshSnowCm ?? base?.freshSnowCm ?? null,
      avalanche_level: avalanche?.level ?? null,
      avalanche_valid_until: avalanche?.validUntil ?? null,
      lifts_open: lift?.liftsOpen ?? null,
      lifts_total: r.lifts_total,
      slopes_open_km: lift?.slopesOpenKm ?? null,
      lift_source: lift?.source ?? null,
    });
  }

  for (const batch of chunks(rows, 500)) {
    await sql`
      INSERT INTO live_status (
        destination_id, temperature_c, weather_code, visibility_m, wind_kmh, snow_depth_valley_cm, snow_depth_top_cm,
        fresh_snow_cm, avalanche_level, avalanche_valid_until, lifts_open, lifts_total, slopes_open_km, lift_source
      )
      SELECT x.destination_id, x.temperature_c, x.weather_code, x.visibility_m, x.wind_kmh, x.snow_depth_valley_cm,
             x.snow_depth_top_cm, x.fresh_snow_cm, x.avalanche_level, x.avalanche_valid_until, x.lifts_open,
             x.lifts_total, x.slopes_open_km, x.lift_source
      FROM jsonb_to_recordset(${sql.json(batch as never)}) AS x(
        destination_id uuid, temperature_c real, weather_code int, visibility_m int, wind_kmh real,
        snow_depth_valley_cm int, snow_depth_top_cm int, fresh_snow_cm real, avalanche_level smallint,
        avalanche_valid_until timestamptz, lifts_open int, lifts_total int, slopes_open_km real, lift_source text
      )
    `;
  }
  return {
    total: resorts.length,
    updated: rows.length,
    failed,
    avalancheRegions: levels.size,
    withLiftStatus: rows.filter((r) => r.lifts_open !== null).length,
  };
}

/**
 * Wetterraster für Wanderziele: ein Abruf je 0,1°-Zelle, in der Ziele liegen.
 * Die Zeile je Zelle wird überschrieben – die Tabelle wächst nicht.
 */
async function runWeather(ctx: JobContext): Promise<JobResult> {
  await upsertDataSource('open_meteo');
  await upsertDataSource('slf');
  const cells = await sql<{ cell: string }[]>`
    SELECT DISTINCT weather_cell AS cell FROM destinations
    WHERE type = 'hike_destination' AND retired_at IS NULL AND weather_cell IS NOT NULL
    ORDER BY 1
  `;
  const levels = await refreshAvalanche();
  const points = cells.map((c) => weatherCellCenter(c.cell));
  const weather = await fetchWeatherBatch(points, { shouldStop: ctx.shouldStop });

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < cells.length; i++) {
    const w = weather[i];
    if (!w) continue;
    rows.push({
      cell: cells[i].cell, lat: points[i].lat, lng: points[i].lng, model_elev_m: w.modelElevationM,
      temperature_c: w.temperatureC, weather_code: w.weatherCode, visibility_m: w.visibilityM, wind_kmh: w.windKmh,
      snow_depth_cm: w.snowDepthCm, fresh_snow_cm: w.freshSnowCm,
    });
  }
  for (const batch of chunks(rows, 500)) {
    await sql`
      INSERT INTO weather_cells (cell, lat, lng, model_elev_m, captured_at, temperature_c, weather_code, visibility_m, wind_kmh, snow_depth_cm, fresh_snow_cm)
      SELECT x.cell, x.lat, x.lng, x.model_elev_m, now(), x.temperature_c, x.weather_code, x.visibility_m, x.wind_kmh, x.snow_depth_cm, x.fresh_snow_cm
      FROM jsonb_to_recordset(${sql.json(batch as never)}) AS x(
        cell text, lat real, lng real, model_elev_m int, temperature_c real, weather_code int, visibility_m int,
        wind_kmh real, snow_depth_cm int, fresh_snow_cm real
      )
      ON CONFLICT (cell) DO UPDATE SET
        lat = EXCLUDED.lat, lng = EXCLUDED.lng, model_elev_m = EXCLUDED.model_elev_m, captured_at = now(),
        temperature_c = EXCLUDED.temperature_c, weather_code = EXCLUDED.weather_code, visibility_m = EXCLUDED.visibility_m,
        wind_kmh = EXCLUDED.wind_kmh, snow_depth_cm = EXCLUDED.snow_depth_cm, fresh_snow_cm = EXCLUDED.fresh_snow_cm
    `;
  }
  // Zellen ohne Ziele (nach einem Import) entfernen.
  await sql`DELETE FROM weather_cells w WHERE NOT EXISTS (SELECT 1 FROM destinations d WHERE d.weather_cell = w.cell AND d.retired_at IS NULL)`;
  return { total: cells.length, updated: rows.length, failed: cells.length - rows.length, avalancheRegions: levels.size };
}

/**
 * Bekanntheit aus Wikipedia-Seitenaufrufen – nur für Ziele mit hinterlegtem
 * Artikel. Früher wurde der Zielname als Artikeltitel geraten; das ergab für
 * 93 % der Ziele den Wert 1 und wurde entfernt.
 */
async function runTrend(ctx: JobContext): Promise<JobResult> {
  await upsertDataSource('wikipedia');
  const dests = await sql<{ id: string; name: string; wikipedia_title: string }[]>`
    SELECT id, name, wikipedia_title FROM destinations
    WHERE retired_at IS NULL AND wikipedia_title IS NOT NULL AND wikipedia_title <> ''
    ORDER BY name
  `;
  const useOpenAi = isOpenAiTrendEnabled() && env.OPENAI_API_KEY.trim().length > 0;
  let updated = 0;
  let failed = 0;
  let noArticle = 0;
  let throttled = 0;

  for (const d of dests) {
    if (ctx.shouldStop()) break;
    const views = await settle(fetchPageviewsSum(d.wikipedia_title, 30));
    if (!views.ok) {
      failed++;
      // Wikimedia drosselt: nicht weiter anfragen, der nächste Lauf holt den Rest.
      if (views.error instanceof HttpError && views.error.status === 429 && ++throttled >= 5) break;
      continue;
    }
    throttled = 0;
    if (views.value === null) {
      noArticle++;
      await sql`DELETE FROM trend_scores WHERE destination_id = ${d.id}`;
      continue;
    }
    let { score } = pageviewsToScore(views.value);
    let source = 'wikipedia';
    let rationale = `Wikipedia-Seitenaufrufe (30 Tage): ${views.value}`;
    if (useOpenAi) {
      const ai = await settle(enrichTrendWithOpenAi(d.wikipedia_title, env.OPENAI_API_KEY));
      if (ai.ok) {
        score = ai.value.score;
        rationale = ai.value.rationale;
        source = 'openai+wikipedia';
      }
    }
    await sql`
      INSERT INTO trend_scores (destination_id, score, rationale, source, is_estimate, updated_at)
      VALUES (${d.id}, ${score}, ${rationale}, ${source}, true, now())
      ON CONFLICT (destination_id) DO UPDATE SET score = EXCLUDED.score, rationale = EXCLUDED.rationale,
        source = EXCLUDED.source, is_estimate = true, updated_at = now()
    `;
    updated++;
    await new Promise((r) => setTimeout(r, 120)); // Wikimedia schonen
  }
  // Altlasten ohne Artikel entfernen.
  const removed = await sql`
    DELETE FROM trend_scores t USING destinations d
    WHERE d.id = t.destination_id AND (d.wikipedia_title IS NULL OR d.wikipedia_title = '' OR d.retired_at IS NOT NULL)
  `;
  return { total: dests.length, updated: updated + noArticle, failed, withScore: updated, noArticle, removedLegacy: removed.count };
}

/** Aufräumen: Verlauf begrenzen, alte Zähler und Protokolle löschen. */
async function runMaintenance(): Promise<JobResult> {
  const live = await sql`DELETE FROM live_status WHERE captured_at < now() - interval '120 days'`;
  const nonSki = await sql`
    DELETE FROM live_status l USING destinations d WHERE d.id = l.destination_id AND d.type <> 'ski_resort'
  `;
  const payloads = await sql`UPDATE live_status SET raw_payload = NULL WHERE raw_payload IS NOT NULL`;
  const limits = await sql`DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'`;
  const runs = await sql`DELETE FROM import_runs WHERE started_at < now() - interval '180 days'`;
  const stuck = await sql`
    UPDATE import_runs SET status = 'failed', finished_at = now(), error = 'Lauf ohne Abschluss (Abbruch oder Absturz)'
    WHERE status = 'running' AND started_at < now() - interval '6 hours'
  `;
  const locks = await sql`DELETE FROM job_locks WHERE locked_until < now()`;
  const removed = live.count + nonSki.count + limits.count + runs.count + locks.count;
  return {
    total: 1, updated: 1, failed: 0,
    liveStatusPruned: live.count + nonSki.count, rawPayloadsCleared: payloads.count, rateLimitsPruned: limits.count,
    runsPruned: runs.count, stuckRunsClosed: stuck.count, rowsRemoved: removed,
  };
}

export const JOBS: Record<string, JobSpec> = {
  ski: { name: 'worker:ski', lockMinutes: 30, timeoutMinutes: 20, minSuccessRatio: 0.7, run: runSki },
  weather: { name: 'worker:weather', lockMinutes: 30, timeoutMinutes: 20, minSuccessRatio: 0.7, run: runWeather },
  trend: { name: 'worker:trend', lockMinutes: 120, timeoutMinutes: 90, minSuccessRatio: 0.5, run: runTrend },
  maintenance: { name: 'worker:maintenance', lockMinutes: 15, timeoutMinutes: 10, minSuccessRatio: 1, run: runMaintenance },
};
