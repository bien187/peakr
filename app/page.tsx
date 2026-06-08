'use client';

import type { SearchResponse } from '@ch-alpineroute/shared';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FilterPanel } from '@/components/FilterPanel';
import { Header } from '@/components/Header';
import type { MapPoint } from '@/components/MapView';
import { ResultList } from '@/components/ResultList';
import { ListSkeleton } from '@/components/Skeleton';
import { api, ApiError } from '@/lib/api';
import { defaultSearchParams, type SearchParams } from '@/lib/searchParams';
import { useAuthStore } from '@/lib/store';

const STORAGE_KEY = 'ch-alpineroute-search';

const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-slate-500">Karte lädt …</div>
  ),
});

export default function HomePage() {
  const [params, setParams] = useState<SearchParams>(defaultSearchParams);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const token = useAuthStore((s) => s.token);
  const restored = useRef(false);

  // Favoriten des angemeldeten Users laden (kontogebunden)
  useEffect(() => {
    if (!token) {
      setFavoriteIds(new Set());
      return;
    }
    api
      .favorites()
      .then((f) => setFavoriteIds(new Set(f.map((x) => x.id))))
      .catch(() => undefined);
  }, [token]);

  const runSearch = async (p: SearchParams) => {
    if (!p.origin) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.search({
        origin: p.origin,
        mode: p.mode,
        maxMinutes: p.maxMinutes,
        toleranceMinutes: p.toleranceMinutes,
        hikeKind: p.mode === 'hike' ? p.hikeKind : undefined,
        maxSacDifficulty: p.mode === 'hike' && p.maxSacDifficulty ? p.maxSacDifficulty : undefined,
      });
      setData(res);
      setSelectedId(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Suche fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  };

  // Letzte Suche wiederherstellen + automatisch erneut ausführen (Sterne kommen zurück)
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as SearchParams;
      setParams(saved);
      if (saved.origin) void runSearch(saved);
    } catch {
      /* ignore */
    }
  }, []);

  // Suchparameter persistieren
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    } catch {
      /* ignore */
    }
  }, [params]);

  const onChange = (patch: Partial<SearchParams>) => setParams((p) => ({ ...p, ...patch }));

  const toggleFavorite = async (id: string) => {
    if (!token) return;
    const has = favoriteIds.has(id);
    const optimistic = new Set(favoriteIds);
    if (has) optimistic.delete(id);
    else optimistic.add(id);
    setFavoriteIds(optimistic);
    try {
      if (has) await api.removeFavorite(id);
      else await api.addFavorite(id);
    } catch {
      setFavoriteIds(favoriteIds); // zurückrollen
    }
  };

  const points: MapPoint[] = useMemo(() => {
    if (!data) return [];
    return [...data.results, ...data.suggestions].map((r) => ({
      id: r.id,
      name: r.name,
      location: r.location,
      score: r.score,
      blocked: r.blocked,
    }));
  }, [data]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="flex flex-1 flex-col lg:grid lg:h-[calc(100vh-4rem)] lg:grid-cols-[20rem_1fr_26rem] lg:overflow-hidden">
        <aside className="border-b border-slate-800 p-4 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <FilterPanel
            params={params}
            onChange={onChange}
            onSearch={() => void runSearch(params)}
            loading={loading}
          />
          {error && <p className="mt-3 rounded-lg bg-red-950 p-2 text-sm text-red-300">{error}</p>}
          {!token && (
            <p className="mt-3 text-[11px] text-slate-500">
              Tipp:{' '}
              <a href="/login" className="underline">
                anmelden
              </a>
              , um Favoriten (★) zu speichern.
            </p>
          )}
          <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
            ⚠️ Lawinenangaben sind orientierend und ersetzen nicht das offizielle{' '}
            <a className="underline" href="https://whiterisk.ch" target="_blank" rel="noreferrer">
              SLF-Bulletin
            </a>
            .
          </p>
        </aside>

        <div className="h-72 lg:h-full">
          <MapView
            points={points}
            origin={params.origin}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        <section className="overflow-y-auto p-4">
          {loading ? (
            <ListSkeleton />
          ) : data ? (
            <ResultList
              data={data}
              selectedId={selectedId}
              onSelect={setSelectedId}
              canFavorite={!!token}
              favoriteIds={favoriteIds}
              onToggleFavorite={toggleFavorite}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
              <p className="mb-2 text-2xl">🎿🥾</p>
              <p className="font-semibold text-slate-200">Wähle Modus &amp; Startort</p>
              <p className="text-sm">
                Dann findest du die besten Ziele nach Fahrzeit, Schnee, Lawinenlage und Bekanntheit.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
