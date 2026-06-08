/**
 * Wandelt einen DB-Timestamp robust in einen ISO-String.
 *
 * Hintergrund: Der über `drizzle(...)` initialisierte postgres.js-Client liefert
 * `timestamptz` bei rohen SQL-Queries als String (z.B. "2026-06-08 11:58:33.05+02"),
 * nicht als Date. `new Date(...)` parst dieses Format korrekt; ein echtes Date wird
 * direkt genutzt.
 */
export function toIso(value: Date | string | number): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toIsoOrNull(value: Date | string | number | null | undefined): string | null {
  return value == null ? null : toIso(value);
}
