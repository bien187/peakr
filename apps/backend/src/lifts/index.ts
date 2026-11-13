/**
 * Live-Liftstatus.
 *
 * Stand der Abklärung (November 2026): Es gibt keine freie, schweizweite und
 * rechtlich saubere Quelle für den Betriebsstatus von Liften und Pisten. Die
 * Bergbahnen veröffentlichen ihn auf eigenen Webseiten ohne offene Lizenz;
 * Sammelportale untersagen die automatisierte Abfrage. Peakr betreibt deshalb
 * kein Scraping und zeigt «keine Live-Daten», statt Werte zu erfinden.
 *
 * Wer für ein Gebiet eine zugelassene Quelle hat (z. B. eine Vereinbarung mit
 * der Bergbahn oder eine dokumentierte öffentliche Schnittstelle), registriert
 * hier einen Adapter. Der Worker ruft ihn je Lauf einmal auf, begrenzt die
 * Laufzeit und speichert die Quelle zu jedem Messwert.
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
