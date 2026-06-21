'use client';

import type { LatLng, SearchResponse } from '@ch-alpineroute/shared';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResultsPanel } from '@/components/PeakrUI';
import { SearchControls, type PParams } from '@/components/SearchControls';
import { TopBar } from '@/components/PeakrChrome';
import { api, ApiError } from '@/lib/api';
import { adaptResult, ORIGINS, sortCards } from '@/lib/peakr';
import { useFavorites } from '@/lib/useFavorites';
import { useSettings } from '@/lib/theme';
import { useAuthStore } from '@/lib/store';

// Echte MapLibre-Karte (swisstopo) → nur clientseitig laden.
const PeakrMap = dynamic(() => import('@/components/PeakrMap').then((m) => m.PeakrMap), {
  ssr: false,
  loading: () => <div className="map-wrap" />,
});

const PARAMS_KEY = 'peakr-params';

const DEFAULT_PARAMS: PParams = {
  origin: { lat: ORIGINS[0].lat, lng: ORIGINS[0].lng },
  originLabel: ORIGINS[0].label,
  mode: 'ski',
  maxMin: 120,
  tolMin: 20,
  hikeKind: 'any',
  maxSac: '',
};

export default function HomePage() {
  const router = useRouter();
  const { favs, toggle: onFav } = useFavorites();
  const { setAppMode } = useSettings();
  const { user } = useAuthStore();

  const [params, setParams] = useState<PParams>(DEFAULT_PARAMS);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState('score');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const restored = useRef(false);
  const homeApplied = useRef(false);

  // gespeicherte Parameter wiederherstellen
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const r = localStorage.getItem(PARAMS_KEY);
      if (r) {
        const p = { ...DEFAULT_PARAMS, ...(JSON.parse(r) as Partial<PParams>) };
        setParams(p);
        if (p.mode) setAppMode(p.mode);
      }
    } catch {
      /* ignore */
    } finally {
      setHydrated(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Gespeicherten Heimatort automatisch laden (einmalig, nur wenn kein expliziter Startort in localStorage)
  useEffect(() => {
    if (homeApplied.current) return;
    if (!user?.homeLocation || !user?.homeLabel) return;
    homeApplied.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(PARAMS_KEY) || 'null') as Partial<PParams> | null;
      if (!saved?.origin) {
        setParams((p) => ({ ...p, origin: user.homeLocation!, originLabel: user.homeLabel! }));
      }
    } catch { /* ignore */ }
  }, [user]);

  // Parameter persistieren – erst NACH dem Wiederherstellen, sonst überschreibt der
  // Initial-Render (DEFAULT_PARAMS = ski) die gespeicherten Werte, bevor sie gelesen werden.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(PARAMS_KEY, JSON.stringify(params));
    } catch {
      /* ignore */
    }
  }, [params, hydrated]);

  const set = (patch: Partial<PParams>) => {
    if (patch.mode) setAppMode(patch.mode);
    setParams((p) => ({ ...p, ...patch }));
  };

  // Suche bei Parameteränderung (leicht entprellt, damit Slider nicht spammt)
  useEffect(() => {
    if (!params.origin) return;
    const origin = params.origin;
    const handle = setTimeout(() => {
      setLoading(true);
      setError(null);
      api
        .search({
          origin,
          mode: params.mode,
          maxMinutes: params.maxMin,
          toleranceMinutes: params.tolMin,
          hikeKind: params.mode === 'hike' ? (params.hikeKind as never) : undefined,
          maxSacDifficulty:
            params.mode === 'hike' && params.maxSac ? (params.maxSac as never) : undefined,
        })
        .then((res) => {
          setData(res);
          setSelectedId(null);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : 'Suche fehlgeschlagen.'))
        .finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(handle);
  }, [params]);

  const onLocate = () => {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        set({
          origin: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          originLabel: 'Mein Standort',
        });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  // Zielart-Filter passiert serverseitig (poi_kind) – hier nur noch sortieren.
  const results = useMemo(
    () => (data ? sortCards(data.results.map((r) => adaptResult(r, false)), sort) : []),
    [data, sort],
  );
  const suggestions = useMemo(
    () => (data ? sortCards(data.suggestions.map((r) => adaptResult(r, true)), sort) : []),
    [data, sort],
  );

  // Karte zeigt exakt die Treffer der Liste.
  const mapCards = useMemo(() => [...results, ...suggestions], [results, suggestions]);

  const originPt: LatLng = params.origin ?? { lat: ORIGINS[0].lat, lng: ORIGINS[0].lng };

  // Stabile Callbacks → die memoisierten ResultCards rendern bei Auswahl nicht alle neu.
  const handleMapSelect = useCallback((id: string) => {
    setSelectedId(id);
    setSheetOpen(true);
  }, []);
  const handleOpen = useCallback(
    (id: string) => router.push(`/destinations/${id}?fromlat=${originPt.lat}&fromlng=${originPt.lng}`),
    [router, originPt.lat, originPt.lng],
  );

  return (
    <>
      <TopBar
        centerSlot={
          <SearchControls params={params} set={set} onLocate={onLocate} locating={locating} />
        }
      />
      <div className="stage">
        <PeakrMap
          points={mapCards}
          originPt={originPt}
          originLabel={params.originLabel || 'Start'}
          selectedId={selectedId}
          onSelect={handleMapSelect}
          mode={params.mode}
          alwaysLabels={true}
        />
        <ResultsPanel
          results={results}
          suggestions={suggestions}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpen={handleOpen}
          favs={favs}
          onFav={onFav}
          originLabel={params.originLabel || 'Start'}
          mode={params.mode}
          sort={sort}
          onSort={setSort}
          count={results.length}
          sheetOpen={sheetOpen}
          onSheetToggle={() => setSheetOpen((v) => !v)}
        />
      </div>
      {(error || loading) && (
        <div className="search-status">
          {loading ? 'Suche läuft …' : error}
        </div>
      )}
    </>
  );
}
