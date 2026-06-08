/** Minimaler Ziel-Kontext, den ein Adapter zum Matchen/Abfragen braucht. */
export interface AdapterDestination {
  id: string;
  name: string;
  canton: string | null;
  wikipediaTitle: string | null;
}

/** Ergebnis eines Liftstatus-Adapters. `null` = unbekannt (nie crashen!). */
export interface LiftStatus {
  liftsOpen: number | null;
  liftsTotal: number | null;
  slopesOpenKm: number | null;
  /** Quelle/Adapter-Name für Transparenz. */
  source: string;
}

export interface SkiResortAdapter {
  readonly name: string;
  /** Trifft dieser Adapter auf das Ziel zu? */
  matches(dest: AdapterDestination): boolean;
  /** Holt den Liftstatus (best effort). Wirft nicht — gibt im Zweifel unknown zurück. */
  fetchStatus(dest: AdapterDestination): Promise<LiftStatus>;
}

export const UNKNOWN_LIFT_STATUS = (source = 'unknown'): LiftStatus => ({
  liftsOpen: null,
  liftsTotal: null,
  slopesOpenKm: null,
  source,
});
