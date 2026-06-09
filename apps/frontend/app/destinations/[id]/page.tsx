'use client';

import dynamic from 'next/dynamic';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { adaptDetail, type PDetail } from '@/lib/peakr';
import { useFavorites } from '@/lib/useFavorites';

// Detailansicht enthält MapLibre (3D) → nur clientseitig laden.
const DetailView = dynamic(() => import('@/components/PeakrDetail').then((m) => m.DetailView), {
  ssr: false,
  loading: () => <div className="page-pad">3D-Ansicht wird vorbereitet …</div>,
});

export default function DestinationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isFav, toggle } = useFavorites();
  const [d, setD] = useState<PDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const origin = (() => {
    const lat = parseFloat(searchParams.get('fromlat') ?? '');
    const lng = parseFloat(searchParams.get('fromlng') ?? '');
    return !isNaN(lat) && !isNaN(lng) ? { lat, lng } : null;
  })();

  useEffect(() => {
    if (!params?.id) return;
    setError(null);
    api
      .destination(params.id)
      .then((x) => setD(adaptDetail(x)))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.'));
  }, [params?.id]);

  if (error) {
    return (
      <div className="detail">
        <div className="detail-body">
          <p className="detail-note">{error}</p>
          <button type="button" className="btn" onClick={() => router.push('/')}>
            Zurück zur Karte
          </button>
        </div>
      </div>
    );
  }

  if (!d) return <div className="page-pad">Lädt …</div>;

  return <DetailView d={d} isFav={isFav(d.id)} onFav={toggle} onBack={() => router.push('/')} origin={origin} />;
}
