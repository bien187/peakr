import type {
  DataFreshness,
  LiftStatusArea,
  LiftStatusSummary,
  OperationalStatus,
  ResortReportStatus,
  SlopeCounts,
  SourceLink,
  StatusCounts,
} from '@ch-alpineroute/shared';

/**
 * Anzeige des Lift- und Pistenstatus. Die Statuswerte kommen bereits
 * normalisiert vom Server (apps/backend/src/lifts/status.ts); hier stehen nur
 * Beschriftungen, Farben und Zeitangaben – an einem Ort für Karte und Detail.
 */

export const OP_STATUS: Record<OperationalStatus, { label: string; icon: string }> = {
  open: { label: 'offen', icon: 'Check' },
  preparation: { label: 'in Vorbereitung', icon: 'Clock' },
  closed: { label: 'geschlossen', icon: 'X' },
  unknown: { label: 'unbekannt', icon: 'CircleHelp' },
};

export const RESORT_STATUS: Record<
  ResortReportStatus,
  { label: string; short: string; icon: string; tone: OperationalStatus }
> = {
  open: { label: 'In Betrieb laut Bericht', short: 'in Betrieb', icon: 'Check', tone: 'open' },
  closed: { label: 'Geschlossen laut Bericht', short: 'geschlossen', icon: 'X', tone: 'closed' },
  no_report: {
    label: 'Kein aktueller Bericht',
    short: 'kein Bericht',
    icon: 'CircleHelp',
    tone: 'unknown',
  },
  unknown: { label: 'Status unbekannt', short: 'unbekannt', icon: 'CircleHelp', tone: 'unknown' },
};

export const FRESHNESS: Record<DataFreshness, { label: string; hint: string }> = {
  fresh: { label: 'aktuell', hint: 'Bericht von heute' },
  stale: { label: 'älter', hint: 'Bericht älter als 12 Stunden – für heute nicht verlässlich' },
  outdated: { label: 'veraltet', hint: 'Bericht älter als 36 Stunden' },
  unknown: { label: 'ohne Zeitpunkt', hint: 'Die Quelle nennt keinen Zeitpunkt' },
};

export const LIFT_TYPE: Record<string, string> = {
  gondola: 'Gondelbahn',
  cable_car: 'Luftseilbahn',
  chairlift: 'Sesselbahn',
  drag_lift: 'Schlepplift',
  carpet: 'Förderband',
  funicular: 'Standseilbahn',
  other: 'Anlage',
};

/** Schwierigkeit laut Quelle; Farbe nach Schweizer Signalisation. */
export const SLOPE_DIFFICULTY: Record<string, { label: string; color: string }> = {
  easy: { label: 'leicht', color: '#2f7fd1' },
  intermediate: { label: 'mittel', color: '#d8362a' },
  difficult: { label: 'schwer', color: '#1f2933' },
  ski_route: { label: 'Skiroute', color: '#e0a100' },
  other: { label: 'Piste', color: '#9aa3ad' },
};

const COLOUR: Record<string, string> = {
  green: '#4caf50',
  blue: '#2f7fd1',
  red: '#d8362a',
  black: '#1f2933',
  yellow: '#e0a100',
  orange: '#ef7d00',
};

/** Farbe einer Piste: zuerst die Farbe der Quelle, sonst die der Schwierigkeit. */
export function slopeColor(type: string | null, colour: string | null): string {
  const first = colour?.split('_')[0];
  return (
    (first && COLOUR[first]) ||
    SLOPE_DIFFICULTY[type ?? 'other']?.color ||
    SLOPE_DIFFICULTY.other.color
  );
}

/** Gebiet hat einen aktuellen Bericht (offen oder geschlossen gemeldet). */
export const isReporting = (s: { status: ResortReportStatus } | null | undefined): boolean =>
  !!s && (s.status === 'open' || s.status === 'closed');

/** «18/24» – fehlt «gesamt», nur die offene Zahl; ohne Angabe ein Strich. */
export function openOfTotal(c: StatusCounts | SlopeCounts): string {
  if (c.open === null) return '–';
  return c.total !== null ? `${c.open}/${c.total}` : String(c.open);
}

const zurich = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', ...opts }).format(new Date(iso));
const dayKey = (d: Date) =>
  zurich(d.toISOString(), { year: 'numeric', month: '2-digit', day: '2-digit' });

/** «08:40», «gestern 13:40» oder «18.12. 08:40» in Schweizer Zeit. */
export function reportTime(iso: string, now: Date = new Date()): string {
  const t = zurich(iso, { hour: '2-digit', minute: '2-digit' });
  const day = dayKey(new Date(iso));
  if (day === dayKey(now)) return t;
  if (day === dayKey(new Date(now.getTime() - 86_400_000))) return `gestern ${t}`;
  return `${zurich(iso, { day: '2-digit', month: '2-digit' })} ${t}`;
}

/** Kurztext: «Bericht 08:40» (Gebietsbericht) bzw. «Stand 08:40» (letzte Prüfung durch die Quelle). */
export function reportStamp(s: LiftStatusSummary, now: Date = new Date()): string {
  if (!s.dataAt) return 'kein aktueller Bericht';
  return `${s.dataAtIsReport ? 'Bericht' : 'Stand'} ${reportTime(s.dataAt, now)}`;
}

/** Domain eines Links für die Quellenangabe («infosnow.ch»). */
export function linkLabel(link: SourceLink | string): string {
  const url = typeof link === 'string' ? link : link.url;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Originalquellen, die genannt werden müssen (null = ungeprüft → nennen), ohne Doppelte. */
export function requiredCredits(links: SourceLink[]): string[] {
  return [...new Set(links.filter((l) => l.attributionRequired !== false).map(linkLabel))];
}

/**
 * Schneehöhen laut Bericht, je Gebiet mit Werten: «Berg 80 cm, Tal 35 cm, neu 5 cm»;
 * bei mehreren Gebieten mit Namen davor. Gebiete ohne Bericht oder ohne Werte entfallen.
 */
export function snowLines(areas: LiftStatusArea[]): string[] {
  const reporting = areas.filter((a) => a.status === 'open' || a.status === 'closed');
  return reporting.flatMap((a) => {
    const parts = [
      a.snow.mountainCm !== null ? `Berg ${a.snow.mountainCm} cm` : null,
      a.snow.valleyCm !== null ? `Tal ${a.snow.valleyCm} cm` : null,
      a.snow.freshCm ? `neu ${a.snow.freshCm} cm` : null,
    ].filter((p): p is string => p !== null);
    if (parts.length === 0) return [];
    return [reporting.length > 1 ? `${a.name}: ${parts.join(', ')}` : parts.join(', ')];
  });
}
