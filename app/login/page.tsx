'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Header } from '@/components/Header';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api.login({ email, password });
      setAuth(r.token, r.user);
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto max-w-md p-6">
        <h1 className="mb-4 text-2xl font-bold">Anmelden</h1>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            placeholder="E-Mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-11 rounded-lg border border-slate-700 bg-slate-900 px-3"
          />
          <input
            type="password"
            required
            placeholder="Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="min-h-11 rounded-lg border border-slate-700 bg-slate-900 px-3"
          />
          {error && <p className="rounded bg-red-950 p-2 text-sm text-red-300">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="min-h-12 rounded-xl bg-sky-600 font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {loading ? 'Anmelden …' : 'Anmelden'}
          </button>
        </form>
        <p className="mt-4 text-sm text-slate-400">
          Noch kein Konto?{' '}
          <Link href="/register" className="text-sky-400 underline">
            Registrieren
          </Link>
        </p>
      </main>
    </div>
  );
}
