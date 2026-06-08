'use client';

import type { DestinationDetail } from '@ch-alpineroute/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AvalancheBadge, TrendBadge } from '@/components/badges';
import { Header } from '@/components/Header';
import { HistoryChart } from '@/components/HistoryChart';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, weatherInfo } from '@/lib/format';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

export default function DestinationDetailPage() {
  const params = useParams<{ id: string }>();
  const [d, setD] = useState<DestinationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    api
      .destination(params.id)
      .then(setD)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Laden fehlgeschlagen.'));
  }, [params?.id]);

  if (error) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="mx-auto max-w-3xl p-6">
          <p className="rounded bg-red-950 p-3 text-red-300">{error}</p>
          <Link href="/" className="mt-4 inline-block text-sky-400 underline">
            ← Zurück zur Suche
          </Link>
        </main>
      </div>
    );
  }

  if (!d) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="mx-auto max-w-3xl p-6 text-slate-400">Lädt …</main>
      </div>
    );
  }

  const isSki = d.type === 'ski_resort';
  const w = weatherInfo(d.live?.weatherCode ?? null);

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <Link href="/" className="text-sm text-sky-400 underline">
            ← Zurück zur Suche
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold">{d.name}</h1>
            <TrendBadge trend={d.trend} />
          </div>
          <p className="text-sm text-slate-400">
            {isSki ? 'Skigebiet' : 'Wanderziel'}
            {d.canton ? ` · Kanton ${d.canton}` : ''}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${d.location.lat},${d.location.lng}`}
              target="_blank"
              rel="noreferrer"
              className="min-h-9 rounded-lg bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
            >
              🗺️ Google Maps
            </a>
            <a
              href={`https://maps.apple.com/?daddr=${d.location.lat},${d.location.lng}&q=${encodeURIComponent(d.name)}`}
              target="_blank"
              rel="noreferrer"
              className="min-h-9 rounded-lg bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
            >
              Apple Maps
            </a>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {isSki ? (
            <>
              <Fact
                label="Höhe Tal"
                value={d.elevationBaseM != null ? `${d.elevationBaseM} m` : '–'}
              />
              <Fact
                label="Höhe Berg"
                value={d.elevationTopM != null ? `${d.elevationTopM} m` : '–'}
              />
              <Fact
                label="Schnee Berg"
                value={d.live?.snowDepthTopCm != null ? `${d.live.snowDepthTopCm} cm` : '–'}
              />
              <Fact
                label="Neuschnee"
                value={d.live?.freshSnowCm != null ? `${d.live.freshSnowCm} cm` : '–'}
              />
            </>
          ) : (
            <>
              <Fact label="SAC-Grad" value={d.sacDifficulty ?? '–'} />
              <Fact label="Höhe" value={d.elevationTopM != null ? `${d.elevationTopM} m` : '–'} />
              <Fact label="Aufstieg" value={d.ascentM != null ? `${d.ascentM} hm` : '–'} />
              <Fact label="Distanz" value={d.distanceKm != null ? `${d.distanceKm} km` : '–'} />
            </>
          )}
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-semibold">Aktuelle Lage</h2>
          {d.live ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>
                {w.emoji} {w.label}
                {d.live.temperatureC != null ? ` · ${Math.round(d.live.temperatureC)} °C` : ''}
              </span>
              {d.live.windKmh != null && <span>💨 {Math.round(d.live.windKmh)} km/h</span>}
              {isSki && <AvalancheBadge level={d.live.avalancheLevel ?? null} />}
              <span className="text-xs text-slate-500">
                Stand: {formatDateTime(d.live.capturedAt)}
              </span>
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              Noch keine Live-Daten (Worker noch nicht gelaufen).
            </p>
          )}
          {isSki && (
            <p className="mt-3 text-xs text-slate-500">
              ⚠️ Lawinen-Einschätzung ersetzt nicht das offizielle{' '}
              <a className="underline" href="https://whiterisk.ch" target="_blank" rel="noreferrer">
                SLF-Bulletin
              </a>
              .
            </p>
          )}
        </section>

        <section>
          <h2 className="mb-2 font-semibold">Verlauf</h2>
          <HistoryChart history={d.history} />
        </section>

        {d.wikipediaTitle && (
          <a
            href={`https://de.wikipedia.org/wiki/${encodeURIComponent(d.wikipediaTitle)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm text-sky-400 underline"
          >
            Mehr auf Wikipedia →
          </a>
        )}
      </main>
    </div>
  );
}
