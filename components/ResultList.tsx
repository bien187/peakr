'use client';

import type { SearchResponse } from '@ch-alpineroute/shared';
import { ResultCard } from './ResultCard';

export function ResultList({
  data,
  selectedId,
  onSelect,
  canFavorite,
  favoriteIds,
  onToggleFavorite,
}: {
  data: SearchResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
  canFavorite: boolean;
  favoriteIds: Set<string>;
  onToggleFavorite: (id: string) => void;
}) {
  const total = data.results.length + data.suggestions.length;

  if (total === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-400">
        Keine Ziele im Zeitfenster gefunden. Erhöhe die Fahrzeit oder Toleranz.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">
        {data.results.length} Treffer
        {!data.meta.matrixUsed && ' · Fahrzeiten geschätzt (kein ORS-Key)'}
      </p>

      {data.results.map((r) => (
        <ResultCard
          key={r.id}
          result={r}
          selected={selectedId === r.id}
          onSelect={onSelect}
          canFavorite={canFavorite}
          isFavorite={favoriteIds.has(r.id)}
          onToggleFavorite={onToggleFavorite}
        />
      ))}

      {data.suggestions.length > 0 && (
        <div className="mt-2 border-t border-dashed border-slate-700 pt-3">
          <h4 className="mb-2 text-sm font-semibold text-amber-300">
            Etwas weiter weg ({data.suggestions.length})
          </h4>
          <div className="flex flex-col gap-3">
            {data.suggestions.map((r) => (
              <ResultCard
                key={r.id}
                result={r}
                selected={selectedId === r.id}
                onSelect={onSelect}
                canFavorite={canFavorite}
                isFavorite={favoriteIds.has(r.id)}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
