import { settle } from '../../lib/http';
import { logger } from '../../lib/logger';
import { exampleAdapters } from './examples';
import { UNKNOWN_LIFT_STATUS, type AdapterDestination, type LiftStatus } from './types';

export * from './types';

const adapters = [...exampleAdapters];

/**
 * Liefert den Liftstatus eines Skigebiets über den passenden Adapter.
 * Eine kaputte Quelle führt nie zum Crash — im Zweifel `unknown`.
 */
export async function getLiftStatus(dest: AdapterDestination): Promise<LiftStatus> {
  const adapter = adapters.find((a) => a.matches(dest));
  if (!adapter) return UNKNOWN_LIFT_STATUS();

  const result = await settle(adapter.fetchStatus(dest));
  if (!result.ok) {
    logger.warn(
      { adapter: adapter.name, dest: dest.name, error: result.error.message },
      'Liftstatus-Adapter fehlgeschlagen',
    );
    return UNKNOWN_LIFT_STATUS(`${adapter.name} (Fehler)`);
  }
  return result.value;
}
