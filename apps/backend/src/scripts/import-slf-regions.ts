import { queryClient } from '../db';
import { logger } from '../lib/logger';
import { linkDestinationsToRegions, upsertAvalancheRegion } from '../repositories/import.repo';
import { fetchWarningRegions } from '../services/slf.service';

async function main(): Promise<void> {
  logger.info('⏳ Lade SLF-Warnregionen ...');
  const regions = await fetchWarningRegions();
  logger.info({ count: regions.length }, 'Regionen geladen, schreibe in DB ...');

  let ok = 0;
  let failed = 0;
  for (const region of regions) {
    try {
      await upsertAvalancheRegion(region.id, region.name, region.geometry);
      ok++;
    } catch (err) {
      failed++;
      logger.error(
        { region: region.id, error: err instanceof Error ? err.message : String(err) },
        'Region-Upsert fehlgeschlagen',
      );
    }
  }

  logger.info('⏳ Verknüpfe Ziele mit Regionen (ST_Contains) ...');
  const linked = await linkDestinationsToRegions();

  logger.info({ regions: ok, failed, linkedDestinations: linked }, '✅ SLF-Import fertig.');
  await queryClient.end();
}

main().catch((err) => {
  logger.error(err, 'SLF-Import fehlgeschlagen');
  process.exit(1);
});
