import { randomUUID } from 'node:crypto';
import { queryClient as sql } from '../db';
import { logger } from '../lib/logger';
import { setMeta, withRun } from '../pipeline/runs';

/**
 * Gemeinsamer Rahmen für alle Worker-Läufe:
 *  - Sperre in der Datenbank gegen parallele Läufe (läuft bei Absturz von selbst ab)
 *  - Zeitlimit und sauberes Beenden bei SIGTERM/SIGINT
 *  - Protokoll in import_runs (Status, Kennzahlen, Fehler) → /api/health
 *  - Fehlercode, wenn zu wenige Datensätze aktualisiert wurden (CI meldet den Lauf als fehlgeschlagen)
 */

export interface JobContext {
  /** true, sobald der Lauf enden soll (Signal oder Zeitlimit). Schleifen prüfen das je Durchgang. */
  shouldStop: () => boolean;
}

export interface JobResult extends Record<string, unknown> {
  total: number;
  updated: number;
  failed: number;
}

export interface JobSpec {
  name: string;
  /** Sperrdauer; muss länger sein als ein normaler Lauf. */
  lockMinutes: number;
  /** Harte Laufzeitgrenze. */
  timeoutMinutes: number;
  /** Mindestanteil erfolgreicher Datensätze, darunter gilt der Lauf als fehlgeschlagen. */
  minSuccessRatio: number;
  run: (ctx: JobContext) => Promise<JobResult>;
}

export type JobOutcome = 'success' | 'failed' | 'skipped';

async function acquireLock(job: string, owner: string, minutes: number): Promise<boolean> {
  const rows = await sql`
    INSERT INTO job_locks (job, owner, locked_until)
    VALUES (${job}, ${owner}, now() + make_interval(mins => ${minutes}))
    ON CONFLICT (job) DO UPDATE SET owner = EXCLUDED.owner, locked_until = EXCLUDED.locked_until
    WHERE job_locks.locked_until < now()
    RETURNING owner
  `;
  return rows.length > 0;
}

async function releaseLock(job: string, owner: string): Promise<void> {
  await sql`DELETE FROM job_locks WHERE job = ${job} AND owner = ${owner}`.catch(() => undefined);
}

export async function runJob(spec: JobSpec): Promise<JobOutcome> {
  const owner = randomUUID();
  if (!(await acquireLock(spec.name, owner, spec.lockMinutes))) {
    logger.warn({ job: spec.name }, 'Lauf übersprungen: derselbe Job läuft bereits');
    return 'skipped';
  }

  let stop = false;
  const onSignal = (signal: string): void => {
    logger.warn({ job: spec.name, signal }, 'Signal empfangen – Lauf wird nach dem aktuellen Block beendet');
    stop = true;
  };
  const sigterm = (): void => onSignal('SIGTERM');
  const sigint = (): void => onSignal('SIGINT');
  process.once('SIGTERM', sigterm);
  process.once('SIGINT', sigint);
  const timer = setTimeout(() => {
    logger.error({ job: spec.name, minutes: spec.timeoutMinutes }, 'Zeitlimit erreicht – Lauf wird beendet');
    stop = true;
  }, spec.timeoutMinutes * 60_000);
  timer.unref();

  try {
    const stats = await withRun(spec.name, null, async () => {
      const result = await spec.run({ shouldStop: () => stop });
      const ratio = result.total === 0 ? 1 : result.updated / result.total;
      if (ratio < spec.minSuccessRatio) {
        throw new Error(
          `Nur ${result.updated} von ${result.total} Datensätzen aktualisiert (${Math.round(ratio * 100)} %, Minimum ${Math.round(spec.minSuccessRatio * 100)} %).`,
        );
      }
      return { ...result, partial: result.failed > 0 || stop };
    });
    // Neue Live-Daten entwerten die Such-Caches.
    if (stats.updated > 0) await setMeta('live_version', { version: new Date().toISOString() });
    return 'success';
  } catch {
    return 'failed';
  } finally {
    clearTimeout(timer);
    process.off('SIGTERM', sigterm);
    process.off('SIGINT', sigint);
    await releaseLock(spec.name, owner);
  }
}
