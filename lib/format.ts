/** WMO-Wettercode → Emoji + deutsches Label. */
export function weatherInfo(code: number | null): { emoji: string; label: string } {
  if (code == null) return { emoji: '❓', label: 'unbekannt' };
  if (code === 0) return { emoji: '☀️', label: 'Klar' };
  if (code <= 2) return { emoji: '🌤️', label: 'Heiter' };
  if (code === 3) return { emoji: '☁️', label: 'Bewölkt' };
  if (code <= 48) return { emoji: '🌫️', label: 'Nebel' };
  if (code <= 57) return { emoji: '🌦️', label: 'Niesel' };
  if (code <= 67) return { emoji: '🌧️', label: 'Regen' };
  if (code <= 77) return { emoji: '🌨️', label: 'Schneefall' };
  if (code <= 82) return { emoji: '🌧️', label: 'Schauer' };
  if (code <= 86) return { emoji: '🌨️', label: 'Schneeschauer' };
  return { emoji: '⛈️', label: 'Gewitter' };
}

/** Farbe (Hex) für einen Score 0–100 — für Karten-Marker. */
export function scoreColorHex(score: number): string {
  if (score >= 80) return '#16a34a';
  if (score >= 60) return '#65a30d';
  if (score >= 40) return '#ca8a04';
  if (score >= 20) return '#ea580c';
  return '#dc2626';
}

/** Tailwind-Klassen für ein Score-Badge. */
export function scoreBadgeClasses(score: number): string {
  if (score >= 80) return 'bg-green-600 text-white';
  if (score >= 60) return 'bg-lime-600 text-white';
  if (score >= 40) return 'bg-yellow-500 text-black';
  if (score >= 20) return 'bg-orange-600 text-white';
  return 'bg-red-600 text-white';
}

/** Offizielles SLF-Ampelschema für Lawinen-Gefahrenstufen 1–5. */
export const AVALANCHE_LEVELS: Record<number, { label: string; color: string; text: string }> = {
  1: { label: 'gering', color: '#c8e676', text: '#1a1a1a' },
  2: { label: 'mässig', color: '#fff200', text: '#1a1a1a' },
  3: { label: 'erheblich', color: '#ff9900', text: '#1a1a1a' },
  4: { label: 'gross', color: '#ff0000', text: '#ffffff' },
  5: { label: 'sehr gross', color: '#a30000', text: '#ffffff' },
};

export function formatDriveMinutes(min: number): string {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
