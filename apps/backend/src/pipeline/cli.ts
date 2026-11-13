/**
 * Datenpipeline von Peakr.
 *
 *   pnpm pipeline all                 kompletter Lauf in der richtigen Reihenfolge
 *   pnpm pipeline prepare             Rohdaten laden und filtern
 *   pnpm pipeline slf destinations    einzelne Schritte
 *
 * Schritte: prepare → slf → destinations → ski → network (Strassengraph,
 * Ausgangspunkte, Wanderrouten) → index (Suchindex für die Website). Jeder Schritt ist wiederholbar (idempotent) und
 * wird in import_runs protokolliert.
 */
import { queryClient } from '../db';
import { logger } from '../lib/logger';
import { ensureDirs } from './paths';
import { setMeta, upsertDataSource, withRun } from './runs';
import { prepare, readSourcesMeta } from './steps/prepare';

const STEPS = ['prepare', 'slf', 'destinations', 'ski', 'network', 'index'] as const;
type Step = (typeof STEPS)[number];

/** Trägt Quellen samt Stand in data_sources ein (Herkunftsnachweis). */
async function registerSources(): Promise<void> {
  const meta = readSourcesMeta();
  await upsertDataSource('osm', meta.osm.timestamp);
  await upsertDataSource('swissnames3d', meta.swissnames3d.version);
  await upsertDataSource('swisstlm3d_wanderwege', meta.wanderwege.version);
}

async function runStep(step: Step, opts: { maxAgeHours: number }): Promise<void> {
  switch (step) {
    case 'prepare': {
      await prepare(opts);
      await registerSources();
      return;
    }
    case 'slf': {
      const { importSlfRegions } = await import('./steps/slfRegions');
      await upsertDataSource('slf');
      await withRun('pipeline:slf', 'slf', importSlfRegions);
      return;
    }
    case 'destinations': {
      await registerSources();
      const { importDestinations } = await import('./steps/destinations');
      await withRun('pipeline:destinations', 'swissnames3d', importDestinations);
      return;
    }
    case 'ski': {
      await registerSources();
      const { importSkiResorts } = await import('./steps/ski');
      await withRun('pipeline:ski', 'osm', importSkiResorts);
      return;
    }
    case 'network': {
      await registerSources();
      const { buildNetwork } = await import('./steps/networkStep');
      await upsertDataSource('terrain_tiles');
      await withRun('pipeline:network', 'osm', buildNetwork);
      return;
    }
    case 'index': {
      const { buildSearchIndex } = await import('./steps/searchIndex');
      await withRun('pipeline:index', null, buildSearchIndex);
      return;
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const refresh = args.includes('--refresh');
  const requested = args.filter((a) => !a.startsWith('--'));
  const steps: Step[] =
    requested.length === 0 || requested.includes('all') ? [...STEPS] : (requested as Step[]);
  for (const s of steps) {
    if (!STEPS.includes(s)) {
      logger.error(`Unbekannter Schritt «${s}». Verfügbar: ${STEPS.join(', ')}, all`);
      process.exit(2);
    }
  }
  ensureDirs();
  // Ohne --refresh werden vorhandene Downloads bis zu 20 Stunden weiterverwendet.
  const opts = { maxAgeHours: refresh ? 0 : 20 };

  for (const step of steps) {
    logger.info(`▶ Schritt ${step}`);
    await runStep(step, opts);
  }
  // Neue Daten → neuer Datenstand; Caches der Suche hängen an diesem Wert.
  await setMeta('data_version', { version: new Date().toISOString() });
}

main()
  .then(async () => {
    await queryClient.end({ timeout: 5 });
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error(err, 'Pipeline fehlgeschlagen');
    await queryClient.end({ timeout: 5 }).catch(() => undefined);
    process.exit(1);
  });
