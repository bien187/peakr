/**
 * Darstellungslogik der Sammelmarkierungen («Pulse Cluster») – ohne DOM, testbar.
 *
 *  - Grösse: logarithmisch, fest verankert (2 Ziele → klein, 1000+ → gross). Sie
 *    hängt nur von der Anzahl ab, nicht vom Zoom oder vom grössten sichtbaren
 *    Zähler – so bleibt sie beim Zoomen und Verschieben stabil.
 *  - Stufen: klein (nur Zahl), mittel (Zahl + Bergsymbol), gross (+ ein
 *    Topo-Ring, Kategorien beim Überfahren), sehr gross (+ zweiter Ring).
 *  - Kategorien: nur aus den tatsächlichen Arten der Ziele (clusterProperties der
 *    Kartenquelle), nie geschätzt.
 */
import { KIND_META } from './peakr';

export type ClusterTier = 'sm' | 'md' | 'lg' | 'xl';

/** Arten, die die Kartenquelle je Zähler mitzählt (siehe clusterProperties in PeakrMap). */
export const CLUSTER_KINDS = ['peak', 'viewpoint', 'hut', 'lake', 'pass', 'ski'] as const;
export type ClusterKind = (typeof CLUSTER_KINDS)[number];

/** Bezugsgrössen der logarithmischen Skala: ab hier klein bzw. gross. */
const REF_MIN = 2;
const REF_MAX = 1000;

/** Normierte Grösse 0–1 (log(count/2) / log(1000/2), begrenzt). */
export function clusterScale(count: number): number {
  const c = Math.max(REF_MIN, count);
  return Math.min(1, Math.log(c / REF_MIN) / Math.log(REF_MAX / REF_MIN));
}

/**
 * Durchmesser in Pixeln: Desktop 42–70, Handy 36–58. In 2-px-Stufen, damit kleine
 * Änderungen der Anzahl die Grösse nicht flackern lassen.
 */
export function clusterSize(count: number, compact: boolean): number {
  const [min, max] = compact ? [36, 58] : [42, 70];
  return Math.round((min + (max - min) * clusterScale(count)) / 2) * 2;
}

export function clusterTier(count: number): ClusterTier {
  if (count < 20) return 'sm';
  if (count < 100) return 'md';
  if (count < 400) return 'lg';
  return 'xl';
}

const nf = new Intl.NumberFormat('de-CH');

/** Zahl im Zähler, mit Schweizer Tausendertrennung. */
export function formatCount(n: number): string {
  return nf.format(n);
}

export interface ClusterCategory {
  kind: ClusterKind;
  count: number;
  label: string;
}

/** Vorhandene Kategorien eines Zählers, häufigste zuerst. */
export function clusterCategories(props: Partial<Record<ClusterKind, unknown>>): ClusterCategory[] {
  const out: ClusterCategory[] = [];
  for (const kind of CLUSTER_KINDS) {
    const v = props[kind];
    const count = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
    if (count <= 0) continue;
    const meta = KIND_META[kind];
    out.push({ kind, count, label: count === 1 ? meta.label : meta.plural });
  }
  return out.sort((a, b) => b.count - a.count || CLUSTER_KINDS.indexOf(a.kind) - CLUSTER_KINDS.indexOf(b.kind));
}

/**
 * Zweite Zeile für grosse Zähler, z. B. «180 Gipfel · 120 Hütten» – höchstens zwei
 * Kategorien. null bei kleinen Zählern oder wenn die Arten nichts Neues sagen
 * (nur eine Art, deren Anzahl ohnehin der Zahl entspricht).
 */
export function clusterInfoLine(count: number, cats: ClusterCategory[]): string | null {
  const tier = clusterTier(count);
  if (tier === 'sm' || tier === 'md' || cats.length === 0) return null;
  if (cats.length === 1 && cats[0].count === count) return null;
  return cats
    .slice(0, 2)
    .map((c) => `${formatCount(c.count)} ${c.label}`)
    .join(' · ');
}

/** Vorlesetext des Zählers. */
export function clusterAriaLabel(count: number, cats: ClusterCategory[]): string {
  const parts = cats.slice(0, 4).map((c) => `${formatCount(c.count)} ${c.label}`);
  return `${formatCount(count)} Ziele${parts.length > 0 ? `: ${parts.join(', ')}` : ''} – hineinzoomen`;
}
