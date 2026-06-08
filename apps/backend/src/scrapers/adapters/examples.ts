import {
  UNKNOWN_LIFT_STATUS,
  type AdapterDestination,
  type LiftStatus,
  type SkiResortAdapter,
} from './types';

/**
 * Beispiel-Adapter für einzelne Skigebiete.
 *
 * EHRLICHKEIT: Es gibt keine offizielle, schweizweite Gratis-Quelle für Live-Liftstatus.
 * Diese Adapter zeigen die Struktur, geben aktuell aber sauber `unknown` zurück, statt
 * fragile Scraper zu betreiben. Wer für ein Gebiet eine echte (offizielle/erlaubte) Quelle
 * hat, implementiert hier `fetchStatus` aus — der Rest des Systems funktioniert unverändert.
 */
function makeNameAdapter(name: string, matchNames: string[]): SkiResortAdapter {
  const needles = matchNames.map((n) => n.toLowerCase());
  return {
    name,
    matches(dest: AdapterDestination): boolean {
      const hay = `${dest.name} ${dest.wikipediaTitle ?? ''}`.toLowerCase();
      return needles.some((n) => hay.includes(n));
    },
    async fetchStatus(): Promise<LiftStatus> {
      // Keine freie offizielle Quelle verfügbar → unknown (kein Crash, kein Fake-Wert).
      return UNKNOWN_LIFT_STATUS(`${name} (keine offizielle Gratis-Quelle)`);
    },
  };
}

export const exampleAdapters: SkiResortAdapter[] = [
  makeNameAdapter('zermatt-adapter', ['Zermatt', 'Matterhorn']),
  makeNameAdapter('laax-adapter', ['Laax', 'Flims', 'Falera']),
  makeNameAdapter('davos-adapter', ['Davos', 'Klosters', 'Parsenn']),
];
