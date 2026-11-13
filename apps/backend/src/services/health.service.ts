import type { HealthResponse } from '@ch-alpineroute/shared';
import { queryClient as sql } from '../db';
import { toIsoOrNull } from '../lib/dates';
import { graphInfo } from '../routing/driveTime';
import { getSearchIndex } from '../search/searchIndex';

/** Wie alt der letzte erfolgreiche Lauf höchstens sein darf, in Stunden. */
export const JOB_MAX_AGE_HOURS: Record<string, number> = {
  'worker:ski': 8,
  'worker:weather': 14,
  'worker:trend': 24 * 9,
  'worker:maintenance': 24 * 3,
  'pipeline:destinations': 24 * 45,
  'pipeline:ski': 24 * 45,
  'pipeline:network': 24 * 16,
  'pipeline:index': 24 * 16,
};

/** Betriebszustand: Datenbank, Strassengraph, Datenbestand und Aktualität aller Läufe. */
export async function health(): Promise<HealthResponse> {
  const routing = graphInfo();
  const index = getSearchIndex();
  const searchIndex = {
    available: index !== null,
    builtAt: index?.builtAt ?? null,
    destinations: index?.destinations.length ?? 0,
    routes: index?.routes.length ?? 0,
  };
  const timestamp = new Date().toISOString();
  try {
    const [counts] = await sql<{ destinations: number; ski: number; routes: number; version: string | null }[]>`
      SELECT
        (SELECT count(*)::int FROM destinations WHERE type = 'hike_destination' AND retired_at IS NULL) AS destinations,
        (SELECT count(*)::int FROM destinations WHERE type = 'ski_resort' AND retired_at IS NULL) AS ski,
        (SELECT count(*)::int FROM hike_routes) AS routes,
        (SELECT value->>'version' FROM app_meta WHERE key = 'data_version') AS version
    `;
    const runs = await sql<{ job: string; status: string; finished_at: Date | string | null }[]>`
      SELECT DISTINCT ON (job) job, status, finished_at
      FROM import_runs WHERE status IN ('success', 'partial')
      ORDER BY job, finished_at DESC NULLS LAST
    `;
    const lastByJob = new Map(runs.map((r) => [r.job, r]));
    const jobs = Object.entries(JOB_MAX_AGE_HOURS).map(([job, maxAge]) => {
      const run = lastByJob.get(job);
      const finishedAt = toIsoOrNull(run?.finished_at ?? null);
      const ageHours = finishedAt ? Math.round(((Date.now() - Date.parse(finishedAt)) / 3_600_000) * 10) / 10 : null;
      return { job, status: run?.status ?? 'never', finishedAt, ageHours, stale: ageHours === null || ageHours > maxAge };
    });
    const sources = await sql<{ id: string; name: string; attribution: string | null; license: string | null; version: string | null; fetched_at: Date | string | null }[]>`
      SELECT id, name, attribution, license, version, fetched_at FROM data_sources ORDER BY id
    `;
    const hasData = counts.destinations > 0 && counts.ski > 0;
    const degraded = !routing.available || !searchIndex.available || !hasData || jobs.some((j) => j.stale);
    return {
      status: degraded ? 'degraded' : 'ok',
      timestamp,
      database: true,
      routing,
      searchIndex,
      data: { destinations: counts.destinations, skiResorts: counts.ski, hikeRoutes: counts.routes, dataVersion: counts.version },
      jobs,
      sources: sources.map((s) => ({
        id: s.id, name: s.name, attribution: s.attribution, license: s.license, version: s.version, fetchedAt: toIsoOrNull(s.fetched_at),
      })),
    };
  } catch {
    return {
      status: 'down',
      timestamp,
      database: false,
      routing,
      searchIndex,
      data: { destinations: 0, skiResorts: 0, hikeRoutes: 0, dataVersion: null },
      jobs: [],
      sources: [],
    };
  }
}
