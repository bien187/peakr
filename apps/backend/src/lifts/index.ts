/**
 * Adapter für zusätzliche Liftstatus-Quellen einzelner Gebiete (Ski-Worker).
 *
 * Der Lift- und Pistenstatus kommt seit November 2026 aus den Statusberichten
 * von LiftRadar (eigener Job `pnpm worker lifts`, siehe sync.ts und
 * docs/LIFT_UND_PISTENSTATUS.md) und steht in ski_resort_status. Peakr betreibt
 * kein Scraping von Betreiber-Websites.
 *
 * Wer für ein Gebiet eine weitere zugelassene Quelle hat (z. B. eine
 * Vereinbarung mit der Bergbahn oder eine dokumentierte öffentliche
 * Schnittstelle), kann hier einen Adapter registrieren. Der Ski-Worker ruft ihn
 * je Lauf einmal auf und speichert die Quelle zu jedem Messwert in live_status.
 */

export interface LiftResort {
  id: string;
  name: string;
  /** Stabile Referenz des Gebiets, z. B. «ski:way/123». */
  ref: string;
}

export interface LiftStatus {
  liftsOpen: number | null;
  slopesOpenKm: number | null;
  /** Name der Quelle – wird zu jedem Messwert gespeichert und angezeigt. */
  source: string;
}

export interface LiftStatusAdapter {
  readonly source: string;
  /** Zuständigkeit über die stabile Referenz, nicht über Namensteile. */
  matches(resort: LiftResort): boolean;
  fetchStatus(resort: LiftResort, signal: AbortSignal): Promise<LiftStatus>;
}

const adapters: LiftStatusAdapter[] = [];

export function registerLiftAdapter(adapter: LiftStatusAdapter): void {
  adapters.push(adapter);
}

/** Liefert den Liftstatus oder null, wenn es für das Gebiet keine Quelle gibt oder sie ausfällt. */
export async function getLiftStatus(resort: LiftResort, timeoutMs = 8000): Promise<LiftStatus | null> {
  const adapter = adapters.find((a) => a.matches(resort));
  if (!adapter) return null;
  try {
    return await adapter.fetchStatus(resort, AbortSignal.timeout(timeoutMs));
  } catch {
    return null;
  }
}
