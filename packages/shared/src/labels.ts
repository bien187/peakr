/** Objektart der Quelle in Anzeigeform (swissNAMES3D schreibt Umlaute aus). */
export function classLabel(objectClass: string | null | undefined): string | null {
  if (!objectClass) return null;
  // Reine OSM-Tag-Angaben («OSM natural=peak») sagen nicht mehr als die Zielart selbst.
  if (objectClass.startsWith('OSM ') && objectClass.includes('=')) return null;
  return objectClass.replace(/uegel/g, 'ügel').replace(/^OSM /, '').replace(/ \(OSM[^)]*\)$/, '');
}
