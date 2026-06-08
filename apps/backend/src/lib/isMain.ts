import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * True, wenn das Modul direkt als Skript läuft (nicht importiert).
 * So planen Worker ihren Cron nur beim direkten Start, nicht beim Import
 * (z.B. durch die Admin-Route).
 */
export function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(entry);
  } catch {
    return false;
  }
}
