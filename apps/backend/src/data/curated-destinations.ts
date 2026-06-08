import type { DestinationInsert } from '../repositories/import.repo';

/**
 * Kuratierte Startmenge bekannter Schweizer Ziele. Koordinaten sind bewusst
 * grob (Ortskern/See) — der Overpass-Import ergänzt/präzisiert weitere Ziele.
 * `wikipediaTitle` zeigt auf den de.wikipedia-Artikel für den Trend-Score.
 */
export const curatedDestinations: DestinationInsert[] = [
  // --- Skigebiete ---
  { name: 'Zermatt – Matterhorn ski paradise', type: 'ski_resort', canton: 'VS', lat: 46.0207, lng: 7.7491, elevationBaseM: 1620, elevationTopM: 3883, wikipediaTitle: 'Zermatt', sourceRef: { curated: true } },
  { name: 'Saas-Fee', type: 'ski_resort', canton: 'VS', lat: 46.1095, lng: 7.929, elevationBaseM: 1800, elevationTopM: 3600, wikipediaTitle: 'Saas-Fee', sourceRef: { curated: true } },
  { name: 'Verbier – 4 Vallées', type: 'ski_resort', canton: 'VS', lat: 46.0961, lng: 7.2286, elevationBaseM: 1500, elevationTopM: 3330, wikipediaTitle: 'Verbier', sourceRef: { curated: true } },
  { name: 'Davos Klosters', type: 'ski_resort', canton: 'GR', lat: 46.799, lng: 9.82, elevationBaseM: 1560, elevationTopM: 2844, wikipediaTitle: 'Davos', sourceRef: { curated: true } },
  { name: 'Flims Laax Falera', type: 'ski_resort', canton: 'GR', lat: 46.808, lng: 9.258, elevationBaseM: 1100, elevationTopM: 3018, wikipediaTitle: 'Laax', sourceRef: { curated: true } },
  { name: 'St. Moritz – Corviglia', type: 'ski_resort', canton: 'GR', lat: 46.4983, lng: 9.8389, elevationBaseM: 1822, elevationTopM: 3303, wikipediaTitle: 'St. Moritz', sourceRef: { curated: true } },
  { name: 'Engelberg – Titlis', type: 'ski_resort', canton: 'OW', lat: 46.821, lng: 8.401, elevationBaseM: 1000, elevationTopM: 3028, wikipediaTitle: 'Engelberg', sourceRef: { curated: true } },
  { name: 'Grindelwald – First', type: 'ski_resort', canton: 'BE', lat: 46.6242, lng: 8.0414, elevationBaseM: 1034, elevationTopM: 2486, wikipediaTitle: 'Grindelwald', sourceRef: { curated: true } },
  { name: 'Andermatt – Sedrun', type: 'ski_resort', canton: 'UR', lat: 46.636, lng: 8.594, elevationBaseM: 1444, elevationTopM: 2961, wikipediaTitle: 'Andermatt', sourceRef: { curated: true } },
  { name: 'Arosa Lenzerheide', type: 'ski_resort', canton: 'GR', lat: 46.7833, lng: 9.68, elevationBaseM: 1230, elevationTopM: 2865, wikipediaTitle: 'Arosa', sourceRef: { curated: true } },

  // --- Wanderziele ---
  { name: 'Oeschinensee', type: 'hike_destination', canton: 'BE', lat: 46.4992, lng: 7.7286, elevationTopM: 1578, sacDifficulty: 'T2', wikipediaTitle: 'Oeschinensee', sourceRef: { curated: true } },
  { name: 'Bachalpsee', type: 'hike_destination', canton: 'BE', lat: 46.6667, lng: 8.027, elevationTopM: 2265, sacDifficulty: 'T2', wikipediaTitle: 'Bachalpsee', sourceRef: { curated: true } },
  { name: 'Creux du Van', type: 'hike_destination', canton: 'NE', lat: 46.9333, lng: 6.7333, elevationTopM: 1463, sacDifficulty: 'T2', wikipediaTitle: 'Creux du Van', sourceRef: { curated: true } },
  { name: 'Aletschgletscher (Bettmerhorn)', type: 'hike_destination', canton: 'VS', lat: 46.4, lng: 8.05, elevationTopM: 2647, sacDifficulty: 'T2', wikipediaTitle: 'Aletschgletscher', sourceRef: { curated: true } },
  { name: 'Saxer Lücke', type: 'hike_destination', canton: 'AI', lat: 47.2667, lng: 9.4333, elevationTopM: 1649, sacDifficulty: 'T3', wikipediaTitle: 'Saxer Lücke', sourceRef: { curated: true } },
  { name: 'Lac de Moiry', type: 'hike_destination', canton: 'VS', lat: 46.145, lng: 7.575, elevationTopM: 2249, sacDifficulty: 'T2', wikipediaTitle: 'Lac de Moiry', sourceRef: { curated: true } },
];
