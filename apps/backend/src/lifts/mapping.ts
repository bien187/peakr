/**
 * Zuordnung LiftRadar-Gebiet → Peakr-Skigebiet.
 *
 * Bewusst eine Liste im Code statt einer Zuordnung zur Laufzeit: Namen
 * unterscheiden sich zwischen den Quellen (Sprachen, Verbünde, Teilgebiete),
 * und eine falsche Zuordnung zeigt einen falschen Betriebsstatus. Jede Zeile ist
 * nachvollziehbar und lässt sich prüfen.
 *
 * Schlüssel auf der Peakr-Seite ist die stabile OSM-Referenz des Skigebiets
 * (destination_sources.source_ref, z. B. «ski:way/660203241»), nicht die UUID:
 * sie bleibt bei jedem Neuaufbau und in jeder Datenbank gleich.
 *
 * Erstellt am 25.11.2026 aus dem Peakr-Ski-Schritt (OSM-Stand 11.11.2026) und dem
 * LiftRadar-Index desselben Tages:
 *  - lift_names     Anlagennamen der LiftRadar-Einzelliste mit den OSM-Anlagen
 *                   des Peakr-Gebiets verglichen (Treffer/Anlagen in «evidence»)
 *  - name_location  gleicher Name, wenige Kilometer Abstand, ähnliche Anlagenzahl
 *                   (für Gebiete ohne Einzelliste)
 *  - manual         Ortskenntnis, Begründung in «evidence»
 *
 * Mehrere LiftRadar-Gebiete dürfen zu einem Peakr-Gebiet gehören (Verbünde wie
 * 4 Vallées); ein LiftRadar-Gebiet gehört höchstens zu einem Peakr-Gebiet.
 * Umfasst ein LiftRadar-Gebiet mehrere Peakr-Gebiete, wird es nicht zugeordnet
 * (siehe LIFTRADAR_UNMAPPED) – der Bericht liesse sich nicht ehrlich aufteilen.
 *
 * Neue Zuordnungen: `pnpm liftradar:mapping`
 * listet Kandidaten; erst nach Prüfung hier eintragen (docs/LIFT_UND_PISTENSTATUS.md).
 */

export type MatchMethod = 'lift_names' | 'name_location' | 'manual';

export interface LiftRadarMapping {
  /** ID bei LiftRadar (Datei /json/ch/<id>.json). */
  liftradarId: string;
  /** Stabile Referenz des Peakr-Skigebiets (destination_sources, Quelle «osm»). */
  peakrRef: string;
  /** Name des Peakr-Gebiets zur Kontrolle (massgebend ist peakrRef). */
  peakrName: string;
  method: MatchMethod;
  evidence: string;
  /** false = automatisch vorgeschlagen und noch nicht geprüft. */
  verified?: boolean;
}

// Eine Zeile je Zuordnung, damit sich die Liste wie eine Tabelle prüfen lässt.
// prettier-ignore
export const LIFTRADAR_MAPPING: readonly LiftRadarMapping[] = [
  { liftradarId: 'verbier', peakrRef: 'ski:way/660203241', peakrName: '4 Vallées – Verbier/La Tzoumaz/Nendaz/Veysonnaz/Thyon', method: 'lift_names', evidence: '17/17 Anlagennamen' },
  { liftradarId: 'nendaz', peakrRef: 'ski:way/660203241', peakrName: '4 Vallées – Verbier/La Tzoumaz/Nendaz/Veysonnaz/Thyon', method: 'lift_names', evidence: '16/18 Anlagennamen' },
  { liftradarId: 'thyon', peakrRef: 'ski:way/660203241', peakrName: '4 Vallées – Verbier/La Tzoumaz/Nendaz/Veysonnaz/Thyon', method: 'lift_names', evidence: '10/10 Anlagennamen' },
  { liftradarId: 'veysonnaz', peakrRef: 'ski:way/660203241', peakrName: '4 Vallées – Verbier/La Tzoumaz/Nendaz/Veysonnaz/Thyon', method: 'lift_names', evidence: '9/10 Anlagennamen' },
  { liftradarId: 'la-tzoumaz', peakrRef: 'ski:way/660203241', peakrName: '4 Vallées – Verbier/La Tzoumaz/Nendaz/Veysonnaz/Thyon', method: 'lift_names', evidence: '9/9 Anlagennamen' },
  { liftradarId: 'arosa', peakrRef: 'ski:way/601135365', peakrName: 'Arosa Lenzerheide', method: 'lift_names', evidence: '14/14 Anlagennamen' },
  { liftradarId: 'lenzerheide', peakrRef: 'ski:way/601135365', peakrName: 'Arosa Lenzerheide', method: 'lift_names', evidence: '28/29 Anlagennamen' },
  { liftradarId: 'villars', peakrRef: 'ski:way/660210948', peakrName: 'Villars/Gryon/Les Diablerets', method: 'lift_names', evidence: '15/15 Anlagennamen' },
  { liftradarId: 'gryon', peakrRef: 'ski:way/660210948', peakrName: 'Villars/Gryon/Les Diablerets', method: 'lift_names', evidence: '6/6 Anlagennamen' },
  { liftradarId: 'les-diablerets', peakrRef: 'ski:way/660210948', peakrName: 'Villars/Gryon/Les Diablerets', method: 'lift_names', evidence: '8/8 Anlagennamen' },
  { liftradarId: 'champery', peakrRef: 'ski:relation/19457834', peakrName: 'Les Portes du Soleil', method: 'lift_names', evidence: '15/15 Anlagennamen' },
  { liftradarId: 'morgins', peakrRef: 'ski:relation/19457834', peakrName: 'Les Portes du Soleil', method: 'lift_names', evidence: '15/17 Anlagennamen' },
  { liftradarId: 'st-moritz-corviglia', peakrRef: 'ski:way/642474968', peakrName: 'Corviglia', method: 'lift_names', evidence: '20/23 Anlagennamen' },
  { liftradarId: 'corvatsch', peakrRef: 'ski:way/642474968', peakrName: 'Corviglia', method: 'lift_names', evidence: '13/14 Anlagennamen (Peakr fasst Corviglia und Corvatsch zusammen)' },
  { liftradarId: 'grimentz-zinal', peakrRef: 'ski:way/1138703077', peakrName: 'Zinal / Grimentz', method: 'lift_names', evidence: '20/21 Anlagennamen' },
  { liftradarId: 'vercorin', peakrRef: 'ski:way/1138703077', peakrName: 'Zinal / Grimentz', method: 'lift_names', evidence: '9/9 Anlagennamen (Vercorin liegt in der OSM-Fläche «Zinal / Grimentz»)' },
  { liftradarId: 'unterbaech', peakrRef: 'ski:way/665127741', peakrName: 'Unterbäch – Brandalp', method: 'lift_names', evidence: '5/7 Anlagennamen' },
  { liftradarId: 'eischoll', peakrRef: 'ski:way/665127741', peakrName: 'Unterbäch – Brandalp', method: 'lift_names', evidence: '3/4 Anlagennamen (Raron–Eischoll, Eischoll–Strygge)' },
  { liftradarId: 'chaeserrugg', peakrRef: 'ski:way/601297222', peakrName: 'Chäserrugg-Alt St. Johann', method: 'lift_names', evidence: '14/14 Anlagennamen' },
  { liftradarId: 'wildhaus', peakrRef: 'ski:way/601297222', peakrName: 'Chäserrugg-Alt St. Johann', method: 'lift_names', evidence: 'Oberdorf, Freienalp, Gamsalp, Gamserrugg im Peakr-Gebiet' },
  { liftradarId: 'adelboden', peakrRef: 'ski:way/665124161', peakrName: 'Adelboden - Lenk', method: 'lift_names', evidence: '12/12 Anlagennamen' },
  { liftradarId: 'arolla', peakrRef: 'ski:relation/19357160', peakrName: 'Arolla', method: 'lift_names', evidence: '5/6 Anlagennamen' },
  { liftradarId: 'belalp', peakrRef: 'ski:way/1226020028', peakrName: 'Blatten Belalp', method: 'lift_names', evidence: '8/10 Anlagennamen' },
  { liftradarId: 'bellwald', peakrRef: 'ski:way/1148328974', peakrName: 'Bellwald', method: 'lift_names', evidence: 'gleicher Name, 1,4 km, 2/5 Anlagennamen' },
  { liftradarId: 'champex-lac', peakrRef: 'ski:way/1449656646', peakrName: 'Champex-Lac', method: 'lift_names', evidence: '4/4 Anlagennamen' },
  { liftradarId: 'charmey', peakrRef: 'ski:way/1225703746', peakrName: 'Charmey', method: 'lift_names', evidence: 'gleicher Name, 3,0 km, 4/7 Anlagennamen' },
  { liftradarId: 'crans-montana', peakrRef: 'ski:way/599002420', peakrName: 'Crans-Montana', method: 'lift_names', evidence: '18/24 Anlagennamen' },
  { liftradarId: 'diavolezza-lagalb', peakrRef: 'ski:way/642477771', peakrName: 'Diavolezza-Lagalb', method: 'lift_names', evidence: 'gleicher Name, 1,8 km, 3/5 Anlagennamen' },
  { liftradarId: 'diemtigtal-wiriehorn', peakrRef: 'ski:way/1227109241', peakrName: 'Wiriehorn', method: 'lift_names', evidence: 'Wiriehorn, 1,5 km, 5 Anlagen wie bei Peakr' },
  { liftradarId: 'elm', peakrRef: 'ski:way/1225837839', peakrName: 'Elm', method: 'lift_names', evidence: '4/6 Anlagennamen' },
  { liftradarId: 'elsigen-metsch', peakrRef: 'ski:way/1449385229', peakrName: 'Elsigen-Metsch', method: 'lift_names', evidence: '9/10 Anlagennamen' },
  { liftradarId: 'engelberg-titlis', peakrRef: 'ski:way/1362257705', peakrName: 'Engelberg-Titlis', method: 'lift_names', evidence: '16/20 Anlagennamen' },
  { liftradarId: 'engstligenalp', peakrRef: 'ski:way/1449657505', peakrName: 'Engstligenalp', method: 'lift_names', evidence: '7/8 Anlagennamen' },
  { liftradarId: 'evolene', peakrRef: 'ski:way/1226461740', peakrName: 'Evolène', method: 'lift_names', evidence: 'gleicher Name, 2,3 km, 3/5 Anlagennamen' },
  { liftradarId: 'flumserberg', peakrRef: 'ski:way/754266155', peakrName: 'Flumserberg', method: 'lift_names', evidence: '17/17 Anlagennamen' },
  { liftradarId: 'glacier-3000', peakrRef: 'ski:way/1252352411', peakrName: 'Glacier 3000', method: 'lift_names', evidence: '11/11 Anlagennamen' },
  { liftradarId: 'graechen', peakrRef: 'ski:way/1226460886', peakrName: 'Grächen', method: 'lift_names', evidence: '12/12 Anlagennamen' },
  { liftradarId: 'grindelwald-first', peakrRef: 'ski:way/599436179', peakrName: 'First – Grindelwald', method: 'lift_names', evidence: '5/7 Anlagennamen' },
  { liftradarId: 'grindelwald-wengen', peakrRef: 'ski:way/1227173315', peakrName: 'Grindelwald - Wengen', method: 'lift_names', evidence: '18/21 Anlagennamen' },
  { liftradarId: 'hoch-ybrig', peakrRef: 'ski:way/601136474', peakrName: 'Hoch-Ybrig', method: 'lift_names', evidence: '9/13 Anlagennamen' },
  { liftradarId: 'jakobshorn', peakrRef: 'ski:way/601299778', peakrName: 'Jakobshorn', method: 'lift_names', evidence: '10/10 Anlagennamen' },
  { liftradarId: 'jaun', peakrRef: 'ski:way/601128716', peakrName: 'Jaun', method: 'lift_names', evidence: '5/5 Anlagennamen' },
  { liftradarId: 'klewenalp-stockhuette', peakrRef: 'ski:way/1225716833', peakrName: 'Klewenalp - Stockhütte', method: 'lift_names', evidence: '15/15 Anlagennamen' },
  { liftradarId: 'la-berra', peakrRef: 'ski:way/1225702099', peakrName: 'La Berra', method: 'lift_names', evidence: 'gleicher Name, 1,1 km, 3/6 Anlagennamen' },
  { liftradarId: 'la-fouly', peakrRef: 'ski:way/1225714414', peakrName: 'La Fouly', method: 'lift_names', evidence: '3/4 Anlagennamen' },
  { liftradarId: 'laax', peakrRef: 'ski:way/599441663', peakrName: 'Laax-Flims-Falera', method: 'lift_names', evidence: '30/32 Anlagennamen' },
  { liftradarId: 'lauchernalp', peakrRef: 'ski:way/1225709007', peakrName: 'Lauchernalp', method: 'lift_names', evidence: '5/6 Anlagennamen' },
  { liftradarId: 'les-marecottes', peakrRef: 'ski:way/1225714078', peakrName: 'Les Marecottes', method: 'lift_names', evidence: '4/4 Anlagennamen' },
  { liftradarId: 'les-mosses', peakrRef: 'ski:way/1138617897', peakrName: 'Les Mosses', method: 'lift_names', evidence: '13/14 Anlagennamen' },
  { liftradarId: 'les-paccots', peakrRef: 'ski:way/1225707077', peakrName: 'Les Paccots', method: 'lift_names', evidence: '9/10 Anlagennamen' },
  { liftradarId: 'leukerbad-torrent', peakrRef: 'ski:way/1226017306', peakrName: 'Leukerbad (Torrent)', method: 'lift_names', evidence: '6/7 Anlagennamen' },
  { liftradarId: 'leysin', peakrRef: 'ski:way/1138615003', peakrName: 'Leysin', method: 'lift_names', evidence: '10/13 Anlagennamen' },
  { liftradarId: 'madrisa', peakrRef: 'ski:way/601298991', peakrName: 'Madrisa', method: 'lift_names', evidence: '8/9 Anlagennamen' },
  { liftradarId: 'meiringen-hasliberg', peakrRef: 'ski:way/601107962', peakrName: 'Meiringen-Hasliberg', method: 'lift_names', evidence: '14/16 Anlagennamen' },
  { liftradarId: 'melchsee-frutt', peakrRef: 'ski:way/1227350627', peakrName: 'Melchsee-Frutt', method: 'lift_names', evidence: '14/15 Anlagennamen' },
  { liftradarId: 'moosalp', peakrRef: 'ski:way/665127845', peakrName: 'Moosalpregion', method: 'lift_names', evidence: '7/8 Anlagennamen' },
  { liftradarId: 'muerren-schilthorn', peakrRef: 'ski:way/599438589', peakrName: 'Mürren/Schilthorn', method: 'lift_names', evidence: '11/13 Anlagennamen' },
  { liftradarId: 'obersaxen-mundaun', peakrRef: 'ski:way/1226241296', peakrName: 'Obersaxen-Mundaun', method: 'lift_names', evidence: '17/17 Anlagennamen' },
  { liftradarId: 'ovronnaz', peakrRef: 'ski:way/1226016225', peakrName: 'Ovronnaz', method: 'lift_names', evidence: '7/7 Anlagennamen' },
  { liftradarId: 'parsenn', peakrRef: 'ski:way/601299396', peakrName: 'Parsenn', method: 'lift_names', evidence: '14/18 Anlagennamen' },
  { liftradarId: 'pizol', peakrRef: 'ski:way/1226534484', peakrName: 'Pizol Bad Ragaz', method: 'lift_names', evidence: '10/12 Anlagennamen' },
  { liftradarId: 'rinerhorn', peakrRef: 'ski:way/601300983', peakrName: 'Rinerhorn', method: 'lift_names', evidence: 'gleicher Name, 0,5 km, 2/5 Anlagennamen' },
  { liftradarId: 'saas-fee', peakrRef: 'ski:way/45408941', peakrName: 'Saas Fee', method: 'lift_names', evidence: '17/23 Anlagennamen' },
  { liftradarId: 'saas-grund', peakrRef: 'ski:way/1225712315', peakrName: 'Saas-Grund', method: 'lift_names', evidence: '6/9 Anlagennamen' },
  { liftradarId: 'schatzalp', peakrRef: 'ski:way/601300156', peakrName: 'Schatzalp/Strela (Davos Klosters)', method: 'lift_names', evidence: '4/4 Anlagennamen' },
  { liftradarId: 'schwarzsee', peakrRef: 'ski:way/1226458742', peakrName: 'Schwarzsee', method: 'lift_names', evidence: 'gleicher Name, 0,9 km, 2/6 Anlagennamen' },
  { liftradarId: 'scuol', peakrRef: 'ski:way/1226394113', peakrName: 'Scuol Motta Naluns', method: 'lift_names', evidence: '10/12 Anlagennamen' },
  { liftradarId: 'soerenberg', peakrRef: 'ski:way/601129767', peakrName: 'Sörenberg', method: 'lift_names', evidence: '12/12 Anlagennamen' },
  { liftradarId: 'spluegen', peakrRef: 'ski:way/1226239363', peakrName: 'Splügen', method: 'lift_names', evidence: '6/7 Anlagennamen' },
  { liftradarId: 'st-luc-chandolin', peakrRef: 'ski:way/601131935', peakrName: 'Saint Luc - Chandolin', method: 'lift_names', evidence: '16/16 Anlagennamen' },
  { liftradarId: 'vicheres-liddes', peakrRef: 'ski:way/1226395364', peakrName: 'Vichères-Bavon', method: 'lift_names', evidence: '3/5 Anlagennamen' },
  { liftradarId: 'visperterminen', peakrRef: 'ski:way/1227364615', peakrName: 'Visperterminen', method: 'lift_names', evidence: 'gleicher Name, 1,6 km, 3/5 Anlagennamen' },
  { liftradarId: 'zermatt', peakrRef: 'ski:way/540681046', peakrName: 'Zermatt - Breuil-Cervinia', method: 'lift_names', evidence: '32/36 Anlagennamen' },
  { liftradarId: 'airolo-pesciuem', peakrRef: 'ski:way/1226242826', peakrName: 'Airolo - Pesciüm', method: 'name_location', evidence: 'gleicher Name, 0,4 km, 8 bzw. 9 Anlagen (keine Einzelliste)' },
  { liftradarId: 'aletsch-arena', peakrRef: 'ski:way/1226018440', peakrName: 'Aletsch Arena', method: 'name_location', evidence: 'gleicher Name, 0,7 km, 40 bzw. 35 Anlagen (keine Einzelliste)' },
  { liftradarId: 'anzere', peakrRef: 'ski:way/1027139922', peakrName: 'Anzère', method: 'name_location', evidence: 'gleicher Name, 2,0 km, 13 bzw. 12 Anlagen (keine Einzelliste)' },
  { liftradarId: 'bosco-gurin', peakrRef: 'ski:way/54913422', peakrName: 'Bosco Gurin – Grossalp', method: 'name_location', evidence: 'gleicher Name, 2,0 km (keine Einzelliste)' },
  { liftradarId: 'cari', peakrRef: 'ski:way/1226244107', peakrName: 'Carì', method: 'name_location', evidence: 'gleicher Name, 1,1 km, je 4 Anlagen (keine Einzelliste)' },
  { liftradarId: 'goldingen', peakrRef: 'ski:way/911466485', peakrName: 'Atzmännig', method: 'name_location', evidence: '«Goldingen (Atzmännig)», 3,3 km (keine Einzelliste)' },
  { liftradarId: 'hochwang', peakrRef: 'ski:way/1226538939', peakrName: 'Hochwang – Goldgruben', method: 'name_location', evidence: 'gleicher Name, 1,2 km, je 4 Anlagen (keine Einzelliste)' },
  { liftradarId: 'oberholz-farner', peakrRef: 'ski:way/1445279089', peakrName: 'Skilift Oberholz-Farner', method: 'name_location', evidence: 'gleicher Name, 0,4 km, je 3 Anlagen (keine Einzelliste)' },
  { liftradarId: 'sarn', peakrRef: 'ski:way/1226669192', peakrName: 'Sarn-Heinzenberg', method: 'name_location', evidence: '«Sarn (Heinzenberg)», 2,0 km (keine Einzelliste)' },
  { liftradarId: 'tschappina', peakrRef: 'ski:way/1226669691', peakrName: 'Tschappina', method: 'name_location', evidence: 'gleicher Name, 0,4 km, je 4 Anlagen (keine Einzelliste)' },
  { liftradarId: 'val-muestair', peakrRef: 'ski:way/1227176469', peakrName: 'Minschuns', method: 'manual', evidence: 'Minschuns ist das Skigebiet des Val Müstair; 2,1 km, je 4 Anlagen' },
  { liftradarId: 'zuoz', peakrRef: 'ski:way/642478131', peakrName: 'St. Moritz – Zuoz', method: 'manual', evidence: 'Peakr-Gebiet «St. Moritz – Zuoz» liegt 0,9 km vom Ort, 7 bzw. 6 Anlagen' },
];

/** Schweizer LiftRadar-Gebiete, die bewusst keinem Peakr-Gebiet zugeordnet sind. */
export const LIFTRADAR_UNMAPPED: Readonly<Record<string, string>> = {
  gstaad:
    'Bericht umfasst drei Peakr-Gebiete (Schönried – Saanenmöser – Zweisimmen – St. Stephan, Gstaad – Saanen – Rougemont, Wispile) sowie Wasserngrat, Lauenen und Gsteig.',
  'andermatt-sedrun-disentis':
    'Bericht umfasst zwei Peakr-Gebiete (Skiarena Andermatt-Sedrun, Gemsstock – Andermatt) und Disentis.',
  lenk: 'Bericht umfasst Anlagen in zwei Peakr-Gebieten (Betelberg, Adelboden - Lenk).',
  tschiertschen: 'Kein entsprechendes Peakr-Gebiet (nicht im OSM-Bestand als Skigebiet erkannt).',
};

/** Hinweise, wenn die Berichte nur einen Teil des Peakr-Gebiets abdecken (Schlüssel: peakrRef). */
export const COVERAGE_NOTES: Readonly<Record<string, string>> = {
  'ski:relation/19457834':
    'Der Bericht deckt nur den Schweizer Teil der Portes du Soleil ab (Champéry, Morgins).',
  'ski:way/665124161':
    'Der Bericht deckt nur die Anlagen von Adelboden ab, nicht die Lenker Seite (Metsch, Bühlberg).',
};

/** Prüft die Liste: eindeutige IDs, gültige Formate, keine Überschneidung mit den Ausnahmen. */
export function mappingProblems(list: readonly LiftRadarMapping[] = LIFTRADAR_MAPPING): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const m of list) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(m.liftradarId))
      problems.push(`ungültige ID ${m.liftradarId}`);
    if (!/^ski:(way|relation|node|lift)\/\d+$/.test(m.peakrRef))
      problems.push(`ungültige Referenz ${m.peakrRef}`);
    if (seen.has(m.liftradarId)) problems.push(`doppelt: ${m.liftradarId}`);
    if (m.liftradarId in LIFTRADAR_UNMAPPED)
      problems.push(`zugeordnet und ausgenommen: ${m.liftradarId}`);
    seen.add(m.liftradarId);
  }
  return problems;
}

const BY_ID = new Map(LIFTRADAR_MAPPING.map((m) => [m.liftradarId, m]));

export function mappingFor(liftradarId: string): LiftRadarMapping | undefined {
  return BY_ID.get(liftradarId);
}

/** Abdeckungshinweis für ein Peakr-Gebiet anhand seiner LiftRadar-Gebiete. */
export function coverageNoteFor(liftradarIds: string[]): string | null {
  for (const id of liftradarIds) {
    const ref = BY_ID.get(id)?.peakrRef;
    if (ref && COVERAGE_NOTES[ref]) return COVERAGE_NOTES[ref];
  }
  return null;
}
