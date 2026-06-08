'use client';

import type { TrendScore } from '@ch-alpineroute/shared';
import { AVALANCHE_LEVELS, scoreBadgeClasses } from '@/lib/format';

export function ScoreBadge({ score }: { score: number }) {
  return (
    <span
      className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm font-bold ${scoreBadgeClasses(
        score,
      )}`}
      title="Gesamt-Score (0–100)"
    >
      {score}
    </span>
  );
}

export function AvalancheBadge({ level }: { level: number | null }) {
  if (level == null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-700 px-2 py-1 text-xs text-slate-200">
        ❄️ Lawine: k.A.
      </span>
    );
  }
  const info = AVALANCHE_LEVELS[level] ?? AVALANCHE_LEVELS[1];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold"
      style={{ backgroundColor: info.color, color: info.text }}
      title="Lawinen-Gefahrenstufe (SLF) – ersetzt nicht das offizielle Bulletin"
    >
      ⚠️ Stufe {level} · {info.label}
    </span>
  );
}

export function TrendBadge({ trend }: { trend: TrendScore | null }) {
  if (!trend) return null;
  const title = trend.rationale
    ? `${trend.rationale}${trend.isEstimate ? ' · Bekanntheits-Schätzung' : ''}`
    : 'Bekanntheits-Schätzung';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2 py-1 text-xs text-orange-300"
      title={title}
    >
      🔥 {trend.score}
    </span>
  );
}
