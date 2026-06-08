'use client';

import type { SearchResult } from '@ch-alpineroute/shared';
import Link from 'next/link';
import { formatDriveMinutes, weatherInfo } from '@/lib/format';
import { AvalancheBadge, ScoreBadge, TrendBadge } from './badges';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-100">{value}</span>
    </div>
  );
}

export function ResultCard({
  result,
  selected,
  onSelect,
  canFavorite,
  isFavorite,
  onToggleFavorite,
}: {
  result: SearchResult;
  selected: boolean;
  onSelect: (id: string) => void;
  canFavorite: boolean;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
}) {
  const w = weatherInfo(result.live?.weatherCode ?? null);
  const isSki = result.type === 'ski_resort';

  return (
    <article
      onClick={() => onSelect(result.id)}
      className={`cursor-pointer rounded-xl border bg-slate-900 p-4 transition hover:border-sky-600 ${
        selected ? 'border-sky-500 ring-1 ring-sky-500' : 'border-slate-800'
      } ${result.blocked ? 'border-red-700/70' : ''}`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-white">{result.name}</h3>
          <p className="text-xs text-slate-400">
            {result.canton ? `${result.canton} · ` : ''}
            {formatDriveMinutes(result.driveMinutes)} Fahrt · {result.distanceAirKm} km Luftlinie
            {result.overBudgetMinutes ? (
              <span className="ml-1 rounded bg-amber-900/60 px-1 text-amber-300">
                +{result.overBudgetMinutes} Min
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TrendBadge trend={result.trend} />
          <ScoreBadge score={result.score} />
        </div>
      </div>

      {result.blocked && result.blockedReason && (
        <p className="mb-2 rounded-lg bg-red-950/70 px-2 py-1 text-xs font-semibold text-red-300">
          🚫 {result.blockedReason}
        </p>
      )}

      <div className="mb-3 grid grid-cols-3 gap-2">
        {isSki ? (
          <>
            <Stat
              label="Schnee Berg"
              value={result.live?.snowDepthTopCm != null ? `${result.live.snowDepthTopCm} cm` : '–'}
            />
            <Stat
              label="Neuschnee"
              value={result.live?.freshSnowCm != null ? `${result.live.freshSnowCm} cm` : '–'}
            />
            <Stat
              label="Lifte"
              value={
                result.live?.liftsTotal
                  ? `${result.live.liftsOpen ?? 0}/${result.live.liftsTotal}`
                  : 'k.A.'
              }
            />
          </>
        ) : (
          <>
            <Stat label="SAC" value={result.sacDifficulty ?? '–'} />
            <Stat label="Aufstieg" value={result.ascentM != null ? `${result.ascentM} hm` : '–'} />
            <Stat
              label="Distanz"
              value={result.distanceKm != null ? `${result.distanceKm} km` : '–'}
            />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-800 px-2 py-1 text-xs">
          {w.emoji} {w.label}
          {result.live?.temperatureC != null ? ` · ${Math.round(result.live.temperatureC)}°C` : ''}
        </span>
        {isSki && <AvalancheBadge level={result.live?.avalancheLevel ?? null} />}
        <div className="ml-auto flex items-center gap-1">
          {canFavorite && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(result.id);
              }}
              className="min-h-9 rounded-lg px-2 text-lg hover:bg-slate-800"
              title={isFavorite ? 'Favorit entfernen' : 'Zu Favoriten'}
              aria-label="Favorit umschalten"
            >
              {isFavorite ? '★' : '☆'}
            </button>
          )}
          <Link
            href={`/destinations/${result.id}`}
            onClick={(e) => e.stopPropagation()}
            className="min-h-9 rounded-lg bg-slate-800 px-3 py-1 text-xs hover:bg-slate-700"
          >
            Details →
          </Link>
        </div>
      </div>
    </article>
  );
}
