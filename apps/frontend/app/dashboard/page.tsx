'use client';

import type { DestinationWithStatus, LatLng } from '@ch-alpineroute/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TrendBadge } from '@/components/badges';
import { Header } from '@/components/Header';
import { LocationSearch } from '@/components/LocationSearch';
import { api } from '@/lib/api';
import { weatherInfo } from '@/lib/format';
import { useAuthStore } from '@/lib/store';

export default function DashboardPage() {
  const router = useRouter();
  const { token, user, setUser } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  const [favorites, setFavorites] = useState<DestinationWithStatus[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [openAiKey, setOpenAiKey] = useState('');

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !token) router.push('/login');
  }, [mounted, token, router]);

  useEffect(() => {
    if (token)
      api
        .favorites()
        .then(setFavorites)
        .catch(() => undefined);
  }, [token]);

  const saveHome = async (loc: LatLng, label: string) => {
    const u = await api.updateMe({ homeLocation: loc, homeLabel: label });
    setUser(u);
    setMsg('Startort gespeichert.');
  };

  const removeFav = async (id: string) => {
    await api.removeFavorite(id);
    setFavorites((f) => f.filter((x) => x.id !== id));
  };

  if (!mounted || !token) return null;

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-3xl space-y-8 p-6">
        <section>
          <h1 className="mb-1 text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-slate-400">Angemeldet als {user?.email}</p>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-semibold">🏠 Standard-Startort</h2>
          <p className="mb-2 text-sm text-slate-400">
            Aktuell: {user?.homeLabel ?? 'nicht gesetzt'}
          </p>
          <LocationSearch label={user?.homeLabel ?? ''} onSelect={saveHome} />
          {msg && <p className="mt-2 text-sm text-green-400">{msg}</p>}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="mb-2 font-semibold">🤖 OpenAI-Key (optional, kostenpflichtig)</h2>
          <p className="mb-2 text-sm text-slate-400">
            Status: {user?.hasOpenAiKey ? 'hinterlegt ✓' : 'nicht hinterlegt'}. Wird verschlüsselt
            gespeichert und nie angezeigt.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="password"
              placeholder="sk-…"
              value={openAiKey}
              onChange={(e) => setOpenAiKey(e.target.value)}
              className="min-h-11 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm"
            />
            <button
              onClick={async () => {
                await api.setOpenAiKey(openAiKey);
                setOpenAiKey('');
                const me = await api.me();
                setUser(me);
                setMsg('OpenAI-Key gespeichert.');
              }}
              disabled={openAiKey.trim().length < 20}
              className="min-h-11 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              Speichern
            </button>
          </div>
        </section>

        <section>
          <h2 className="mb-3 font-semibold">★ Favoriten ({favorites.length})</h2>
          {favorites.length === 0 ? (
            <p className="text-sm text-slate-400">
              Noch keine Favoriten. Markiere Ziele in der Suche mit dem Stern.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {favorites.map((f) => {
                const w = weatherInfo(f.live?.weatherCode ?? null);
                return (
                  <div key={f.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <h3 className="truncate font-bold">{f.name}</h3>
                      <TrendBadge trend={f.trend} />
                    </div>
                    <p className="mb-2 text-xs text-slate-400">
                      {w.emoji} {w.label}
                      {f.live?.snowDepthTopCm != null
                        ? ` · ${f.live.snowDepthTopCm} cm Schnee`
                        : ''}
                    </p>
                    <div className="flex gap-2">
                      <Link
                        href={`/destinations/${f.id}`}
                        className="min-h-9 rounded-lg bg-slate-800 px-3 py-1 text-xs hover:bg-slate-700"
                      >
                        Details →
                      </Link>
                      <button
                        onClick={() => removeFav(f.id)}
                        className="min-h-9 rounded-lg px-3 py-1 text-xs text-red-300 hover:bg-slate-800"
                      >
                        Entfernen
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
