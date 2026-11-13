'use client';

import dynamic from 'next/dynamic';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { CompassLoader } from '@/components/PeakrUI';
import { api, ApiError } from '@/lib/api';
import { adaptDetail, type PDetail } from '@/lib/peakr';
import { useFavorites } from '@/lib/useFavorites';

// Detailansicht enthält MapLibre (3D) → nur clientseitig laden.
const DetailView = dynamic(() => import('@/components/PeakrDetail').then((m) => m.DetailView), {
  ssr: false,
  loading: () => (
    <div className="page-pad">
      <CompassLoader label="Ansicht wird vorbereitet …" />
    </div>
  ),
});

function parseOrigin(sp: URLSearchParams): { lat: number; lng: number } | null {
  // «from=lat,lng»; die frühere Schreibweise fromlat/fromlng bleibt für alte Links gültig.
  const from = sp.get('from');
  const [a, b] = from ? from.split(',') : [sp.get('fromlat') ?? '', sp.get('fromlng') ?? ''];
  const lat = parseFloat(a ?? '');
  const lng = parseFloat(b ?? '');
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function DestinationDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isFav, toggle } = useFavorites();
  const [d, setD] = useState<PDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const originKey = searchParams.get('from') ?? `${searchParams.get('fromlat') ?? ''},${searchParams.get('fromlng') ?? ''}`;
  const origin = useMemo(() => parseOrigin(new URLSearchParams(searchParams.toString())), [originKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const routeParam = Number(searchParams.get('route'));
  const initialRouteId = Number.isInteger(routeParam) && routeParam > 0 ? routeParam : null;
  // Planung aus der Suche (Datum, Startstunde); ohne Angabe wählt der Server.
  const planDateParam = searchParams.get('date');
  const planStartParam = Number(searchParams.get('start'));
  const plan = useMemo(
    () =>
      planDateParam && /^\d{4}-\d{2}-\d{2}$/.test(planDateParam) && Number.isInteger(planStartParam)
        ? { date: planDateParam, startHour: planStartParam }
        : null,
    [planDateParam, planStartParam],
  );

  useEffect(() => {
    if (!params?.id) return;
    const ctrl = new AbortController();
    setError(null);
    setD(null);
    api
      .destination(params.id, origin, ctrl.signal, plan)
      .then((x) => setD(adaptDetail(x)))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.');
      });
    return () => ctrl.abort();
  }, [params?.id, origin, plan]);

  if (error) {
    return (
      <div className="detail">
        <div className="detail-body">
          <p className="detail-note is-plain">{error}</p>
          <button type="button" className="btn" onClick={() => router.push('/')} style={{ marginTop: 16 }}>
            Zurück zur Suche
          </button>
        </div>
      </div>
    );
  }

  if (!d)
    return (
      <div className="page-pad">
        <CompassLoader label="Ziel wird geladen …" />
      </div>
    );

  return (
    <DetailView
      d={d}
      isFav={isFav(d.id)}
      onFav={toggle}
      onBack={() => router.push('/')}
      origin={origin}
      originLabel={searchParams.get('label')}
      initialRouteId={initialRouteId}
    />
  );
}

export default function DestinationDetailPage() {
  // useSearchParams braucht eine Suspense-Grenze, sonst scheitert der statische Build.
  return (
    <Suspense
      fallback={
        <div className="page-pad">
          <CompassLoader label="Ziel wird geladen …" />
        </div>
      }
    >
      <DestinationDetail />
    </Suspense>
  );
}
