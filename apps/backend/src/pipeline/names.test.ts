import { describe, expect, it } from 'vitest';
import { nameSimilarity, normalizeName } from './names';

describe('Namensabgleich', () => {
  it('ignoriert Gattungswörter und Umlautschreibweisen', () => {
    expect(normalizeName('Chamanna Tschierva CAS')).toBe(normalizeName('Tschierva'));
    expect(normalizeName('Vermigelhütte')).toBe(normalizeName('Vermigel Hütte'));
    expect(nameSimilarity('Grünhorn', 'Gruenhorn')).toBe(1);
  });

  it('erkennt Teilnamen nur als ganze Wörter', () => {
    expect(nameSimilarity('Piz Bernina', 'Piz Bernina / Pizzo Bernina')).toBeGreaterThanOrEqual(0.9);
    // Ganzes Wort enthalten → hohe Ähnlichkeit; zusammengeführt wird trotzdem nur bei geringem Abstand.
    expect(nameSimilarity('Rigi', 'Rigi Kulm')).toBe(0.9);
    expect(nameSimilarity('Rig', 'Rigi Kulm')).toBeLessThan(0.78);
  });

  it('verschiedene Berge bleiben verschieden', () => {
    expect(nameSimilarity('Grosser Mythen', 'Kleiner Mythen')).toBeLessThan(0.78);
    expect(nameSimilarity('Pizol', 'Piz Ol')).toBeLessThan(1);
  });
});
