/**
 * Suchindex: alle statischen Daten, die die Suche braucht, in einer Datei.
 *
 * Die Datenpipeline schreibt ihn zusammen mit dem Strassengraphen; die Website
 * liest beide einmal je Instanz in den Arbeitsspeicher. Eine Suche braucht die
 * Datenbank dadurch nur noch für die kleinen, häufig wechselnden Live-Daten
 * (Wetterraster, Lawinenstufen, Skigebiets-Messwerte, Bekanntheit). Das hält
 * den Datenverkehr weit unter dem Gratis-Kontingent und die Suche funktioniert
 * auch, wenn die Datenbank kurz nicht erreichbar ist.
 *
 * Datensätze sind Tupel (Arrays), damit die Datei klein bleibt.
 */

export const SEARCH_INDEX_FORMAT = 1;

/** [id, Typ 0=Wanderziel 1=Skigebiet, Name, Kanton, Breite, Länge, Höhe oben, Höhe unten, Zielart,
 *  Objektklasse, Metadaten-Qualität, Bedeutung, Wikipedia-Titel, SLF-Region, Quelle, Wetterzelle, Route 0/1] */
export type DestTuple = [
  string, 0 | 1, string, string | null, number, number, number | null, number | null, string | null,
  string | null, number | null, number | null, string | null, string | null, string | null, string | null, 0 | 1,
];

/** [id, Art 0=Parkplatz 1=Strassenzugang 2=Talstation, Name, Breite, Länge, Fahrpunkt Breite, Fahrpunkt Länge,
 *  Abstand Strasse m, Höhe, Qualität 1–3, Gebühr, Kapazität] */
export type TrailheadTuple = [
  string, 0 | 1 | 2, string | null, number, number, number | null, number | null, number | null, number | null,
  number, string | null, string | null,
];

/** [Routen-ID, Ziel-Index, Ausgangspunkt-Index, Rang, Distanz m, Aufstieg m, Abstieg m, Gehzeit hin, Gehzeit zurück,
 *  tiefster Punkt, höchster Punkt, SAC min 0–6, SAC max 0–6 (0 = unbekannt), Anteil bekannt, Anteil amtlich, Endabstand m] */
export type RouteTuple = [
  number, number, number, number, number, number, number, number, number, number | null, number | null,
  number, number, number, number, number,
];

/** [Ziel-Index, Talstation-Index (−1 = keine), Anlagen, Anlagen je Typ, Pisten-km, Pisten-km je Schwierigkeit, Gruppierung] */
export type SkiTuple = [number, number, number, Record<string, number>, number | null, Record<string, number>, string];

export interface SearchIndexFile {
  format: number;
  builtAt: string;
  /** Stand des Strassengraphen, mit dem die Ausgangspunkte bestimmt wurden. */
  graphBuiltAt: string | null;
  routeSource: string;
  routesComputedAt: string | null;
  destinations: DestTuple[];
  trailheads: TrailheadTuple[];
  routes: RouteTuple[];
  ski: SkiTuple[];
}

export const TRAILHEAD_KINDS = ['parking', 'road_access', 'valley_station'] as const;
export const SAC_GRADES = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'] as const;
